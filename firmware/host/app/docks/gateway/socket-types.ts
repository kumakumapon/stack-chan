export type GatewaySocket = {
  /** false means not accepted yet; the connection remains usable. */
  // biome-ignore lint/suspicious/noConfusingVoidType: Existing platform adapters return void on acceptance.
  write(data: string, audioInput?: boolean): boolean | void
  clearPendingAudio?(): void
  close(): void
}

export type GatewaySocketOptions = {
  secure: boolean
  host: string
  port: number
  path: string
  headers?: [string, string][]
  onReady(): void
  onMessage(message: string): void
  onClosed(reason?: string): void
}

export type GatewaySocketFactory = (options: GatewaySocketOptions) => GatewaySocket
