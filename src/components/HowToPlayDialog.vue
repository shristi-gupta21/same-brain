<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();
const dialog = ref<HTMLDialogElement | null>(null);

watch(() => props.open, open => {
  if (open && !dialog.value?.open) dialog.value?.showModal();
  else if (!open && dialog.value?.open) dialog.value.close();
});

function close() {
  emit('update:open', false);
}
</script>

<template>
  <dialog ref="dialog" class="how-dialog" @click="($event.target === $event.currentTarget) && close()" @close="close">
    <button class="dialog-close" aria-label="Close" @click="close">×</button>
    <div class="eyebrow">THE WHOLE IDEA</div><h2>Think alike.<br />Win together-ish.</h2>
    <p>Everyone gets the same question. Type the answer you think someone else will choose.</p>
    <p>A match earns points, but a smaller matching group earns more. So go with your gut, then see whose brain took the same turn.</p>
    <div class="scoring"><span>2 alike <b>100 pts</b></span><span>3 alike <b>70 pts</b></span><span>4 alike <b>50 pts</b></span></div>
    <button class="button primary full" @click="close">Got it</button>
  </dialog>
</template>
