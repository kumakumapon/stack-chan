// Deliver distinct frames so Piu processes moves before the release event.
export async function dragLcd(page, fromY, toY, clock = true) {
  const send = async (type, y) => {
    await page.locator('canvas[aria-hidden="true"]').evaluate(
      (canvas, { type, y }) => {
        const bounds = canvas.getBoundingClientRect()
        canvas.dispatchEvent(
          new MouseEvent(type, {
            clientX: bounds.left + 140,
            clientY: bounds.top + y,
            bubbles: true,
          })
        )
      },
      { type, y }
    )
    if (clock) await page.clock.runFor(30)
    else await page.waitForTimeout(30)
  }
  await send('mousedown', fromY)
  for (let step = 1; step <= 10; step++) await send('mousemove', fromY + ((toY - fromY) * step) / 10)
  await send('mouseup', toY)
}

// Host Mini Apps in launcher order. XS sorts titles by code point, so the
// Japanese titles order as: 3問クイズ, おみくじ, じゃんけん, はやおし, メモリー,
// リズムまねっこ, 暮らし工房, 生活クエスト, 集中タイマー. The Pet MOD's
// "PET STATUS" sorts right after the quiz, and the minigames sample's half-width
// kana titles (ｽﾀｯｸﾁｬﾝ CATCH / JUMP) sort after every host app. Keep this the only copy of the order.
const HOST_LAUNCHER_ORDER = [
  'quiz',
  'fortune',
  'janken',
  'quick-tap',
  'memory',
  'rhythm',
  'workshop',
  'quest',
  'focus',
  'catch',
  'jump',
]

export function launcherRow(app, pet = false) {
  const index = HOST_LAUNCHER_ORDER.indexOf(app)
  if (index < 0) throw new Error(`unknown launcher app: ${app}`)
  return pet && index > 0 ? index + 1 : index
}

// Tap a row of the open Mini App launcher. Rows are 44 px tall from y=52
// (44 px AppBar + 8 px inset); four fit without scrolling. The launcher
// scrolls exactly by the drag distance, clamped at the end, so scroll just
// enough to bring the row into the fourth slot (y=206), dragging in steps
// that stay on the screen.
export async function tapLauncherRow(page, tap, row, clock = true) {
  for (let remaining = Math.max(0, row - 3) * 44; remaining > 0; remaining -= 132) {
    await dragLcd(page, 215, 215 - Math.min(132, remaining), clock)
  }
  await tap(140, 74 + Math.min(row, 3) * 44)
}
