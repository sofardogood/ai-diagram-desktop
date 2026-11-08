# Development & CI/CD Guide

## 1. Repository Setup & Architecture

- **Repository**: `https://github.com/sofardogood/ai-diagram-desktop`
- `src/main/` - Electron main process, preload bridge, CLI argument parser, and AI backend router
- `drawio/src/main/webapp/` - Bundled draw.io web editor enhanced with `js/aiAssistant.js`, `js/authGate.js`, and the multi-tab AI Side Browser in `js/diagramly/ElectronApp.js`
- `build/` - Icons, entitlements, security fuses (`fuses.mjs`), macOS Quick Look extension, and signing hooks
- `electron-builder-*.json` - Platform-specific packaging configurations
- `sync.cjs` - Syncs the version from `./drawio/VERSION` into `package.json` and configures `src/main/disableUpdate.js`
- `.github/workflows/` - GitHub Actions workflows for GitHub Pages deployment (`deploy-pages.yml`) and desktop installer builds (`personal-build.yml`, `electron-builder*.yml`)

## 2. Local Development Workflow

1. **Install dependencies**:
   ```bash
   npm install
   ```
2. **Start in development mode**:
   ```bash
   npm start
   # Or with Chrome DevTools automatically opened:
   DRAWIO_ENV=dev npm start
   ```
3. **Run unit tests**:
   ```bash
   npm test
   ```

## 3. Packaging Unsigned Desktop Installers

Before packaging on any platform, sync the version and disable auto-update so the app does not attempt to pull upstream updates:

```bash
npm run sync -- disableUpdate
```

- **macOS (Apple Silicon DMG)**:
  ```bash
  DRAWIO_UNSIGNED=true CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --config electron-builder-linux-mac.json --mac dmg --arm64 --publish never
  ```
- **Windows (NSIS / MSI)**:
  ```powershell
  $env:DRAWIO_UNSIGNED="true"
  npx electron-builder --config electron-builder-win.json --publish never
  ```
- **Linux (AppImage / deb)**:
  ```bash
  npx electron-builder --config electron-builder-linux-mac.json --linux AppImage deb --x64 --publish never
  ```

For additional details on personal/fork builds, see [`doc/BUILDING_FOR_PERSONAL_USE.md`](doc/BUILDING_FOR_PERSONAL_USE.md).

## 4. GitHub Pages Deployment (Web & Cloud Edition)

Pushing to the `main` branch automatically triggers `.github/workflows/deploy-pages.yml`, which publishes `drawio/src/main/webapp` to GitHub Pages with:
- SHA-256 authentication gate (`js/authGate.js`, default passcode: `drawio-ai`)
- Universal AI Assistant (`js/aiAssistant.js`) using direct browser fetch to Gemini / OpenAI / Claude / Ollama
- Popup-based AI Browser presets with persistent native browser cookies
