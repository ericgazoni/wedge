<script setup lang="ts">
const props = defineProps<{
  recentProjects: string[];
  cloning: boolean;
}>();

const emit = defineEmits<{
  (e: "open-local"): void;
  (e: "join-shared"): void;
  (e: "open-recent", path: string): void;
  (e: "remove-recent", path: string): void;
}>();
</script>

<template>
  <div class="h-full w-full flex items-center justify-center p-8">
    <div class="panel w-full max-w-3xl p-6 space-y-4">
      <div class="text-xl font-semibold">Welcome to Wedge</div>
      <div class="grid gap-3 md:grid-cols-2">
        <button class="btn h-20 text-left" @click="emit('open-local')">
          <span class="block font-semibold">Open a project on this computer</span>
          <span class="block text-xs text-slate-400">Browse for an existing folder.</span>
        </button>
        <button class="btn h-20 text-left" :disabled="cloning" @click="emit('join-shared')">
          <span class="block font-semibold">Join a shared project</span>
          <span class="block text-xs text-slate-400">Download from your team server.</span>
        </button>
      </div>

      <div class="pt-2">
        <div class="text-xs uppercase tracking-wider text-slate-500 mb-2">Recent projects</div>
        <div v-if="!props.recentProjects.length" class="text-sm text-slate-500">No recent projects yet.</div>
        <div v-else class="space-y-1">
          <div
            v-for="path in props.recentProjects"
            :key="path"
            class="flex items-center justify-between rounded border border-slate-800 px-2 py-1"
          >
            <button class="text-left text-sm text-slate-300 truncate" @click="emit('open-recent', path)">{{ path }}</button>
            <button class="text-xs text-slate-500 hover:text-slate-300" @click="emit('remove-recent', path)">Remove</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

