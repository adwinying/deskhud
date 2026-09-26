import { expect, test } from "bun:test"
import { parseEnv } from "@/env"

const ha = { HA_URL: "http://homeassistant.lan:8123", HA_TOKEN: "token" }

test("unset groups leave their feature off", () => {
  expect(parseEnv({})).toEqual({ port: 3000, ha: undefined, ssh: undefined })
})

test("complete groups parse", () => {
  expect(parseEnv({ PORT: "8080", ...ha })).toMatchObject({ port: 8080, ha })
})

test("partial groups fail", () => {
  expect(() => parseEnv({ HA_URL: ha.HA_URL })).toThrow()
  expect(() => parseEnv({ SSH_KEY: "/secrets/ssh/id_ed25519" })).toThrow()
})
