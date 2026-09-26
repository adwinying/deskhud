import { z } from "zod"

type Env = Record<string, string | undefined>

const nonEmpty = z.string().min(1)

// All or none: unset leaves the feature off, but a partial group is a typo and fails startup.
const group = <T extends z.ZodObject>(schema: T, env: Env) =>
  Object.keys(schema.shape).some((key) => env[key] !== undefined)
    ? schema.parse(env)
    : undefined

// "label:value,label:value"; labels become Module IDs, so they must be unique.
const accounts = z
  .string()
  .optional()
  .transform((list) => list?.split(",") ?? [])
  .pipe(
    z.array(
      z
        .string()
        .regex(/^[\w-]+:.+$/, "expected label:value")
        .transform((entry) => {
          const colon = entry.indexOf(":")
          return { label: entry.slice(0, colon), value: entry.slice(colon + 1) }
        }),
    ),
  )
  .refine(
    (entries) =>
      new Set(entries.map(({ label }) => label)).size === entries.length,
    "duplicate label",
  )

export const parseEnv = (env: Env) => ({
  port: z.coerce.number().int().positive().default(3000).parse(env.PORT),
  // Workspace light
  ha: group(z.object({ HA_URL: z.url(), HA_TOKEN: nonEmpty }), env),
  // AI usage (ADR 0003): Claude setup-tokens and the Hub's own Codex auth.json paths
  claude: accounts.parse(env.CLAUDE_TOKENS),
  codex: accounts.parse(env.CODEX_AUTHS),
  // Tasks: a TickTick Open API access token
  ticktick: nonEmpty.optional().parse(env.TICKTICK_TOKEN),
  // Sleep: Google Health API OAuth client and refresh token (scripts/google-health-setup.sh)
  googleHealth: group(
    z.object({
      GOOGLE_HEALTH_CLIENT_ID: nonEmpty,
      GOOGLE_HEALTH_CLIENT_SECRET: nonEmpty,
      GOOGLE_HEALTH_REFRESH_TOKEN: nonEmpty,
    }),
    env,
  ),
  // CO2: base URL of the Tasmota device with the SCD40 sensor
  co2: z.url().optional().parse(env.CO2_SENSOR_URL),
  // Tap actions (ADR 0002)
  ssh: group(
    z.object({
      WORKSTATION_SSH: nonEmpty,
      SSH_KEY: nonEmpty,
      SSH_KNOWN_HOSTS: nonEmpty,
    }),
    env,
  ),
})

export const env = parseEnv(process.env)
