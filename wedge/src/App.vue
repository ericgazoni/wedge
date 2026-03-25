<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMagicKeys } from "@vueuse/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "./stores/app";
import { useRepoStore } from "./stores/repo";
import { getLastDoorstopScanDebug } from "./services/doorstop";

const app = useAppStore();
const repo = useRepoStore();

const keys = useMagicKeys();
const flatTreeCursor = ref(0);

const scanDebug = ref(getLastDoorstopScanDebug());

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

const viewLabel = computed(() => {
    if (app.currentView === "editor") return "Editor";
    if (app.currentView === "batch") return "Batch";
    return "Git";
});

const debugSummary = computed(() => {
    const d = scanDebug.value;
    return `visited=${d.visitedDirs} candidates=${d.candidateDirs.length} docs=${d.documentDirs.length} parseErrors=${d.parseErrors.length}`;
});

function setView(v: "editor" | "batch" | "git") {
    app.currentView = v;
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
                                <div
                                    class="grid grid-cols-[120px_1fr] gap-2 items-center"
                                >
                                    <label class="text-sm text-slate-400"
                                        >UID</label
                                    >
                                    <input
                                        class="input h-9"
                                        :value="selectedItem.uid"
                                        readonly
                                    />
                                </div>
                                <div
                                    class="grid grid-cols-[120px_1fr] gap-2 items-center"
                                >
                                    <label class="text-sm text-slate-400"
                                        >Header</label
                                    >
                                    <input
                                        class="input h-9"
                                        :value="
                                            String(
                                                selectedItem.data.header ?? '',
                                            )
                                        "
                                        readonly
                                    />
                                </div>
                                <div
                                    class="grid grid-cols-[120px_1fr] gap-2 items-start"
                                >
                                    <label class="text-sm text-slate-400 mt-2"
                                        >Text</label
                                    >
                                    <textarea
                                        class="input min-h-[220px]"
                                        :value="
                                            String(selectedItem.data.text ?? '')
                                        "
                                        readonly
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
