export type AppBehaviorModules = {
  has(specifier: string): boolean
  importNow(specifier: string): unknown
}

type ContextCreatedBehavior = {
  appendDefaultContextCreated?: boolean
  onContextCreated?: (context: unknown, option: unknown) => Promise<void> | void
}

export function resolveAppBehaviors<TBehavior extends ContextCreatedBehavior>(
  modules: AppBehaviorModules,
  defaultBehavior: TBehavior,
  onImportError?: (error: unknown) => void,
): TBehavior[] {
  if (modules.has('mod')) {
    try {
      return [mergeDefinedBehavior(defaultBehavior, modules.importNow('mod') as Partial<TBehavior>)]
    } catch (error) {
      onImportError?.(error)
    }
  }
  return [defaultBehavior]
}

function mergeDefinedBehavior<TBehavior extends ContextCreatedBehavior>(
  defaultBehavior: TBehavior,
  modBehavior: Partial<TBehavior>,
): TBehavior {
  const behavior = { ...defaultBehavior }
  for (const key of Object.keys(modBehavior) as Array<keyof TBehavior>) {
    const value = modBehavior[key]
    if (value !== undefined) {
      behavior[key] = value
    }
  }
  const defaultContextCreated = defaultBehavior.onContextCreated
  const modContextCreated = modBehavior.onContextCreated
  if (modBehavior.appendDefaultContextCreated && defaultContextCreated && modContextCreated) {
    behavior.onContextCreated = async (...args) => {
      await defaultContextCreated(...args)
      await modContextCreated(...args)
    }
  }
  return behavior
}
