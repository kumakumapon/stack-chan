import { resetState, state } from 'stackchan-voice-test-state'
import { assert, equal } from 'testing/assert'
import { TTS } from 'tts-stackchan-voice'

resetState()

const playedPowers: number[] = []
let callbackCalls = 0
let callbackError: unknown
let doneCalls = 0
const tts = new TTS({
  onDone: () => {
    doneCalls += 1
  },
  onPlayed: (power) => playedPowers.push(power),
  speed: 130,
  voice: 'cute',
  volume: 0.25,
})

tts.stream('デバイス再生', 0.75, (error) => {
  callbackCalls += 1
  callbackError = error
})

equal(state.constructors.length, 1, 'device TTS should construct one stackchan-voice renderer')
equal(state.constructors[0].preset, 1, 'device TTS should select the cute voice preset')
equal(state.constructors[0].resourceName, 'stackchan-ja.aqd', 'device TTS should load its dictionary')
equal(state.says.length, 1, 'device TTS should synthesize one utterance')
equal(state.says[0].text, 'デバイス再生', 'device TTS should forward the utterance')
equal(state.says[0].speed, 130, 'device TTS should forward the configured speed')
equal(state.audio.sampleRate, 24000, 'device playback should use the synthesized sample rate')
equal(state.audio.bitsPerSample, 16, 'device playback should use 16-bit PCM')
equal(state.audio.channels, 1, 'device playback should be mono')
equal(state.audio.volume, 0.75, 'stream volume should override the constructor volume')
equal(state.audio.started, 1, 'device playback should start AudioOut')
equal(state.audio.writes.length, 2, 'device playback should write PCM followed by its drain buffer')
assert(
  state.audio.writes[0].some((byte) => byte !== 0),
  'device playback should write synthesized PCM',
)
assert(
  state.audio.writes[1].every((byte) => byte === 0),
  'device playback should zero-fill its drain buffer',
)
assert(
  state.audio.writesAreUint8Arrays.every(Boolean),
  'device playback should pass ArrayBuffer views accepted by AudioOut.write',
)
assert(
  playedPowers.some((power) => power > 0),
  'device playback should report synthesized power',
)
equal(state.audio.stopped, 1, 'completed device playback should stop AudioOut')
equal(state.audio.closed, 1, 'completed device playback should close AudioOut')
equal(doneCalls, 1, 'completed device playback should notify onDone once')
equal(callbackCalls, 1, 'completed device playback should invoke its callback once')
equal(callbackError, undefined, 'completed device playback should not report an error')
equal(tts.streaming, false, 'completed device playback should clear streaming state')

let singingCallbackCalls = 0
let singingCallbackError: unknown
tts.streamKoe('#C4,500ki#D4,500ra', undefined, (error) => {
  singingCallbackCalls += 1
  singingCallbackError = error
})

equal(state.koes.length, 1, 'device TTS should synthesize one singing utterance')
equal(state.koes[0].koe, '#C4,500ki#D4,500ra', 'device TTS should forward raw koe notation')
equal(state.koes[0].speed, 130, 'device TTS should use the configured speed for singing consonants')
equal(state.audio.started, 2, 'device singing should use the same AudioOut playback path')
assert(
  state.audio.writes.slice(2).some((write) => write.some((byte) => byte !== 0)),
  'device singing should write synthesized PCM',
)
equal(singingCallbackCalls, 1, 'completed device singing should invoke its callback once')
equal(singingCallbackError, undefined, 'completed device singing should not report an error')
equal(tts.streaming, false, 'completed device singing should clear streaming state')

tts.stream('「明日は１４日に行ってください」')
equal(state.says.length, 2, 'text preparation should still synthesize the complete reply')
equal(
  state.says[1].text,
  ' 明日はじゅうよっかに行ってください ',
  'prepare quotes and calendar digits only for text synthesis',
)
equal(tts.streaming, false, 'prepared text should finish playback')

// '♫' (U+266B) is deliberately left untouched by prepareStackchanVoiceText (it is not part of
// its curated symbol-normalization list), so it survives into the first say() attempt and is
// only removed by the post-failure stripStackchanVoiceSymbols() fallback.
const SYMBOL_TEXT = '明日は晴れ♫です'
const SYMBOL_TEXT_STRIPPED = '明日は晴れ です'

// 1. A first say() failure on text that contains a strippable symbol retries once with the
// stripped text, and succeeds.
resetState()
state.sayFailQueue = [true, false]
let retrySucceededError: unknown
let retrySucceededCalls = 0
tts.stream(SYMBOL_TEXT, undefined, (error) => {
  retrySucceededCalls += 1
  retrySucceededError = error
})
equal(state.says.length, 2, 'a strippable symbol failure should retry say() exactly once')
equal(state.says[0].text, SYMBOL_TEXT, 'the first attempt should use the normally-prepared text')
equal(state.says[1].text, SYMBOL_TEXT_STRIPPED, 'the retry should use the symbol-stripped text')
equal(retrySucceededCalls, 1, 'a successful retry should still invoke the completion callback once')
equal(retrySucceededError, undefined, 'a successful retry should not report an error')
equal(tts.streaming, false, 'a successful retry should finish playback')

// 2. If the retry also fails, the ORIGINAL (first) error is what surfaces, not the retry's.
resetState()
state.sayFailQueue = [true, true]
let bothFailedError: unknown
let bothFailedCalls = 0
tts.stream(SYMBOL_TEXT, undefined, (error) => {
  bothFailedCalls += 1
  bothFailedError = error
})
equal(state.says.length, 2, 'a failed retry should still only attempt say() twice')
equal(bothFailedCalls, 1, 'a failed retry should still invoke the completion callback once')
equal(
  (bothFailedError as Error)?.message,
  'stub say failure #0',
  'the callback should receive the FIRST say() error, not the retry error (#1)',
)
equal(tts.streaming, false, 'a failed retry should still clear streaming state')

// 3. When there is nothing to strip, say() is not retried: the same input would fail identically.
resetState()
state.sayFailQueue = [true]
let noSymbolCalls = 0
let noSymbolError: unknown
tts.stream('こんにちは', undefined, (error) => {
  noSymbolCalls += 1
  noSymbolError = error
})
equal(state.says.length, 1, 'a failure with no removable symbols should not be retried')
equal(noSymbolCalls, 1, 'a non-retried failure should still invoke the completion callback once')
equal(
  (noSymbolError as Error)?.message,
  'stub say failure #0',
  'a non-retried failure should report the original error',
)
equal(tts.streaming, false, 'a non-retried failure should still clear streaming state')

// 4. The koe() path never retries, even on failure: it is raw singing notation, not text.
resetState()
state.koeFailQueue = [true]
let koeFailedCalls = 0
let koeFailedError: unknown
tts.streamKoe('#C4,500ki#D4,500ra', undefined, (error) => {
  koeFailedCalls += 1
  koeFailedError = error
})
equal(state.koes.length, 1, 'a koe() failure should not be retried')
equal(state.says.length, 0, 'a koe() failure should never fall through to the say() text path')
equal(koeFailedCalls, 1, 'a failed koe() should still invoke the completion callback once')
equal((koeFailedError as Error)?.message, 'stub koe failure #0', 'a failed koe() should report its own error')
equal(tts.streaming, false, 'a failed koe() should still clear streaming state')

trace('ok\n')
