<script setup lang="ts">
import type { Room } from '../types/game';
import { playerInitials } from '../utils/game';

defineProps<{ room: Room; busy: string }>();
defineEmits<{ copyCode: []; copyInvite: []; start: []; home: [] }>();
</script>

<template>
  <section class="screen room">
    <div class="room-heading"><div><div class="room-id"><span class="status-dot"></span>{{ room.mode === 'public' ? 'PUBLIC MATCH' : 'PRIVATE ROOM' }}</div><h1 class="title">{{ room.state === 'NO_MATCH' ? 'No match found' : room.mode === 'public' ? 'Finding your people' : 'The hangout' }}</h1><p class="lead">{{ room.state === 'NO_MATCH' ? 'No one joined this time. Give Quick Play another try.' : room.mode === 'public' ? 'Your match will start as soon as everyone is ready.' : 'Send the invite. The more brains, the better.' }}</p></div></div>
    <div class="room-code-box"><div><div class="room-code-label">Room code</div><div class="room-code">{{ room.roomCode }}</div></div><button class="copy-button" @click="$emit('copyCode')">Copy code</button><button class="copy-button" @click="$emit('copyInvite')">Share invite</button></div>
    <div class="room-layout">
      <div>
        <p class="section-label">Players <span style="color:#c0bbb2">{{ room.players.length }}/6</span></p>
        <div class="player-grid">
          <template v-for="index in 6" :key="index">
            <div v-if="room.players[index - 1]" class="player-tile">
              <span class="avatar" :style="{ background: room.players[index - 1].color }">{{ playerInitials(room.players[index - 1].name) }}</span>
              <span style="min-width:0"><span class="player-name">{{ room.players[index - 1].name }}{{ room.players[index - 1].id === room.playerId ? ' (you)' : '' }}</span><span v-if="room.players[index - 1].id === room.hostId" class="host-label">HOST</span></span>
            </div>
            <div v-else class="empty-slot">+ &nbsp; Open seat</div>
          </template>
        </div>
      </div>
      <aside class="settings-panel">
        <p class="section-label">Game settings</p>
        <div class="setting-row"><span>Questions</span><b>{{ room.config.questions }}</b></div>
        <div class="setting-row"><span>Answer time</span><b>{{ room.config.seconds }} sec</b></div>
        <div class="setting-row"><span>Match length</span><b>~{{ Math.round(room.config.questions * (room.config.seconds + 10) / 60) }} min</b></div>
        <div class="room-controls">
          <button v-if="room.state === 'NO_MATCH'" class="button primary" @click="$emit('home')">Back to home</button>
          <button v-else-if="room.mode === 'public'" class="button primary" disabled>Finding players…</button>
          <template v-else-if="room.playerId === room.hostId"><button class="button primary" :disabled="room.players.filter(player => player.connected).length < 2 || Boolean(busy)" @click="$emit('start')"><span v-if="busy === 'start'" class="button-spinner" aria-hidden="true"></span>{{ busy === 'start' ? 'Starting…' : 'Start game →' }}</button><p class="waiting-copy">{{ room.players.length < 2 ? 'Need one more brain to get started.' : 'Everyone in? Let’s go.' }}</p></template>
          <p v-else class="waiting-copy">Waiting for the host to start…</p>
        </div>
      </aside>
    </div>
  </section>
</template>
