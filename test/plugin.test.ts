import { describe, expect, test } from "bun:test"
import { bodyForEffort, DEFAULT_CONFIG, foldEfforts, parseEffortCatalog, resolveConfig, toTargetProvider } from "../src"

const payload = {
  data: [
    { id: "gpt", meta: { llamaswap: { reasoning_efforts: ["low", "high"], aliases: ["gpt:low", "gpt:high", "gpt:bg"] } } },
    { id: "gpt:low", meta: { llamaswap: { reasoning_efforts: ["low", "high"], aliases: ["gpt:low"] } } },
    { id: "gpt:bg", meta: { llamaswap: { reasoning_efforts: ["low", "high"] } } },
    { id: "plain" },
  ],
}

describe("resolveConfig", () => {
  test("defaults", () => expect(resolveConfig(undefined)).toEqual(DEFAULT_CONFIG))
  test("overrides and malformed values", () => {
    const config = resolveConfig({ providers: ["a", 1], metadataKey: "", hideAliases: false, timeoutMs: -1, separator: "-", models: { x: ["low", 2], y: false, z: 3 } })
    expect(config.providers).toEqual(["a"])
    expect(config.metadataKey).toBe("reasoning_efforts")
    expect(config.hideAliases).toBe(false)
    expect(config.timeoutMs).toBe(5000)
    expect(config.separator).toBe("-")
    expect(config.models).toEqual({ x: ["low"], y: false })
  })
})

describe("bodyForEffort", () => {
  test("nested", () => expect(bodyForEffort("chat_template_kwargs.reasoning_effort", "low")).toEqual({ chat_template_kwargs: { reasoning_effort: "low" } }))
  test("top level", () => expect(bodyForEffort("reasoning_effort", "low")).toEqual({ reasoning_effort: "low" }))
})

describe("parseEffortCatalog", () => {
  test("keeps base models only", () => {
    const catalog = parseEffortCatalog(payload, DEFAULT_CONFIG)
    expect([...catalog.keys()]).toEqual(["gpt"])
    expect(catalog.get("gpt")?.efforts).toEqual(["low", "high"])
  })
  test("custom metadata key", () => {
    const data = { data: [{ id: "m", meta: { llamaswap: { efforts: ["x"] } } }] }
    expect([...parseEffortCatalog(data, { ...DEFAULT_CONFIG, metadataKey: "efforts" }).keys()]).toEqual(["m"])
  })
  test("static models override metadata and false disables", () => {
    const config = { ...DEFAULT_CONFIG, models: { gpt: false, plain: ["low"] } as const }
    expect([...parseEffortCatalog(payload, config).keys()]).toEqual(["plain"])
  })
  test("garbage payload", () => expect(parseEffortCatalog(null, DEFAULT_CONFIG).size).toBe(0))
})

describe("foldEfforts", () => {
  const catalog = parseEffortCatalog(payload, DEFAULT_CONFIG)
  const models = [{ id: "gpt" }, { id: "gpt:low" }, { id: "gpt:bg" }, { id: "plain" }]
  test("adds variants in order and hides effort aliases only", () => {
    const folded = foldEfforts(models, catalog, DEFAULT_CONFIG)
    expect(folded.map((model) => model.id)).toEqual(["gpt", "gpt:bg", "plain"])
    expect(folded[0].variants).toEqual([
      { id: "low", body: { chat_template_kwargs: { reasoning_effort: "low" } } },
      { id: "high", body: { chat_template_kwargs: { reasoning_effort: "high" } } },
    ])
  })
  test("hideAliases off keeps aliases", () => {
    const folded = foldEfforts(models, catalog, { ...DEFAULT_CONFIG, hideAliases: false })
    expect(folded.map((model) => model.id)).toContain("gpt:low")
  })
  test("existing variant ids are not duplicated", () => {
    const folded = foldEfforts([{ id: "gpt", variants: [{ id: "low" }] }], catalog, DEFAULT_CONFIG)
    expect(folded[0].variants?.map((variant) => variant.id)).toEqual(["low", "high"])
  })
  test("custom body path", () => {
    const folded = foldEfforts([{ id: "gpt" }], catalog, { ...DEFAULT_CONFIG, bodyPath: "reasoning_effort" })
    expect(folded[0].variants?.[0].body).toEqual({ reasoning_effort: "low" })
  })
})

describe("toTargetProvider", () => {
  const entry = (id: string, settings: object) => ({ id, settings })
  test("matches by modelInfoFormat", () => {
    const provider = toTargetProvider(entry("p", { baseURL: "http://h/v1/", apiKey: "k", modelsDiscovery: { modelInfoFormat: "llama-swap" } }), DEFAULT_CONFIG)
    expect(provider).toEqual({ id: "p", baseURL: "http://h/v1", apiKey: "k" })
  })
  test("matches by explicit id", () => {
    const config = { ...DEFAULT_CONFIG, providers: ["srv"] }
    expect(toTargetProvider(entry("srv", { baseURL: "http://h/v1" }), config)?.id).toBe("srv")
    expect(toTargetProvider(entry("other", { baseURL: "http://h/v1" }), config)).toBeUndefined()
  })
  test("empty modelInfoFormat disables the format match", () => {
    const settings = { baseURL: "http://h/v1", modelsDiscovery: { modelInfoFormat: "llama-swap" } }
    expect(toTargetProvider(entry("p", settings), { ...DEFAULT_CONFIG, modelInfoFormat: "" })).toBeUndefined()
  })
})
