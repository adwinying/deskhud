export type Effects = {
  ssh: {
    open: (url: string) => Promise<void>
    /** Launches or focuses an app the forced command allows. */
    activate: (app: "t3code") => Promise<void>
    /** Sends a playback command to the Workstation's Now Playing app. */
    media: (command: "toggle" | "previous" | "next") => Promise<void>
    /** Streams `media-control stream` lines, reconnecting after each `fail`. */
    watchMedia: (source: PushSource<string>) => void
  }
  ha: {
    /** Resolves once HA reports the target entity's state changed. */
    callService: (
      domain: string,
      service: string,
      data: { entity_id: string },
    ) => Promise<void>
    watch: (entityId: string, source: PushSource<string>) => void
  }
}

/** `next` on every reading, `fail` whenever the Source goes down. */
export type PushSource<T> = { next(data: T): void; fail(error: unknown): void }

// Method syntax keeps `render` bivariant, so any Module<T> fits in Module<unknown>[].
export type Module<T> = {
  id: string
  span: 1 | 2 | 3 | 4
  /** Higher comes first. */
  priority: number
  visible?(data: T, now: Date): boolean
  effectivePriority?(data: T, now: Date): number
  render(data: T): JSX.Element
  /** `action` names the button tapped inside the Module, if any. */
  tap?(effects: Effects, data: T, action?: string): Promise<void>
} & (
  | { schedule: { every: number }; fetch(): T | Promise<T> }
  | { subscribe(effects: Effects, source: PushSource<T>): void }
)

export const defineModule = <T>(module: Module<T>) => module
