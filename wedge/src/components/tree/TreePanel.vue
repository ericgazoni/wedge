<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useMagicKeys } from "@vueuse/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../../stores/app";
import { useRepoStore } from "../../stores/repo";
import type { DoorstopItem } from "../../types/doorstop";

type TreeRow =
  | { kind: "doc"; key: string; label: string }
  | { kind: "item"; uid: string; header: string; active: boolean };

const emit = defineEmits<{
  (e: "counts-change", payload: { docs: number; items: number }): void;
}>();

const app = useAppStore();
const repo = useRepoStore();
const keys = useMagicKeys();

const MIN_TREE_WIDTH = 220;
const MAX_TREE_WIDTH = 760;
const TREE_WIDTH_STORAGE_KEY = "wedge.treeWidth";
const ACTIVE_ONLY_STORAGE_KEY = "wedge.treeActiveOnly";
const SEARCH_EXCLUDED_FIELDS = new Set(["reviewed", "level"]);

const flatTreeCursor = ref(0);
const showActiveOnly = ref(loadPersistedActiveOnly());
const treeWidth = ref(loadPersistedTreeWidth());
const contextMenu = ref<{
  open: boolean;
  x: number;
  y: number;
  uid: string;
}>({ open: false, x: 0, y: 0, uid: "" });

function clampTreeWidth(next: number): number {
  return Math.max(MIN_TREE_WIDTH, Math.min(MAX_TREE_WIDTH, next));
}

function loadPersistedTreeWidth(): number {
  if (typeof window === "undefined") return 320;
  try {
    const raw = window.localStorage.getItem(TREE_WIDTH_STORAGE_KEY);
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampTreeWidth(parsed) : 320;
  } catch {
    return 320;
  }
}

function loadPersistedActiveOnly(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ACTIVE_ONLY_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistTreeWidth(width: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TREE_WIDTH_STORAGE_KEY, String(clampTreeWidth(width)));
  } catch {
    // Ignore storage errors.
  }
}

function persistActiveOnly(value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVE_ONLY_STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Ignore storage errors.
  }
}

function isTruthyActive(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "yes" || normalized === "1") return true;
    if (normalized === "false" || normalized === "no" || normalized === "0") return false;
  }
  return true;
}

function isItemActive(item: DoorstopItem): boolean {
  return isTruthyActive(item.data.active);
}

function collectSearchParts(value: unknown, out: string[]) {
  if (value == null) return;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    out.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectSearchParts(entry, out);
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.push(k);
      collectSearchParts(v, out);
    }
  }
}

function buildItemSearchText(item: DoorstopItem): string {
  const parts: string[] = [item.uid];
  for (const [field, value] of Object.entries(item.data)) {
    if (SEARCH_EXCLUDED_FIELDS.has(field)) continue;
    parts.push(field);
    collectSearchParts(value, parts);
  }
  return parts.join(" ").toLowerCase();
}

function matchesItemFilter(item: DoorstopItem, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q.length) return true;
  return buildItemSearchText(item).includes(q);
}

const flatTree = computed<TreeRow[]>(() => {
  const q = app.treeFilter;
  const onlyActive = showActiveOnly.value;
  const rows: TreeRow[] = [];

  for (const d of repo.documentTree) {
    const visibleItems = d.items.filter(
      (it) => matchesItemFilter(it, q) && (!onlyActive || isItemActive(it)),
    );
    if (q.trim().length > 0 && visibleItems.length === 0) continue;

    rows.push({ kind: "doc", key: d.prefix, label: `${d.prefix} (${visibleItems.length})` });
    if (!(app.expandedDocs[d.prefix] ?? true)) continue;

    for (const it of visibleItems) {
      rows.push({
        kind: "item",
        uid: it.uid,
        header: String(it.data.header ?? ""),
        active: isItemActive(it),
      });
    }
  }

  return rows;
});

const visibleDocCount = computed(() => flatTree.value.filter((row) => row.kind === "doc").length);
const visibleItemCount = computed(() => flatTree.value.filter((row) => row.kind === "item").length);

function startTreeResize(event: MouseEvent) {
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = treeWidth.value;

  document.body.style.userSelect = "none";
  document.body.style.cursor = "col-resize";

  const onMouseMove = (moveEvent: MouseEvent) => {
    treeWidth.value = clampTreeWidth(startWidth + (moveEvent.clientX - startX));
  };

  const onMouseUp = () => {
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
}

function moveCursor(delta: number) {
  if (!flatTree.value.length) return;
  flatTreeCursor.value = Math.max(0, Math.min(flatTree.value.length - 1, flatTreeCursor.value + delta));
}

function activateCursorRow() {
  const row = flatTree.value[flatTreeCursor.value];
  if (!row) return;
  if (row.kind === "doc") return app.toggleDoc(row.key);
  app.selectedUid = row.uid;
  app.currentView = "editor";
}

function onTreeRowClick(idx: number) {
  flatTreeCursor.value = idx;
  const row = flatTree.value[idx];
  if (!row) return;
  if (row.kind === "item") {
    app.selectedUid = row.uid;
    app.currentView = "editor";
  }
}

function closeContextMenu() {
  contextMenu.value.open = false;
}

function onWindowPointerDown() {
  closeContextMenu();
}

function onWindowEscapeKey(event: KeyboardEvent) {
  if (event.key === "Escape") closeContextMenu();
}

function onItemContextMenu(event: MouseEvent, idx: number, uid: string) {
  event.preventDefault();
  flatTreeCursor.value = idx;
  app.selectedUid = uid;
  contextMenu.value = {
    open: true,
    x: event.clientX,
    y: event.clientY,
    uid,
  };
}

async function toggleItemActiveFromContextMenu() {
  const uid = contextMenu.value.uid;
  if (!uid) return;

  const item = repo.findItem(uid);
  if (!item) {
    closeContextMenu();
    return;
  }

  const nextData = {
    ...item.data,
    active: !isItemActive(item),
  };

  await repo.saveItem(uid, nextData);
  closeContextMenu();
}

async function deleteItemFromContextMenu() {
  const uid = contextMenu.value.uid;
  if (!uid) return;

  const ok = await confirm(`Delete ${uid}?`, {
    title: "Delete item",
    kind: "warning",
    okLabel: "Delete",
    cancelLabel: "Cancel",
  });
  if (!ok) return;

  const currentDoc = repo.findItem(uid)?.docPrefix ?? "";
  const deleted = await repo.deleteItem(uid);
  if (!deleted) {
    closeContextMenu();
    return;
  }

  const fallbackUid =
    repo.documentTree.find((d) => d.prefix === currentDoc)?.items[0]?.uid ??
    repo.allItems[0]?.uid ??
    "";

  if (app.selectedUid === uid) app.selectedUid = fallbackUid;
  closeContextMenu();
}

const contextMenuTargetItem = computed(() => repo.findItem(contextMenu.value.uid));
const contextMenuTargetIsActive = computed(() => {
  const item = contextMenuTargetItem.value;
  return item ? isItemActive(item) : false;
});

onMounted(() => {
  window.addEventListener("pointerdown", onWindowPointerDown);
  window.addEventListener("keydown", onWindowEscapeKey);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onWindowPointerDown);
  window.removeEventListener("keydown", onWindowEscapeKey);
});

watch(
  () => flatTree.value.length,
  (len) => {
    if (!len) {
      flatTreeCursor.value = 0;
      return;
    }
    if (flatTreeCursor.value >= len) flatTreeCursor.value = len - 1;
  },
);

watch(
  () => treeWidth.value,
  (width) => persistTreeWidth(width),
);

watch(
  () => showActiveOnly.value,
  (value) => persistActiveOnly(value),
);

watch(
  () => [visibleDocCount.value, visibleItemCount.value],
  ([docs, items]) => emit("counts-change", { docs, items }),
  { immediate: true },
);

watch(() => keys["ArrowDown"]?.value, (p, prev) => p && !prev && moveCursor(1));
watch(() => keys["ArrowUp"]?.value, (p, prev) => p && !prev && moveCursor(-1));
watch(() => keys["Enter"]?.value, (p, prev) => p && !prev && activateCursorRow());
watch(() => keys["/"]?.value, (p, prev) => {
  if (!(p && !prev)) return;
  (document.getElementById("tree-filter") as HTMLInputElement | null)?.focus();
});
</script>

<template>
  <aside class="bg-panel min-h-0 flex shrink-0" :style="{ width: `${treeWidth}px` }">
    <div class="min-h-0 flex flex-col flex-1">
      <div class="px-3 py-2 border-b border-slate-800 flex items-center gap-2">
        <input id="tree-filter" v-model="app.treeFilter" class="input w-full h-8" placeholder="Filter tree (/)" />
        <span class="kbd">/</span>
        <label class="inline-flex items-center gap-1 text-xs text-slate-400 whitespace-nowrap select-none">
          <input v-model="showActiveOnly" type="checkbox" class="h-3.5 w-3.5" />
          Active only
        </label>
      </div>
      <div class="flex-1 min-h-0 overflow-auto p-2">
        <div v-if="repo.loading" class="text-xs text-slate-400 p-2">Scanning repository...</div>
        <div v-else-if="repo.error" class="text-xs text-red-400 p-2">{{ repo.error }}</div>
        <div v-else-if="!repo.repo" class="text-xs text-slate-500 p-2">Open a repository to load documents.</div>
        <div v-else-if="flatTree.length === 0" class="text-xs text-slate-500 p-2">Repository loaded but no doorstop document/items were detected.</div>
        <div v-else class="space-y-1 text-sm">
          <div
            v-for="(row, idx) in flatTree"
            :key="row.kind === 'doc' ? `doc-${row.key}` : `item-${row.uid}`"
            class="px-2 py-1 rounded cursor-default border select-none"
            :class="[
              idx === flatTreeCursor ? 'border-sky-500 bg-slate-800' : 'border-transparent',
              row.kind === 'doc'
                ? 'text-slate-300 font-semibold'
                : row.active
                  ? 'text-slate-300 pl-6'
                  : 'text-slate-500 pl-6 italic',
            ]"
            @click="onTreeRowClick(idx)"
            @contextmenu="row.kind === 'item' ? onItemContextMenu($event, idx, row.uid) : undefined"
          >
            <template v-if="row.kind === 'doc'">
              <span class="mr-2 text-slate-500">{{ (app.expandedDocs[row.key] ?? true) ? '▾' : '▸' }}</span>
              <span @click.stop="app.toggleDoc(row.key)">{{ row.label }}</span>
            </template>
            <template v-else>
              <span
                class="mr-2 inline-block h-2 w-2 rounded-full align-middle"
                :class="row.active ? 'bg-emerald-400/80' : 'bg-slate-600'"
              ></span>
              <span class="text-slate-300">{{ row.uid }}</span>
              <span class="text-slate-500"> - {{ row.header || "(no header)" }}</span>
              <span v-if="!row.active" class="text-[10px] uppercase tracking-wide text-slate-500 ml-2">inactive</span>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="contextMenu.open"
      class="fixed z-50 min-w-[180px] rounded border border-slate-700 bg-panel2 p-1 shadow-lg"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      @pointerdown.stop
    >
      <button
        class="w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-800"
        @click="toggleItemActiveFromContextMenu"
      >
        Set {{ contextMenuTargetIsActive ? "inactive" : "active" }}
      </button>
      <button
        class="w-full rounded px-2 py-1 text-left text-sm text-red-300 hover:bg-slate-800"
        @click="deleteItemFromContextMenu"
      >
        Delete item
      </button>
    </div>

    <div
      class="w-1.5 bg-slate-800 hover:bg-sky-700 cursor-col-resize shrink-0"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize tree panel"
      @mousedown="startTreeResize"
    ></div>
  </aside>
</template>

