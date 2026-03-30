<script setup lang="ts">
import { computed, ref, toRaw, watch } from "vue";
import { useMagicKeys } from "@vueuse/core";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "./stores/app";
import { useRepoStore } from "./stores/repo";
import { getLastDoorstopScanDebug } from "./services/doorstop";
import { STANDARD_FIELDS } from "./types/doorstop";
import type { DoorstopItem } from "./types/doorstop";

const app = useAppStore();
const repo = useRepoStore();
const keys = useMagicKeys();

const flatTreeCursor = ref(0);
const scanDebug = ref(getLastDoorstopScanDebug());
const editorDraft = ref<Record<string, unknown>>({});
const editorMessage = ref("");
const savingItem = ref(false);

type BatchRow = {
  id: number;
  title: string;
  text: string;
  active: boolean;
  derived: boolean;
  normative: boolean;
  ref: string;
  reviewed: string;
  level: number;
  expanded: boolean;
};

const batchDocPrefix = ref("");
const batchLinkUid = ref("");
const batchRows = ref<BatchRow[]>([]);
const batchMessage = ref("");
const savingBatch = ref(false);
let nextBatchRowId = 1;

const flatTree = computed(() => {
  const q = app.treeFilter.trim().toLowerCase();
  const rows: Array<
    | { kind: "doc"; key: string; label: string }
    | { kind: "item"; uid: string; header: string; docKey: string }
  > = [];

  for (const d of repo.documentTree) {
    rows.push({ kind: "doc", key: d.prefix, label: `${d.prefix} (${d.count})` });
    if (!(app.expandedDocs[d.prefix] ?? true)) continue;

    for (const it of d.items) {
      const header = String(it.data.header ?? "");
      const hay = `${it.uid} ${header}`.toLowerCase();
      if (!q || hay.includes(q)) {
        rows.push({ kind: "item", uid: it.uid, header, docKey: d.prefix });
      }
    }
  }

  return rows;
});

const selectedItem = computed(() => repo.findItem(app.selectedUid));
const availableDocPrefixes = computed(() =>
  repo.documentTree.map((d) => d.prefix).sort((a, b) => a.localeCompare(b)),
);

const docsByPrefix = computed(() => {
  const map = new Map<string, { parent: string | null }>();
  for (const d of repo.documentTree) {
    map.set(d.prefix, { parent: d.parent ?? null });
  }
  return map;
});

const batchSourceItem = computed(() => repo.findItem(batchLinkUid.value));
const batchTargetDocOptions = computed(() => {
  if (!batchSourceItem.value) return [] as string[];
  return getDirectChildPrefixes(batchSourceItem.value.docPrefix);
});

const batchLinkOptions = computed(() => {
  if (!batchDocPrefix.value) return [] as Array<{ uid: string; label: string }>;
  const allowedSourceDocs = new Set(getAncestorPrefixes(batchDocPrefix.value));
  return repo.allItems
    .filter(
      (item) =>
        item.docPrefix !== batchDocPrefix.value && allowedSourceDocs.has(item.docPrefix),
    )
    .map((item) => ({
      uid: item.uid,
      label: `${item.uid}${item.data.header ? ` - ${String(item.data.header)}` : ""}`,
    }))
    .sort((a, b) => a.uid.localeCompare(b.uid));
});

const customAttributeEntries = computed(() => {
  const standard = new Set<string>(STANDARD_FIELDS);
  return Object.entries(editorDraft.value).filter(([k]) => !standard.has(k));
});

const linksText = computed({
  get: () => formatLinks(editorDraft.value.links),
  set: (value: string) => {
    editorDraft.value.links = parseLinksText(value);
  },
});

const invalidLinkUids = computed(() => {
  const links = Array.isArray(editorDraft.value.links) ? editorDraft.value.links : [];
  const missing = new Set<string>();
  for (const entry of links) {
    if (!entry || typeof entry !== "object") continue;
    const uid = Object.keys(entry as Record<string, unknown>)[0];
    if (uid && !repo.findItem(uid)) missing.add(uid);
  }
  return [...missing].sort((a, b) => a.localeCompare(b));
});

const isDirty = computed(() => {
  if (!selectedItem.value) return false;
  return JSON.stringify(editorDraft.value) !== JSON.stringify(selectedItem.value.data);
});

const viewLabel = computed(() =>
  app.currentView === "editor" ? "Editor" : app.currentView === "batch" ? "Batch" : "Git",
);

const debugSummary = computed(() => {
  const d = scanDebug.value;
  return `visited=${d.visitedDirs} candidates=${d.candidateDirs.length} docs=${d.documentDirs.length} parseErrors=${d.parseErrors.length}`;
});

function getDirectChildPrefixes(prefix: string): string[] {
  return repo.documentTree
    .filter((d) => d.parent === prefix)
    .map((d) => d.prefix)
    .sort((a, b) => a.localeCompare(b));
}

function getAncestorPrefixes(prefix: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let current = docsByPrefix.value.get(prefix)?.parent ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    out.push(current);
    current = docsByPrefix.value.get(current)?.parent ?? null;
  }
  return out;
}

function getItemFromCursor(): DoorstopItem | null {
  const row = flatTree.value[flatTreeCursor.value];
  if (!row || row.kind !== "item") return null;
  return repo.findItem(row.uid);
}

function getPreferredBatchSourceItem(): DoorstopItem | null {
  return selectedItem.value ?? getItemFromCursor();
}

function asString(value: unknown): string {
  return value == null ? "" : String(value);
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatCustomValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseCustomValue(raw: string): unknown {
  const t = raw.trim();
  if (!t.length) return "";
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  const n = Number(t);
  if (Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(t)) return n;
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      return JSON.parse(t);
    } catch {
      return raw;
    }
  }
  return raw;
}

function formatLinks(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const obj = entry as Record<string, unknown>;
      const uid = Object.keys(obj)[0];
      if (!uid) return "";
      const stamp = obj[uid];
      return stamp == null ? uid : `${uid}:${String(stamp)}`;
    })
    .filter(Boolean)
    .join("\n");
}

function parseLinksText(raw: string): Array<Record<string, string | null>> {
  const out: Array<Record<string, string | null>> = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const [uid, ...rest] = t.split(":");
    const id = uid.trim();
    if (!id) continue;
    const stamp = rest.join(":").trim();
    out.push({ [id]: stamp.length ? stamp : null });
  }
  return out;
}

function resetEditorMessage() {
  editorMessage.value = "";
}

function safeCloneData<T>(value: T): T {
  const raw = toRaw(value);
  try {
    return structuredClone(raw);
  } catch {
    try {
      return JSON.parse(JSON.stringify(raw)) as T;
    } catch {
      return {} as T;
    }
  }
}

function syncDraftFromSelection(item = selectedItem.value) {
  editorDraft.value = item ? safeCloneData(item.data) : {};
  resetEditorMessage();
}

function createEmptyBatchRow(): BatchRow {
  return {
    id: nextBatchRowId++,
    title: "",
    text: "",
    active: true,
    derived: false,
    normative: true,
    ref: "",
    reviewed: "",
    level: 1,
    expanded: false,
  };
}

function ensureBatchInitialized() {
  const preferred = getPreferredBatchSourceItem();
  if (preferred) {
    batchLinkUid.value = preferred.uid;
    batchDocPrefix.value = getDirectChildPrefixes(preferred.docPrefix)[0] ?? "";
  } else if (!batchDocPrefix.value) {
    batchDocPrefix.value = availableDocPrefixes.value[0] ?? "";
  }
  if (!batchRows.value.length) batchRows.value = [createEmptyBatchRow()];
}

function openBatchMode() {
  app.currentView = "batch";
  batchMessage.value = "";
  ensureBatchInitialized();
}

function addBatchRow(afterIndex?: number) {
  const row = createEmptyBatchRow();
  if (afterIndex == null || afterIndex < 0 || afterIndex >= batchRows.value.length) {
    batchRows.value.push(row);
  } else {
    batchRows.value.splice(afterIndex + 1, 0, row);
  }
}

function removeBatchRow(index: number) {
  if (index < 0 || index >= batchRows.value.length) return;
  batchRows.value.splice(index, 1);
  if (!batchRows.value.length) batchRows.value = [createEmptyBatchRow()];
}

function toggleBatchRowExpanded(index: number, expanded?: boolean) {
  const row = batchRows.value[index];
  if (!row) return;
  row.expanded = typeof expanded === "boolean" ? expanded : !row.expanded;
}

function normalizeBatchRow(row: BatchRow): Record<string, unknown> {
  const links: Array<Record<string, string | null>> = [];
  if (batchLinkUid.value.trim()) links.push({ [batchLinkUid.value.trim()]: null });
  return {
    header: row.title,
    text: row.text,
    active: row.active,
    derived: row.derived,
    normative: row.normative,
    ref: row.ref,
    reviewed: row.reviewed.trim() ? row.reviewed : null,
    level: row.level,
    links,
  };
}

async function saveBatchItems() {
  if (savingBatch.value) return;
  if (!batchDocPrefix.value) {
    batchMessage.value = "Select a target document.";
    return;
  }
  const rowsToSave = batchRows.value.filter((r) => r.title.trim().length > 0);
  if (!rowsToSave.length) {
    batchMessage.value = "Add at least one item title.";
    return;
  }

  savingBatch.value = true;
  batchMessage.value = "";
  try {
    const createdUids: string[] = [];
    for (const row of rowsToSave) {
      const created = await repo.createItem(batchDocPrefix.value, normalizeBatchRow(row));
      if (created) createdUids.push(created.uid);
    }
    if (createdUids.length) {
      app.selectedUid = createdUids[0];
      app.currentView = "editor";
      editorMessage.value = `Created ${createdUids.join(", ")}.`;
      batchRows.value = [createEmptyBatchRow()];
    }
  } catch (error) {
    batchMessage.value = error instanceof Error ? error.message : "Failed to create batch items.";
  } finally {
    savingBatch.value = false;
  }
}

function setView(v: "editor" | "batch" | "git") {
  if (v === "batch") return openBatchMode();
  app.currentView = v;
}

let openingRepo = false;
async function openRepository() {
  if (openingRepo) return;
  openingRepo = true;
  try {
    const path = await open({ directory: true, multiple: false, title: "Open Doorstop repository" });
    if (!path || Array.isArray(path)) return;
    app.repoPath = path;
    await repo.load(path);
    scanDebug.value = getLastDoorstopScanDebug();
    app.selectedUid = repo.allItems[0]?.uid ?? "";
    flatTreeCursor.value = 0;
    syncDraftFromSelection();
  } finally {
    openingRepo = false;
  }
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

async function saveCurrentItem() {
  if (!selectedItem.value || savingItem.value) return;
  savingItem.value = true;
  resetEditorMessage();
  try {
    await repo.saveItem(selectedItem.value.uid, editorDraft.value);
    editorMessage.value = "Saved.";
    syncDraftFromSelection();
  } catch (error) {
    editorMessage.value = error instanceof Error ? error.message : "Failed to save item.";
  } finally {
    savingItem.value = false;
  }
}

async function createNewItemInCurrentDoc() {
  const docPrefix = selectedItem.value?.docPrefix ?? availableDocPrefixes.value[0] ?? "";
  if (!docPrefix) return;
  const created = await repo.createItem(docPrefix);
  if (!created) return;
  app.selectedUid = created.uid;
  app.currentView = "editor";
  editorMessage.value = `Created ${created.uid}.`;
}

async function duplicateCurrentItem() {
  if (!selectedItem.value) return;
  const created = await repo.duplicateItem(selectedItem.value.uid);
  if (!created) return;
  app.selectedUid = created.uid;
  app.currentView = "editor";
  editorMessage.value = `Duplicated to ${created.uid}.`;
}

async function deleteCurrentItem() {
  if (!selectedItem.value) return;
  const ok = await confirm(`Delete ${selectedItem.value.uid}?`, {
    title: "Delete item",
    kind: "warning",
    okLabel: "Delete",
    cancelLabel: "Cancel",
  });
  if (!ok) return;

  const currentUid = selectedItem.value.uid;
  const currentDoc = selectedItem.value.docPrefix;
  const done = await repo.deleteItem(currentUid);
  if (!done) return;

  app.selectedUid =
    repo.documentTree.find((d) => d.prefix === currentDoc)?.items[0]?.uid ?? repo.allItems[0]?.uid ?? "";
  editorMessage.value = `Deleted ${currentUid}.`;
}

watch(() => selectedItem.value, (item) => syncDraftFromSelection(item ?? null), { immediate: true });
watch(() => flatTree.value.length, (len) => {
  if (!len) return (flatTreeCursor.value = 0);
  if (flatTreeCursor.value >= len) flatTreeCursor.value = len - 1;
});

watch(() => batchSourceItem.value?.uid, () => {
  if (!batchSourceItem.value) return;
  const targets = getDirectChildPrefixes(batchSourceItem.value.docPrefix);
  batchDocPrefix.value = targets.includes(batchDocPrefix.value) ? batchDocPrefix.value : (targets[0] ?? "");
}, { immediate: true });

watch(() => [batchDocPrefix.value, batchLinkOptions.value.map((x) => x.uid).join("|")], () => {
  if (!batchDocPrefix.value) return (batchLinkUid.value = "");
  const allowed = new Set(batchLinkOptions.value.map((x) => x.uid));
  if (!allowed.size) return (batchLinkUid.value = "");
  if (!allowed.has(batchLinkUid.value)) {
    const preferred = getPreferredBatchSourceItem()?.uid;
    batchLinkUid.value = preferred && allowed.has(preferred) ? preferred : batchLinkOptions.value[0].uid;
  }
}, { immediate: true });

watch(() => keys["Ctrl+O"]?.value, async (p, prev) => p && !prev && (await openRepository()));
watch(() => keys["Ctrl+S"]?.value, async (p, prev) => p && !prev && app.currentView === "editor" && (await saveCurrentItem()));
watch(() => keys["Ctrl+N"]?.value, async (p, prev) => {
  if (!(p && !prev)) return;
  if (app.currentView === "batch") return addBatchRow();
  if (app.currentView === "editor") await createNewItemInCurrentDoc();
});
watch(() => keys["Ctrl+D"]?.value, async (p, prev) => p && !prev && app.currentView === "editor" && (await duplicateCurrentItem()));
watch(() => keys["Ctrl+Delete"]?.value, async (p, prev) => p && !prev && app.currentView === "editor" && (await deleteCurrentItem()));
watch(() => keys["Ctrl+G"]?.value, (p, prev) => p && !prev && (app.currentView = app.currentView === "git" ? "editor" : "git"));
watch(() => keys["Ctrl+Shift+N"]?.value, (p, prev) => p && !prev && openBatchMode());
watch(() => keys["Ctrl+Enter"]?.value, async (p, prev) => p && !prev && app.currentView === "batch" && (await saveBatchItems()));
watch(() => keys["ArrowDown"]?.value, (p, prev) => p && !prev && moveCursor(1));
watch(() => keys["ArrowUp"]?.value, (p, prev) => p && !prev && moveCursor(-1));
watch(() => keys["Enter"]?.value, (p, prev) => p && !prev && activateCursorRow());
watch(() => keys["Escape"]?.value, (p, prev) => {
  if (!(p && !prev)) return;
  app.commandPaletteOpen = false;
  app.linkFinderOpen = false;
  if (app.currentView === "batch") app.currentView = "editor";
});
watch(() => keys["/"]?.value, (p, prev) => {
  if (!(p && !prev)) return;
  (document.getElementById("tree-filter") as HTMLInputElement | null)?.focus();
});
</script>

<template>
  <div class="h-full w-full bg-bg text-text">
    <div class="h-full w-full grid grid-rows-[56px_1fr_34px] gap-px bg-slate-800">
      <header class="bg-panel px-4 flex items-center justify-between">
        <div class="flex items-center gap-4 min-w-0">
          <div class="text-sm font-bold tracking-wide">WEDGE</div>
          <div class="h-4 w-px bg-slate-700"></div>
          <div class="text-xs text-slate-400 truncate max-w-[50vw]">{{ app.repoPath || "No repository opened" }}</div>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn" @click="openRepository"><span class="kbd mr-2">Ctrl+O</span>Open</button>
          <button class="btn" :class="{ 'border-sky-500 text-sky-300': app.currentView === 'editor' }" @click="setView('editor')">Editor</button>
          <button class="btn" :class="{ 'border-sky-500 text-sky-300': app.currentView === 'batch' }" @click="setView('batch')">Batch</button>
          <button class="btn" :class="{ 'border-sky-500 text-sky-300': app.currentView === 'git' }" @click="setView('git')">Git</button>
        </div>
      </header>

      <main class="min-h-0 grid grid-cols-[320px_1fr] gap-px bg-slate-800">
        <aside class="bg-panel min-h-0 flex flex-col">
          <div class="px-3 py-2 border-b border-slate-800 flex items-center gap-2">
            <input id="tree-filter" v-model="app.treeFilter" class="input w-full h-8" placeholder="Filter tree (/)" />
            <span class="kbd">/</span>
          </div>
          <div class="px-3 py-2 border-b border-slate-800 text-[11px] text-slate-500">{{ debugSummary }}</div>
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
                :class="[idx === flatTreeCursor ? 'border-sky-500 bg-slate-800' : 'border-transparent', row.kind === 'doc' ? 'text-slate-300 font-semibold' : 'text-slate-400 pl-6']"
                @click="onTreeRowClick(idx)"
              >
                <template v-if="row.kind === 'doc'">
                  <span class="mr-2 text-slate-500">{{ (app.expandedDocs[row.key] ?? true) ? '▾' : '▸' }}</span>
                  <span @click.stop="app.toggleDoc(row.key)">{{ row.label }}</span>
                </template>
                <template v-else>
                  <span class="text-slate-300">{{ row.uid }}</span>
                  <span class="text-slate-500"> - {{ row.header || "(no header)" }}</span>
                </template>
              </div>
            </div>
          </div>
        </aside>

        <section class="bg-panel min-h-0 flex flex-col">
          <div class="px-4 py-2 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">{{ viewLabel }} View</div>
          <div class="flex-1 min-h-0 overflow-auto p-4">
            <template v-if="app.currentView === 'editor'">
              <div v-if="!selectedItem" class="text-sm text-slate-500">Select an item from the tree.</div>
              <div v-else class="space-y-3 max-w-5xl">
                <div class="flex items-center gap-2">
                  <button class="btn" :disabled="!isDirty || savingItem" @click="saveCurrentItem"><span class="kbd mr-2">Ctrl+S</span>Save</button>
                  <button class="btn" @click="createNewItemInCurrentDoc"><span class="kbd mr-2">Ctrl+N</span>New</button>
                  <button class="btn" @click="duplicateCurrentItem"><span class="kbd mr-2">Ctrl+D</span>Duplicate</button>
                  <button class="btn" @click="deleteCurrentItem"><span class="kbd mr-2">Ctrl+Delete</span>Delete</button>
                </div>
                <div v-if="editorMessage" class="text-xs text-slate-300 bg-slate-800 border border-slate-700 rounded px-2 py-1">{{ editorMessage }}</div>
                <div class="grid grid-cols-[120px_1fr] gap-2 items-center"><label class="text-sm text-slate-400">UID</label><input class="input h-9" :value="selectedItem.uid" readonly /></div>
                <div class="grid grid-cols-[120px_1fr] gap-2 items-center"><label class="text-sm text-slate-400">Header</label><input class="input h-9" :value="asString(editorDraft.header)" @input="editorDraft.header = ($event.target as HTMLInputElement).value" /></div>
                <div class="grid grid-cols-[120px_1fr] gap-2 items-center"><label class="text-sm text-slate-400">Ref</label><input class="input h-9" :value="asString(editorDraft.ref)" @input="editorDraft.ref = ($event.target as HTMLInputElement).value" /></div>
                <div class="grid grid-cols-[120px_1fr] gap-2 items-center"><label class="text-sm text-slate-400">Reviewed</label><input class="input h-9" :value="asString(editorDraft.reviewed)" @input="editorDraft.reviewed = parseCustomValue(($event.target as HTMLInputElement).value)" /></div>
                <div class="grid grid-cols-[120px_1fr] gap-2 items-center"><label class="text-sm text-slate-400">Level</label><input class="input h-9" type="number" step="0.1" :value="asNumber(editorDraft.level, 1)" @input="editorDraft.level = asNumber(($event.target as HTMLInputElement).value, 1)" /></div>
                <div class="grid grid-cols-[120px_1fr] gap-2 items-start"><label class="text-sm text-slate-400 mt-2">Text</label><textarea class="input min-h-[220px]" :value="asString(editorDraft.text)" @input="editorDraft.text = ($event.target as HTMLTextAreaElement).value" /></div>
                <div class="grid grid-cols-[120px_1fr] gap-2 items-start"><label class="text-sm text-slate-400 mt-2">Links</label><div class="space-y-1"><textarea class="input min-h-[100px]" v-model="linksText" /><div v-if="invalidLinkUids.length" class="text-xs text-amber-300">Missing targets: {{ invalidLinkUids.join(', ') }}</div></div></div>
                <div v-for="([key, value], idx) in customAttributeEntries" :key="`custom-${idx}-${key}`" class="grid grid-cols-[120px_1fr] gap-2 items-start"><label class="text-sm text-slate-400 mt-2">{{ key }}</label><textarea class="input min-h-[72px]" :value="formatCustomValue(value)" @input="editorDraft[key] = parseCustomValue(($event.target as HTMLTextAreaElement).value)" /></div>
              </div>
            </template>

            <template v-else-if="app.currentView === 'batch'">
              <div class="space-y-3 max-w-5xl">
                <div class="flex items-center gap-2">
                  <label class="text-sm text-slate-400">Document</label>
                  <select class="input h-9 min-w-[180px]" v-model="batchDocPrefix">
                    <option value="" disabled>Select document</option>
                    <option v-for="prefix in batchTargetDocOptions" :key="`batch-doc-${prefix}`" :value="prefix">{{ prefix }}</option>
                  </select>
                  <label class="text-sm text-slate-400">Link</label>
                  <select class="input h-9 min-w-[260px]" v-model="batchLinkUid">
                    <option value="">(none)</option>
                    <option v-for="option in batchLinkOptions" :key="`batch-link-${option.uid}`" :value="option.uid">{{ option.label }}</option>
                  </select>
                  <button class="btn" :disabled="savingBatch || !batchDocPrefix" @click="saveBatchItems"><span class="kbd mr-2">Ctrl+Enter</span>Save all</button>
                  <button class="btn" @click="addBatchRow()"><span class="kbd mr-2">Ctrl+N</span>Add line</button>
                </div>
                <div v-if="!batchDocPrefix" class="text-xs text-amber-300">No valid child document for the selected source item.</div>
                <div v-if="batchMessage" class="text-xs text-slate-300 bg-slate-800 border border-slate-700 rounded px-2 py-1">{{ batchMessage }}</div>
                <div class="space-y-2">
                  <div v-for="(row, idx) in batchRows" :key="`batch-row-${row.id}`" class="border border-slate-800 rounded-md p-2 bg-panel2">
                    <div class="flex items-center gap-2">
                      <input class="input h-9 flex-1" v-model="row.title" placeholder="Item title" @keydown.enter.prevent="addBatchRow(idx)" @keydown.tab.prevent="toggleBatchRowExpanded(idx, true)" @keydown.shift.tab.prevent="toggleBatchRowExpanded(idx, false)" @keydown.ctrl.backspace.prevent="removeBatchRow(idx)" />
                      <button class="btn" @click="toggleBatchRowExpanded(idx)">{{ row.expanded ? 'Collapse' : 'Expand' }}</button>
                      <button class="btn" @click="removeBatchRow(idx)">Remove</button>
                    </div>
                    <div v-if="row.expanded" class="mt-2 grid grid-cols-2 gap-2">
                      <textarea class="input min-h-[90px] col-span-2" v-model="row.text" placeholder="Text" />
                      <input class="input h-9" v-model="row.ref" placeholder="Ref" />
                      <input class="input h-9" v-model="row.reviewed" placeholder="Reviewed" />
                      <input class="input h-9" type="number" step="0.1" v-model.number="row.level" />
                      <div class="col-span-2 flex gap-4 text-sm">
                        <label class="flex items-center gap-2"><input type="checkbox" v-model="row.active" />active</label>
                        <label class="flex items-center gap-2"><input type="checkbox" v-model="row.derived" />derived</label>
                        <label class="flex items-center gap-2"><input type="checkbox" v-model="row.normative" />normative</label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <template v-else>
              <div class="text-sm text-slate-400">Git panel coming in phase 4.</div>
            </template>
          </div>
        </section>
      </main>

      <footer class="bg-panel px-4 flex items-center justify-between text-xs border-t border-slate-800">
        <div class="text-slate-300">branch: - | staged: 0 | modified: 0</div>
        <div class="text-slate-400">docs: {{ repo.docCount }} | items: {{ repo.itemCount }} | sync: -</div>
      </footer>
    </div>
  </div>
</template>
