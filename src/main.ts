import { App, Notice, Plugin, TFolder, TAbstractFile, Menu, MenuItem, PluginSettingTab, Setting, FileSystemAdapter } from 'obsidian';
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

interface VaultFileClipboardSettings {
	targetFolderPath: string;
	enableAudioFeedback: boolean;
	showPasteFromClipboardMenu: boolean;
	showCopyToTargetFolderMenu: boolean;
}

const DEFAULT_SETTINGS: VaultFileClipboardSettings = {
	targetFolderPath: '',
	enableAudioFeedback: true,
	showPasteFromClipboardMenu: true,
	showCopyToTargetFolderMenu: true
}

export default class VaultFileClipboard extends Plugin {
	settings!: VaultFileClipboardSettings;
	private audioCtx: AudioContext | null = null;
	private boundDragStartHandler!: (evt: DragEvent) => void;

	private boundKeyDownHandler!: (evt: KeyboardEvent) => void;

	async onload() {
		console.debug(t('LOAD_PLUGIN'));
		await this.loadSettings();

		// Audio Context initialisieren
		this.initAudio();

		// 1. Global copy/paste handler for file explorer selections.
		this.boundKeyDownHandler = (evt: KeyboardEvent) => {
			if (!(evt.metaKey || evt.ctrlKey) || evt.altKey) return;

			const isCopyShortcut = evt.key.toLowerCase() === 'c' || evt.code === 'KeyC';
			const isPasteShortcut = !evt.shiftKey && (evt.key.toLowerCase() === 'v' || evt.code === 'KeyV');
			if (!isCopyShortcut && !isPasteShortcut) return;

			const target = evt.target instanceof HTMLElement ? evt.target : null;
			// Always preserve native clipboard behavior inside editors and form controls.
			if (target && (
				target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable ||
				target.closest('.cm-editor, .markdown-source-view, .markdown-rendered')
			)) {
				return;
			}

			if (isCopyShortcut) {
				const files = this.getSelectedFiles();
				if (files.length > 0) {
					evt.preventDefault();
					evt.stopPropagation();
					void this.copyFilesToClipboard(files);
				}
				return;
			}

			if (evt.repeat) return;
			const targetFolder = this.getSelectedFolderForPaste(target);
			if (targetFolder) {
				evt.preventDefault();
				evt.stopImmediatePropagation();
				void this.pasteExternalFiles(targetFolder);
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

		this.addSettingTab(new VaultFileClipboardSettingTab(this.app, this));
	}

	onunload() {
		console.debug(t('UNLOAD_PLUGIN'));
		if (this.audioCtx) void this.audioCtx.close();
		document.getElementById('vault-file-clipboard-style')?.remove();
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

	private getSelectedFolderForPaste(target: HTMLElement | null): TFolder | null {
		// Prefer the folder that currently owns keyboard focus, when available.
		const folderElement = target?.closest('.nav-folder-title, .nav-folder');
		const focusedFolderPath = folderElement?.getAttribute('data-path')
			?? folderElement?.querySelector('.nav-folder-title[data-path]')?.getAttribute('data-path');

		if (focusedFolderPath !== null && focusedFolderPath !== undefined) {
			const focusedFolder = this.app.vault.getAbstractFileByPath(focusedFolderPath);
			if (focusedFolder instanceof TFolder) return focusedFolder;
		}

		// Ignore active editor files and accept the shortcut only when exactly one folder is selected.
		const selectedFolders = this.getSelectedFiles().filter((file): file is TFolder => file instanceof TFolder);
		return selectedFolders.length === 1 ? selectedFolders[0] : null;
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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class VaultFileClipboardSettingTab extends PluginSettingTab {
	plugin: VaultFileClipboard;

	constructor(app: App, plugin: VaultFileClipboard) {
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

		containerEl.createEl('hr');

		const isWin = os.platform() === 'win32';
		const targetFolderPlaceholder = isWin ? 'C:\\path\\to\\folder' : '/path/to/folder';

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
						window.open("https://github.com/EdgerHao/Obsidian-Natural-Move-Export/tree/codex/vault-file-clipboard");
					}))
			.addButton(btn => btn
					.setButtonText(t('SETTING_HELP_BUG_BUTTON'))
					.onClick(() => {
						window.open("https://github.com/EdgerHao/Obsidian-Natural-Move-Export/issues");
				}));
	}
}
