# Wedge

Wedge is a desktop application for working with [Doorstop](https://doorstop.readthedocs.io/en/latest/) requirements projects.

It provides a local UI for opening a repository, browsing and editing requirement content, and handling project sync workflows in one place.

## Why Wedge exists

Doorstop is excellent for requirements-as-code, but many teams still need a desktop-first editing experience for day-to-day authoring and review.

Wedge focuses on that gap:

- Keep Doorstop files and structure as the source of truth.
- Make common work (browse, edit, create, link, sync) fast and approachable.
- Reduce friction for contributors who are not comfortable with command-line Git workflows.

## What Wedge currently supports

The feature set below reflects the current implementation in this repository.

- Open or join projects
  - Open an existing local repository folder.
  - Join a shared project by downloading from an HTTPS URL.
  - Keep a recent-project list for quick reopen.
- Doorstop repository scanning
  - Recursively finds Doorstop document directories via `.doorstop.yml` / `.doorstop.yaml`.
  - Skips common non-project folders (for example `.git`, `node_modules`, `target`, `dist`).
  - Loads item files from YAML and Markdown formats.
- Editor workflow
  - Edit core fields (`header`, `text`, `level`, `active`, `derived`, `normative`, `ref`, `links`).
  - Edit custom attributes beyond the standard Doorstop fields.
  - Auto-save while editing and manual save hook before sync.
  - Link picker with search and invalid-link detection.
- Tree and item management
  - Search/filter tree content across item fields.
  - Optional "active only" filtering.
  - Context actions to create, duplicate, activate/deactivate, and delete items.
  - Resizable tree panel and keyboard navigation.
- Batch creation
  - Create multiple child items quickly from one view.
  - Set per-row metadata (`text`, `ref`, `level`, flags) before saving.
  - Optionally pre-link newly created items to a selected source item.
- Sync and conflict handling
  - "Sync now" workflow with status indicator and periodic background refresh.
  - Startup refresh and branch/status visibility.
  - Conflict resolution options: keep mine, keep theirs, or abort.
  - Basic credential prompts and per-host remembered credentials.

## Doorstop ecosystem references

[Doorstop's official examples page](https://doorstop.readthedocs.io/en/latest/examples.html) lists other third-party clients as well:

## Tech stack

- [Tauri](https://tauri.app/) for the desktop shell and native integration.
- [Vue 3](https://vuejs.org/) + [TypeScript](https://www.typescriptlang.org/) for the frontend.
- [Vite](https://vitejs.dev/) for frontend development and builds.

## Development

Install dependencies:

```bash
npm install
```

Run the frontend in dev mode:

```bash
npm run dev
```

Run the desktop app in Tauri dev mode:

```bash
npm run tauri dev
```

Build frontend assets:

```bash
npm run build
```
