# Visionary Infinite Canvas Codex Plugin

让 Codex 可以打开并操作 Visionary Infinite Canvas。

## 安装

macOS / Linux：

```bash
git clone https://github.com/ursuchcute/visionary-infinite-canvas.git
cd visionary-infinite-canvas
codex plugin marketplace add "$(pwd)"
codex plugin add visionary-infinite-canvas@visionary-infinite-canvas-local
```

Windows PowerShell：

```powershell
git clone https://github.com/ursuchcute/visionary-infinite-canvas.git
cd visionary-infinite-canvas
codex plugin marketplace add "$PWD"
codex plugin add visionary-infinite-canvas@visionary-infinite-canvas-local
```

Windows CMD 将 `$PWD` 替换为 `%cd%`。

安装后新建一个 Codex 任务，然后输入：

```text
帮我打开并连接到 Visionary Infinite Canvas
```
