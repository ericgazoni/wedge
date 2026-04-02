<script setup lang="ts">
import { computed } from "vue";
import { useAppStore } from "../../stores/app";
import { useGitStore } from "../../stores/git";

const app = useAppStore();
const git = useGitStore();

const canResolveConflict = computed(() => !!app.repoPath && git.conflictingFiles.length > 0 && !git.syncing);

async function keepMine() {
  if (!app.repoPath) return;
  await git.resolveConflict(app.repoPath, "mine");
}

async function keepTheirs() {
  if (!app.repoPath) return;
  await git.resolveConflict(app.repoPath, "theirs");
}

async function askForHelp() {
  if (!app.repoPath) return;
  await git.resolveConflict(app.repoPath, "abort");
}
</script>

<template>
  <div class="space-y-4">
    <div class="panel p-3 space-y-2">
      <div class="text-sm text-slate-300">Sync status: {{ git.statusText }}</div>
      <div class="text-xs text-slate-400">Branch: {{ git.status?.branch ?? "-" }}</div>
      <div class="text-xs text-slate-400">Local changes: {{ git.status?.localChangeCount ?? 0 }}</div>
      <div class="text-xs text-slate-400">Remote updates: {{ git.status?.updatesAvailable ? "yes" : "no" }}</div>
      <div v-if="git.lastSyncAt" class="text-xs text-slate-400">Last sync: {{ git.lastSyncAt }}</div>
    </div>

    <div v-if="git.error" class="panel p-3 border-red-900/60">
      <div class="text-sm text-red-300">{{ git.error.message }}</div>
      <details class="mt-2 text-xs text-slate-400">
        <summary class="cursor-pointer">Error details</summary>
        <pre class="mt-2 whitespace-pre-wrap">{{ git.error.details }}</pre>
      </details>
    </div>

    <div v-if="git.conflictingFiles.length" class="panel p-3 space-y-3 border-amber-800/70">
      <div class="text-sm text-amber-300">Sync conflict</div>
      <div class="text-xs text-slate-300">Someone else modified the same files. Choose one option:</div>
      <ul class="text-xs text-slate-400 space-y-1">
        <li v-for="file in git.conflictingFiles" :key="file">- {{ file }}</li>
      </ul>
      <div class="flex gap-2">
        <button class="btn" :disabled="!canResolveConflict" @click="keepMine">Keep my version</button>
        <button class="btn" :disabled="!canResolveConflict" @click="keepTheirs">Keep their version</button>
        <button class="btn" :disabled="!canResolveConflict" @click="askForHelp">Ask for help</button>
      </div>
    </div>

    <div v-if="!app.repoPath" class="text-sm text-slate-500">Open or join a project to use sync.</div>
  </div>
</template>
