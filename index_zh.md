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

**Natural Move/Export** 是一款 Obsidian 插件，可无缝桥接 Obsidian 与您的操作系统。它让 Obsidian 的文件资源管理器感觉就像您计算机上的原生文件夹。

## 为什么选择 Natural Move/Export？

Obsidian 的文件资源管理器功能强大，但相对孤立。将文件从 Obsidian 中复制出来通常需要先在访达 (Finder)/资源管理器 (Explorer) 中打开文件夹。**Natural Move/Export** 通过在 Obsidian 内部直接启用原生的系统级复制粘贴、拖放以及专业导出功能解决了这个问题。

## ✨ 核心功能

### 📋 原生系统复制
在 Obsidian 中选择文件并按 `Cmd + C` (macOS) 或 `Ctrl + C` (Win)。然后，您可以使用 `Cmd + V` 直接将其粘贴到桌面或任何其他应用程序中。
文件和整个文件夹均可复制。

### 📥 将外部文件粘贴到 Obsidian
在访达、文件资源管理器或 Linux 文件管理器中复制文件或文件夹，然后右键单击 Obsidian 文件夹并选择 **Natural move: 粘贴外部文件到此处**。遇到同名项目时会自动生成新名称，不会覆盖已有文件。

### 🖱️ 直接拖放
按住 `Alt` 键并将文件或文件夹从 Obsidian 直接拖动到其他应用程序（例如邮件、Slack 或文件夹）中。

### 🚀 专业 Pandoc 导出
只需单击一下，即可将您的 Markdown 笔记转换为精美的文档。
*   **Word (.docx)：** 使用您自己的自定义 `.docx` 模板进行专业品牌定制。
*   **PowerPoint (.pptx)：** 立即将笔记转换为演示文稿。
*   **PDF 和 Beamer：** 高质量的学术和幻灯片导出。
*   **HTML 和 Markdown：** 干净、独立的导出。

### 📁 目标文件夹同步
在设置中配置固定的目标文件夹。通过右键菜单一键将文件和文件夹复制到那里。非常适合备份、共享或项目导出。

### 🌍 智能本地化与操作系统检测
*   **自动语言：** 插件会自动适应您的 Obsidian 语言设置。
*   **智能操作系统检测：** 无论您使用的是 Windows、macOS 还是 Linux，设置和占位符都会自动调整。

## 🆓 所有功能免费开放

插件的全部功能无需许可证，所有用户均可使用。设置页还可以单独隐藏文件资源管理器右键菜单中的“粘贴外部文件”、“复制到目标文件夹”和 Pandoc 导出子菜单。

## 🛠️ Pandoc 导出的先决条件

要使用导出功能（Word、PowerPoint、PDF 等），您的系统中必须安装 **Pandoc**。

- **Mac：** 通过 Homebrew 安装 `brew install pandoc` 或从 [Pandoc 官网](https://pandoc.org/installing.html)下载安装程序。
- **Windows：** 从 Pandoc 官网下载安装程序。

### ⚠️ PDF 和 Beamer 导出重要提示 (MacTeX)

Pandoc 需要后台的 LaTeX 发行版来生成 PDF 和 Beamer 演示文稿。在 macOS 上，**MacTeX** 是标准配置。在 Windows 上，推荐使用 **MiKTeX**。

**安装 MacTeX (macOS)：**

*选项 1：通过 Homebrew (推荐)*
打开终端并输入以下命令：
```bash
brew install --cask mactex-no-gui
```
*(注意：下载量非常大（约 5 GB），因为它包含所有必要的 LaTeX 软件包。`mactex-no-gui` 版本仅安装命令行工具，这对于 Pandoc 来说已经足够了)。*

*选项 2：手动下载*
1. 访问官方网站：[tug.org/mactex](https://www.tug.org/mactex/)
2. 下载 `MacTeX.pkg` 文件并运行安装程序。


**安装 MiKTeX (Windows):**
1. 访问官方网站：[miktex.org/download](https://miktex.org/download)
2. 下载安装程序并运行。
3. 在安装过程中，选择自动安装缺失的软件包。

安装 Pandoc 和 MacTeX/MiKTeX 后，您可能需要完全重启 Obsidian 才能识别新的系统路径。Natural Move/Export 插件会自动在标准路径（`/Library/TeX/texbin`、`/opt/homebrew/bin`、`/usr/local/bin`）中搜索所需的程序。

## 在 Obsidian 中安装

### 通过 BRAT (测试版测试)
1. 从社区插件中安装 "Obsidian 42 - BRAT" 插件。
2. 转到 BRAT 设置并单击 "Add Beta Plugin"。
3. 输入此 GitHub 仓库的 URL。
4. 单击 "Add Plugin"。

### 手动安装
1. 下载项目为 ZIP 文件并解压。
2. 在您的 Obsidian 库中创建文件夹：`.obsidian/plugins/natural-move`
3. 将所有解压后的项目文件复制到此新文件夹中。
4. 在此文件夹中打开终端并运行以下命令：
   ```bash
   npm install
   npm run build
   ```
5. 打开 Obsidian 并转到 **设置 > 社区插件**。
6. 如果尚未禁用，请禁用“安全模式”。
7. 单击“刷新”并启用 **Natural Move/Export** 插件。

## 致谢与许可

- **作者：** Naturalis
- **许可：** MIT
- **第三方工具：** 此插件使用 [Pandoc](https://pandoc.org/) (GPL 许可) 作为文件转换的外部命令行工具。Pandoc 不随此插件捆绑，必须由用户单独安装。
