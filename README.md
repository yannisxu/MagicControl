# Magic Control

Magic Control allows you to control your Mac using hand gestures via your webcam.
通过摄像头捕捉手势，实现对 Mac 的隔空操控，主要用于演示 PPT 等场景

## Usage Guide / 使用教程

See the [Animated Guide](https://yannisxu.github.io/MagicControl/guide.html) for a visual demonstration.
[查看动态演示](https://yannisxu.github.io/MagicControl/guide.html)

**1. 激光滑动 / Laser Sliding**
- Move your hand naturally to control the red laser pointer.
- 移动手掌控制红色激光点。

**2. 手势捏合 / Pinch**
- Pinch your **Index Finger** and **Thumb** together to activate "Grab Mode".
- A **Green Dot** will appear to confirm recognition.
- 捏合**食指**和**拇指**；出现**绿点**表示识别成功。

**3. 左滑右滑 / Swipe**
- While holding the pinch, move your hand **Left/Right** (or Up/Down) to flip pages.
- Release the pinch to trigger the action.
- 保持捏合状态，向**左/右**（或上/下）移动手掌；松开捏合即可触发翻页。

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
- [Antigravity](https://antigravity.app/)
