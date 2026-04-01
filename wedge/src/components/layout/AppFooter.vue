<script setup lang="ts">
defineProps<{
  visibleDocCount: number;
  visibleItemCount: number;
}>();
</script>

<template>
  <footer class="bg-panel px-4 flex items-center justify-between text-xs border-t border-slate-800">
    <div class="text-slate-300">branch: - | staged: 0 | modified: 0</div>
    <div class="text-slate-400">docs: {{ visibleDocCount }} | items: {{ visibleItemCount }} | sync: -</div>
  </footer>
</template>

