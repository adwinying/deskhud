import { z } from "zod"
import { defineModule } from "@/module"

// Yahoo!路線情報 diainfo IDs, from https://transit.yahoo.co.jp/diainfo/area/4
const lines = {
  半蔵門線: 138,
  都営浅草線: 128,
  京成押上線: 98,
  東武スカイツリーライン: 77,
  総武線各停: 40,
  総武線快速: 61,
}

const Notice = z.object({
  status: z.string().trim().min(1),
  message: z.string(),
  normal: z.boolean(),
})

// #mdServiceStatus holds dt (status) / dd (message) pairs; dd.normal marks 平常運転.
const parse = (html: string) => {
  const notices: z.input<typeof Notice>[] = []
  const current = () => notices.at(-1)
  new HTMLRewriter()
    .on("#mdServiceStatus dt", {
      element: () =>
        void notices.push({ status: "", message: "", normal: false }),
      text: (chunk) => {
        const notice = current()
        if (notice) notice.status += chunk.text
      },
    })
    .on("#mdServiceStatus dd", {
      element: (dd) => {
        const notice = current()
        if (notice) notice.normal = dd.getAttribute("class") === "normal"
      },
    })
    .on("#mdServiceStatus dd p", {
      text: (chunk) => {
        const notice = current()
        if (notice) notice.message += chunk.text
      },
    })
    .transform(html)
  return notices
}

const url = (id: number) => `https://transit.yahoo.co.jp/diainfo/${id}/0`

// Throws on any markup surprise so the Module goes Stale instead of hiding a delay.
const scrape = async (line: string, id: number) => {
  const response = await fetch(url(id), {
    // A hung request would otherwise stall the schedule without ever going Stale.
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok)
    throw new Error(`Yahoo!路線情報 responded ${response.status} for ${line}`)
  const notices = z
    .array(Notice)
    .min(1)
    .safeParse(parse(await response.text()))
  if (!notices.success)
    throw new Error(`unexpected Yahoo!路線情報 markup for ${line}`, {
      cause: notices.error,
    })

  return notices.data
    .filter(({ normal }) => !normal)
    .map(({ status, message }) => ({
      id,
      line,
      status,
      // Drops the trailing "（9月26日 16時30分掲載）".
      message: message.replace(/（[^（]*掲載）$/, "").trim(),
    }))
}

export const trains = defineModule({
  id: "trains",
  span: 4,
  priority: 30,
  schedule: { every: 2 * 60_000 },
  fetch: async () =>
    (
      await Promise.all(
        Object.entries(lines).map(([line, id]) => scrape(line, id)),
      )
    ).flat(),
  visible: (disruptions) => disruptions.length > 0,
  effectivePriority: (disruptions) => (disruptions.length ? 100 : 30),
  // The action is a diainfo ID; only IDs from `lines` are opened. Tapping outside an entry opens the first.
  tap: ({ ssh }, disruptions, action) => {
    const id = action
      ? Object.values(lines).find((id) => String(id) === action)
      : disruptions[0]?.id
    if (!id) throw new Error(`unknown trains action: ${action}`)
    return ssh.open(url(id))
  },
  render: (disruptions) => (
    <ul class="flex flex-col gap-3 rounded-xl bg-neutral-900 p-4">
      {disruptions.map(({ id, line, status, message }) => (
        <li data-on:click__stop={`@post('/tap/trains/${id}')`}>
          <p class="flex items-baseline gap-2">
            <span class="font-semibold">{line}</span>
            <span class="rounded bg-amber-400 px-1 text-sm text-black">
              {status}
            </span>
          </p>
          <p class="text-sm text-neutral-400">{message}</p>
        </li>
      ))}
    </ul>
  ),
})
