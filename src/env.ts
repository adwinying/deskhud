import { z } from "zod"

type Env = Record<string, string | undefined>

const nonEmpty = z.string().min(1)

// All or none: unset leaves the feature off, but a partial group is a typo and fails startup.
const group = <T extends z.ZodObject>(schema: T, env: Env) =>
  Object.keys(schema.shape).some((key) => env[key] !== undefined)
    ? schema.parse(env)
    : undefined

export const parseEnv = (env: Env) => ({
  port: z.coerce.number().int().positive().default(3000).parse(env.PORT),
  // Workspace light
  ha: group(z.object({ HA_URL: z.url(), HA_TOKEN: nonEmpty }), env),
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
