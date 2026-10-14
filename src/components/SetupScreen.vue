<script setup lang="ts">
import type { Screen, SetupValues } from '../types/game';

const props = defineProps<{
  screen: Extract<Screen, 'create' | 'join' | 'quick'>;
  questions: number;
  seconds: number;
  joinCode: string;
  error: string;
  busy: string;
}>();

const emit = defineEmits<{
  back: [];
  'update:questions': [value: number];
  'update:seconds': [value: number];
  'update:joinCode': [value: string];
  create: [values: SetupValues];
  join: [values: SetupValues];
  quick: [values: SetupValues];
}>();

function submit(event: Event) {
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const values: SetupValues = {
    name: String(data.get('name') || ''),
    code: String(data.get('code') || ''),
  };
  if (props.screen === 'create') emit('create', values);
  else if (props.screen === 'join') emit('join', values);
  else emit('quick', values);
}

</script>

<template>
  <section class="screen narrow">
    <div class="form-head">
      <button class="back-link" @click="$emit('back')">← &nbsp;Back</button>
      <template v-if="screen === 'create'"><h1 class="title">Set the scene</h1><p class="lead">A few friends, a few questions, and a suspicious amount of mind reading.</p></template>
      <template v-else-if="screen === 'join'"><h1 class="title">You’re invited</h1><p class="lead">Grab a nickname and jump into the room.</p></template>
      <template v-else><h1 class="title">Find your people</h1><p class="lead">We’ll gather a few brains and start a public match.</p></template>
    </div>

    <form class="form-stack" @submit.prevent="submit">
      <label><span class="field-label">Your nickname</span><input class="text-input" name="name" maxlength="18" placeholder="What should we call you?" autocomplete="nickname" required /></label>

      <template v-if="screen === 'create'">
        <div>
          <span class="field-label">Number of questions</span>
          <div class="segmented"><button v-for="value in [3, 5, 10]" :key="value" type="button" class="segment" :class="{ active: value === questions }" :aria-pressed="value === questions" @click="$emit('update:questions', value)">{{ value }} {{ value === 3 ? 'Quick' : value === 5 ? 'Classic' : 'Extended' }}</button></div>
        </div>
        <div>
          <span class="field-label">Answer timer</span>
          <div class="segmented"><button v-for="value in [10, 15, 20]" :key="value" type="button" class="segment" :class="{ active: value === seconds }" :aria-pressed="value === seconds" @click="$emit('update:seconds', value)">{{ value }} seconds</button></div>
        </div>
      </template>
      <label v-if="screen === 'join'"><span class="field-label">Room code</span><input :value="joinCode" class="text-input" name="code" maxlength="6" placeholder="e.g. BRN482" autocapitalize="characters" required @input="$emit('update:joinCode', ($event.target as HTMLInputElement).value)" /></label>

      <div class="form-error">{{ error }}</div>
      <button class="button primary full" type="submit" :disabled="Boolean(busy)">
        <span v-if="busy" class="button-spinner" aria-hidden="true"></span>
        {{ busy === 'create' ? 'Creating room…' : busy === 'join' ? 'Joining room…' : busy === 'quick' ? 'Finding a match…' : screen === 'create' ? 'Create private room →' : screen === 'join' ? 'Join room →' : 'Find a match →' }}
      </button>
      <div v-if="screen === 'create'" class="form-tip">Your friends can join with a code or the invitation link.</div>
      <div v-else-if="screen === 'quick'" class="form-tip">Public matches use 5 questions and a 15 second timer.</div>
    </form>
  </section>
</template>
