# Natural Move/Export

[English](index.md) | [Deutsch](index_de.md) | [Français](index_fr.md) | [Español](index_es.md) | [简体中文](index_zh.md) | [日本語](index_ja.md) | [한국어](index_ko.md) | [Português](index_pt.md) | [Русский](index_ru.md)

<div style="max-width: 900px; margin: 40px auto; position: relative; padding-bottom: 50.625%; height: 0; overflow: hidden; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);">
  <iframe 
    src="https://www.youtube.com/embed/7rfUTl3iBh8" 
    frameborder="0" 
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
    allowfullscreen 
    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;">
  </iframe>
</div>
**Natural Move/Export** is an Obsidian plugin that seamlessly bridges the gap between Obsidian and your operating system. It makes Obsidian's File Explorer feel like a native folder on your computer.

## Why Natural Move/Export?

Obsidian's File Explorer is powerful, but isolated. Copying files out of Obsidian usually requires opening the folder in Finder/Explorer first. **Natural Move/Export** fixes this by enabling native system-wide copy-paste, drag & drop, and professional exports directly from within Obsidian.

## ✨ Key Features

### 📋 Native System Copy
Select files in Obsidian and press `Cmd + C` (macOS) or `Ctrl + C` (Win). You can then paste them directly onto your desktop or into any other application with `Cmd + V`.
Files and entire folders are both supported.

### 🖱️ Direct Drag & Drop
Hold the `Alt` key and drag files or folders from Obsidian directly into other apps (e.g., Mail, Slack, or a folder).

### 🚀 Professional Pandoc Export
Convert your Markdown notes into polished documents with a single click.
*   **Word (.docx):** Use your own custom `.docx` templates for professional branding.
*   **PowerPoint (.pptx):** Turn notes into presentations instantly.
*   **PDF & Beamer:** High-quality academic and slide exports.
*   **HTML & Markdown:** Clean, standalone exports.

### 📁 Target Folder Sync
Configure a fixed target folder in the settings. Copy files and folders there with one click via the context menu. Perfect for backups, sharing, or project exports.

### 🌍 Smart Localization & OS Detection
*   **Automatic Language:** The plugin automatically adapts to your Obsidian language settings.
*   **Smart OS Detection:** Settings and placeholders automatically adjust depending on whether you are using Windows, macOS, or Linux.

## 🆓 Free for Everyone

All plugin features are available to every user without a license. The settings page also lets you hide the target-folder copy action and the Pandoc export submenu from the file explorer context menu.

## 🛠️ Prerequisites for Pandoc Export

To use the export functions (Word, PowerPoint, PDF, etc.), **Pandoc** must be installed on your system.

- **Mac:** `brew install pandoc` (via Homebrew) or download the installer from the [Pandoc website](https://pandoc.org/installing.html).
- **Windows:** Download the installer from the Pandoc website.

### ⚠️ Important for PDF and Beamer Export (MacTeX & MiKTeX)

Pandoc requires a LaTeX distribution in the background to generate PDFs and Beamer presentations. On macOS, **MacTeX** is the standard. On Windows, **MiKTeX** is recommended.

**Installing MacTeX (macOS):**

*Option 1: Via Homebrew (Recommended)*
Open the terminal and enter the following command:
```bash
brew install --cask mactex-no-gui
```
*(Note: The download is very large (approx. 5 GB) as it contains all necessary LaTeX packages. The `mactex-no-gui` version only installs the command-line tools, which is sufficient for Pandoc).*

*Option 2: Manual Download*
1. Go to the official website: [tug.org/mactex](https://www.tug.org/mactex/)
2. Download the `MacTeX.pkg` file and run the installer.


**Installing MiKTeX (Windows):**
1. Go to the official website: [miktex.org/download](https://miktex.org/download)
2. Download the installer and run it.
3. During installation, choose to install missing packages automatically.

After installing Pandoc and MacTeX/MiKTeX, you may need to restart Obsidian completely for the new system paths to be recognized. The Natural Move/Export plugin automatically searches for the required programs in the standard paths (`/Library/TeX/texbin`, `/opt/homebrew/bin`, `/usr/local/bin`).

## Installation in Obsidian

### Via BRAT (Beta Testing)
1. Install the "Obsidian 42 - BRAT" plugin from the Community Plugins.
2. Go to the BRAT settings and click on "Add Beta Plugin".
3. Enter the URL of this GitHub repository.
4. Click on "Add Plugin".

### Manual Installation
1. Download the project as a ZIP file and extract it.
2. Create the folder in your Obsidian Vault: `.obsidian/plugins/natural-move`
3. Copy all extracted project files into this new folder.
4. Open a terminal in this folder and run the following commands:
   ```bash
   npm install
   npm run build
   ```
5. Open Obsidian and go to **Settings > Community Plugins**.
6. Disable "Safe Mode" if you haven't already.
7. Click "Refresh" and enable the **Natural Move/Export** plugin.

## Credits & License

- **Author:** Naturalis
- **License:** MIT
- **Third-party tools:** This plugin uses [Pandoc](https://pandoc.org/) (GPL licensed) as an external command-line tool for file conversion. Pandoc is not bundled with this plugin and must be installed separately by the user.
