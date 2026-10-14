<script setup lang="ts">
import { ref } from 'vue';
import GameScreen from './components/GameScreen.vue';
import HomeScreen from './components/HomeScreen.vue';
import HowToPlayDialog from './components/HowToPlayDialog.vue';
import LobbyScreen from './components/LobbyScreen.vue';
import ResultsScreen from './components/ResultsScreen.vue';
import RevealScreen from './components/RevealScreen.vue';
import SetupScreen from './components/SetupScreen.vue';
import { useSameBrain } from './composables/useSameBrain';

const game = useSameBrain();
const { state } = game;
const howToPlayOpen = ref(false);
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <button class="brand" aria-label="Same Brain home" @click="game.home">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i></span>
        <span>same brain</span>
      </button>
      <button class="how-link" @click="howToPlayOpen = true">How to play <span aria-hidden="true">↗</span></button>
    </header>

    <main id="app" class="main-content" aria-live="polite">
      <Transition mode="out-in" name="screen">
        <HomeScreen v-if="state.screen === 'home'" key="home" @create="game.navigate('create')" @join="game.navigate('join')" @quick="game.navigate('quick')" />

        <SetupScreen
          v-else-if="['create', 'join', 'quick'].includes(state.screen)"
          :key="state.screen"
          v-model:questions="state.questions"
          v-model:seconds="state.seconds"
          v-model:join-code="state.joinCode"
          :screen="state.screen as 'create' | 'join' | 'quick'"
          :error="state.error"
          :busy="state.busy"
          @back="game.navigate('home')"
          @create="game.createRoom"
          @join="game.joinRoom"
          @quick="game.quickPlay"
        />

        <LobbyScreen
          v-else-if="state.screen === 'lobby' && state.room"
          key="lobby"
          :room="state.room"
          :busy="state.busy"
          @copy-code="game.copyText(state.room.roomCode, 'Room code copied.')"
          @copy-invite="game.copyText(game.inviteUrl.value, 'Invite link copied.')"
          @start="game.startGame"
          @home="game.home"
        />

        <GameScreen
          v-else-if="state.screen === 'game' && state.room"
          key="game"
          :room="state.room"
          :remaining="game.remaining.value"
          :countdown="game.countdown.value"
          :countdown-number="game.countdownNumber.value"
          :timer-label="game.timerLabel.value"
          :submitted-percent="game.submittedPercent.value"
          :busy="state.busy"
          :draft="state.draft"
          @update:draft="state.draft = $event"
          @submit="game.submitAnswer"
        />

        <RevealScreen v-else-if="state.screen === 'reveal' && state.room" key="reveal" :room="state.room" :ranked-players="game.rankedPlayers.value" />

        <ResultsScreen
          v-else-if="state.screen === 'results' && state.room"
          key="results"
          :room="state.room"
          :busy="state.busy"
          :ranked-players="game.rankedPlayers.value"
          :winners="game.winners.value"
          :winner-tied="game.winnerTied.value"
          :winner="game.winner.value"
          :winner-names="game.winnerNames.value"
          @rematch="game.rematch"
          @home="game.home"
        />
      </Transition>
    </main>

    <footer class="footer"><span>Made for people who finish each other&apos;s</span><span class="footer-dot">thoughts.</span></footer>
    <Transition name="toast"><div v-if="state.toast" class="toast show" role="status">{{ state.toast }}</div></Transition>
    <HowToPlayDialog v-model:open="howToPlayOpen" />
  </div>
</template>
