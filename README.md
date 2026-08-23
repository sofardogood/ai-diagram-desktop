# AI Diagram Editor (Desktop) 🚀

> **An AI-powered, offline-first diagramming desktop application built on top of draw.io / Electron.**
> Featuring automatic flowchart connectivity, next-step prediction, and an embedded multi-tab AI browser (ChatGPT / Claude / Gemini) with persistent sessions.

---

## ✨ Key Features

### 1. 🤖 AI Flowchart Assistant (Auto-Connect & Auto-Complete)
- **Auto-Connect (全自動結線)**: Automatically analyzes placed nodes on the canvas and generates optimal flowchart arrows, branches, and connections based on logical structure and meaning.
- **Auto-Complete (次のステップ自動追加)**: Predicts the next logical process / decision step and automatically adds connected diagram elements.
- **Multi-Model Support**: Directly connect your API keys for **Google Gemini (Gemini 2.5/3.x Flash)**, **OpenAI (GPT-4o)**, or **Anthropic Claude**.
- **Privacy & Security**: All API keys are stored exclusively in your local machine's encrypted storage. No intermediate servers, telemetry, or third-party tracking.

### 2. 🌐 Embedded Multi-Tab AI Side Browser
- **Side-by-Side Workflow**: Keep ChatGPT, Claude, Gemini, or Google Search open right next to your canvas.
- **Multi-Tab Architecture**: Open and switch between multiple web tabs without reloading pages or losing in-progress prompts and chat history.
- **Permanent Login & Cookie Persistence**: Standard Chrome User-Agent integration allows seamless Google OAuth sign-in and permanently keeps your login cookies across app restarts.
- **Dynamic Layout Shifting**: Opening or resizing the browser automatically shifts the draw.io canvas and ensures all formatting/style panels remain 100% visible and interactive.

### 3. 💾 Enhanced File Management
- **Direct Overwrite Save**: Opening or importing existing diagrams preserves full file metadata, enabling instant `Cmd+S` / `Ctrl+S` overwrite saves without reverting to "Untitled".

---

## 🛠 Getting Started & Building from Source

### Prerequisites
- [Node.js](https://nodejs.org/) (version 20.x or later)
- npm

### Installation & Run Locally

```bash
# 1. Clone repository
git clone https://github.com/sofardogood/ai-diagram-desktop.git
cd ai-diagram-desktop

# 2. Install dependencies
npm install

# 3. Start development mode
npm start
```

### Packaging Desktop Binaries

#### macOS (Apple Silicon / Intel)
```bash
npm run sync -- disableUpdate
DRAWIO_UNSIGNED=true CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --config electron-builder-linux-mac.json --mac dmg --arm64 --publish never
```

#### Windows
```powershell
$env:DRAWIO_UNSIGNED="true"
npm run sync -- disableUpdate
npx electron-builder --config electron-builder-win.json --publish never
```

#### Linux
```bash
npm run sync -- disableUpdate
npx electron-builder --config electron-builder-linux-mac.json --linux AppImage deb --x64 --publish never
```

---

## 📄 License & Attribution

This project is licensed under the [Apache License 2.0](LICENSE).

### Attribution
- This software is a customized fork derived from [drawio-desktop](https://github.com/jgraph/drawio-desktop) and [drawio](https://github.com/jgraph/drawio), created and maintained by **JGraph Ltd**.
- `draw.io` is a registered trademark of JGraph Ltd.
- This is an independent, community-driven open-source project and is not affiliated with or endorsed by JGraph Ltd.

