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

The feature set below reflects the current implementation:

- Open or join projects
  - Open an existing local repository folder.
  - Join a shared project by git-sync via HTTPS URL (no SSH support yet).
  - Automatically re-open last used project.
- Doorstop repository scanning
  - Recursively finds Doorstop document directories via `.doorstop.yml` / `.doorstop.yaml`.
  - Loads item files from YAML and Markdown formats.
- Editor workflow
  - Edit core fields (`header`, `text`, `level`, `active`, `derived`, `normative`, `ref`, `links`).
  - Edit custom attributes beyond the standard Doorstop fields.
  - Auto-save while editing.
  - Link picker with search and invalid-link detection.
- Tree and item management
  - Global search content across item fields.
  - Filtering "active only" items.
  - Filtering documents that have Doorstop integrity issues.
  - Warning indicator on document cards when issues are detected.
  - Context actions to create, duplicate, activate/deactivate, and delete items.
  - Resizable tree panel and keyboard navigation.
- Batch creation
  - Create multiple child items quickly from one view.
  - Set per-row metadata (`text`, `ref`, `level`, ...) before saving.
  - Link newly created items to a selected source item.
- Doorstop integrity checks
  - Automatically runs `doorstop review` and `doorstop check` after each save.
  - Issues reported by Doorstop are reflected in real time in the tree panel.
  - Check status (pass / N issues) shown in the status bar.
  - Doorstop is bundled with the application — no separate installation required.
- Collaboration via Git and conflict handling
  - "Sync now" workflow with status indicator and periodic background refresh.
  - Startup refresh and branch/status visibility.
  - Conflict resolution options: keep mine, keep theirs, or abort.
  - Basic credential prompts and per-host remembered credentials.

## Doorstop ecosystem references

[Doorstop's official examples page](https://doorstop.readthedocs.io/en/latest/examples.html) lists other third-party clients as well:

- [sevendays/doorhole](https://github.com/sevendays/doorhole)
- [ownbee/doorstop-edit](https://github.com/ownbee/doorstop-edit)

## Requirements

- A local folder for your Doorstop project repository.
- Optional: an HTTPS remote repository URL if you want to sync with a shared server.

Using Wedge with an existing repository? See [`manual/git-project-setup.md`](manual/git-project-setup.md).

## Tech stack

- [Tauri](https://tauri.app/) for the desktop shell and native integration.
- [Vue 3](https://vuejs.org/) + [TypeScript](https://www.typescriptlang.org/) for the frontend.
- [Vite](https://vitejs.dev/) for frontend development and builds.
- [Rust](https://www.rust-lang.org/) for native Tauri commands (Git, Doorstop integration).
- [uv](https://docs.astral.sh/uv/) for managing the Python environment used by Doorstop.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) and npm
- [Rust toolchain](https://rustup.rs/)
- [uv](https://docs.astral.sh/uv/getting-started/installation/) — Python package manager

### Setup

Install Node dependencies:

```bash
npm install
```

Set up the Python environment (provides `doorstop` for the integrity check feature in dev):

```bash
uv sync
```

This creates a `.venv/` directory in the project root. Wedge automatically finds the `doorstop` binary inside it when running in dev mode — no further configuration needed.

### Running

Run the desktop app in Tauri dev mode:

```bash
npm run tauri dev
```

### Building for production

`tauri build` handles everything automatically via `beforeBuildCommand`:

```bash
npm run tauri build
```

This will:
1. Run `scripts/build_doorstop_sidecar.sh`, which uses PyInstaller to package the `doorstop` CLI and its Python runtime into a single self-contained binary and places it in `src-tauri/binaries/`.
2. Build the frontend assets.
3. Compile and bundle the Tauri app with the doorstop binary embedded.

The sidecar build step is skipped on subsequent runs if the binary already exists. Delete `src-tauri/binaries/doorstop-<target-triple>` and re-run to force a rebuild.

> **Note:** `uv` must be available on the build machine. On CI, add a `uv` install step before running `tauri build`.
