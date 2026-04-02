<script setup lang="ts">
import { computed, ref, toRaw, watch } from "vue";
import { useMagicKeys } from "@vueuse/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../../stores/app";
import { useRepoStore } from "../../stores/repo";
import { STANDARD_FIELDS } from "../../types/doorstop";

const app = useAppStore();
const repo = useRepoStore();
const keys = useMagicKeys();

const editorDraft = ref<Record<string, unknown>>({});
const editorMessage = ref("");
const savingItem = ref(false);

const selectedItem = computed(() => repo.findItem(app.selectedUid));

const customAttributeEntries = computed(() => {
  const standard = new Set<string>(STANDARD_FIELDS);
  return Object.entries(editorDraft.value).filter(([k]) => !standard.has(k));
});

function linkUidFromEntry(entry: unknown): string {
  if (!entry || typeof entry !== "object") return "";
  const key = Object.keys(entry as Record<string, unknown>)[0] ?? "";
  return key.split(":")[0].trim();
}

function linkStampFromEntry(entry: unknown): string | null {
  if (!entry || typeof entry !== "object") return null;
  const key = Object.keys(entry as Record<string, unknown>)[0] ?? "";
  const value = (entry as Record<string, unknown>)[key];
  return value == null ? null : String(value);
}

const linkOptions = computed(() => {
  const selfUid = selectedItem.value?.uid ?? "";
  return repo.allItems
    .filter((item) => item.uid !== selfUid)
    .map((item) => ({
      uid: item.uid,
      name: String(item.data.header ?? "").trim() || item.uid,
      label: `${item.uid} - ${String(item.data.header ?? "").trim() || item.uid}`,
    }))
    .sort((a, b) => a.uid.localeCompare(b.uid));
});

const linkQuery = ref("");
const linkMenuOpen = ref(false);

const selectedLinkUids = computed<string[]>({
  get: () => {
    const links = Array.isArray(editorDraft.value.links) ? editorDraft.value.links : [];
    const seen = new Set<string>();
    for (const entry of links) {
      const uid = linkUidFromEntry(entry);
      if (uid) seen.add(uid);
    }
    return [...seen];
  },
  set: (uids) => {
    const links = Array.isArray(editorDraft.value.links) ? editorDraft.value.links : [];
    const previousStampByUid = new Map<string, string | null>();
    for (const entry of links) {
      const uid = linkUidFromEntry(entry);
      if (!uid) continue;
      previousStampByUid.set(uid, linkStampFromEntry(entry));
    }

    editorDraft.value.links = uids.map((uid) => ({
      [uid]: previousStampByUid.get(uid) ?? null,
    }));
  },
});

const filteredLinkOptions = computed(() => {
  const q = linkQuery.value.trim().toLowerCase();
  const selected = new Set(selectedLinkUids.value);
  const base = linkOptions.value.filter((o) => !selected.has(o.uid));
  if (!q) return [] as typeof base;
  return base
    .filter((o) => o.label.toLowerCase().includes(q))
    .slice(0, 12);
});

const selectedLinkPills = computed(() => {
  const byUid = new Map(linkOptions.value.map((o) => [o.uid, o.name]));
  return selectedLinkUids.value.map((uid) => ({
    uid,
    name: byUid.get(uid) ?? uid,
  }));
});

const invalidLinkUids = computed(() => {
  const missing = new Set<string>();
  for (const uid of selectedLinkUids.value) {
    if (!repo.findItem(uid)) missing.add(uid);
  }
  return [...missing].sort((a, b) => a.localeCompare(b));
});

const isDirty = computed(() => {
  if (!selectedItem.value) return false;
  return JSON.stringify(editorDraft.value) !== JSON.stringify(selectedItem.value.data);
});

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

function addSelectedLink(uid: string) {
  if (!uid) return;
  if (selectedLinkUids.value.includes(uid)) return;
  selectedLinkUids.value = [...selectedLinkUids.value, uid];
  linkQuery.value = "";
  linkMenuOpen.value = false;
}

function removeSelectedLink(uid: string) {
  selectedLinkUids.value = selectedLinkUids.value.filter((x) => x !== uid);
}

function pickFirstFilteredLink() {
  const first = filteredLinkOptions.value[0];
  if (first) addSelectedLink(first.uid);
}

function closeLinkMenuSoon() {
  window.setTimeout(() => {
    linkMenuOpen.value = false;
  }, 120);
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

function isDeleteShortcutPressed(): boolean {
  return Boolean(
    keys["Ctrl+Delete"]?.value ||
      keys["Control+Delete"]?.value ||
      keys["Ctrl+Backspace"]?.value ||
      keys["Control+Backspace"]?.value ||
      keys["Meta+Backspace"]?.value,
  );
}

watch(
  () => selectedItem.value,
  (item) => syncDraftFromSelection(item ?? null),
  { immediate: true },
);

watch(() => keys["Ctrl+S"]?.value, async (p, prev) => p && !prev && app.currentView === "editor" && (await saveCurrentItem()));
watch(isDeleteShortcutPressed, async (p, prev) => {
  if (!(p && !prev)) return;
  if (app.currentView !== "editor") return;
  await deleteCurrentItem();
});
</script>

<template>
  <div v-if="!selectedItem" class="text-sm text-slate-500">Select an item from the tree.</div>
  <div v-else class="space-y-3 w-full">
    <div class="flex items-center gap-2">
      <button class="btn" :disabled="!isDirty || savingItem" @click="saveCurrentItem"><span class="kbd mr-2">Ctrl+S</span>Save</button>
      <button class="btn" @click="deleteCurrentItem"><span class="kbd mr-2">Ctrl+Delete</span>Delete</button>
    </div>
    <div v-if="editorMessage" class="text-xs text-slate-300 bg-slate-800 border border-slate-700 rounded px-2 py-1">{{ editorMessage }}</div>

    <div class="grid grid-cols-[120px_1fr] gap-2 items-center"><label class="text-sm text-slate-400">UID</label><input class="input h-9" :value="selectedItem.uid" readonly /></div>
    <div class="grid grid-cols-[120px_1fr] gap-2 items-center"><label class="text-sm text-slate-400">Header</label><input class="input h-9" :value="asString(editorDraft.header)" @input="editorDraft.header = ($event.target as HTMLInputElement).value" /></div>
    <div class="grid grid-cols-[120px_1fr] gap-2 items-start"><label class="text-sm text-slate-400 mt-2">Text</label><textarea class="input min-h-[460px] h-[55vh]" :value="asString(editorDraft.text)" @input="editorDraft.text = ($event.target as HTMLTextAreaElement).value" /></div>
    <div class="grid grid-cols-[120px_1fr] gap-2 items-center"><label class="text-sm text-slate-400">Level</label><input class="input h-9" type="number" step="0.1" :value="asNumber(editorDraft.level, 1)" @input="editorDraft.level = asNumber(($event.target as HTMLInputElement).value, 1)" /></div>

    <details class="border border-slate-800 rounded-md p-2 bg-panel2">
      <summary class="cursor-pointer text-sm text-slate-300 select-none">More fields</summary>
      <div class="mt-3 space-y-3">
        <div class="grid grid-cols-[120px_1fr] gap-2 items-center"><label class="text-sm text-slate-400">Ref</label><input class="input h-9" :value="asString(editorDraft.ref)" @input="editorDraft.ref = ($event.target as HTMLInputElement).value" /></div>

        <div class="grid grid-cols-[120px_1fr] gap-2 items-start">
          <label class="text-sm text-slate-400 mt-2">Links</label>
          <div class="space-y-2">
            <div class="relative">
              <input
                class="input h-9 w-full"
                v-model="linkQuery"
                placeholder="Type to filter links (UID or header)"
                @focus="linkMenuOpen = true"
                @blur="closeLinkMenuSoon"
                @keydown.enter.prevent="pickFirstFilteredLink"
              />

              <div
                v-if="linkMenuOpen && filteredLinkOptions.length"
                class="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-md border border-slate-700 bg-panel2"
              >
                <button
                  v-for="option in filteredLinkOptions"
                  :key="`link-opt-${option.uid}`"
                  type="button"
                  class="w-full text-left px-2 py-1 text-sm hover:bg-slate-800"
                  @mousedown.prevent="addSelectedLink(option.uid)"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <span
                v-for="pill in selectedLinkPills"
                :key="`link-pill-${pill.uid}`"
                class="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-700 bg-slate-800 text-xs text-slate-200"
              >
                {{ pill.uid }} - {{ pill.name }}
                <button
                  type="button"
                  class="text-slate-400 hover:text-slate-200"
                  @click="removeSelectedLink(pill.uid)"
                >
                  x
                </button>
              </span>
            </div>

            <div v-if="invalidLinkUids.length" class="text-xs text-amber-300">
              Missing targets: {{ invalidLinkUids.join(', ') }}
            </div>
          </div>
        </div>

        <hr />

        <div v-for="([key, value], idx) in customAttributeEntries" :key="`custom-${idx}-${key}`" class="grid grid-cols-[120px_1fr] gap-2 items-start"><label class="text-sm text-slate-400 mt-2 capitalize">{{ key }}</label><input class="input" :value="formatCustomValue(value)" @input="editorDraft[key] = parseCustomValue(($event.target as HTMLInputElement).value)" /></div>
      </div>
    </details>
  </div>
</template>

