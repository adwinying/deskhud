import dayjs from "dayjs"
import { CalendarClock } from "lucide-static"
import { z } from "zod"
import { authorize, type Credentials } from "@/google"
import { icon } from "@/icon"
import { defineModule } from "@/module"

const before = 60 * 60_000
const after = 10 * 60_000
const shown = 3

// All-day events carry `start.date` instead and never show.
const Events = z.object({
  // The calendar's title; the account's email for its primary calendar.
  summary: z.string(),
  items: z.array(
    z.object({
      summary: z.string().default("(タイトルなし)"),
      htmlLink: z.url(),
      start: z.object({ dateTime: z.string().optional() }),
      attendees: z
        .array(
          z.object({
            self: z.boolean().optional(),
            responseStatus: z.string(),
          }),
        )
        .default([]),
    }),
  ),
})

export type Event = { title: string; start: number; url: string }

const inWindow = (start: number, now: number) =>
  start - before <= now && now < start + after

type Account = { label: string; refreshToken: string; calendars: string[] }

const listEvents = async (token: string, calendar: string, label: string) => {
  const now = Date.now()
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar)}/events`,
  )
  url.search = new URLSearchParams({
    // timeMin bounds the end time, timeMax the start time.
    timeMin: new Date(now - after).toISOString(),
    timeMax: new Date(now + before).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    eventTypes: "default",
  }).toString()
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    // A hung request would otherwise stall the schedule without ever going Stale.
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok)
    throw new Error(`Google Calendar ${label} responded ${response.status}`)
  return Events.parse(await response.json())
}

const fetchEvents = async (
  credentials: Omit<Credentials, "refreshToken">,
  { label, refreshToken, calendars }: Account,
) => {
  const token = await authorize({ ...credentials, refreshToken })
  const [primary, shared] = await Promise.all([
    listEvents(token, "primary", label),
    Promise.all(
      calendars.map((calendar) => listEvents(token, calendar, label)),
    ),
  ])
  // Only the primary calendar's summary is the account's email.
  const email = primary.summary
  return [primary, ...shared].flatMap(({ items }) =>
    items.flatMap(({ summary, htmlLink, start, attendees }) => {
      const declined = attendees.some(
        ({ self, responseStatus }) => self && responseStatus === "declined",
      )
      if (!start.dateTime || declined) return []
      const link = new URL(htmlLink)
      // Without it, the Workstation's browser opens the event in its default Google account.
      link.searchParams.set("authuser", email)
      return [
        { title: summary, start: Date.parse(start.dateTime), url: link.href },
      ]
    }),
  )
}

const upcoming = (events: Event[], now: number) =>
  events.filter(({ start }) => inWindow(start, now))

export const calendar = (
  credentials: Omit<Credentials, "refreshToken">,
  accounts: Account[],
) =>
  defineModule<Event[]>({
    id: "calendar",
    span: 4,
    // Between the light and the sleep Module.
    priority: 45,
    // Each fetch re-renders, so the countdown and the window stay minute-accurate.
    schedule: { every: 60_000 },
    fetch: async () =>
      (
        await Promise.all(
          accounts.map((account) => fetchEvents(credentials, account)),
        )
      )
        .flat()
        .toSorted((a, b) => a.start - b.start),
    // Re-checked against now, so a Stale list never outlives its window.
    visible: (events, now) => upcoming(events, now.getTime()).length > 0,
    tap: async ({ ssh }, events) => {
      const [first] = upcoming(events, Date.now())
      if (!first) throw new Error("no upcoming event")
      await ssh.open(first.url)
    },
    render: (events) => {
      const list = upcoming(events, Date.now())
      const rest = list.length - shown
      return (
        <div class="flex flex-col gap-2 rounded-xl bg-neutral-900 p-4">
          <p class="flex items-center gap-1 text-sm leading-none text-neutral-400">
            <span class="text-sky-600">{icon(CalendarClock)}</span> 予定
            {rest > 0 && <span class="ml-auto">他{rest}件</span>}
          </p>
          <ul class="font-semibold">
            {list.slice(0, shown).map(({ title, start }) => (
              <li class="flex gap-2">
                <span class="shrink-0 tabular-nums">
                  {dayjs(start).format("H:mm")}
                </span>
                <span class="truncate" safe>
                  {title}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )
    },
  })
