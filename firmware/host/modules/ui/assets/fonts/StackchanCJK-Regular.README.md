# StackchanCJK-Regular.ttf

This is a build-time subset of Noto Sans CJK SC 2.004 Regular. It contains printable ASCII plus the glyphs used by the Japanese, English, and Simplified Chinese firmware catalogs.

- Source: <https://github.com/notofonts/noto-cjk/blob/Sans2.004/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf>
- Source SHA-256: `d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964`
- Transformation: instantiate `wght=400`, then subset to printable ASCII and all values in `host/app/strings/{ja,en,zh-CN}.json`
- Copyright: © 2014-2021 Adobe (<http://www.adobe.com/>), with Reserved Font Name “Source”
- License: SIL Open Font License 1.1; see `StackchanCJK-Regular.LICENSE.txt`

The manifest publishes the bitmap resource as `StackchanCJK-12`; the source font's internal family metadata remains `Noto Sans SC`.

The firmware uses this font only for Simplified Chinese. Its bitmap resources include Basic Latin and characters from `host/app/strings/zh-CN.json` (read directly as a UTF-8 character file), rather than the union of all locales. Japanese uses `k8x12-12`; excluding Japanese-only glyphs from the Chinese bitmap avoids duplicating them in the small M5Stack factory partition. The source TTF retains the full catalog subset above.
