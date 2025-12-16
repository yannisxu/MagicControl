# Magic Control

Magic Control allows you to control your Mac using hand gestures via your webcam.

## Download / 下载

[Download Latest macOS DMG / 下载最新 macOS 安装包](https://github.com/yannisxu/MagicControl/releases)

## Installation / 安装

Since this application is not signed with an Apple Developer ID, macOS may prevent it from opening ("App is damaged" or "Unidentified developer").

To fix this, open Terminal and run the following command **after** moving the app to your Applications folder:

```bash
sudo xattr -r -d com.apple.quarantine "/Applications/Magic Control.app"
```

If you haven't moved it to Applications, use the path to where the app is located (e.g., Downloads).

---

因为本应用没有 Apple 开发者签名，macOS 可能会提示“已损坏”或“无法打开”。

解决方法：请打开“终端 (Terminal)”，输入以下命令（假设您已将 App 拖入“应用程序”文件夹）：

```bash
sudo xattr -r -d com.apple.quarantine "/Applications/Magic Control.app"
```

如果应用在其他位置（比如下载文件夹），请将路径替换为实际路径。

## Development

This template should help get you started developing with Tauri, React and Typescript in Vite.

### Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
