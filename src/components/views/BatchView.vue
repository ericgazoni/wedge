<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useMagicKeys } from "@vueuse/core";
import { useAppStore } from "../../stores/app";
import { useRepoStore } from "../../stores/repo";

type BatchRow = {
  id: number;
  title: string;
  text: string;
  active: boolean;
  derived: boolean;
  normative: boolean;
  ref: string;
  level: number;
  expanded: boolean;
};

const app = useAppStore();
const repo = useRepoStore();
const keys = useMagicKeys();

const batchDocPrefix = ref("");
const batchLinkUid = ref("");
const batchRows = ref<BatchRow[]>([]);
const batchMessage = ref("");
const savingBatch = ref(false);
let nextBatchRowId = 1;
const batchTitleInputs = new Map<number, HTMLInputElement>();

function setBatchTitleInputRef(id: number, el: HTMLInputElement | null) {
  if (el) batchTitleInputs.set(id, el);
  else batchTitleInputs.delete(id);
}

function focusBatchTitleInput(id: number) {
  void nextTick(() => batchTitleInputs.get(id)?.focus());
}

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

const batchSourceItem = computed(() => selectedItem.value);
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

function getDocumentMaxLevel(prefix: string): number {
  const doc = repo.documentTree.find((d) => d.prefix === prefix);
  if (!doc) return 0;

  let max = 0;
  for (const item of doc.items) {
    const n = Number(item.data.level);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max;
}

function getBatchMaxLevel(): number {
  let max = 0;
  for (const row of batchRows.value) {
    if (Number.isFinite(row.level)) max = Math.max(max, row.level);
  }
  return max;
}

function computeNextBatchLevel(): number {
  const docMax = batchDocPrefix.value ? getDocumentMaxLevel(batchDocPrefix.value) : 0;
  const base = Math.max(docMax, getBatchMaxLevel());
  return Math.round((base + 0.1) * 10) / 10;
}

function createEmptyBatchRow(level = computeNextBatchLevel()): BatchRow {
  return {
    id: nextBatchRowId++,
    title: "",
    text: "",
    active: true,
    derived: false,
    normative: true,
    ref: "",
    level,
    expanded: false,
  };
}

function ensureBatchInitialized() {
  if (selectedItem.value) {
    batchLinkUid.value = selectedItem.value.uid;
    batchDocPrefix.value = getDirectChildPrefixes(selectedItem.value.docPrefix)[0] ?? "";
  } else if (!batchDocPrefix.value) {
    batchDocPrefix.value = availableDocPrefixes.value[0] ?? "";
  }
  if (!batchRows.value.length) batchRows.value = [createEmptyBatchRow()];
}

function addBatchRow(afterIndex?: number) {
  const row = createEmptyBatchRow();
  if (afterIndex == null || afterIndex < 0 || afterIndex >= batchRows.value.length) {
    batchRows.value.push(row);
  } else {
    batchRows.value.splice(afterIndex + 1, 0, row);
  }
  focusBatchTitleInput(row.id);
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

function onBatchTitleKeydown(event: KeyboardEvent, index: number) {
  if (event.key === "Tab") {
    event.preventDefault();
    toggleBatchRowExpanded(index, !event.shiftKey);
    return;
  }
  if (event.key === "Backspace" && event.ctrlKey) {
    event.preventDefault();
    removeBatchRow(index);
  }
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
      batchRows.value = [createEmptyBatchRow()];
    }
  } catch (error) {
    batchMessage.value = error instanceof Error ? error.message : "Failed to create batch items.";
  } finally {
    savingBatch.value = false;
  }
}

watch(
  () => app.currentView,
  (view) => {
    if (view === "batch") {
      batchMessage.value = "";
      ensureBatchInitialized();
    }
  },
  { immediate: true },
);

watch(() => batchSourceItem.value?.uid, () => {
  const source = batchSourceItem.value;
  if (!source) return;
  const targets = getDirectChildPrefixes(source.docPrefix);
  batchDocPrefix.value = targets.includes(batchDocPrefix.value) ? batchDocPrefix.value : (targets[0] ?? "");
  // Keep the selected tree item as the active batch source when switching items in-place.
  batchLinkUid.value = source.uid;
}, { immediate: true });

watch(() => batchDocPrefix.value, () => {
  if (
    batchRows.value.length === 1 &&
    !batchRows.value[0].title.trim() &&
    !batchRows.value[0].text.trim()
  ) {
    batchRows.value[0].level = computeNextBatchLevel();
  }
});

watch(() => [batchDocPrefix.value, batchLinkOptions.value.map((x) => x.uid).join("|")], () => {
  if (!batchDocPrefix.value) {
    batchLinkUid.value = "";
    return;
  }
  const allowed = new Set(batchLinkOptions.value.map((x) => x.uid));
  if (!allowed.size) {
    batchLinkUid.value = "";
    return;
  }
  if (!allowed.has(batchLinkUid.value)) {
    const preferred = selectedItem.value?.uid;
    batchLinkUid.value = preferred && allowed.has(preferred) ? preferred : batchLinkOptions.value[0].uid;
  }
}, { immediate: true });

watch(() => keys["Ctrl+Shift+N"]?.value, (p, prev) => {
  if (p && !prev) app.currentView = "batch";
});
watch(() => keys["Ctrl+S"]?.value, async (p, prev) => p && !prev && app.currentView === "batch" && (await saveBatchItems()));
watch(
  () => keys["Ctrl+Enter"]?.value,
  (p, prev) => p && !prev && app.currentView === "batch" && addBatchRow(),
);
</script>

<template>
  <div class="space-y-3 w-full">
    <div class="flex items-center gap-2 flex-wrap w-fit max-w-full">
      <label class="text-sm text-slate-400">Document</label>
      <select class="input h-9 min-w-[10rem] max-w-[16rem]" v-model="batchDocPrefix">
        <option value="" disabled>Select document</option>
        <option v-for="prefix in batchTargetDocOptions" :key="`batch-doc-${prefix}`" :value="prefix">{{ prefix }}</option>
      </select>
      <label class="text-sm text-slate-400">Link</label>
      <select class="input h-9 min-w-[12rem] max-w-[24rem]" v-model="batchLinkUid">
        <option value="">(none)</option>
        <option v-for="option in batchLinkOptions" :key="`batch-link-${option.uid}`" :value="option.uid">{{ option.label }}</option>
      </select>
    </div>
    <div class="flex items-center gap-2">
      <button class="btn" :disabled="savingBatch || !batchDocPrefix" @click="saveBatchItems"><span class="kbd mr-2">Ctrl+S</span>Save all</button>
      <button class="btn" @click="addBatchRow()"><span class="kbd mr-2">Ctrl+Enter</span>Add line</button>
    </div>
    <div v-if="!batchDocPrefix" class="text-xs text-amber-300">No valid child document for the selected source item.</div>
    <div v-if="batchMessage" class="text-xs text-slate-300 bg-slate-800 border border-slate-700 rounded px-2 py-1">{{ batchMessage }}</div>
    <div class="space-y-2">
      <div v-for="(row, idx) in batchRows" :key="`batch-row-${row.id}`" class="border border-slate-800 rounded-md p-2 bg-panel2">
        <div class="flex items-center gap-2 flex-wrap">
          <input
            :ref="(el) => setBatchTitleInputRef(row.id, el as HTMLInputElement | null)"
            class="input h-9 flex-1 min-w-[12rem]"
            v-model="row.title"
            placeholder="Item title"
            @keydown="onBatchTitleKeydown($event, idx)"
          />
          <button
            class="btn px-3"
            :aria-label="row.expanded ? 'Collapse row' : 'Expand row'"
            :title="row.expanded ? 'Collapse row' : 'Expand row'"
            @click="toggleBatchRowExpanded(idx)"
          >
            <svg
              v-if="row.expanded"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              class="h-4 w-4"
              aria-hidden="true"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="m18 15-6-6-6 6" />
            </svg>
            <svg
              v-else
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              class="h-4 w-4"
              aria-hidden="true"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <button
            class="btn px-3"
            aria-label="Remove row"
            title="Remove row"
            @click="removeBatchRow(idx)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              class="h-4 w-4"
              aria-hidden="true"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9 14.394 18m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673A2.25 2.25 0 0 1 15.916 21.75H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
          </button>
        </div>
        <div v-if="row.expanded" class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <textarea class="input min-h-[90px] sm:col-span-2" v-model="row.text" placeholder="Text" />
          <input class="input h-9" v-model="row.ref" placeholder="Ref" />
          <input class="input h-9" type="number" step="0.1" v-model.number="row.level" />
          <div class="sm:col-span-2 flex gap-4 text-sm flex-wrap">
            <label class="flex items-center gap-2"><input type="checkbox" v-model="row.active" />active</label>
            <label class="flex items-center gap-2"><input type="checkbox" v-model="row.derived" />derived</label>
            <label class="flex items-center gap-2"><input type="checkbox" v-model="row.normative" />normative</label>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

