const digits = ['ぜろ', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう']
const days: Record<number, string> = {
  1: 'ついたち',
  2: 'ふつか',
  3: 'みっか',
  4: 'よっか',
  5: 'いつか',
  6: 'むいか',
  7: 'なのか',
  8: 'ようか',
  9: 'ここのか',
  10: 'とおか',
  14: 'じゅうよっか',
  20: 'はつか',
  24: 'にじゅうよっか',
}

function integerReading(source: string): string {
  // Keep leading-zero identifiers and arbitrarily large numbers digit-for-digit.
  if (source.length > 12 || (source.length > 1 && source[0] === '0')) {
    return Array.from(source, (digit) => digits[Number(digit)]).join('')
  }
  const value = Number(source)
  if (!value) return digits[0]
  if (value >= 10000) {
    const unit = value >= 100000000 ? 100000000 : 10000
    const rest = value % unit
    return (
      integerReading(String(Math.floor(value / unit))) +
      (unit === 10000 ? 'まん' : 'おく') +
      (rest ? integerReading(String(rest)) : '')
    )
  }
  let result = ''
  const thousands = Math.floor(value / 1000)
  const hundreds = Math.floor(value / 100) % 10
  const tens = Math.floor(value / 10) % 10
  const ones = value % 10
  if (thousands)
    result +=
      thousands === 3 ? 'さんぜん' : thousands === 8 ? 'はっせん' : (thousands === 1 ? '' : digits[thousands]) + 'せん'
  if (hundreds)
    result +=
      hundreds === 3
        ? 'さんびゃく'
        : hundreds === 6
          ? 'ろっぴゃく'
          : hundreds === 8
            ? 'はっぴゃく'
            : (hundreds === 1 ? '' : digits[hundreds]) + 'ひゃく'
  if (tens) result += (tens === 1 ? '' : digits[tens]) + 'じゅう'
  if (ones) result += digits[ones]
  return result
}

/** Replaces a trailing occurrence of `from` in `reading` with `to`, otherwise leaves it untouched. */
function replaceTrailing(reading: string, from: string, to: string): string {
  return reading.endsWith(from) ? reading.slice(0, -from.length) + to : reading
}

const semiVoicedRow: Record<string, string> = { は: 'ぱ', ひ: 'ぴ', ふ: 'ぷ', へ: 'ぺ', ほ: 'ぽ' }

/** Applies は-row -> ぱ-row semi-voicing that follows a small つ (っ) onbin, and leaves other rows untouched. */
function onbinBase(base: string): string {
  const first = base[0]
  const voiced = semiVoicedRow[first]
  return voiced ? voiced + base.slice(1) : base
}

const tsuWords = [
  '',
  'ひとつ',
  'ふたつ',
  'みっつ',
  'よっつ',
  'いつつ',
  'むっつ',
  'ななつ',
  'やっつ',
  'ここのつ',
  'とお',
]

function tsuReading(value: number, integer: string): string {
  return value >= 1 && value <= 10 ? tsuWords[value] : integerReading(integer) + 'つ'
}

function ninReading(value: number, integer: string): string {
  if (value === 1) return 'ひとり'
  if (value === 2) return 'ふたり'
  return replaceTrailing(replaceTrailing(integerReading(integer), 'よん', 'よ'), 'なな', 'しち') + 'にん'
}

function funReading(value: number, integer: string): string {
  const last = value % 10
  if (last === 1) return replaceTrailing(integerReading(integer), 'いち', 'いっ') + 'ぷん'
  if (last === 3 || last === 4) return integerReading(integer) + 'ぷん'
  if (last === 6) return replaceTrailing(integerReading(integer), 'ろく', 'ろっ') + 'ぷん'
  if (last === 8) return replaceTrailing(integerReading(integer), 'はち', 'はっ') + 'ぷん'
  if (last === 0 && value >= 10) return replaceTrailing(integerReading(integer), 'じゅう', 'じゅっ') + 'ぷん'
  return integerReading(integer) + 'ふん'
}

type CounterRule = {
  base: string
  /** Trailing digits (1, 6 and/or 8) that trigger small-つ onbin (with は-row semi-voicing where relevant). */
  onbin: number[]
  /** Full replacement for the base when the trailing digit is 3 (rendaku voicing); omitted keeps the plain base. */
  voiced3?: string
  /** Exact value overrides (e.g. 20歳 -> はたち) checked before any digit-based rule. */
  exact?: Record<number, string>
}

const counterRules: Record<string, CounterRule> = {
  本: { base: 'ほん', onbin: [1, 6, 8], voiced3: 'ぼん' },
  匹: { base: 'ひき', onbin: [1, 6, 8], voiced3: 'びき' },
  杯: { base: 'はい', onbin: [1, 6, 8], voiced3: 'ばい' },
  回: { base: 'かい', onbin: [1, 6, 8] },
  階: { base: 'かい', onbin: [1, 6, 8], voiced3: 'がい' },
  個: { base: 'こ', onbin: [1, 6, 8] },
  冊: { base: 'さつ', onbin: [1, 8] },
  歳: { base: 'さい', onbin: [1, 8], exact: { 20: 'はたち' } },
  才: { base: 'さい', onbin: [1, 8], exact: { 20: 'はたち' } },
}

function counterReading(value: number, integer: string, rule: CounterRule): string {
  if (rule.exact && value in rule.exact) return rule.exact[value]
  const last = value % 10
  if (last === 3 && rule.voiced3 !== undefined) return integerReading(integer) + rule.voiced3
  if (rule.onbin.includes(last)) {
    const from = digits[last]
    const to = last === 1 ? 'いっ' : last === 6 ? 'ろっ' : 'はっ'
    return replaceTrailing(integerReading(integer), from, to) + onbinBase(rule.base)
  }
  if (last === 0 && value >= 10)
    return replaceTrailing(integerReading(integer), 'じゅう', 'じゅっ') + onbinBase(rule.base)
  return integerReading(integer) + rule.base
}

/** Sweeping a BMP codepoint table against the bundled dictionary converter found 2286 codepoints that make
 * error 105 fire on any sentence that also contains kanji or katakana. Enumerating dangerous characters
 * cannot keep up with a set that size, so this is a whitelist of characters confirmed *safe* instead:
 * kana, kanji, the Japanese punctuation marks that read naturally, and ASCII printable characters.
 *
 * Four ASCII characters are excluded even though they print fine on their own: `'` `/` `;` `<`. The
 * vendored C converter's text_needs_dictionary() treats any of them as a signal that the caller passed
 * raw phonetic notation directly, which silently disables dictionary lookup for the rest of the sentence
 * and drops any kanji that follows -- without raising error 105. That makes them more dangerous than the
 * codepoints that do raise 105: there is no error to detect and fall back from. Measured example:
 * "今日は晴れです'そうですね" (with a raw apostrophe) converts to "haredesu'soudesune", silently discarding
 * "今日は". Callers must neutralize `'` `/` `;` `<` before they ever reach isSafeStackchanVoiceChar.
 *
 * This is the single definition of "safe" for StackchanVoice text: both the final sweep in
 * prepareStackchanVoiceText and the stripStackchanVoiceSymbols fallback share it below, so the safe set
 * is never duplicated. */
const safeJapanesePunctuation = new Set(['、', '。', '〜', '～'])

function isSafeStackchanVoiceChar(ch: string): boolean {
  const code = ch.codePointAt(0) as number
  if (code >= 0x3040 && code <= 0x309f) return true // hiragana
  if (code >= 0x30a0 && code <= 0x30ff) return true // katakana (includes ー and ・)
  if (code >= 0x4e00 && code <= 0x9fff) return true // kanji
  if (code >= 0x3005 && code <= 0x3007) return true // 々 〆 〇 (word-forming, not punctuation)
  if (code >= 0x20 && code <= 0x7e) return ch !== "'" && ch !== '/' && ch !== ';' && ch !== '<' // ASCII printable
  return safeJapanesePunctuation.has(ch)
}

/** Sweeps every character not confirmed safe (see isSafeStackchanVoiceChar) to a half-width space, never
 * dropping a word or a digit -- only symbols. A valid UTF-16 surrogate pair (e.g. emoji) counts as one
 * character and becomes exactly one space, not two. Shared by prepareStackchanVoiceText's final sweep
 * and the stripStackchanVoiceSymbols fallback so the sweep logic is never duplicated either. */
function sweepUnsafeStackchanVoiceChars(text: string): { text: string; removed: string } {
  let result = ''
  const removed = new Set<string>()
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        removed.add(text[i] + text[i + 1])
        result += ' '
        i++
        continue
      }
    }
    const ch = text[i]
    if (isSafeStackchanVoiceChar(ch)) {
      result += ch
    } else {
      removed.add(ch)
      result += ' '
    }
  }
  return { text: result, removed: Array.from(removed).join('') }
}

// JIS X 0201 half-width katakana (plus its punctuation companions ｡｢｣､･) mapped to full-width, 1:1 by
// index. Half-width katakana carries real words (e.g. ｺﾝﾋﾟｭｰﾀ) -- if left alone it would be wiped out by
// the whitelist sweep below and the word would be lost, so it must be converted before the sweep runs.
const halfWidthKana = '｡｢｣､･ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ'
const fullWidthKana =
  '。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン'

// Half-width kana that gain a voiced (゛ / dakuten) or semi-voiced (゜ / handakuten) full-width form when
// followed by ﾞ (U+FF9E) or ﾟ (U+FF9F).
const voicedHalfWidthKana: Record<string, string> = {
  ｳ: 'ヴ',
  ｶ: 'ガ',
  ｷ: 'ギ',
  ｸ: 'グ',
  ｹ: 'ゲ',
  ｺ: 'ゴ',
  ｻ: 'ザ',
  ｼ: 'ジ',
  ｽ: 'ズ',
  ｾ: 'ゼ',
  ｿ: 'ゾ',
  ﾀ: 'ダ',
  ﾁ: 'ヂ',
  ﾂ: 'ヅ',
  ﾃ: 'デ',
  ﾄ: 'ド',
  ﾊ: 'バ',
  ﾋ: 'ビ',
  ﾌ: 'ブ',
  ﾍ: 'ベ',
  ﾎ: 'ボ',
}
const semiVoicedHalfWidthKana: Record<string, string> = { ﾊ: 'パ', ﾋ: 'ピ', ﾌ: 'プ', ﾍ: 'ペ', ﾎ: 'ポ' }

/** Converts half-width katakana (and its ｡｢｣､･ punctuation companions) to full-width, composing a
 * trailing ﾞ/ﾟ into dakuten/handakuten where the base kana supports it (ｶﾞ -> ガ, ﾊﾟ -> パ). When the
 * combination cannot be composed (e.g. ｱﾞ, which has no voiced form), the base character is kept on its
 * own and the ﾞ/ﾟ is left for the whitelist sweep to turn into a trailing space, so the word survives
 * rather than being silently dropped. ｢ and ｣ map to full-width 「」, which the whitelist sweep below
 * then turns into spaces -- the same single-space-per-character outcome as the existing quote-stripping
 * step, since ｢｣ never make it into the safe set either. */
function toFullWidthKana(text: string): string {
  let result = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const index = halfWidthKana.indexOf(ch)
    if (index === -1) {
      result += ch
      continue
    }
    const next = text[i + 1]
    if (next === 'ﾞ' && voicedHalfWidthKana[ch]) {
      result += voicedHalfWidthKana[ch]
      i++
    } else if (next === 'ﾟ' && semiVoicedHalfWidthKana[ch]) {
      result += semiVoicedHalfWidthKana[ch]
      i++
    } else {
      result += fullWidthKana[index]
    }
  }
  return result
}

/** StackchanVoice text frontend only; never apply to raw koe or other engines.
 * Retain words and unknown symbols (so unsupported content fails explicitly).
 * Calendar days are assumed for N日, except the explicit duration 1日間.
 * This is not a complete Japanese morphological/counter pronunciation engine.
 */
export function prepareStackchanVoiceText(text: string): string {
  const normalized = text
    .replace(/[「」『』“”‘’"]/g, ' ')
    .replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10))
    .replace(/[0-9]{1,3}(?:,[0-9]{3})+(?![0-9])/g, (number) => number.replace(/,/g, ''))
    // Meaningful readings, applied before the whitelist sweep further down so they take effect
    // instead of being reduced to a bare space.
    .replace(/　/g, ' ')
    .replace(/[（）【】〈〉《》〔〕［］｛｝]/g, ' ')
    .replace(/[：；，]/g, '、')
    .replace(/[…‥]/g, '、')
    .replace(/￥([0-9]+)/g, (_match, number) => `${number}円`)
    .replace(/￥/g, ' ')
    .replace(/[%％]/g, 'ぱーせんと')
    .replace(/([0-9])[〜～](?=[0-9])/g, (_match, digit) => `${digit}から`)
  const counted = normalized.replace(
    /([0-9]+)(?:\.([0-9]+))?(日|時間|時|月|つ|人|分|本|匹|杯|回|階|個|冊|歳|才|枚|秒)?/g,
    (_match, integer, fraction, suffix, offset) => {
      const value = Number(integer)
      if (fraction === undefined) {
        if (suffix === '日' && value >= 1 && value <= 31) {
          if (value === 1 && normalized[offset + _match.length] === '間') return 'いちにち'
          return days[value] ?? integerReading(integer) + 'にち'
        }
        if (suffix === '時間') {
          return (value === 4 ? 'よ' : integerReading(integer)) + 'じかん'
        }
        if (suffix === '時' && value <= 24) {
          return (value === 4 ? 'よ' : value === 7 ? 'しち' : value === 9 ? 'く' : integerReading(integer)) + 'じ'
        }
        if (suffix === '月' && value >= 1 && value <= 12) {
          return (value === 4 ? 'し' : value === 7 ? 'しち' : value === 9 ? 'く' : integerReading(integer)) + 'がつ'
        }
        if (suffix === 'つ') return tsuReading(value, integer)
        if (suffix === '人') return ninReading(value, integer)
        if (suffix === '分') {
          // 3分の1 (a fraction) reads as さんぶんのいち, not the counter さんぷん.
          if (normalized[offset + _match.length] === 'の') return integerReading(integer) + 'ぶん'
          return funReading(value, integer)
        }
        if (suffix && suffix in counterRules) return counterReading(value, integer, counterRules[suffix])
        if (suffix === '枚') return integerReading(integer) + 'まい'
        if (suffix === '秒') return integerReading(integer) + 'びょう'
      }
      return (
        integerReading(integer) +
        (fraction === undefined
          ? ''
          : 'てん' + Array.from(fraction as string, (digit) => digits[Number(digit)]).join('')) +
        (suffix ?? '')
      )
    },
  )
  // Half-width katakana carries real words (ｺﾝﾋﾟｭｰﾀ etc); convert it to full-width before the whitelist
  // sweep below removes it and loses the word.
  const withFullWidthKana = toFullWidthKana(counted)
  // ' / ; < are read by the vendored C converter's text_needs_dictionary() as a signal that the caller
  // passed raw phonetic notation directly, which silently disables dictionary lookup and drops any kanji
  // later in the sentence without raising error 105 -- see isSafeStackchanVoiceChar's doc comment.
  // Neutralize all four unconditionally before the whitelist sweep so none can ever reach the converter.
  // ';' reads naturally as a pause, so it becomes 、 like the other pause punctuation above; ' / < become
  // spaces since they have no natural reading.
  const withoutDictionaryEscapes = withFullWidthKana.replace(/;/g, '、').replace(/['/<]/g, ' ')
  // Final whitelist sweep: anything not confirmed safe (isSafeStackchanVoiceChar) becomes a half-width
  // space. This replaces the old per-character blocklist, which could never enumerate the 2286 BMP
  // codepoints confirmed to trigger error 105.
  return sweepUnsafeStackchanVoiceChars(withoutDictionaryEscapes).text
}

/** One-shot fallback for after StackchanVoice fails with error 105: strips every character that is not
 * known to be safe (see isSafeStackchanVoiceChar), replacing each with a half-width space. Never drops
 * words or digits, only symbols. */
export function stripStackchanVoiceSymbols(text: string): { text: string; removed: string } {
  return sweepUnsafeStackchanVoiceChars(text)
}
