# Vault File Clipboard

**Vault File Clipboard** 为 Obsidian 文件资源管理器补充原生的文件与文件夹复制粘贴体验。无需先打开访达或文件资源管理器，即可从库中复制文件、将外部文件粘贴到库内，或拖放到其他桌面应用。

## 功能

- **复制出去：** 选中库内文件或文件夹，按 `Command + C`（macOS）或 `Ctrl + C`（Windows/Linux），随后可粘贴到其他桌面应用。
- **粘贴进来：** 在访达或文件资源管理器中复制文件/文件夹，选中 Obsidian 文件夹后按 `Command + V` 或 `Ctrl + V`。
- **右键菜单：** 支持复制所选项目、将外部项目粘贴到文件夹，以及复制到预设目标文件夹。
- **外部拖放：** 按住 `Alt`，将库内文件或文件夹拖到其他桌面应用。
- **安全处理同名项目：** 粘贴到库内时不会覆盖已有文件，会自动生成带序号的新名称。
- **多文件与文件夹：** 支持文件、文件夹和多选操作。
- **跨平台：** 支持 macOS、Windows 和 Linux 桌面环境。

## 设置

- 显示或隐藏“粘贴外部文件”右键菜单。
- 显示或隐藏“复制到目标文件夹”右键菜单。
- 配置可选的目标文件夹绝对路径。
- 开启或关闭音频反馈。

## 安装

### BRAT

在 BRAT 中添加以下仓库：

`https://github.com/EdgerHao/Obsidian-Vault-File-Clipboard`

### 手动安装

将 `main.js`、`manifest.json` 和 `styles.css` 复制到：

`.obsidian/plugins/vault-file-clipboard/`

重新加载 Obsidian，然后在第三方插件中启用 **Vault File Clipboard**。

## 隐私

插件完全在本地工作。只有执行粘贴操作时才读取系统剪贴板中的文件路径，不会把文件数据发送到服务器。

## 许可证

MIT
