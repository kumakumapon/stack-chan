/** Host-internal, temporary suppression. Persistent Companion settings stay untouched. */
const owners = new WeakMap<object, Set<object>>()

export function suppressCompanionIdle(context: object): () => void {
  const handles = owners.get(context) ?? new Set<object>()
  const handle = {}
  handles.add(handle)
  owners.set(context, handles)
  let released = false
  return () => {
    if (released) return
    released = true
    handles.delete(handle)
    if (handles.size === 0) owners.delete(context)
  }
}

export function isCompanionIdleSuppressed(context: object): boolean {
  return (owners.get(context)?.size ?? 0) > 0
}
