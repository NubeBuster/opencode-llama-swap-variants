import { describe, expect, mock, spyOn, test } from "bun:test"
import plugin from "../src/index.js"
import { requireDiscovery } from "../src/dependency.js"

const self = { id: plugin.id, state: { status: "active" } }
const discovery = { id: "opencode.models-discovery", state: { status: "active" } }
const signal = () => new AbortController().signal

describe("requireDiscovery", () => {
  test("accepts an active dependency by runtime ID, including local and Git installs", async () => {
    for (const source of [{ type: "local", path: "/plugins/discovery" }, { type: "package", target: "github:yuhp/opencode-models-discovery" }]) {
      const ctx = { plugin: { list: async () => ({ data: [self, { ...discovery, source }] }) } }
      expect(await requireDiscovery(ctx, signal())).toBe(true)
    }
  })

  test("reports a missing or disabled dependency with an installation hint", async () => {
    const ctx = { plugin: { list: async () => ({ data: [self] }) } }
    await expect(requireDiscovery(ctx, signal())).rejects.toThrow("missing or disabled")
    await expect(requireDiscovery(ctx, signal())).rejects.toThrow("opencode plugin add opencode-models-discovery")
  })

  test("does not mistake another active plugin for discovery", async () => {
    const ctx = { plugin: { list: async () => [self, { id: "other", state: { status: "active" } }] } }
    await expect(requireDiscovery(ctx, signal())).rejects.toThrow("missing or disabled")
  })

  test("reports setup failures by ID", async () => {
    const ctx = { plugin: { list: async () => [self, { ...discovery, state: { status: "failed", error: "setup failed" } }] } }
    await expect(requireDiscovery(ctx, signal())).rejects.toThrow("failed to load: setup failed")
  })

  test("reports package load failures without a runtime ID", async () => {
    for (const target of ["opencode-models-discovery", "opencode-models-discovery@1.8.0"]) {
      const ctx = { plugin: { list: async () => ({ data: [self, {
        source: { type: "package", target }, state: { status: "failed", error: "install failed" },
      }] }) } }
      await expect(requireDiscovery(ctx, signal())).rejects.toThrow("failed to load: install failed")
    }
  })

  test("waits for startup inventory, regardless of plugin order", async () => {
    let calls = 0
    const ctx = { plugin: { list: async () => ({ data: calls++ === 0 ? [] : [self, discovery] }) } }
    expect(await requireDiscovery(ctx, signal())).toBe(true)
    expect(calls).toBe(2)
  })

  test("cleanup cancels the startup wait", async () => {
    const controller = new AbortController()
    const ctx = { plugin: { list: async () => { controller.abort(); return { data: [] } } } }
    expect(await requireDiscovery(ctx, controller.signal)).toBe(false)
  })

  test("API errors are not mistaken for a missing dependency", async () => {
    const ctx = { plugin: { list: async () => { throw new Error("inventory unavailable") } } }
    await expect(requireDiscovery(ctx, signal())).rejects.toThrow("inventory unavailable")
  })
})

describe("plugin setup", () => {
  test("logs dependency errors without starting provider discovery", async () => {
    const errors: unknown[] = []
    const original = console.error
    console.error = (error) => { errors.push(error) }
    const listProviders = mock(async () => [])
    let cleanup: (() => void) | undefined
    try {
      cleanup = await plugin.setup({
        plugin: { list: async () => ({ data: [self] }) },
        provider: { list: listProviders },
        event: { async *subscribe() {} },
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(listProviders).not.toHaveBeenCalled()
      expect(errors).toHaveLength(1)
      expect(String(errors[0])).toContain("Variants are disabled")
    } finally {
      cleanup?.()
      console.error = original
    }
  })

  test("enables variants when installation finishes and disables them if the dependency disappears", async () => {
    const errors: unknown[] = []
    const original = console.error
    console.error = (error) => { errors.push(error) }
    const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "gpt", meta: { llamaswap: { reasoning_efforts: ["high"], aliases: ["gpt:high"] } } }],
    })))
    const installed = Promise.withResolvers<any>()
    const removed = Promise.withResolvers<any>()
    const enabled = Promise.withResolvers<void>()
    const disabled = Promise.withResolvers<void>()
    let inventory: any[] = [self]
    let transform: ((editor: any) => void) | undefined
    let subscriptionSignal: AbortSignal | undefined
    const listProviders = mock(async () => ({ data: [{
      id: "p", settings: { baseURL: "http://server/v1", modelsDiscovery: { modelInfoFormat: "llama-swap" } },
    }] }))
    let cleanup: (() => void) | undefined
    try {
      cleanup = await plugin.setup({
        plugin: { list: async () => ({ data: inventory }) },
        provider: {
          list: listProviders,
          transform: mock(async (callback: (editor: any) => void) => { transform = callback }),
          reload: async () => {
            if (!transform) return
            if (inventory.includes(discovery)) enabled.resolve()
            else disabled.resolve()
          },
        },
        event: {
          async *subscribe({ signal }: { signal: AbortSignal }) {
            subscriptionSignal = signal
            yield await installed.promise
            yield await removed.promise
          },
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(listProviders).not.toHaveBeenCalled()
      expect(errors).toHaveLength(1)

      inventory = [self, discovery]
      installed.resolve({ type: "plugin.updated" })
      await enabled.promise
      const setModels = mock(() => {})
      const editor = {
        list: () => [{ provider: { id: "p" }, models: new Map([["gpt", { id: "gpt" }], ["gpt:high", { id: "gpt:high" }]]) }],
        models: { set: setModels },
      }
      transform!(editor)
      expect(setModels).toHaveBeenCalledWith("p", [{ id: "gpt", variants: [{ id: "high", body: { reasoning_effort: "high" } }] }])

      inventory = [self]
      removed.resolve({ type: "plugin.updated" })
      await disabled.promise
      setModels.mockClear()
      transform!(editor)
      expect(setModels).not.toHaveBeenCalled()
      expect(errors).toHaveLength(2)
      cleanup()
      expect(subscriptionSignal?.aborted).toBe(true)
    } finally {
      cleanup?.()
      fetchMock.mockRestore()
      console.error = original
    }
  })
})
