import { z } from "zod"

export type Credentials = {
  clientId: string
  clientSecret: string
  refreshToken: string
}

const Token = z.object({ access_token: z.string() })

// Google refresh tokens don't rotate, so the one from setup lasts until revoked.
export const authorize = async ({
  clientId,
  clientSecret,
  refreshToken,
}: Credentials) => {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok)
    throw new Error(`Google token refresh responded ${response.status}`)
  return Token.parse(await response.json()).access_token
}
