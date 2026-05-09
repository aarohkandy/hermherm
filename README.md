# HermHerm

HermHerm is the first desktop playground for the consumer agent app we discussed. This build is intentionally simple to run on Windows: it uses Electron + React right now so you can test the product shape without installing Rust, Visual Studio Build Tools, Hermes, Ollama, or a local model.

The production shell can still move to Tauri later. The current goal is to make the interface and testing loop real first.

## What This Build Does

- Runs as a Windows desktop app.
- Shows a polished three-pane agent workspace: navigation, run timeline, tool trace, output studio, and safety inspector.
- Simulates streaming assistant output and visible tool calls.
- Includes starter playground tasks for research, tool debugging, and local-mode planning.
- Builds a Windows installer through Electron Builder.
- Adds GitHub Actions for Windows and macOS artifacts.

## What This Build Does Not Do Yet

- It does not call Hermes Agent.
- It does not call OpenAI, Anthropic, OpenRouter, or any hosted model.
- It does not read or write your files.
- It does not install Ollama or download a local model.
- It is not code-signed yet, so Windows SmartScreen can warn on packaged builds.

## Easiest Windows Test

Double-click:

```text
start-windows.bat
```

That script checks for Node, installs dependencies if needed, and starts the desktop app.

If you prefer PowerShell:

```powershell
npm.cmd install
npm.cmd run app:dev
```

Use `npm.cmd` instead of `npm` if PowerShell blocks `npm.ps1` on your machine.

## Build A Windows Installer

```powershell
npm.cmd run app:dist
```

The installer will appear in:

```text
release/
```

For a quick unpacked desktop build:

```powershell
npm.cmd run app:portable
```

That creates a folder under `release/portable/`. Open the generated `HermHerm.exe` inside it.

`npm.cmd run app:dist` uses Electron Builder to make a familiar installer. On some Windows machines, Electron Builder may need Developer Mode or symlink privileges because one of its signing helper downloads contains symlinks. `app:portable` avoids that and is the easier local test path.

## Health Check

```powershell
check-windows.bat
```

or:

```powershell
npm.cmd run check:system
npm.cmd run build
```

## Testing macOS From Windows

You cannot fully test a real Mac app from Windows alone. The practical options are:

1. Use GitHub Actions to build a macOS artifact.
2. Rent or borrow a real Mac and remote into it from Windows.
3. Use a Mac cloud provider like MacStadium or AWS EC2 Mac.

GitHub Actions is good for packaging. A real Mac is still needed to test first launch, DMG behavior, Gatekeeper, notarization, sidecars, and the feel of the app.

## Why Electron First?

The planned production direction is Tauri v2, but Tauri development on Windows requires Rust, MSVC C++ Build Tools, and WebView2 readiness. This machine currently has Node and Git, so Electron gives us a working desktop playground immediately.

When we move to Tauri, the likely prerequisites are:

- Rust via rustup
- Visual Studio Build Tools with Desktop development with C++
- Node.js LTS
- WebView2 Runtime

## Near-Term Roadmap

1. Wire the UI to a real streaming model provider.
2. Add provider settings and local encrypted key storage.
3. Add a Hermes API server health check.
4. Add a Tauri shell once Windows prerequisites are installed.
5. Add CI release drafts with downloadable installers.
6. Add local-mode experiments: Hermes sidecar, Ollama detection, and model download UX.
