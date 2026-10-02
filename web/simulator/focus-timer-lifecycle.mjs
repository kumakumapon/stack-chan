/** Capture visibility before RAF stops; the host consumes the original instant. */
export function installFocusTimerVisibility({
  document,
  runtime,
  idle,
  now = () => performance.now(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let pending
  let disposed = false
  const changed = () => {
    if (disposed || !document.hidden) return
    runtime.state.focusHiddenAt ??= now()
    if (pending !== undefined) clearTimeoutFn(pending)
    // One final scheduler pass while hidden lets the host save its pause even
    // though 3D RAF has stopped. The timestamp also survives until return if
    // the browser freezes before this callback runs.
    pending = setTimeoutFn(() => {
      pending = undefined
      if (!disposed) idle()
    }, 1100)
  }
  document.addEventListener('visibilitychange', changed)
  changed()
  return () => {
    disposed = true
    document.removeEventListener('visibilitychange', changed)
    if (pending !== undefined) clearTimeoutFn(pending)
    delete runtime.state.focusHiddenAt
  }
}
