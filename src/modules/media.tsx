import { Music, Pause, Play, SkipBack, SkipForward } from "lucide-static"
import { z } from "zod"
import { icon } from "@/icon"
import { defineModule } from "@/module"

// A `media-control stream --micros` payload. Every key may be missing.
const Media = z.object({
  title: z.string().nullish(),
  artist: z.string().nullish(),
  playing: z.boolean().nullish(),
  playbackRate: z.number().nullish(),
  elapsedTimeMicros: z.number().nullish(),
  // Absent for live streams, whose duration is infinite.
  durationMicros: z.number().nullish(),
  timestampEpochMicros: z.number().nullish(),
  artworkData: z.string().nullish(),
  artworkMimeType: z.string().nullish(),
})
export type Media = z.infer<typeof Media>

// The first event carries the full payload, later ones only the changed keys.
const Event = z.object({ diff: z.boolean(), payload: Media })

export const apply = (media: Media, line: string): Media => {
  const { diff, payload } = Event.parse(JSON.parse(line))
  return diff ? { ...media, ...payload } : payload
}

// Like the iOS lock screen, a paused player lingers a while for resuming.
const pausedFor = 5 * 60_000

export const active = (media: Media, now: number) =>
  !!media.title &&
  (!!media.playing ||
    now - (media.timestampEpochMicros ?? 0) / 1000 < pausedFor)

const commands = ["toggle", "previous", "next"] as const

const filled = (svg: string) =>
  icon(svg).replace('fill="none"', 'fill="currentColor"')

const clock = (seconds: string) =>
  `Math.floor(${seconds} / 60) + ':' + String(Math.floor(${seconds} % 60)).padStart(2, '0')`

// Advanced on the Kiosk every second, so a playing track needs no Hub updates.
const Progress = ({ media }: { media: Media }) => {
  if (!media.durationMicros) return ""
  const duration = media.durationMicros / 1e6
  const elapsed = (media.elapsedTimeMicros ?? 0) / 1e6
  const at = (media.timestampEpochMicros ?? 0) / 1000
  const rate = media.playing ? (media.playbackRate ?? 1) : 0
  const position = `Math.min(${duration}, Math.max(0, ${elapsed} + ($mediaNow - ${at}) / 1000 * ${rate}))`
  return (
    <div
      class="flex flex-col gap-1"
      data-signals:media-now="Date.now()"
      data-on-interval="$mediaNow = Date.now()"
    >
      <div class="h-1.5 overflow-hidden rounded-full bg-neutral-700">
        <div
          class="h-full bg-neutral-100"
          data-style:width={`${position} / ${duration} * 100 + '%'`}
        />
      </div>
      <p class="flex justify-between text-xs text-neutral-400 tabular-nums">
        <span data-text={clock(position)} />
        <span data-text={`'-' + ${clock(`(${duration} - ${position})`)}`} />
      </p>
    </div>
  )
}

export const media = defineModule<Media>({
  id: "media",
  span: 4,
  // Between the calendar and the sleep Module.
  priority: 44.5,
  subscribe: ({ ssh }, source) => {
    let media: Media = {}
    ssh.watchMedia({
      next: (line) => source.next((media = apply(media, line))),
      fail: (error) => source.fail(error),
    })
  },
  visible: (media, now) => active(media, now.getTime()),
  // Tapping anywhere but the skip buttons toggles playback.
  tap: ({ ssh }, _, action = "toggle") => {
    const command = commands.find((command) => command === action)
    if (!command) throw new Error(`unknown media action: ${action}`)
    return ssh.media(command)
  },
  render: (media) => {
    const artwork =
      media.artworkData &&
      `data:${media.artworkMimeType};base64,${media.artworkData}`
    return (
      <div class="flex flex-col gap-3 rounded-xl bg-neutral-900 p-4">
        <div class="flex items-center gap-3">
          {artwork ? (
            <img
              src={artwork}
              alt=""
              class="size-14 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <p class="flex size-14 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-2xl text-neutral-400">
              {icon(Music)}
            </p>
          )}
          <div class="min-w-0">
            <p class="truncate text-xl font-semibold" safe>
              {media.title}
            </p>
            <p class="truncate text-neutral-400" safe>
              {media.artist}
            </p>
          </div>
        </div>
        <Progress media={media} />
        <div class="flex items-center justify-around text-3xl">
          <button
            aria-label="前へ"
            data-on:click__stop="@post('/tap/media/previous')"
          >
            {filled(SkipBack)}
          </button>
          <p class="text-4xl">{filled(media.playing ? Pause : Play)}</p>
          <button
            aria-label="次へ"
            data-on:click__stop="@post('/tap/media/next')"
          >
            {filled(SkipForward)}
          </button>
        </div>
      </div>
    )
  },
})
