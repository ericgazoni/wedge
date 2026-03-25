<script setup lang="ts">
import { computed, ref, toRaw, watch } from "vue";
import { useMagicKeys } from "@vueuse/core";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "./stores/app";
import { useRepoStore } from "./stores/repo";
import { getLastDoorstopScanDebug } from "./services/doorstop";
import { STANDARD_FIELDS } from "./types/doorstop";

const app = useAppStore();
const repo = useRepoStore();

const keys = useMagicKeys();
const flatTreeCursor = ref(0);

const scanDebug = ref(getLastDoorstopScanDebug());
const editorDraft = ref<Record<string, unknown>>({});
const editorMessage = ref("");
const savingItem = ref(false);

const flatTree = computed(() => {
    const q = app.treeFilter.trim().toLowerCase();
    const rows: Array<
        | { kind: "doc"; key: string; label: string }
        | { kind: "item"; uid: string; header: string; docKey: string }
    > = [];

    for (const d of repo.documentTree) {
        rows.push({
            kind: "doc",
            key: d.prefix,
            label: `${d.prefix} (${d.count})`,
        });

        const expanded = app.expandedDocs[d.prefix] ?? true;
        if (!expanded) continue;

        for (const it of d.items) {
            const header = String(it.data.header ?? "");
            const hay = `${it.uid} ${header}`.toLowerCase();
            if (!q || hay.includes(q)) {
                rows.push({
                    kind: "item",
                    uid: it.uid,
                    header,
                    docKey: d.prefix,
                });
            }
        }
    }

    return rows;
});

const selectedItem = computed(() => repo.findItem(app.selectedUid));

const availableDocPrefixes = computed(() =>
    repo.documentTree.map((d) => d.prefix).sort((a, b) => a.localeCompare(b)),
);

const customAttributeEntries = computed(() => {
    const standard = new Set<string>(STANDARD_FIELDS);
    return Object.entries(editorDraft.value).filter(([key]) => !standard.has(key));
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
        if (!uid) continue;
        if (!repo.findItem(uid)) missing.add(uid);
    }

    return Array.from(missing).sort((a, b) => a.localeCompare(b));
});

const isDirty = computed(() => {
    if (!selectedItem.value) return false;
    return JSON.stringify(editorDraft.value) !== JSON.stringify(selectedItem.value.data);
});

const viewLabel = computed(() => {
    if (app.currentView === "editor") return "Editor";
    if (app.currentView === "batch") return "Batch";
    return "Git";
});

const debugSummary = computed(() => {
    const d = scanDebug.value;
    return `visited=${d.visitedDirs} candidates=${d.candidateDirs.length} docs=${d.documentDirs.length} parseErrors=${d.parseErrors.length}`;
});

function asString(value: unknown): string {
    return value == null ? "" : String(value);
}

function asNumber(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
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
    const trimmed = raw.trim();
    if (!trimmed.length) return "";

    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (trimmed === "null") return null;

    const n = Number(trimmed);
    if (trimmed.length && Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
        return n;
    }

    if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
        try {
            return JSON.parse(trimmed);
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
        const trimmed = line.trim();
        if (!trimmed) continue;

        const [uid, ...stampParts] = trimmed.split(":");
        const id = uid.trim();
        if (!id) continue;

        const stamp = stampParts.join(":").trim();
        out.push({ [id]: stamp.length ? stamp : null });
    }

    return out;
}

function setView(v: "editor" | "batch" | "git") {
    app.currentView = v;
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

let openingRepo = false;
async function openRepository() {
    if (openingRepo) return;
    openingRepo = true;

    try {
        const path = await open({
            directory: true,
            multiple: false,
            title: "Open Doorstop repository",
        });

        if (!path || Array.isArray(path)) return;

        app.repoPath = path;
        await repo.load(path);

        scanDebug.value = getLastDoorstopScanDebug();

        const firstUid = repo.allItems[0]?.uid;
        app.selectedUid = firstUid ?? "";
        flatTreeCursor.value = 0;
        syncDraftFromSelection();
    } finally {
        openingRepo = false;
    }
}

function moveCursor(delta: number) {
    if (!flatTree.value.length) return;
    flatTreeCursor.value = Math.max(
        0,
        Math.min(flatTree.value.length - 1, flatTreeCursor.value + delta),
    );
}

function activateCursorRow() {
    const row = flatTree.value[flatTreeCursor.value];
    if (!row) return;

    if (row.kind === "doc") {
        app.toggleDoc(row.key);
        return;
    }

    app.selectedUid = row.uid;
    app.currentView = "editor";
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
      console.error(error);
        editorMessage.value =
            error instanceof Error ? error.message : "Failed to save item.";
    } finally {
        savingItem.value = false;
    }
}

async function createNewItemInCurrentDoc() {
    const docPrefix =
        selectedItem.value?.docPrefix ?? availableDocPrefixes.value[0] ?? "";
    if (!docPrefix) return;

    resetEditorMessage();

    try {
        const created = await repo.createItem(docPrefix);
        if (!created) return;

        app.selectedUid = created.uid;
        app.currentView = "editor";
        editorMessage.value = `Created ${created.uid}.`;
    } catch (error) {
        editorMessage.value =
            error instanceof Error ? error.message : "Failed to create item.";
    }
}

async function duplicateCurrentItem() {
    if (!selectedItem.value) return;

    resetEditorMessage();

    try {
        const created = await repo.duplicateItem(selectedItem.value.uid);
        if (!created) return;

        app.selectedUid = created.uid;
        app.currentView = "editor";
        editorMessage.value = `Duplicated to ${created.uid}.`;
    } catch (error) {
        editorMessage.value =
            error instanceof Error ? error.message : "Failed to duplicate item.";
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
    resetEditorMessage();

    try {
        const done = await repo.deleteItem(currentUid);
        if (!done) return;

        const sameDocFirst =
            repo.documentTree.find((d) => d.prefix === currentDoc)?.items[0]?.uid ??
            repo.allItems[0]?.uid ??
            "";

        app.selectedUid = sameDocFirst;
        editorMessage.value = `Deleted ${currentUid}.`;
    } catch (error) {
        editorMessage.value =
            error instanceof Error ? error.message : "Failed to delete item.";
    }
}

watch(
    () => selectedItem.value,
    (item) => {
        syncDraftFromSelection(item ?? null);
    },
    { immediate: true },
);

watch(
    () => flatTree.value.length,
    (len) => {
        if (!len) {
            flatTreeCursor.value = 0;
            return;
        }
        if (flatTreeCursor.value >= len) {
            flatTreeCursor.value = len - 1;
        }
    },
);

watch(
    () => keys["Ctrl+O"]?.value,
    async (pressed, prev) => {
        if (pressed && !prev) {
            await openRepository();
        }
    },
);

watch(
    () => keys["Ctrl+S"]?.value,
    async (pressed, prev) => {
        if (pressed && !prev && app.currentView === "editor") {
            await saveCurrentItem();
        }
    },
);

watch(
    () => keys["Ctrl+N"]?.value,
    async (pressed, prev) => {
        if (pressed && !prev && app.currentView === "editor") {
            await createNewItemInCurrentDoc();
        }
    },
);

watch(
    () => keys["Ctrl+D"]?.value,
    async (pressed, prev) => {
        if (pressed && !prev && app.currentView === "editor") {
            await duplicateCurrentItem();
        }
    },
);

watch(
    () => keys["Ctrl+Delete"]?.value,
    async (pressed, prev) => {
        if (pressed && !prev && app.currentView === "editor") {
            await deleteCurrentItem();
        }
    },
);

watch(
    () => keys["Ctrl+G"]?.value,
    (pressed, prev) => {
        if (pressed && !prev) {
            app.currentView = app.currentView === "git" ? "editor" : "git";
        }
    },
);

watch(
    () => keys["Ctrl+Shift+N"]?.value,
    (pressed, prev) => {
        if (pressed && !prev) {
            app.currentView = "batch";
        }
    },
);

watch(
    () => keys["ArrowDown"]?.value,
    (pressed, prev) => {
        if (pressed && !prev) moveCursor(1);
    },
);

watch(
    () => keys["ArrowUp"]?.value,
    (pressed, prev) => {
        if (pressed && !prev) moveCursor(-1);
    },
);

watch(
    () => keys["Enter"]?.value,
    (pressed, prev) => {
        if (pressed && !prev) activateCursorRow();
    },
);

watch(
    () => keys["Escape"]?.value,
    (pressed, prev) => {
        if (!(pressed && !prev)) return;
        app.commandPaletteOpen = false;
        app.linkFinderOpen = false;
        if (app.currentView === "batch") app.currentView = "editor";
    },
);

watch(
    () => keys["/"]?.value,
    (pressed, prev) => {
        if (!(pressed && !prev)) return;
        const el = document.getElementById(
            "tree-filter",
        ) as HTMLInputElement | null;
        el?.focus();
    },
);
</script>

<template>
    <div class="h-full w-full bg-bg text-text">
        <div
            class="h-full w-full grid grid-rows-[56px_1fr_34px] gap-px bg-slate-800"
        >
            <header class="bg-panel px-4 flex items-center justify-between">
                <div class="flex items-center gap-4 min-w-0">
                    <div class="text-sm font-bold tracking-wide">WEDGE</div>
                    <div class="h-4 w-px bg-slate-700"></div>
                    <div class="text-xs text-slate-400 truncate max-w-[50vw]">
                        {{ app.repoPath || "No repository opened" }}
                    </div>
                </div>

                <div class="flex items-center gap-2">
                    <button class="btn" @click="openRepository">
                        <span class="kbd mr-2">Ctrl+O</span>Open
                    </button>
                    <button
                        class="btn"
                        :class="{
                            'border-sky-500 text-sky-300':
                                app.currentView === 'editor',
                        }"
                        @click="setView('editor')"
                    >
                        Editor
                    </button>
                    <button
                        class="btn"
                        :class="{
                            'border-sky-500 text-sky-300':
                                app.currentView === 'batch',
                        }"
                        @click="setView('batch')"
                    >
                        Batch
                    </button>
                    <button
                        class="btn"
                        :class="{
                            'border-sky-500 text-sky-300':
                                app.currentView === 'git',
                        }"
                        @click="setView('git')"
                    >
                        Git
                    </button>
                </div>
            </header>

            <main
                class="min-h-0 grid grid-cols-[320px_1fr] gap-px bg-slate-800"
            >
                <aside class="bg-panel min-h-0 flex flex-col">
                    <div
                        class="px-3 py-2 border-b border-slate-800 flex items-center gap-2"
                    >
                        <input
                            id="tree-filter"
                            v-model="app.treeFilter"
                            class="input w-full h-8"
                            placeholder="Filter tree (/)"
                        />
                        <span class="kbd">/</span>
                    </div>

                    <div
                        class="px-3 py-2 border-b border-slate-800 text-[11px] text-slate-500"
                    >
                        {{ debugSummary }}
                    </div>

                    <div class="flex-1 min-h-0 overflow-auto p-2">
                        <div
                            v-if="repo.loading"
                            class="text-xs text-slate-400 p-2"
                        >
                            Scanning repository...
                        </div>
                        <div
                            v-else-if="repo.error"
                            class="text-xs text-red-400 p-2"
                        >
                            {{ repo.error }}
                        </div>
                        <div
                            v-else-if="!repo.repo"
                            class="text-xs text-slate-500 p-2"
                        >
                            Open a repository to load documents.
                        </div>
                        <div
                            v-else-if="flatTree.length === 0"
                            class="text-xs text-slate-500 p-2"
                        >
                            Repository loaded but no doorstop document/items
                            were detected.
                        </div>
                        <div v-else class="space-y-1 text-sm">
                            <div
                                v-for="(row, idx) in flatTree"
                                :key="
                                    row.kind === 'doc'
                                        ? `doc-${row.key}`
                                        : `item-${row.uid}`
                                "
                                class="px-2 py-1 rounded cursor-default border"
                                :class="[
                                    idx === flatTreeCursor
                                        ? 'border-sky-500 bg-slate-800'
                                        : 'border-transparent',
                                    row.kind === 'doc'
                                        ? 'text-slate-300 font-semibold'
                                        : 'text-slate-400 pl-6',
                                ]"
                                @click="flatTreeCursor = idx"
                                @dblclick="activateCursorRow"
                            >
                                <template v-if="row.kind === 'doc'">
                                    <span class="mr-2 text-slate-500">
                                        {{
                                            (app.expandedDocs[row.key] ?? true)
                                                ? "▾"
                                                : "▸"
                                        }}
                                    </span>
                                    <span
                                        @click.stop="app.toggleDoc(row.key)"
                                        >{{ row.label }}</span
                                    >
                                </template>
                                <template v-else>
                                    <span class="text-slate-300">{{
                                        row.uid
                                    }}</span>
                                    <span class="text-slate-500">
                                        —
                                        {{ row.header || "(no header)" }}</span
                                    >
                                </template>
                            </div>
                        </div>
                    </div>
                </aside>

                <section class="bg-panel min-h-0 flex flex-col">
                    <div
                        class="px-4 py-2 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500"
                    >
                        {{ viewLabel }} View
                    </div>

                    <div class="flex-1 min-h-0 overflow-auto p-4">
                        <template v-if="app.currentView === 'editor'">
                            <div
                                v-if="!selectedItem"
                                class="text-sm text-slate-500"
                            >
                                Select an item from the tree.
                            </div>
                            <div v-else class="space-y-3 max-w-5xl">
                                <div class="flex items-center gap-2">
                                    <button
                                        class="btn"
                                        :disabled="!isDirty || savingItem"
                                        @click="saveCurrentItem"
                                    >
                                        <span class="kbd mr-2">Ctrl+S</span>Save
                                    </button>
                                    <button class="btn" @click="createNewItemInCurrentDoc">
                                        <span class="kbd mr-2">Ctrl+N</span>New
                                    </button>
                                    <button class="btn" @click="duplicateCurrentItem">
                                        <span class="kbd mr-2">Ctrl+D</span>Duplicate
                                    </button>
                                    <button class="btn" @click="deleteCurrentItem">
                                        <span class="kbd mr-2">Ctrl+Delete</span>Delete
                                    </button>
                                    <span
                                        class="text-xs"
                                        :class="isDirty ? 'text-amber-300' : 'text-slate-500'"
                                    >
                                        {{ isDirty ? 'Unsaved changes' : 'Saved' }}
                                    </span>
                                </div>

                                <div
                                    v-if="editorMessage"
                                    class="text-xs text-slate-300 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                                >
                                    {{ editorMessage }}
                                </div>

                                <div class="grid grid-cols-[120px_1fr] gap-2 items-center">
                                    <label class="text-sm text-slate-400">UID</label>
                                    <input class="input h-9" :value="selectedItem.uid" readonly />
                                </div>

                                <div class="grid grid-cols-[120px_1fr] gap-2 items-center">
                                    <label class="text-sm text-slate-400">Header</label>
                                    <input
                                        class="input h-9"
                                        :value="asString(editorDraft.header)"
                                        @input="
                                            editorDraft.header = (
                                                $event.target as HTMLInputElement
                                            ).value
                                        "
                                    />
                                </div>

                                <div class="grid grid-cols-[120px_1fr] gap-2 items-center">
                                    <label class="text-sm text-slate-400">Ref</label>
                                    <input
                                        class="input h-9"
                                        :value="asString(editorDraft.ref)"
                                        @input="
                                            editorDraft.ref = (
                                                $event.target as HTMLInputElement
                                            ).value
                                        "
                                    />
                                </div>

                                <div class="grid grid-cols-[120px_1fr] gap-2 items-center">
                                    <label class="text-sm text-slate-400">Reviewed</label>
                                    <input
                                        class="input h-9"
                                        :value="asString(editorDraft.reviewed)"
                                        @input="
                                            editorDraft.reviewed = parseCustomValue(
                                                (
                                                    $event.target as HTMLInputElement
                                                ).value,
                                            )
                                        "
                                    />
                                </div>

                                <div class="grid grid-cols-[120px_1fr] gap-2 items-center">
                                    <label class="text-sm text-slate-400">Level</label>
                                    <input
                                        class="input h-9"
                                        type="number"
                                        step="0.1"
                                        :value="asNumber(editorDraft.level, 1)"
                                        @input="
                                            editorDraft.level = asNumber(
                                                (
                                                    $event.target as HTMLInputElement
                                                ).value,
                                                1,
                                            )
                                        "
                                    />
                                </div>

                                <div class="grid grid-cols-[120px_1fr] gap-2 items-center">
                                    <label class="text-sm text-slate-400">Flags</label>
                                    <div class="flex flex-wrap gap-3 text-sm">
                                        <label class="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                :checked="Boolean(editorDraft.active)"
                                                @change="
                                                    editorDraft.active = (
                                                        $event.target as HTMLInputElement
                                                    ).checked
                                                "
                                            />
                                            active
                                        </label>
                                        <label class="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                :checked="Boolean(editorDraft.derived)"
                                                @change="
                                                    editorDraft.derived = (
                                                        $event.target as HTMLInputElement
                                                    ).checked
                                                "
                                            />
                                            derived
                                        </label>
                                        <label class="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                :checked="Boolean(editorDraft.normative)"
                                                @change="
                                                    editorDraft.normative = (
                                                        $event.target as HTMLInputElement
                                                    ).checked
                                                "
                                            />
                                            normative
                                        </label>
                                    </div>
                                </div>

                                <div class="grid grid-cols-[120px_1fr] gap-2 items-start">
                                    <label class="text-sm text-slate-400 mt-2">Text</label>
                                    <textarea
                                        class="input min-h-[220px]"
                                        :value="asString(editorDraft.text)"
                                        @input="
                                            editorDraft.text = (
                                                $event.target as HTMLTextAreaElement
                                            ).value
                                        "
                                    />
                                </div>

                                <div class="grid grid-cols-[120px_1fr] gap-2 items-start">
                                    <label class="text-sm text-slate-400 mt-2">Links</label>
                                    <div class="space-y-1">
                                        <textarea
                                            class="input min-h-[100px]"
                                            placeholder="One link per line. Use UID or UID:STAMP"
                                            v-model="linksText"
                                        />
                                        <div
                                            v-if="invalidLinkUids.length"
                                            class="text-xs text-amber-300"
                                        >
                                            Missing targets: {{ invalidLinkUids.join(', ') }}
                                        </div>
                                    </div>
                                </div>

                                <div
                                    v-for="([key, value], idx) in customAttributeEntries"
                                    :key="`custom-${idx}-${key}`"
                                    class="grid grid-cols-[120px_1fr] gap-2 items-start"
                                >
                                    <label class="text-sm text-slate-400 mt-2">{{ key }}</label>
                                    <textarea
                                        class="input min-h-[72px]"
                                        :value="formatCustomValue(value)"
                                        @input="
                                            editorDraft[key] = parseCustomValue(
                                                (
                                                    $event.target as HTMLTextAreaElement
                                                ).value,
                                            )
                                        "
                                    />
                                </div>
                            </div>
                        </template>

                        <template v-else-if="app.currentView === 'batch'">
                            <div class="text-sm text-slate-400">
                                Batch mode UI coming in phase 3.
                            </div>
                        </template>

                        <template v-else>
                            <div class="text-sm text-slate-400">
                                Git panel coming in phase 4.
                            </div>
                        </template>
                    </div>
                </section>
            </main>

            <footer
                class="bg-panel px-4 flex items-center justify-between text-xs border-t border-slate-800"
            >
                <div class="text-slate-300">
                    branch: - | staged: 0 | modified: 0
                </div>
                <div class="text-slate-400">
                    docs: {{ repo.docCount }} | items: {{ repo.itemCount }} |
                    sync: -
                </div>
            </footer>
        </div>
    </div>
</template>
