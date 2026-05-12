#!/usr/bin/env bash
# Build the bundled doorstop sidecar binary using PyInstaller via uv.
#
# Run once before `tauri build` to embed doorstop in the app bundle, or let
# tauri.conf.json's beforeBuildCommand call it automatically.
#
# Requirements: uv (https://docs.astral.sh/uv/getting-started/installation/)
#               rustc (for target triple detection)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/.."
BINARIES_DIR="$PROJECT_DIR/src-tauri/binaries"
WORK_DIR="$(mktemp -d)"

cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

if ! command -v rustc &>/dev/null; then
    echo "Error: rustc not found. Install Rust to determine the target triple." >&2
    exit 1
fi

if ! command -v uv &>/dev/null; then
    echo "Error: uv not found. Install it with: curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
    exit 1
fi

TARGET_TRIPLE="$(rustc -Vv | grep '^host:' | awk '{print $2}')"
OUTPUT="$BINARIES_DIR/doorstop-$TARGET_TRIPLE"

# Skip rebuild if a real (non-empty) binary already exists.
if [[ -f "$OUTPUT" && -s "$OUTPUT" ]]; then
    echo "Sidecar already built: $OUTPUT"
    echo "Remove it and re-run to rebuild."
    exit 0
fi

mkdir -p "$BINARIES_DIR"

echo "Syncing Python environment..."
(cd "$PROJECT_DIR" && uv sync)

echo "Locating doorstop entry point..."
ENTRY="$(cd "$PROJECT_DIR" && uv run python -c "import doorstop, os; print(os.path.join(os.path.dirname(doorstop.__file__), '__main__.py'))")"
echo "  -> $ENTRY"

echo "Building standalone doorstop binary (this may take a minute)..."
(cd "$PROJECT_DIR" && uv run pyinstaller \
    "$ENTRY" \
    --onefile \
    --name doorstop \
    --distpath "$WORK_DIR/dist" \
    --workpath "$WORK_DIR/build" \
    --specpath "$WORK_DIR" \
    --clean \
    --noconfirm \
    --log-level WARN)

mv "$WORK_DIR/dist/doorstop" "$OUTPUT"
chmod +x "$OUTPUT"

echo ""
echo "Done: $OUTPUT"
