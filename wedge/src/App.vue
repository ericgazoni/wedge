<script setup lang="ts">
import { computed } from "vue";
import { useAppStore } from "./stores/app";

const app = useAppStore();

const viewLabel = computed(() => {
    if (app.currentView === "editor") return "Editor";
    if (app.currentView === "batch") return "Batch";
    return "Git";
});

function setView(v: "editor" | "batch" | "git") {
    app.currentView = v;
}
</script>

<template>
    <div class="h-full w-full bg-bg text-text">
        <div
            class="h-full w-full grid grid-rows-[56px_1fr_34px] gap-px bg-slate-800"
        >
            <!-- TITLE BAR -->
            <header
                class="bg-panel px-4 flex items-center justify-between shadow-[inset_0_-1px_0_0_rgb(30_41_59)]"
            >
                <div class="flex items-center gap-4 min-w-0">
                    <div class="text-sm font-bold tracking-wide">
                        WEDGE - Doorstop Manager
                    </div>
                    <div class="h-4 w-px bg-slate-700"></div>
                    <div class="text-xs text-slate-400 truncate max-w-[50vw]">
                        {{ app.repoPath || "No repository opened" }}
                    </div>
                </div>

                <div class="flex items-center gap-2">
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

            <!-- BODY -->
            <main
                class="min-h-0 grid grid-cols-[320px_1fr] gap-px bg-slate-800"
            >
                <!-- LEFT TREE PANE -->
                <aside class="bg-panel min-h-0 flex flex-col">
                    <div
                        class="px-3 py-2 border-b border-slate-800 flex items-center gap-2"
                    >
                        <input
                            v-model="app.treeFilter"
                            class="input w-full h-8"
                            placeholder="Filter tree (/)"
                        />
                        <span class="kbd">/</span>
                    </div>

                    <div class="flex-1 min-h-0 overflow-auto p-3">
                        <div
                            class="text-[11px] uppercase tracking-wider text-slate-500 mb-2"
                        >
                            Documents
                        </div>

                        <div class="space-y-1 text-sm">
                            <div
                                class="px-2 py-1 rounded bg-panel2 border border-slate-700 text-slate-300"
                            >
                                REQ <span class="text-slate-500">(0)</span>
                            </div>
                            <div
                                class="px-2 py-1 rounded bg-panel2 border border-slate-700 text-slate-300"
                            >
                                TST <span class="text-slate-500">(0)</span>
                            </div>
                        </div>

                        <div class="mt-4 text-xs text-slate-500">
                            Tree contents will populate once repo scanning is
                            wired in phase 2.
                        </div>
                    </div>

                    <div
                        class="px-3 py-2 border-t border-slate-800 text-xs text-slate-400 flex flex-wrap gap-2"
                    >
                        <span class="kbd">j/k</span><span>Navigate</span>
                        <span class="kbd">Enter</span><span>Open</span>
                        <span class="kbd">Space</span><span>Collapse</span>
                    </div>
                </aside>

                <!-- RIGHT CONTENT PANE -->
                <section class="bg-panel min-h-0 flex flex-col">
                    <div
                        class="px-4 py-2 border-b border-slate-800 flex items-center justify-between"
                    >
                        <div
                            class="text-xs uppercase tracking-wider text-slate-500"
                        >
                            {{ viewLabel }} View
                        </div>
                        <div class="text-xs text-slate-400">
                            <span class="kbd">Ctrl+P</span> Command Palette
                        </div>
                    </div>

                    <div class="flex-1 min-h-0 overflow-auto p-4">
                        <template v-if="app.currentView === 'editor'">
                            <div class="grid grid-cols-2 gap-3 max-w-5xl">
                                <div
                                    class="col-span-2 grid grid-cols-[140px_1fr] items-center gap-2"
                                >
                                    <label class="text-sm text-slate-400"
                                        >UID</label
                                    >
                                    <input
                                        class="input h-9"
                                        readonly
                                        value="-"
                                    />
                                </div>

                                <div
                                    class="col-span-2 grid grid-cols-[140px_1fr] items-center gap-2"
                                >
                                    <label class="text-sm text-slate-400"
                                        >Header</label
                                    >
                                    <input
                                        class="input h-9"
                                        placeholder="Item header"
                                    />
                                </div>

                                <div
                                    class="col-span-2 grid grid-cols-[140px_1fr] items-start gap-2"
                                >
                                    <label class="text-sm text-slate-400 mt-2"
                                        >Text</label
                                    >
                                    <textarea
                                        class="input min-h-[180px] resize-y"
                                        placeholder="Requirement text"
                                    ></textarea>
                                </div>

                                <div
                                    class="grid grid-cols-[140px_1fr] items-center gap-2 col-span-1"
                                >
                                    <label class="text-sm text-slate-400"
                                        >Active</label
                                    >
                                    <button class="btn w-fit">true</button>
                                </div>

                                <div
                                    class="grid grid-cols-[140px_1fr] items-center gap-2 col-span-1"
                                >
                                    <label class="text-sm text-slate-400"
                                        >Reviewed</label
                                    >
                                    <button class="btn w-fit">null</button>
                                </div>
                            </div>
                        </template>

                        <template v-else-if="app.currentView === 'batch'">
                            <div class="max-w-5xl space-y-3">
                                <div class="text-sm text-slate-300">
                                    Rapid entry (one line = one item)
                                </div>
                                <div class="panel p-3 space-y-2">
                                    <input
                                        class="input w-full h-9"
                                        placeholder="Item title..."
                                    />
                                    <input
                                        class="input w-full h-9"
                                        placeholder="Item title..."
                                    />
                                    <input
                                        class="input w-full h-9"
                                        placeholder="Item title..."
                                    />
                                </div>
                            </div>
                        </template>

                        <template v-else>
                            <div class="max-w-5xl grid grid-cols-2 gap-3">
                                <div class="panel p-3">
                                    <div
                                        class="text-xs uppercase text-slate-500 mb-2"
                                    >
                                        Branch
                                    </div>
                                    <div class="text-sm">-</div>
                                </div>
                                <div class="panel p-3">
                                    <div
                                        class="text-xs uppercase text-slate-500 mb-2"
                                    >
                                        Working Tree
                                    </div>
                                    <div class="text-sm">
                                        staged: 0 · modified: 0
                                    </div>
                                </div>
                                <div class="col-span-2 panel p-3 min-h-[220px]">
                                    <div
                                        class="text-xs uppercase text-slate-500 mb-2"
                                    >
                                        Recent commits
                                    </div>
                                    <div class="text-sm text-slate-400">
                                        No git data yet
                                    </div>
                                </div>
                            </div>
                        </template>
                    </div>

                    <div
                        class="px-4 py-2 border-t border-slate-800 text-xs text-slate-400 flex items-center gap-3"
                    >
                        <span class="kbd">Ctrl+S</span
                        ><span>Save + Commit</span>
                        <span class="kbd">Ctrl+Shift+S</span
                        ><span>Save + Push</span> <span class="kbd">Esc</span
                        ><span>Close overlay</span>
                    </div>
                </section>
            </main>

            <!-- STATUS BAR -->
            <footer
                class="bg-panel px-4 flex items-center justify-between text-xs border-t border-slate-800"
            >
                <div class="text-slate-300">
                    branch: - | staged: 0 | modified: 0
                </div>
                <div class="text-slate-400">docs: 0 | items: 0 | sync: -</div>
            </footer>
        </div>
    </div>
</template>
