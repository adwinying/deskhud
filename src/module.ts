export type Effects = {
  ssh: { open: (url: string) => Promise<void> }
  ha: {
    callService: (
      domain: string,
      service: string,
      data: Record<string, unknown>,
    ) => Promise<void>
  }
}

// Method syntax keeps `render` bivariant, so any Module<T> fits in Module<unknown>[].
export type Module<T> = {
  id: string
  span: 1 | 2 | 3 | 4
  /** Higher comes first. */
  priority: number
  schedule: { every: number }
  fetch(): T | Promise<T>
  visible?(data: T, now: Date): boolean
  effectivePriority?(data: T): number
  render(data: T): JSX.Element
  tap?(effects: Effects): Promise<void>
}

export const defineModule = <T>(module: Module<T>) => module
