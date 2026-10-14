<script setup lang="ts">
import type { Room } from '../types/game';

defineProps<{
  room: Room;
  remaining: number;
  countdown: boolean;
  countdownNumber: number;
  timerLabel: string;
  submittedPercent: number;
  busy: string;
  draft: string;
}>();

defineEmits<{ 'update:draft': [value: string]; submit: [] }>();
</script>

<template>
  <section class="screen">
    <section v-if="countdown" class="screen countdown-screen">
      <div class="eyebrow">QUESTION {{ room.round }} OF {{ room.config.questions }}</div>
      <div class="count-number">{{ countdownNumber }}</div>
      <h2>Ready to sync?</h2><p>Same question, coming right up.</p>
    </section>
    <section v-else-if="room.question" class="screen game-wrap">
      <div class="game-meta"><span>QUESTION {{ room.round }} OF {{ room.config.questions }}</span><span class="timer" :class="{ urgent: remaining <= 5 }">{{ timerLabel }}</span></div>
      <div class="question-card"><div class="eyebrow">{{ room.question.category }} · THINK FAST</div><h1 class="question">{{ room.question.text }}</h1></div>
      <div v-if="room.ownSubmitted" class="waiting-box"><span class="lock-icon">🔒</span> Answer locked! Let’s see who thinks like you.</div>
      <form v-else class="answer-form" @submit.prevent="$emit('submit')">
        <input :value="draft" class="text-input" name="answer" maxlength="30" autocomplete="off" placeholder="Type your answer…" :disabled="remaining === 0 || Boolean(busy)" autofocus @input="$emit('update:draft', ($event.target as HTMLInputElement).value)" />
        <button class="button primary" type="submit" :disabled="remaining === 0 || Boolean(busy)"><span v-if="busy === 'submit'" class="button-spinner" aria-hidden="true"></span>{{ busy === 'submit' ? 'Submitting…' : 'Lock it in ↗' }}</button>
      </form>
      <div v-if="!room.ownSubmitted" class="answer-hint">30 characters max · your answer stays secret</div>
      <div class="submitted-meter"><div class="meter-top"><span>Brains locked in</span><span>{{ room.submittedCount }} / {{ room.players.length }}</span></div><div class="meter-track"><div class="meter-fill" :style="{ width: `${submittedPercent}%` }"></div></div></div>
    </section>
  </section>
</template>
