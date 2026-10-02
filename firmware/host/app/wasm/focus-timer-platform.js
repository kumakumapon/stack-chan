// Browser visibility events and the firmware deadline must share one clock domain.
const readNow = native('xs_stackchan_focus_now')
const readHiddenAt = native('xs_stackchan_focus_hidden_at')

export function now() {
  return readNow()
}

export function takeHiddenAt() {
  const at = readHiddenAt()
  return at < 0 ? undefined : at
}
