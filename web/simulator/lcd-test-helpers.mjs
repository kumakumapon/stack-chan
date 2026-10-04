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
