/** Host-internal, temporary suppression. Persistent Companion settings stay untouched. */
// xsl can preload this module into the read-only archive. Allocate mutable
// bookkeeping only at runtime, when the first suppression handle is acquired.
let owners: WeakMap<object, Set<object>> | undefined

export function suppressCompanionIdle(context: object): () => void {
  owners ??= new WeakMap<object, Set<object>>()
  const runtimeOwners = owners
  const handles = runtimeOwners.get(context) ?? new Set<object>()
  const handle = {}
  handles.add(handle)
  runtimeOwners.set(context, handles)
  let released = false
  return () => {
    if (released) return
    released = true
    handles.delete(handle)
    if (handles.size === 0) runtimeOwners.delete(context)
  }
}

export function isCompanionIdleSuppressed(context: object): boolean {
  return (owners?.get(context)?.size ?? 0) > 0
}
