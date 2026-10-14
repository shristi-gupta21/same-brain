<script setup lang="ts">
import type { Player, Room } from '../types/game';
import { playerInitials } from '../utils/game';

defineProps<{ room: Room; rankedPlayers: Player[] }>();
</script>

<template>
  <section class="screen reveal-screen">
    <div class="reveal-top"><div class="eyebrow">QUESTION {{ room.round }} RESULTS</div><h1 class="title">Who had the same brain?</h1><p class="question-small">{{ room.question?.text }}</p></div>
    <div v-if="room.reveal?.length" class="group-grid">
      <article v-for="group in room.reveal" :key="group.answer" class="answer-group">
        <div class="group-answer">{{ group.answer }}</div>
        <div class="group-people"><span v-for="person in group.players" :key="person.id" class="mini-person"><span class="mini-avatar" :style="{ background: person.color }">{{ playerInitials(person.name) }}</span>{{ person.name }}</span></div>
        <div class="points"><b v-if="group.players.length > 1">+{{ group.points }} points each</b><template v-else>No match this time</template></div>
      </article>
    </div>
    <div v-else class="no-matches">No one answered this round. The brain cell is taking a quick break.</div>
    <div class="reveal-board"><span>Scoreboard</span><div class="compact-scores"><span v-for="(player, index) in rankedPlayers" :key="player.id" class="compact-score">{{ index + 1 }}. {{ player.name }}<b>{{ player.score }}</b></span></div></div>
  </section>
</template>
