import { expect, test } from "bun:test"
import { parseEnv } from "@/env"

const ha = { HA_URL: "http://homeassistant.lan:8123", HA_TOKEN: "token" }

test("unset groups leave their feature off", () => {
  expect(parseEnv({})).toEqual({
    port: 3000,
    ha: undefined,
    claude: [],
    codex: [],
    ssh: undefined,
  })
})

test("complete groups parse", () => {
  expect(parseEnv({ PORT: "8080", ...ha })).toMatchObject({ port: 8080, ha })
})

test("partial groups fail", () => {
  expect(() => parseEnv({ HA_URL: ha.HA_URL })).toThrow()
  expect(() => parseEnv({ SSH_KEY: "/secrets/ssh/id_ed25519" })).toThrow()
})

test("account lists parse into labelled entries", () => {
  expect(
    parseEnv({
      CLAUDE_TOKENS: "personal:sk-ant-oat01-a,work:sk-ant-oat01-b",
      CODEX_AUTHS: "personal:/secrets/codex/personal/auth.json",
    }),
  ).toMatchObject({
    claude: [
      { label: "personal", value: "sk-ant-oat01-a" },
      { label: "work", value: "sk-ant-oat01-b" },
    ],
    codex: [{ label: "personal", value: "/secrets/codex/personal/auth.json" }],
  })
  expect(() => parseEnv({ CLAUDE_TOKENS: "sk-ant-oat01-a" })).toThrow()
  expect(() => parseEnv({ CODEX_AUTHS: "a:/x,a:/y" })).toThrow()
})
