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

/** Known-safe characters for the post-error-105 fallback: kana, kanji, ASCII alphanumerics/space and
 * punctuation confirmed safe by measurement. Anything else (including astral-plane characters) is stripped. */
const safePunctuation = new Set([
  '、',
  '。',
  '！',
  '？',
  '・',
  'ー',
  '〜',
  '～',
  '(',
  ')',
  '!',
  '?',
  ':',
  ';',
  '#',
  '*',
  '/',
  '\\',
  '[',
  ']',
  '{',
  '}',
  '|',
  '+',
  '=',
  '_',
  '@',
  ',',
  '.',
  '$',
  '%',
  ' ',
])

function isSafeStackchanVoiceChar(ch: string): boolean {
  const code = ch.codePointAt(0) as number
  if (code >= 0x3040 && code <= 0x309f) return true // hiragana
  if (code >= 0x30a0 && code <= 0x30ff) return true // katakana
  if (code >= 0x4e00 && code <= 0x9fff) return true // kanji
  if (ch === '々' || ch === '〆' || ch === '〇') return true
  if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) return true // ASCII alnum
  return safePunctuation.has(ch)
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
    // Currency/symbol normalization: characters confirmed to trigger error 105 in the bundled dictionary
    // converter when a sentence also contains kanji or katakana.
    .replace(/　/g, ' ')
    .replace(/[（）【】〈〉《》〔〕［］｛｝｢｣]/g, ' ')
    .replace(/[：；，]/g, '、')
    .replace(/[…‥]/g, '、')
    .replace(/[—–―]/g, ' ') // U+2014, U+2013, U+2015 dashes only; never ー (U+30FC)
    .replace(/[※＊＃＿｜＼＜＞＂]/g, ' ')
    .replace(/[♪★☆♡♥♠♣♦♂♀☺☀☂■□▲△▼▽◆◇●◎•✓✔✗§¶†‡′″⇒⇔∀√∞≒≠≦≧±°→←↑↓]/g, ' ')
    .replace(/｡/g, '。')
    .replace(/､/g, '、')
    .replace(/ｰ/g, 'ー')
    // Surrogate pairs (astral-plane characters such as emoji). No /u flag or \u{...} escapes: XS compatibility.
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ' ')
    .replace(/￥([0-9]+)/g, (_match, number) => `${number}円`)
    .replace(/￥/g, ' ')
    .replace(/[%％]/g, 'ぱーせんと')
    .replace(/([0-9])[〜～](?=[0-9])/g, (_match, digit) => `${digit}から`)
  return normalized.replace(
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
}

/** One-shot fallback for after StackchanVoice fails with error 105: strips every character that is not
 * known to be safe (kana, kanji, ASCII alphanumerics/space, and punctuation confirmed safe by measurement),
 * replacing each with a half-width space. Never drops words or digits, only symbols. */
export function stripStackchanVoiceSymbols(text: string): { text: string; removed: string } {
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
