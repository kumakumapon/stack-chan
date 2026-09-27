export const PET_STATE_VERSION = 1

const MAX_STAT = 100
const MAX_XP = 100000
const PET_COOLDOWN_MS = 5000
const GAME_COOLDOWN_MS = 10000
const REACTION_COOLDOWN_MS = 2500
const ENERGY_RECOVERY_MS = 10 * 60 * 1000

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value))
const integer = (value, fallback, minimum, maximum) =>
  Number.isFinite(value) ? clamp(Math.trunc(value), minimum, maximum) : fallback
const timestamp = (value) => integer(value, 0, 0, Number.MAX_SAFE_INTEGER)
const cooldownTimestamp = (value) => integer(value, -1, -1, Number.MAX_SAFE_INTEGER)

export function levelForXp(xp) {
  return Math.min(20, 1 + Math.floor(integer(xp, 0, 0, MAX_XP) / 20))
}

export function createPetState() {
  return {
    version: PET_STATE_VERSION,
    bond: 20,
    energy: 80,
    curiosity: 20,
    xp: 0,
    level: 1,
    interactions: 0,
    pettings: 0,
    games: 0,
    lastSeenAt: 0,
    lastEnergyAt: -1,
    lastPetAt: -1,
    lastGameAt: -1,
    lastReactionAt: -1,
  }
}

/** Validate persisted data; version 0 had no counters or cooldown timestamps. */
export function restorePetState(value) {
  if (!value || typeof value !== 'object' || ![0, PET_STATE_VERSION].includes(value.version)) return createPetState()
  const initial = createPetState()
  const xp = integer(value.xp, initial.xp, 0, MAX_XP)
  return {
    version: PET_STATE_VERSION,
    bond: integer(value.bond, initial.bond, 0, MAX_STAT),
    energy: integer(value.energy, initial.energy, 0, MAX_STAT),
    curiosity: integer(value.curiosity, initial.curiosity, 0, MAX_STAT),
    xp,
    level: levelForXp(xp),
    interactions: integer(value.interactions, 0, 0, MAX_XP),
    pettings: integer(value.pettings, 0, 0, MAX_XP),
    games: integer(value.games, 0, 0, MAX_XP),
    lastSeenAt: timestamp(value.lastSeenAt),
    lastEnergyAt: cooldownTimestamp(value.lastEnergyAt ?? value.lastSeenAt),
    lastPetAt: cooldownTimestamp(value.lastPetAt),
    lastGameAt: cooldownTimestamp(value.lastGameAt),
    lastReactionAt: cooldownTimestamp(value.lastReactionAt),
  }
}

export function decodePetState(raw) {
  if (typeof raw !== 'string') return createPetState()
  try {
    return restorePetState(JSON.parse(raw))
  } catch {
    return createPetState()
  }
}

export function encodePetState(state) {
  return JSON.stringify(restorePetState(state))
}

export function unlockedReactions(level) {
  return {
    greeting: true,
    delighted: level >= 2,
    thinking: level >= 3,
    sleepy: level >= 4,
    celebration: level >= 5,
  }
}

/** Pure game transition. Wall-clock time is supplied by the caller. */
export function applyPetEvent(previous, event) {
  const state = restorePetState(previous)
  const now = timestamp(event?.now)
  if (
    !event ||
    !['boot', 'petted', 'tap', 'gameFinished', 'conversationFinished', 'taskCompleted'].includes(event.type)
  ) {
    return { state, changed: false, reaction: null, speech: null, levelUp: false }
  }
  // Offline targets can restart with an unset clock. Reset time anchors rather
  // than retaining a future timestamp that would lock out all interactions.
  if (now < state.lastSeenAt) {
    state.lastPetAt = -1
    state.lastGameAt = -1
    state.lastReactionAt = -1
    state.lastEnergyAt = now
  }
  const recovered = state.lastEnergyAt >= 0 ? Math.floor((now - state.lastEnergyAt) / ENERGY_RECOVERY_MS) : 0
  if (recovered > 0) {
    state.energy = clamp(state.energy + recovered, 0, MAX_STAT)
    state.lastEnergyAt += recovered * ENERGY_RECOVERY_MS
  } else if (state.lastEnergyAt < 0) state.lastEnergyAt = now
  const priorLevel = state.level
  let reaction = null
  let speech = null
  let accepted = true
  if (event.type === 'boot') {
    reaction = 'greeting'
    speech = state.interactions > 0 ? 'また会えたね！' : 'こんにちは！'
  } else if (event.type === 'petted' || event.type === 'tap') {
    if (state.lastPetAt >= 0 && now - state.lastPetAt < PET_COOLDOWN_MS) accepted = false
    if (accepted) {
      state.bond = clamp(state.bond + 2, 0, MAX_STAT)
      state.xp = clamp(state.xp + 3, 0, MAX_XP)
      state.interactions = clamp(state.interactions + 1, 0, MAX_XP)
      state.pettings = clamp(state.pettings + 1, 0, MAX_XP)
      state.lastPetAt = now
      reaction = 'delighted'
      speech = 'えへへ！'
    }
  } else if (event.type === 'gameFinished') {
    if (state.lastGameAt >= 0 && now - state.lastGameAt < GAME_COOLDOWN_MS) accepted = false
    if (accepted) {
      const score = integer(event.score, 0, 0, 1000)
      state.energy = clamp(state.energy - 5, 0, MAX_STAT)
      state.curiosity = clamp(state.curiosity + 2, 0, MAX_STAT)
      state.xp = clamp(state.xp + 4 + Math.min(6, Math.floor(score / 10)), 0, MAX_XP)
      state.interactions = clamp(state.interactions + 1, 0, MAX_XP)
      state.games = clamp(state.games + 1, 0, MAX_XP)
      state.lastGameAt = now
      reaction = score >= 20 ? 'success' : 'greeting'
      if (score >= 20) speech = 'やったね！'
    }
  } else {
    // Future integrations send a named, validated event. They never send raw stat values.
    state.bond = clamp(state.bond + 1, 0, MAX_STAT)
    state.xp = clamp(state.xp + 2, 0, MAX_XP)
    state.interactions = clamp(state.interactions + 1, 0, MAX_XP)
    reaction = 'greeting'
  }
  state.level = levelForXp(state.xp)
  const levelUp = state.level > priorLevel
  if (levelUp) {
    reaction = 'delighted'
    speech = '新しいことができそう！'
  }
  if (reaction && state.lastReactionAt >= 0 && now - state.lastReactionAt < REACTION_COOLDOWN_MS) reaction = null
  if (reaction) state.lastReactionAt = now
  state.lastSeenAt = now
  return { state, changed: accepted || recovered > 0, reaction, speech: accepted ? speech : null, levelUp }
}
