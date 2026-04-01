<script setup lang="ts">
import type { MainView, ThemeMode } from "../../stores/app";

defineProps<{
  repoPath: string;
  currentView: MainView;
  theme: ThemeMode;
}>();

const emit = defineEmits<{
  (e: "open-repo"): void;
  (e: "set-view", view: MainView): void;
  (e: "toggle-theme"): void;
}>();
</script>

<template>
  <header class="bg-panel px-4 flex items-center justify-between">
    <div class="flex items-center gap-4 min-w-0">
      <div class="text-sm font-bold tracking-wide">WEDGE</div>
      <div class="h-4 w-px bg-slate-700"></div>
      <div class="text-xs text-slate-400 truncate max-w-[50vw]">{{ repoPath || "No repository opened" }}</div>
    </div>
    <div class="flex items-center gap-2">
      <button
        class="btn h-8 w-8 p-0 inline-flex items-center justify-center"
        :title="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
        :aria-label="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
        @click="emit('toggle-theme')"
      >
        <svg
          v-if="theme === 'dark'"
          class="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4"></circle>
          <path d="M12 2v2"></path>
          <path d="M12 20v2"></path>
          <path d="m4.93 4.93 1.41 1.41"></path>
          <path d="m17.66 17.66 1.41 1.41"></path>
          <path d="M2 12h2"></path>
          <path d="M20 12h2"></path>
          <path d="m6.34 17.66-1.41 1.41"></path>
          <path d="m19.07 4.93-1.41 1.41"></path>
        </svg>
        <svg
          v-else
          class="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3a7 7 0 1 0 9 9A9 9 0 1 1 12 3z"></path>
        </svg>
      </button>
      <button class="btn" @click="emit('open-repo')"><span class="kbd mr-2">Ctrl+O</span>Open</button>
      <button class="btn" :class="{ 'border-sky-500 text-sky-300': currentView === 'editor' }" @click="emit('set-view', 'editor')">Editor</button>
      <button class="btn" :class="{ 'border-sky-500 text-sky-300': currentView === 'batch' }" @click="emit('set-view', 'batch')">Batch</button>
      <button class="btn" :class="{ 'border-sky-500 text-sky-300': currentView === 'git' }" @click="emit('set-view', 'git')">Git</button>
    </div>
  </header>
</template>

