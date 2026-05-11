# HermHerm

HermHerm is a Windows desktop app for testing a calm local AI assistant surface. It now uses a beige command-interface layout: a central animated core, local runtime readouts, Ask/Build/Analyze modes, and a visual artifact canvas instead of a normal chat timeline.

This build keeps your existing Hermes setup separate. The app uses a dedicated WSL Hermes profile named `hermherm`, a separate API port (`8643`), and a separate Ollama model directory under:

```text
~/.hermes/profiles/hermherm/ollama-models
```

Your default Hermes profile and Discord gateway stay on their own profile.

## What This Build Does

- Runs as a Windows desktop app through Electron + React.
- Uses a clean beige command surface by default.
- Starts/checks an isolated Hermes profile on `http://127.0.0.1:8643`.
- Uses app-owned Ollama local chat on `http://127.0.0.1:11434`.
- Uses a two-brain local model setup: `qwen2.5:0.5b` for fast routing/simple answers and `gemma4:e4b` for deep answers.
- Starts the app as soon as Fast Qwen is ready, then downloads Deep Gemma 4 in the background if needed.
- Removes starter tasks; the app opens directly to a command input.
- Runs a local `hermherm-visuals` MCP-style server that turns local model replies into visual cards, metrics, and task maps.
- Builds a Windows portable app or installer.

## Easiest Windows Test

Double-click:

```text
start-windows.bat
```

That checks for Node, installs dependencies if needed, and starts the desktop app. On first launch, the app will try to start the isolated local runtime automatically.

For a more explicit setup step, double-click this first:

```text
setup-local-hermes-wsl.bat
```

The older `connect-hermes-wsl.bat` still exists, but it now does the same isolated setup. It no longer edits `~/.hermes/.env` for your default profile.

## Requirements

- Windows with WSL Ubuntu available.
- Hermes already installed inside WSL at `~/.local/bin/hermes`.
- Node.js LTS on Windows for development.

The setup script installs a user-local Ollama binary under `~/.local/ollama` if it is missing. It does not require Windows admin rights.

## PowerShell Commands

Use `npm.cmd` instead of `npm` if PowerShell blocks `npm.ps1`.

```powershell
npm.cmd install
npm.cmd run hermes:wsl
npm.cmd run app:dev
```

## Runtime Ports

```text
HermHerm Hermes profile: hermherm
HermHerm Hermes API:     http://127.0.0.1:8643
HermHerm API key:        hermherm-local-dev
HermHerm Ollama:         http://127.0.0.1:11434
Fast local model:        qwen2.5:0.5b
Deep local model:        gemma4:e4b
```

The app currently chats through the app-owned Ollama endpoint for responsiveness. Qwen classifies each prompt first, then HermHerm either answers with Fast Qwen or routes to Deep Gemma 4. The isolated Hermes API is still started and health-checked so the app runtime is separate from your default Hermes/Discord setup.

## Visual MCP Server

The visual layer lives in:

```text
electron\visual-mcp-server.cjs
```

It exposes MCP-style stdio methods including `tools/list` and `tools/call`. The desktop app calls `compose_visual_response` after each local model response, then renders the returned structure as visual cards, routing metadata, runtime metrics, and a task map.

## Build A Windows App

For the easiest local packaged test:

```powershell
npm.cmd run app:portable
```

Open:

```text
release\portable\HermHerm-win32-x64\HermHerm.exe
```

For a normal installer:

```powershell
npm.cmd run app:dist
```

The installer appears in:

```text
release\
```

Unsigned Windows builds may show SmartScreen warnings.

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
