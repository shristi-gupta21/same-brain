<script setup lang="ts">
import type { Player, Room } from '../types/game';
import { playerInitials } from '../utils/game';

defineProps<{
  room: Room;
  busy: string;
  rankedPlayers: Player[];
  winners: string[];
  winnerTied: boolean;
  winner?: Player;
  winnerNames: string;
}>();

defineEmits<{ rematch: []; home: [] }>();
</script>

<template>
  <section class="screen results-screen">
    <div class="winner-crown">{{ winnerTied ? '✳' : '♛' }}</div>
    <div class="eyebrow">{{ winnerTied ? 'A VERY SAME-BRAIN FINISH' : 'THE BRAINIEST BRAIN' }}</div>
    <h1 class="winner-name">{{ winnerTied ? 'It’s a tie!' : `${winner?.name} wins!` }}</h1>
    <div class="winner-points">{{ winnerTied ? winnerNames : winner?.score }} {{ winnerTied ? '' : 'points' }}</div>

    <table class="results-table"><thead><tr><th>#</th><th>Player</th><th>Matches</th><th style="text-align:right">Score</th></tr></thead>
      <tbody><tr v-for="(player, index) in rankedPlayers" :key="player.id"><td class="rank">{{ String(index + 1).padStart(2, '0') }}</td><td><span style="display:inline-flex;align-items:center;gap:8px"><span class="mini-avatar" :style="{ background: player.color }">{{ playerInitials(player.name) }}</span>{{ player.name }}{{ winners.includes(player.id) ? ' ✦' : '' }}</span></td><td>{{ player.matches }}</td><td class="score-cell">{{ player.score }}</td></tr></tbody>
    </table>

    <div class="results-actions">
      <button v-if="room.playerId === room.hostId" class="button primary" :disabled="Boolean(busy)" @click="$emit('rematch')"><span v-if="busy === 'rematch'" class="button-spinner" aria-hidden="true"></span>{{ busy === 'rematch' ? 'Starting rematch…' : 'Play again ↻' }}</button>
      <button v-else class="button secondary" disabled>Waiting for host…</button>
      <button class="button secondary" @click="$emit('home')">Back to home</button>
    </div>
    <div class="small-note">A fresh set of questions, same good company.</div>
  </section>
</template>
