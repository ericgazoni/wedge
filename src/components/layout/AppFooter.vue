<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  visibleDocCount: number;
  visibleItemCount: number;
  syncText: string;
  syncTone: "amber" | "green" | "blue" | "red" | "neutral";
  branchName: string;
  lastSyncAt: string;
  canSync: boolean;
  syncing: boolean;
  doorstopChecking: boolean;
  doorstopIssueCount: number;
  doorstopHasRun: boolean;
}>();

const emit = defineEmits<{
  (e: "sync-now"): void;
  (e: "show-log"): void;
  (e: "run-check"): void;
}>();

function syncToneClasses(tone: "amber" | "green" | "blue" | "red" | "neutral") {
  if (tone === "amber") return "text-amber-300";
  if (tone === "green") return "text-emerald-300";
  if (tone === "blue") return "text-sky-300";
  if (tone === "red") return "text-red-300";
  return "text-slate-400";
}

const checkStatusText = computed(() => {
  if (props.doorstopChecking) return "checking…";
  if (!props.doorstopHasRun) return "";
  return props.doorstopIssueCount === 0
    ? "✓ no issues"
    : `⚠ ${props.doorstopIssueCount} issue${props.doorstopIssueCount > 1 ? "s" : ""}`;
});

const checkStatusClass = computed(() => {
  if (props.doorstopChecking) return "text-sky-300";
  if (!props.doorstopHasRun) return "";
  return props.doorstopIssueCount === 0 ? "text-emerald-400" : "text-amber-400";
});
</script>

<template>
  <footer class="bg-panel px-4 flex items-center justify-between text-xs border-t border-slate-800 gap-3">
    <div class="flex items-center gap-2 shrink-0">
      <span class="text-slate-400">{{ branchName || "-" }}</span>
      <span class="text-slate-600">|</span>
      <span :class="syncToneClasses(syncTone)">{{ syncText }}</span>
      <button class="btn h-7" :disabled="!canSync || syncing" @click="emit('sync-now')">Sync now</button>
    </div>
    <div class="flex items-center gap-3 shrink-0">
      <span class="text-slate-400">docs: {{ visibleDocCount }} | items: {{ visibleItemCount }}</span>
      <template v-if="doorstopChecking || doorstopHasRun">
        <span class="text-slate-600">|</span>
        <button :class="[checkStatusClass, 'hover:underline']" @click="emit('show-log')">{{ checkStatusText }}</button>
        <button class="btn h-7" :disabled="doorstopChecking" @click="emit('run-check')">Check</button>
      </template>
    </div>
  </footer>
</template>
