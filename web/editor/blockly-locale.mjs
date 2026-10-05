import * as English from 'blockly/msg/en'
import * as Japanese from 'blockly/msg/ja'

const MESSAGE_CATALOGS = Object.freeze({
  ja: Japanese,
  en: English,
})

export function blocklyMessagesFor(locale) {
  return MESSAGE_CATALOGS[locale] ?? MESSAGE_CATALOGS.ja
}

export function loadBlocklyMessages(locale, Blockly = globalThis.Blockly) {
  Blockly?.setLocale?.(blocklyMessagesFor(locale))
  return Promise.resolve()
}
