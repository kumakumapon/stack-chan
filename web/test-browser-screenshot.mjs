// Chromium can lose its compositor surface during a navigation or resize.
// Retry only that capture error, at most three times, keeping the screenshot
// options and all callers' layout/runtime assertions intact.
export async function captureScreenshot(page, options) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await page.screenshot(options)
    } catch (error) {
      if (
        attempt >= 3 ||
        !(error instanceof Error) ||
        !error.message.includes('Protocol error (Page.captureScreenshot): Unable to capture screenshot')
      ) {
        throw error
      }
      console.warn(`[screenshot] retry ${attempt + 1}/3 for ${options.path ?? '<buffer>'}`)
      await page.waitForTimeout(100)
    }
  }
}
