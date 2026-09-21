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
  return normalized.replace(/([0-9]+)(?:\.([0-9]+))?(日|時|月)?/g, (_match, integer, fraction, suffix, offset) => {
    const value = Number(integer)
    if (fraction === undefined) {
      if (suffix === '日' && value >= 1 && value <= 31) {
        if (value === 1 && normalized[offset + integer.length + 1] === '間') return 'いちにち'
        return days[value] ?? integerReading(integer) + 'にち'
      }
      if (suffix === '時' && value <= 24) {
        return (value === 4 ? 'よ' : value === 7 ? 'しち' : value === 9 ? 'く' : integerReading(integer)) + 'じ'
      }
      if (suffix === '月' && value >= 1 && value <= 12) {
        return (value === 4 ? 'し' : value === 7 ? 'しち' : value === 9 ? 'く' : integerReading(integer)) + 'がつ'
      }
    }
    return (
      integerReading(integer) +
      (fraction === undefined
        ? ''
        : 'てん' + Array.from(fraction as string, (digit) => digits[Number(digit)]).join('')) +
      (suffix ?? '')
    )
  })
}
