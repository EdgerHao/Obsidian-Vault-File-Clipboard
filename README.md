# Vault File Clipboard

**Vault File Clipboard** gives Obsidian's file explorer native file and folder clipboard behavior. Copy files out of your vault, paste external files into vault folders, or drag items to other desktop apps without opening Finder or File Explorer first.

## Features

- **Copy out:** Select vault files or folders and press `Cmd + C` (macOS) or `Ctrl + C` (Windows/Linux), then paste them into another desktop app.
- **Paste in:** Copy files or folders in Finder/File Explorer, select a vault folder, and press `Cmd + V` or `Ctrl + V`.
- **Context menus:** Copy selected vault items, paste external items into a folder, or copy items to a configured target folder.
- **External drag:** Hold `Alt` while dragging vault files or folders to another desktop app.
- **Safe conflicts:** Existing files are never overwritten when pasting into the vault; numbered names are created automatically.
- **Multi-file and folder support:** All clipboard operations work with files, folders, and multi-selections.
- **Cross-platform:** Native handling for macOS, Windows, and Linux desktop environments.

## Settings

- Show or hide the external-paste context menu action.
- Show or hide the copy-to-target-folder context menu action.
- Configure an optional absolute target-folder path.
- Enable or disable audio feedback.

## Installation

### BRAT

Add this repository to BRAT:

`https://github.com/EdgerHao/Obsidian-Vault-File-Clipboard`

### Manual

Copy `main.js`, `manifest.json`, and `styles.css` into:

`.obsidian/plugins/vault-file-clipboard/`

Then reload Obsidian and enable **Vault File Clipboard** under Community plugins.

## Privacy

The plugin works locally. It reads file paths from the system clipboard only when you invoke a paste action and does not send file data to a server.

## License

MIT
