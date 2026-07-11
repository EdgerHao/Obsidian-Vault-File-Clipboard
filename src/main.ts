import { App, Notice, Plugin, TFile, TFolder, TAbstractFile, Menu, MenuItem, PluginSettingTab, Setting, FileSystemAdapter } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import { exec, execFile } from 'child_process';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { t } from './lang/helpers';
// @ts-ignore
import * as electron from 'electron';

// Wir nutzen Electron für den Zugriff auf das Dateisystem-Clipboard und Drag & Drop
const { clipboard } = electron;

interface NaturalMoveSettings {
	targetFolderPath: string;
	enableAudioFeedback: boolean;
	pandocPath: string;
	customPandocArgs: string;
	wordTemplatesFolderPath: string;
	showPasteFromClipboardMenu: boolean;
	showCopyToTargetFolderMenu: boolean;
	showPandocExportMenu: boolean;
}

const DEFAULT_SETTINGS: NaturalMoveSettings = {
	targetFolderPath: '',
	enableAudioFeedback: true,
	pandocPath: 'pandoc',
	customPandocArgs: '',
	wordTemplatesFolderPath: '',
	showPasteFromClipboardMenu: true,
	showCopyToTargetFolderMenu: true,
	showPandocExportMenu: true
}

import en from './lang/locale/en';

interface PandocFormat {
	name: string;
	ext: string;
	args: string;
	icon: string;
	menuKey: keyof typeof en;
}

const PANDOC_FORMATS: Record<string, PandocFormat> = {
	'docx': { name: 'Word', ext: 'docx', args: '', icon: 'file-text', menuKey: 'WORD_TEMPLATES_MENU' },
	'pptx': { name: 'PowerPoint', ext: 'pptx', args: '', icon: 'presentation', menuKey: 'PPT_TEMPLATES_MENU' },
	'pdf': { name: 'PDF', ext: 'pdf', args: '', icon: 'file-text', menuKey: 'PDF_TEMPLATES_MENU' },
	'beamer': { name: 'Beamer-Slides', ext: 'pdf', args: '-t beamer', icon: 'presentation', menuKey: 'BEAMER_TEMPLATES_MENU' },
	'markdown': { name: 'Markdown', ext: 'md', args: '-t markdown', icon: 'file-text', menuKey: 'MD_TEMPLATES_MENU' },
	'html': { name: 'HTML', ext: 'html', args: '--embed-resources --standalone', icon: 'globe', menuKey: 'HTML_TEMPLATES_MENU' }
};

export default class NaturalMove extends Plugin {
	settings!: NaturalMoveSettings;
	private audioCtx: AudioContext | null = null;
	private boundDragStartHandler!: (evt: DragEvent) => void;

	private boundKeyDownHandler!: (evt: KeyboardEvent) => void;

	async onload() {
		console.debug(t('LOAD_PLUGIN'));
		await this.loadSettings();

		// Audio Context initialisieren
		this.initAudio();

		// 1. Globaler Copy-Handler für Cmd+C / Ctrl+C (via keydown)
		this.boundKeyDownHandler = (evt: KeyboardEvent) => {
			if ((evt.metaKey || evt.ctrlKey) && (evt.key.toLowerCase() === 'c' || evt.code === 'KeyC')) {
				const target = evt.target as HTMLElement;
				
				// Wenn der Fokus im Editor oder einem Eingabefeld liegt, IMMER das Standard-Copy von Obsidian/System zulassen
				if (
					target.tagName === 'INPUT' || 
					target.tagName === 'TEXTAREA' || 
					target.isContentEditable || 
					target.closest('.cm-editor, .markdown-source-view, .markdown-rendered')
				) {
					return;
				}

				const files = this.getSelectedFiles();
				if (files.length > 0) {
					evt.preventDefault();
					evt.stopPropagation();
					void this.copyFilesToClipboard(files);
				}
			}
		};
		document.addEventListener('keydown', this.boundKeyDownHandler, true);

		// 1b. Obsidian Command als Fallback
		this.addCommand({
			id: 'copy-selected-files',
			name: t('COPY_COMMAND_NAME'),
			callback: () => {
				const files = this.getSelectedFiles();
				if (files.length > 0) {
					void this.copyFilesToClipboard(files);
				} else {
					new Notice(t('NO_FILES_SELECTED'));
				}
			}
		});

		// 2. Drag & Drop Event (Capture Phase)
		this.boundDragStartHandler = this.handleDragStart.bind(this);
		document.addEventListener('dragstart', this.boundDragStartHandler, true);

		// 3. Kontextmenü (File Explorer)
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TAbstractFile) {
					this.addCopyMenuItems(menu, [file], false);
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on('files-menu', (menu, files) => {
				if (files.length > 0) {
					this.addCopyMenuItems(menu, files, false);
				}
			})
		);

		this.addSettingTab(new NaturalMoveSettingTab(this.app, this));
	}

	onunload() {
		console.debug(t('UNLOAD_PLUGIN'));
		if (this.audioCtx) void this.audioCtx.close();
		document.getElementById('natural-move-style')?.remove();
		document.removeEventListener('dragstart', this.boundDragStartHandler, true);
		document.removeEventListener('keydown', this.boundKeyDownHandler, true);
	}

	// ──────────────────────────────────────────────
	//  Drag & Drop Handler
	// ──────────────────────────────────────────────
	private handleDragStart(evt: DragEvent) {
		// 1. Wenn Alt/Option nicht gedrückt ist, machen wir absolut nichts.
		// Das stellt sicher, dass Obsidian's natives Drag & Drop (Verschieben innerhalb) unberührt bleibt.
		if (!evt.altKey) {
			return;
		}

		// 2. Wir prüfen, ob der Drag von einem File Explorer Element kommt.
		const target = evt.target as HTMLElement;
		if (!target || typeof target.closest !== 'function') return;

		const navFile = target.closest('.nav-file-title, .nav-file, .nav-folder-title, .nav-folder');
		if (!navFile) {
			// Alt ist gedrückt, aber kein Explorer-Item (z.B. Text im Editor).
			// Auch hier lassen wir Obsidian machen.
			return;
		}

		// 3. Alt ist gedrückt UND es ist ein Explorer-Item.
		// Jetzt übernehmen wir die Kontrolle für den externen Export.
		
		// Wir stoppen Obsidian's eigene Handler auf dem Document, damit es nicht versucht, 
		// die Datei intern zu verschieben/kopieren.
		evt.stopImmediatePropagation();

		const selectedFiles = this.getSelectedFiles();
		let files: TAbstractFile[] = [];
		
		const path = navFile.getAttribute('data-path') || navFile.querySelector('.nav-file-title, .nav-folder-title')?.getAttribute('data-path');
		const clickedFile = this.app.vault.getAbstractFileByPath(path || "");
		
		if (clickedFile) {
			if (selectedFiles.length > 1 && selectedFiles.some(f => f.path === clickedFile.path)) {
				files = selectedFiles;
			} else {
				files = [clickedFile];
			}
		}

		if (files.length > 0) {
			const absolutePaths = files
				.map(f => this.getAbsolutePath(f))
				.filter((p): p is string => p !== null);

			if (absolutePaths.length > 0) {
				this.startNativeDrag(evt, files, absolutePaths);
			}
		}
	}

	private startNativeDrag(evt: DragEvent, files: TAbstractFile[], absolutePaths: string[]) {
		let nativeDragSuccess = false;

		// 1. Versuch: Native Electron Drag (startDrag)
		try {
			const remote = (window as unknown as { require: (mod: string) => { getCurrentWebContents: () => { startDrag: (item: unknown) => void } } }).require('@electron/remote');
			const wc = remote.getCurrentWebContents();

			if (typeof wc.startDrag === 'function') {
				// Obsidian's internes Dragging stoppen, da startDrag übernimmt
				evt.preventDefault();
				evt.stopPropagation();

				let iconImage;
				try {
					const transparent1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
					iconImage = electron.nativeImage.createFromDataURL(transparent1x1);
				} catch {
					iconImage = "";
				}

				if (this.audioCtx?.state === 'suspended') {
					void this.audioCtx.resume();
				}

				wc.startDrag({
					file: absolutePaths[0],
					files: absolutePaths, // Für neuere Electron-Versionen (Multi-File)
					icon: iconImage
				});

				nativeDragSuccess = true;
				setTimeout(() => this.playSuccessSound(), 500);
			}
		} catch {
			console.debug("Native drag not available, falling back to HTML5 drag");
		}

		// 2. Fallback: HTML5 Drag (DownloadURL / ZIP)
		if (!nativeDragSuccess) {
			const isWin = os.platform() === 'win32';
			evt.dataTransfer?.clearData();

			if (absolutePaths.length === 1) {
				// Einzelne Datei
				let uri = absolutePaths[0].replace(/\\/g, '/');
				if (isWin && !uri.startsWith('/')) uri = '/' + uri;
				
				const downloadUrl = `application/octet-stream:${files[0].name}:file://${uri}`;
				evt.dataTransfer?.setData('DownloadURL', downloadUrl);
				evt.dataTransfer?.setData('text/uri-list', `file://${uri}`);
			} else {
				// Mehrere Dateien (ZIP Workaround)
				const zipName = `Obsidian_Export_${Date.now()}.zip`;
				const zipPath = path.join(os.tmpdir(), zipName);
				this.createZip(absolutePaths, zipPath);
				
				let uri = zipPath.replace(/\\/g, '/');
				if (isWin && !uri.startsWith('/')) uri = '/' + uri;
				
				const downloadUrl = `application/octet-stream:${zipName}:file://${uri}`;
				evt.dataTransfer?.setData('DownloadURL', downloadUrl);
				evt.dataTransfer?.setData('text/uri-list', `file://${uri}`);
			}

			evt.dataTransfer?.setData('text/plain', absolutePaths.join('\n'));
			evt.stopPropagation(); // Verhindert, dass Obsidian die Daten überschreibt
		}
	}

	private createZip(sourcePaths: string[], destPath: string) {
		const platform = os.platform();
		try {
			if (platform === 'darwin') {
				// Mac: natives zip Kommando (-j ignoriert Ordnerstrukturen, -q ist quiet)
				const escapedPaths = sourcePaths.map(p => `"${p.replace(/"/g, '\\"')}"`).join(' ');
				exec(`zip -j -q "${destPath}" ${escapedPaths}`, (error) => {
					if (error) console.error('Zip creation failed (Mac):', error);
				});
			} else if (platform === 'win32') {
				// Windows: PowerShell Compress-Archive
				const escapedPaths = sourcePaths.map(p => `'${p.replace(/'/g, "''")}'`).join(',');
				const script = `powershell.exe -NoProfile -Command "Compress-Archive -Path ${escapedPaths} -DestinationPath '${destPath}' -Force"`;
				exec(script, (error) => {
					if (error) console.error('Zip creation failed (Win):', error);
				});
			}
		} catch (e) {
			console.error('Failed to execute zip command:', e);
		}
	}

	// ──────────────────────────────────────────────
	//  Hilfsfunktionen
	// ──────────────────────────────────────────────

	private addCopyMenuItems(menu: Menu, files: TAbstractFile[], isLink: boolean = false) {
		const fileCount = files.length;
		const labelSuffix = fileCount > 1 ? ` (${fileCount})` : '';
		const prefix = isLink ? t('LINKED_FILE') : '';

		// Import files copied in Finder/Explorer into the selected vault folder.
		if (this.settings.showPasteFromClipboardMenu && files.length === 1 && files[0] instanceof TFolder) {
			menu.addItem((item: MenuItem) => {
				item
					.setTitle(t('PASTE_FROM_CLIPBOARD'))
					.setIcon('clipboard-paste')
					.setSection('action')
					.onClick(() => void this.pasteExternalFiles(files[0] as TFolder));
			});
		}

		// Files and folders can both be copied for free.
		menu.addItem((item: MenuItem) => {
			const title = `${prefix}${t('COPY_TO_CLIPBOARD')}${labelSuffix}`;
			item
				.setTitle(title)
				.setIcon('copy')
				.setSection('action')
				.onClick(() => {
					this.copyFilesToClipboard(files);
				});
		});

		if (this.settings.showCopyToTargetFolderMenu) {
			menu.addItem((item: MenuItem) => {
				const title = `${prefix}${t('COPY_TO_TARGET_FOLDER')}${labelSuffix}`;
				item
					.setTitle(title)
					.setIcon('folder-check')
					.setSection('action')
					.onClick(() => this.copyToTargetFolder(files));
			});
		}

		// Pandoc export is free and can be hidden from the context menu in settings.
		const mdFiles = files.filter((f): f is TFile => f instanceof TFile && f.extension === 'md');
		if (mdFiles.length > 0 && this.settings.showPandocExportMenu) {
			menu.addItem((mainItem: MenuItem) => {
				const mainTitle = t('EXPORT_SUBMENU_TITLE') + labelSuffix;
				mainItem
					.setTitle(mainTitle)
					.setIcon('export')
					.setSection('action');

				const exportSubmenu = (mainItem as MenuItem & { setSubmenu: () => Menu }).setSubmenu();

				Object.entries(PANDOC_FORMATS).forEach(([key, format]) => {
					exportSubmenu.addItem((formatItem: MenuItem) => {
						formatItem
							.setTitle(t(format.menuKey))
							.setIcon(format.icon);

						const formatSubmenu = (formatItem as MenuItem & { setSubmenu: () => Menu }).setSubmenu();

						// 1. Standard Export (No Template)
						formatSubmenu.addItem((item: MenuItem) => {
							item
								.setTitle(t('EXPORT_WITHOUT_TEMPLATE'))
								.setIcon(format.icon)
								.onClick(async () => {
									await this.exportWithPandoc(mdFiles, format);
								});
						});

						// 2. Optional templates
						if (this.settings.wordTemplatesFolderPath) {
							try {
								if (fs.existsSync(this.settings.wordTemplatesFolderPath)) {
									const templateExts: Record<string, string[]> = {
										'docx': ['.docx'],
										'pptx': ['.pptx'],
										'pdf': ['.tex', '.latex'],
										'beamer': ['.tex', '.latex']
									};

									const allowedExts = templateExts[key] || [];
									if (allowedExts.length === 0) return; // Skip formats without template support
									const templateFiles = fs.readdirSync(this.settings.wordTemplatesFolderPath)
										.filter(f => allowedExts.some(ext => f.endsWith(ext)));
									
									templateFiles.forEach(templateFile => {
										formatSubmenu.addItem((item: MenuItem) => {
											const templateName = path.basename(templateFile, path.extname(templateFile));
											const isExperimental = ['pdf', 'beamer', 'pptx'].includes(key);
											item
												.setTitle(t('EXPORT_WITH_TEMPLATE', templateName) + (isExperimental ? ' ' + t('EXPERIMENTAL') : ''))
												.setIcon('file-text')
												.onClick(async () => {
													const templatePath = path.join(this.settings.wordTemplatesFolderPath, templateFile);
													await this.exportWithPandoc(mdFiles, format, templatePath);
												});
										});
									});
								}
							} catch (e) {
								console.error('Error reading templates folder:', e);
							}
						}
					});
				});
			});
		}
	}

	private getSelectedFiles(): TAbstractFile[] {
		const files: TAbstractFile[] = [];
		// Suche nach allen Elementen, die ausgewählt oder aktiv sind (unterstützt alte und neue Obsidian DOM-Strukturen)
		const activeEls = document.querySelectorAll('.is-selected, .is-active, .has-active-menu');
		
		activeEls.forEach(el => {
			// data-path kann auf dem Element selbst oder einem Kind/Elternteil liegen
			let path = el.getAttribute('data-path');
			
			if (!path) {
				const childWithPath = el.querySelector('[data-path]');
				if (childWithPath) path = childWithPath.getAttribute('data-path');
			}
			
			if (!path) {
				const parentWithPath = el.closest('[data-path]');
				if (parentWithPath) path = parentWithPath.getAttribute('data-path');
			}
			
			if (path) {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (file && !files.includes(file)) files.push(file);
			}
		});
		return files;
	}

	private copyFilesToClipboard(files: TAbstractFile[]) {
		const absolutePaths = files
			.map(f => this.getAbsolutePath(f))
			.filter((p): p is string => p !== null);

		if (absolutePaths.length === 0) {
			new Notice(t('COPY_ERROR_PATHS'));
			return;
		}

		const platform = os.platform();

		try {
			if (platform === 'darwin') {
				// macOS: Nutze Objective-C via JXA/AppleScript für echten File-Clipboard-Support
				const script = `
use framework "Foundation"
use framework "AppKit"
set pb to current application's NSPasteboard's generalPasteboard()
pb's clearContents()
set fileArray to current application's NSMutableArray's array()
${absolutePaths.map(p => `fileArray's addObject:(current application's NSURL's fileURLWithPath:"${p.replace(/"/g, '\\"')}")`).join('\n')}
pb's writeObjects:fileArray
`;
				const child = exec('osascript', (error) => {
					if (error) {
						console.error('AppleScript Error:', error);
						clipboard.writeText(absolutePaths.join('\n'));
						new Notice(t('COPY_ERROR_GENERIC'));
					} else {
						this.playSuccessSound();
						new Notice(t('COPY_SUCCESS', absolutePaths.length.toString()));
					}
				});
				child.stdin?.write(script);
				child.stdin?.end();
			} else if (platform === 'win32') {
				// Windows: PowerShell mit speziellem File-Drop Format
				const escapedPaths = absolutePaths.map(p => `'${p.replace(/'/g, "''")}'`).join(', ');
				const script = `powershell.exe -NoProfile -Command "Set-Clipboard -Path ${escapedPaths}"`;
				
				exec(script, (error) => {
					if (error) {
						console.error('PowerShell Error:', error);
						clipboard.writeText(absolutePaths.join('\n'));
						new Notice(t('COPY_ERROR_GENERIC'));
					} else {
						this.playSuccessSound();
						new Notice(t('COPY_SUCCESS', absolutePaths.length.toString()));
					}
				});
			} else {
				clipboard.writeText(absolutePaths.join('\n'));
				this.playSuccessSound();
				new Notice(t('COPY_SUCCESS', absolutePaths.length.toString()));
			}
		} catch (err) {
			console.error('Clipboard Error:', err);
			new Notice(t('CRITICAL_COPY_ERROR'));
		}
	}

	private async pasteExternalFiles(targetFolder: TFolder) {
		const sourcePaths = await this.getFilePathsFromClipboard();
		if (sourcePaths.length === 0) {
			new Notice(t('PASTE_NO_FILES'));
			return;
		}

		const targetPath = this.getAbsolutePath(targetFolder);
		if (!targetPath) {
			new Notice(t('COPY_ERROR_PATHS'));
			return;
		}

		let successCount = 0;
		let errorCount = 0;

		for (const sourcePath of sourcePaths) {
			try {
				const sourceStat = fs.statSync(sourcePath);
				const destinationPath = this.getAvailableDestinationPath(targetPath, path.basename(sourcePath));
				const resolvedSource = path.resolve(sourcePath);
				const resolvedDestination = path.resolve(destinationPath);

				// Prevent recursively copying a directory into itself or one of its descendants.
				if (sourceStat.isDirectory() && (resolvedDestination === resolvedSource || resolvedDestination.startsWith(resolvedSource + path.sep))) {
					throw new Error('Cannot copy a folder into itself.');
				}

				if (sourceStat.isDirectory()) {
					fs.cpSync(sourcePath, destinationPath, { recursive: true, errorOnExist: true });
				} else if (sourceStat.isFile()) {
					fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
				} else {
					throw new Error('Unsupported clipboard item type.');
				}

				successCount++;
			} catch (error) {
				console.error(`Paste Error (${sourcePath}):`, error);
				errorCount++;
			}
		}

		if (successCount > 0) {
			this.playSuccessSound();
			new Notice(t('PASTE_SUCCESS', successCount.toString(), targetFolder.path || '/'));
		}
		if (errorCount > 0) {
			new Notice(t('PASTE_ERROR', errorCount.toString()));
		}
	}

	private getAvailableDestinationPath(targetFolderPath: string, sourceName: string): string {
		const initialPath = path.join(targetFolderPath, sourceName);
		if (!fs.existsSync(initialPath)) return initialPath;

		const extension = path.extname(sourceName);
		const baseName = extension ? path.basename(sourceName, extension) : sourceName;
		let counter = 1;
		let candidatePath: string;

		do {
			candidatePath = path.join(targetFolderPath, `${baseName} (${counter})${extension}`);
			counter++;
		} while (fs.existsSync(candidatePath));

		return candidatePath;
	}

	private async getFilePathsFromClipboard(): Promise<string[]> {
		let clipboardPaths: string[] = [];

		try {
			if (os.platform() === 'darwin') {
				clipboardPaths = await this.readMacFileClipboard();
			} else if (os.platform() === 'win32') {
				clipboardPaths = await this.readWindowsFileClipboard();
			}
		} catch (error) {
			console.debug('Native file clipboard read failed, using URI fallback:', error);
		}

		if (clipboardPaths.length === 0) {
			const formats = clipboard.availableFormats();
			const uriFormat = formats.find((format: string) =>
				format.toLowerCase() === 'text/uri-list' ||
				format.toLowerCase() === 'x-special/gnome-copied-files'
			);

			if (uriFormat) {
				clipboardPaths = this.parseClipboardPathList(clipboard.read(uriFormat));
			}
		}

		return [...new Set(clipboardPaths.map(value => path.resolve(value)))]
			.filter(value => fs.existsSync(value));
	}

	private readMacFileClipboard(): Promise<string[]> {
		const script = `
ObjC.import('AppKit');
const pasteboard = $.NSPasteboard.generalPasteboard;
const readableClasses = $.NSArray.arrayWithObject($.NSURL);
const readOptions = $.NSDictionary.dictionary;
const urls = pasteboard.readObjectsForClassesOptions(readableClasses, readOptions);
const paths = [];
if (urls) {
    for (let index = 0; index < urls.count; index++) {
        const url = urls.objectAtIndex(index);
        if (url.isFileURL) paths.push(ObjC.unwrap(url.path));
    }
}
JSON.stringify(paths);
`;

		return this.runClipboardCommand('osascript', ['-l', 'JavaScript', '-e', script]);
	}

	private readWindowsFileClipboard(): Promise<string[]> {
		const script = "@(Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }) | ConvertTo-Json -Compress";
		return this.runClipboardCommand('powershell.exe', ['-NoProfile', '-Command', script]);
	}

	private runClipboardCommand(command: string, args: string[]): Promise<string[]> {
		return new Promise(resolve => {
			execFile(command, args, { encoding: 'utf8' }, (error, stdout) => {
				if (error || !stdout.trim()) {
					resolve([]);
					return;
				}

				try {
					const parsed = JSON.parse(stdout.trim()) as unknown;
					if (Array.isArray(parsed)) {
						resolve(parsed.filter((value): value is string => typeof value === 'string'));
					} else if (typeof parsed === 'string') {
						resolve([parsed]);
					} else {
						resolve([]);
					}
				} catch {
					resolve(this.parseClipboardPathList(stdout));
				}
			});
		});
	}

	private parseClipboardPathList(rawValue: string): string[] {
		return rawValue
			.split(/\r?\n/)
			.map(value => value.trim())
			.filter(value => value.length > 0 && value !== 'copy' && value !== 'cut' && !value.startsWith('#'))
			.map(value => {
				try {
					return value.startsWith('file://') ? fileURLToPath(value) : value;
				} catch {
					return '';
				}
			})
			.filter(value => value.length > 0 && path.isAbsolute(value));
	}

	private copyToTargetFolder(files: TAbstractFile[]) {
		if (!this.settings.targetFolderPath) {
			new Notice(t('TARGET_FOLDER_NOT_SET'));
			return;
		}

		let successCount = 0;
		let errorCount = 0;

		for (const file of files) {
			const sourcePath = this.getAbsolutePath(file);
			if (!sourcePath) {
				errorCount++;
				continue;
			}

			const destinationPath = path.join(this.settings.targetFolderPath, file.name);
			try {
				if (file instanceof TFolder) {
					fs.cpSync(sourcePath, destinationPath, { recursive: true });
				} else {
					fs.copyFileSync(sourcePath, destinationPath);
				}
				successCount++;
			} catch (err) {
				console.error(`Copy Error (${file.name}):`, err);
				errorCount++;
			}
		}

		if (successCount > 0) {
			this.playSuccessSound();
			new Notice(t('TARGET_FOLDER_SUCCESS', successCount.toString()));
		}
		if (errorCount > 0) {
			new Notice(t('TARGET_FOLDER_ERROR', errorCount.toString()));
		}
	}

	private async createVideoThumbnail(videoFile: TFile, tempDir: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const video = document.createElement('video');
			video.classList.add('natural-move-hidden-video');
			video.muted = true;
			video.src = this.app.vault.getResourcePath(videoFile);
			video.crossOrigin = "anonymous";

			video.onloadedmetadata = () => {
				video.currentTime = Math.min(1, video.duration / 2);
			};

			video.onseeked = () => {
				try {
					const canvas = document.createElement('canvas');
					canvas.width = video.videoWidth || 640;
					canvas.height = video.videoHeight || 360;
					const ctx = canvas.getContext('2d');
					if (ctx) {
						ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
						
						// Draw Play Button Overlay
						ctx.fillStyle = "rgba(0,0,0,0.5)";
						ctx.beginPath();
						ctx.arc(canvas.width/2, canvas.height/2, 40, 0, Math.PI*2);
						ctx.fill();
						ctx.fillStyle = "white";
						ctx.beginPath();
						ctx.moveTo(canvas.width/2 - 12, canvas.height/2 - 20);
						ctx.lineTo(canvas.width/2 + 20, canvas.height/2);
						ctx.lineTo(canvas.width/2 - 12, canvas.height/2 + 20);
						ctx.fill();

						const dataUrl = canvas.toDataURL('image/png');
						const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
						const thumbPath = path.join(tempDir, `thumb_${videoFile.name}.png`);
						fs.writeFileSync(thumbPath, base64Data, 'base64');
						resolve(thumbPath);
					} else {
						reject(new Error("Canvas context is null"));
					}
				} catch (e) {
					reject(e instanceof Error ? e : new Error(String(e)));
				} finally {
					video.remove();
				}
			};

			video.onerror = (e) => {
				video.remove();
				const errorMessage = e instanceof Event ? 'Video playback error' : String(e);
				reject(new Error(`Error loading video: ${errorMessage}`));
			};
		});
	}

	private async processMarkdownForExport(file: TFile, tempDir: string): Promise<string> {
		let content = await this.app.vault.read(file);
		
		// Match Obsidian embeds: ![[filename.ext]] or ![[filename.ext|alt]]
		const embedRegex = /!\[\[(.*?)\]\]/g;
		const matches = [...content.matchAll(embedRegex)];

		for (const match of matches) {
			const fullMatch = match[0];
			const linkContent = match[1];
			const altParts = linkContent.split('|');
			const linkPath = altParts.shift() || '';
			
			let caption = "";
			let width = "";
			let height = "";

			if (altParts.length > 0) {
				const lastPart = altParts[altParts.length - 1];
				if (/^\d+$/.test(lastPart)) {
					width = lastPart;
					altParts.pop();
				} else if (/^\d+x\d+$/.test(lastPart)) {
					const [w, h] = lastPart.split('x');
					width = w;
					height = h;
					altParts.pop();
				}
				caption = altParts.join('|');
			}

			let attributes = "";
			if (width && height) {
				attributes = `{width=${width}px height=${height}px}`;
			} else if (width) {
				attributes = `{width=${width}px}`;
			}

			const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
			if (linkedFile instanceof TFile) {
				const absolutePath = this.getAbsolutePath(linkedFile);
				if (!absolutePath) continue;
				
				const extension = linkedFile.extension.toLowerCase();
				const safePath = absolutePath.replace(/\\/g, '/');

				if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'].includes(extension)) {
					// Replace with absolute image link and add Pandoc size attributes
					content = content.replace(fullMatch, `![${caption}](${safePath})${attributes}`);
				} else if (['mp4', 'webm', 'ogg', 'mov'].includes(extension)) {
					// Video
					try {
						const thumbPath = await this.createVideoThumbnail(linkedFile, tempDir);
						const safeThumbPath = thumbPath.replace(/\\/g, '/');
						content = content.replace(fullMatch, `[![${caption}](${safeThumbPath})${attributes}](file:///${safePath})`);
					} catch (e) {
						console.error("Failed to generate thumbnail for", linkedFile.name, e);
						// Fallback to text link
						content = content.replace(fullMatch, `[🎥 ${linkedFile.name}](file:///${safePath})`);
					}
				}
			}
		}

		const tempMdPath = path.join(tempDir, `temp_${file.name}`);
		fs.writeFileSync(tempMdPath, content, 'utf8');
		return tempMdPath;
	}

	private async exportWithPandoc(files: TFile[], format: PandocFormat, templatePath?: string) {
		if (!this.settings.targetFolderPath || !fs.existsSync(this.settings.targetFolderPath)) {
			new Notice(t('TARGET_FOLDER_NOT_EXISTS'));
			return;
		}

		let successCount = 0;
		let errorCount = 0;
		let lastError = "";
		const pandocCmd = this.settings.pandocPath || 'pandoc';

		const exportName = templatePath ? path.basename(templatePath, '.docx') : format.name;
		new Notice(t('EXPORTING_FILES', files.length.toString(), exportName));

		// Erweitere PATH für Mac (Homebrew, MacTeX)
		const env = {
			...process.env,
			PATH: `${process.env.PATH || ''}:/usr/local/bin:/opt/homebrew/bin:/Library/TeX/texbin:/usr/bin:/bin:/usr/sbin:/sbin`
		};

		let pandocMissing = false;
		
		// Create a temporary directory for pre-processing
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natural-move-'));

		try {
			for (const file of files) {
				const originalSourcePath = this.getAbsolutePath(file);
				if (!originalSourcePath) {
					errorCount++;
					continue;
				}

				// Pre-process markdown to handle images and videos
				let sourcePath = originalSourcePath;
				if (file.extension === 'md') {
					try {
						sourcePath = await this.processMarkdownForExport(file, tempDir);
					} catch (e) {
						console.error("Pre-processing failed for", file.name, e);
						// Fallback to original source path if pre-processing fails
					}
				}

				let destName = file.basename + '.' + format.ext;
				// Verhindere Überschreiben der Quelldatei, falls Zielordner = Vault-Ordner
				if (format.ext === 'md' && originalSourcePath === path.join(this.settings.targetFolderPath, destName)) {
					destName = file.basename + '_export.' + format.ext;
				}
				
				const destPath = path.join(this.settings.targetFolderPath, destName);

				// Pandoc Befehl zusammenbauen
				let customArgs = this.settings.customPandocArgs ? ` ${this.settings.customPandocArgs}` : '';
				
				if (templatePath && fs.existsSync(templatePath)) {
					const ext = path.extname(templatePath).toLowerCase();
					if (ext === '.docx' || ext === '.pptx') {
						customArgs += ` --reference-doc="${templatePath}"`;
					} else {
						customArgs += ` --template="${templatePath}"`;
					}
				}

				// Add resource path so Pandoc can find relative files if any are left
				const originalDir = path.dirname(originalSourcePath);
				customArgs += ` --resource-path="${originalDir}"`;

				const cmd = `"${pandocCmd}" "${sourcePath}" ${format.args}${customArgs} -o "${destPath}"`;

			try {
				await new Promise<void>((resolve, reject) => {
					exec(cmd, { env }, (error, stdout, stderr) => {
						if (error) {
							console.error('Pandoc Error:', error, stderr);
							lastError = stderr || error.message;
							reject(error);
						} else {
							resolve();
						}
					});
				});
				successCount++;
			} catch (err: unknown) {
				console.error(`Fehler beim Export von ${file.name}:`, err);
				
				const errorMessage = err instanceof Error ? err.message : String(err);
				const errorCode = err && typeof err === 'object' && 'code' in err ? String((err as Record<string, unknown>).code) : '';
				const errorStr = errorMessage + ' ' + (lastError || '');
				if (errorStr.toLowerCase().includes('yaml') || errorStr.toLowerCase().includes('metadata')) {
					console.debug('YAML error detected, trying fallback without metadata...');
					const fallbackCmd = `"${pandocCmd}" "${sourcePath}" ${format.args}${customArgs} -f markdown-yaml_metadata_block -o "${destPath}"`;
					try {
						await new Promise<void>((resolve, reject) => {
							exec(fallbackCmd, { env }, (error, stdout, stderr) => {
								if (error) {
									lastError = stderr || error.message;
									reject(error);
								} else {
									resolve();
								}
							});
						});
						successCount++;
						new Notice(t('EXPORT_FALLBACK_YAML') + ` (${file.name})`);
					} catch (fallbackErr: unknown) {
						console.error(`Fallback-Fehler beim Export von ${file.name}:`, fallbackErr);
						errorCount++;
					}
				} else if (errorCode === 'ENOENT' || errorMessage.includes('command not found') || errorMessage.includes('nicht gefunden')) {
					pandocMissing = true;
					break;
				} else {
					errorCount++;
				}
			}
		}
		} finally {
			// Clean up temporary directory
			try {
				fs.rmSync(tempDir, { recursive: true, force: true });
			} catch (e) {
				console.error("Failed to clean up temporary directory", e);
			}
		}

		if (pandocMissing) {
			new Notice(t('PANDOC_NOT_FOUND'));
			return;
		}

		if (successCount > 0) {
			this.playSuccessSound();
			new Notice(t('EXPORT_SUCCESS', successCount.toString(), format.name));
		}
		if (errorCount > 0) {
			new Notice(t('EXPORT_ERROR', errorCount.toString(), lastError.substring(0, 100)));
		}
	}

	private getAbsolutePath(file: TAbstractFile): string | null {
		const adapter = this.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getFullPath(file.path);
		}
		return null; 
	}

	private initAudio() {
		try {
			this.audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
		} catch {
			console.error('AudioContext konnte nicht initialisiert werden');
		}
	}

	public playSuccessSound() {
		if (!this.settings.enableAudioFeedback) return;
		
		if (this.audioCtx?.state === 'suspended') {
			void this.audioCtx.resume();
		}

		if (!this.audioCtx) return;

		try {
			const oscillator = this.audioCtx.createOscillator();
			const gainNode = this.audioCtx.createGain();

			oscillator.connect(gainNode);
			gainNode.connect(this.audioCtx.destination);

			// Mac-ähnlicher "Pop" (Bottle)
			oscillator.type = 'sine';
			oscillator.frequency.setValueAtTime(600, this.audioCtx.currentTime); 
			oscillator.frequency.exponentialRampToValueAtTime(100, this.audioCtx.currentTime + 0.1);

			gainNode.gain.setValueAtTime(0.3, this.audioCtx.currentTime);
			gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.1);

			oscillator.start();
			oscillator.stop(this.audioCtx.currentTime + 0.1);
		} catch (e) {
			console.error('Audio Feedback Error:', e);
		}
	}

	async loadSettings() {
		const savedData = (await this.loadData() || {}) as Record<string, unknown>;
		const hadLegacyLicenseData = ['licenseKey', 'instanceId', 'isPro'].some(key => key in savedData);
		this.settings = Object.assign({}, DEFAULT_SETTINGS, savedData);

		// Remove license data saved by versions that still had paid feature gates.
		const migratedSettings = this.settings as NaturalMoveSettings & Record<string, unknown>;
		delete migratedSettings.licenseKey;
		delete migratedSettings.instanceId;
		delete migratedSettings.isPro;

		if (hadLegacyLicenseData) {
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class NaturalMoveSettingTab extends PluginSettingTab {
	plugin: NaturalMove;

	constructor(app: App, plugin: NaturalMove) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl).setName(t('SETTINGS_TITLE')).setHeading();

		new Setting(containerEl).setName(t('SETTING_CONTEXT_MENU_HEADING')).setHeading();

		new Setting(containerEl)
			.setName(t('SETTING_PASTE_MENU_NAME'))
			.setDesc(t('SETTING_PASTE_MENU_DESC'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showPasteFromClipboardMenu)
				.onChange(async (value) => {
					this.plugin.settings.showPasteFromClipboardMenu = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('SETTING_TARGET_FOLDER_MENU_NAME'))
			.setDesc(t('SETTING_TARGET_FOLDER_MENU_DESC'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showCopyToTargetFolderMenu)
				.onChange(async (value) => {
					this.plugin.settings.showCopyToTargetFolderMenu = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('SETTING_PANDOC_MENU_NAME'))
			.setDesc(t('SETTING_PANDOC_MENU_DESC'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showPandocExportMenu)
				.onChange(async (value) => {
					this.plugin.settings.showPandocExportMenu = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('hr');

		const isWin = os.platform() === 'win32';
		const targetFolderPlaceholder = isWin ? 'C:\\path\\to\\folder' : '/path/to/folder';
		const pandocPlaceholder = isWin ? 'C:\\Program Files\\Pandoc\\pandoc.exe' : '/usr/local/bin/pandoc';
		const templatesFolderPlaceholder = isWin ? 'C:\\path\\to\\templates' : '/path/to/templates';

		new Setting(containerEl)
			.setName(t('SETTING_TARGET_FOLDER_NAME'))
			.setDesc(t('SETTING_TARGET_FOLDER_DESC'))
			.addText(text => {
				text
					.setPlaceholder(targetFolderPlaceholder)
					.setValue(this.plugin.settings.targetFolderPath)
					.onChange(async (value) => {
						this.plugin.settings.targetFolderPath = value.trim();
						await this.plugin.saveSettings();
					});
				
				return text;
			});

		const pandocDesc = document.createDocumentFragment();
		pandocDesc.appendText(t('SETTING_PANDOC_PATH_DESC') + ' ');
		pandocDesc.createEl('a', { 
			text: t('SETTING_PANDOC_DOWNLOAD_LINK'), 
			href: 'https://pandoc.org/installing.html' 
		});

		new Setting(containerEl)
			.setName(t('SETTING_PANDOC_PATH_NAME'))
			.setDesc(pandocDesc)
			.addText(text => {
				text
					.setPlaceholder(pandocPlaceholder)
					.setValue(this.plugin.settings.pandocPath)
					.onChange(async (value) => {
						this.plugin.settings.pandocPath = value.trim();
						await this.plugin.saveSettings();
					});
				
				return text;
			});

		const latexDesc = document.createDocumentFragment();
		latexDesc.appendText(t('SETTING_LATEX_DESC') + ' ');
		if (isWin) {
			latexDesc.createEl('a', { 
				text: t('SETTING_LATEX_WIN_BUTTON'), 
				href: 'https://miktex.org/download' 
			});
		} else {
			latexDesc.createEl('a', { 
				text: t('SETTING_LATEX_MAC_BUTTON'), 
				href: 'https://tug.org/mactex/mactex-download.html' 
			});
		}

		new Setting(containerEl)
			.setName(t('SETTING_LATEX_NAME'))
			.setDesc(latexDesc);

		new Setting(containerEl)
			.setName(t('SETTING_CUSTOM_ARGS_NAME'))
			.setDesc(t('SETTING_CUSTOM_ARGS_DESC'))
			.addTextArea(text => {
				text
					.setPlaceholder('--toc --citeproc ...')
					.setValue(this.plugin.settings.customPandocArgs)
					.onChange(async (value) => {
						this.plugin.settings.customPandocArgs = value.trim();
						await this.plugin.saveSettings();
					});
				
				return text;
			});

		new Setting(containerEl)
			.setName(t('SETTING_WORD_TEMPLATES_FOLDER_NAME'))
			.setDesc(t('SETTING_WORD_TEMPLATES_FOLDER_DESC'))
			.addText(text => {
				text
					.setPlaceholder(templatesFolderPlaceholder)
					.setValue(this.plugin.settings.wordTemplatesFolderPath)
					.onChange(async (value) => {
						this.plugin.settings.wordTemplatesFolderPath = value.trim();
						await this.plugin.saveSettings();
					});
				
				return text;
			});

		new Setting(containerEl)
			.setName(t('SETTING_AUDIO_FEEDBACK_NAME'))
			.setDesc(t('SETTING_AUDIO_FEEDBACK_DESC'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableAudioFeedback)
				.onChange(async (value) => {
					this.plugin.settings.enableAudioFeedback = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('SETTING_TEST_SOUND_NAME'))
			.setDesc(t('SETTING_TEST_SOUND_DESC'))
			.addButton(btn => btn
				.setButtonText(t('SETTING_TEST_SOUND_BUTTON'))
				.onClick(() => {
					this.plugin.playSuccessSound();
				}));

		containerEl.createEl('hr');

		new Setting(containerEl)
			.setName(t('SETTING_HELP_NAME'))
			.setDesc(t('SETTING_HELP_DESC'))
			.addButton(btn => btn
				.setButtonText(t('SETTING_HELP_BUTTON'))
				.onClick(() => {
					window.open("https://naturalis3.github.io/Obsidian-Natural-Move-Export/");
				}))
			.addButton(btn => btn
				.setButtonText(t('SETTING_HELP_BUG_BUTTON'))
				.onClick(() => {
					window.open("https://github.com/Naturalis3/Obsidian-Natural-Move-Export/issues");
				}));
	}
}
