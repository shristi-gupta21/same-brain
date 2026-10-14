<template>
  <section class="screen hero">
    <div class="hero-copy">
      <div class="eyebrow">A PARTY GAME FOR YOUR GROUP CHAT</div>
      <h1>Think alike.<br /><em>Win together-ish.</em></h1>
      <p>Same question. Six different brains. Somehow, the same answer.</p>
      <div class="actions">
        <button class="button primary" @click="$emit('create')"><span class="action-icon">＋</span>Create a game</button>
        <button class="button secondary" @click="$emit('quick')"><span class="action-icon" style="background:#eeeee8;color:#555">↗</span>Quick play</button>
        <button class="button subtle" @click="$emit('join')">Join with a room code</button>
      </div>
      <p class="hero-note">No accounts, no downloads. Just your people and one shared brain cell.</p>
    </div>
    <div class="art-stage" aria-hidden="true"><div class="orbit"></div><div class="confetti-dot"></div><div class="confetti-spark">✳</div><div class="brain-card"><span class="brain-illustration">🧠</span></div><div class="float-tag tag-one">“<b>Pizza</b>”</div><div class="float-tag tag-two">“<b>Pizza</b>”</div></div>
  </section>
</template>

<script setup lang="ts">
defineEmits<{ create: []; join: []; quick: [] }>();
</script>
