export type CloseHandler = () => void | Promise<void>

export class OwnedResources {
  #handlers: CloseHandler[]
  #closePromise: Promise<void> | undefined

  constructor(handlers: ReadonlyArray<CloseHandler> = []) {
    this.#handlers = [...handlers]
  }

  close(): Promise<void> {
    if (!this.#closePromise) this.#closePromise = this.#closeAll()
    return this.#closePromise
  }

  add(handler: CloseHandler): void {
    if (this.#closePromise) throw new Error('resources already closed')
    this.#handlers.push(handler)
  }

  async #closeAll(): Promise<void> {
    let firstError: unknown
    let hasError = false
    for (const handler of this.#handlers) {
      try {
        await handler()
      } catch (error) {
        if (!hasError) {
          firstError = error
          hasError = true
        }
      }
    }
    this.#handlers.length = 0
    if (hasError) throw firstError
  }
}
