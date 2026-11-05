import { getLocalizationLanguage } from 'localization'
import { formatPlayText, type PlayTextValues } from 'play-pack-strings'

/** Play pack message in the host's current UI language. */
export function playText(key: string, values?: PlayTextValues): string {
  return formatPlayText(getLocalizationLanguage(), key, values)
}
