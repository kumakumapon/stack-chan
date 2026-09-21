# Text conversion reproduction

The XS test checks the device adapter (including that raw koe bypasses text
preparation). `text-conversion-probe.c` additionally runs the vendored C converter
against the real bundled dictionary, without hardware or a fake synthesizer.

From `firmware/`, with a C compiler installed:

```sh
cc -Ivendor/stackchan-voice/include host/modules/audio/__tests__/stackchan-voice-device/text-conversion-probe.c vendor/stackchan-voice/src/aqk2r_compat.c -o dist/text-conversion-probe
dist/text-conversion-probe vendor/stackchan-voice/data/stackchan-ja.aqd
```

On Windows, use an x64 Visual Studio Developer shell and `cl /utf-8` with the same
source files, `/Ivendor/stackchan-voice/include`, `/Fedist/text-conversion-probe.exe`
and `/Fodist/`. The output directory must already exist. Generated files stay in
ignored `dist/`.

Observed with the bundled dictionary: `明日は１４日に行ってください` succeeds but
reads the day digit-by-digit; ASCII `14` is skipped. Japanese corner quotes or an
emoji around that mixed-kanji sentence reproduce error 105. Preparing the day as
`じゅうよっか` and quotes as spaces preserves the words and converts successfully.
This reproduces possible causes, not proof of the exact device reply that failed.

The number helper handles common calendar days, months, hours and plain numeric
values. It is not a morphological analyzer: ambiguous dates/durations and other
counters can require context-specific readings. Unsupported symbols are retained
and may still fail explicitly. Do not silently discard them or the reply's words.
