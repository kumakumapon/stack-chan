import en from '../../../locales/en.json'
import ja from '../../../locales/ja.json'

export const SUPPORTED_LOCALES = ['ja', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export type Catalog = Record<string, string>

export const catalogs: Record<Locale, Catalog> = {
  ja,
  en,
}
