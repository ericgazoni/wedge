<script setup lang="ts">
defineProps<{
  visibleDocCount: number;
  visibleItemCount: number;
  syncText: string;
  syncTone: "amber" | "green" | "blue" | "red" | "neutral";
  branchName: string;
  lastSyncAt: string;
  canSync: boolean;
  syncing: boolean;
}>();

const emit = defineEmits<{
  (e: "sync-now"): void;
}>();

function syncToneClasses(tone: "amber" | "green" | "blue" | "red" | "neutral") {
  if (tone === "amber") return "text-amber-300";
  if (tone === "green") return "text-emerald-300";
  if (tone === "blue") return "text-sky-300";
  if (tone === "red") return "text-red-300";
  return "text-slate-400";
}
</script>

<template>
  <footer class="bg-panel px-4 flex items-center justify-between text-xs border-t border-slate-800 gap-3">
    <div class="text-slate-400 truncate">branch: {{ branchName || "-" }}<span v-if="lastSyncAt"> | last sync: {{ lastSyncAt }}</span></div>
    <div class="flex items-center gap-3 shrink-0">
      <div :class="syncToneClasses(syncTone)">{{ syncText }}</div>
      <button class="btn h-7" :disabled="!canSync || syncing" @click="emit('sync-now')">Sync now</button>
      <div class="text-slate-400">docs: {{ visibleDocCount }} | items: {{ visibleItemCount }}</div>
    </div>
  </footer>
</template>

