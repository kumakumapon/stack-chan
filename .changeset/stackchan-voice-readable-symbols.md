---
"stack-chan": patch
---

Fix StackchanVoice replies that stopped mid-sentence or silently dropped
words. Measured against the vendored converter and its bundled dictionary,
a sentence containing kanji or katakana failed conversion outright (error
105) when it also contained any of a large set of common symbols (`…`,
full-width brackets, `♪`, emoji, and others), and four ASCII characters
(`'`, `/`, `;`, `<`) silently dropped the kanji before them instead of
erroring. Normalize by whitelisting characters known to convert cleanly
instead of enumerating the bad ones, and convert half-width katakana to
full width first so the whitelist sweep cannot take a word with it. Words
and numbers are never removed. Also read common counters (つ, 人, 分, 本,
匹, 杯, 回, 階, 個, 冊, 歳/才, 枚, 秒, 時間) together with their number,
including sound changes, instead of leaving the counter kanji to the
dictionary (e.g. 1人 read いちひと instead of ひとり).
