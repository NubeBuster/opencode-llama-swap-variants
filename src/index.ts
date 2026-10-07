import { foldEfforts, parseEffortCatalog, type EffortCatalog, type ModelInfo } from "./catalog.js"
import { resolveConfig, type PluginConfig } from "./config.js"
import { requireDiscovery } from "./dependency.js"

export { parseEffortCatalog, foldEfforts } from "./catalog.js"
export type { EffortCatalog, ModelInfo, Variant } from "./catalog.js"
export { resolveConfig, bodyForEffort, DEFAULT_CONFIG } from "./config.js"
export type { PluginConfig } from "./config.js"

interface TargetProvider {
  id: string
  baseURL: string
  apiKey?: string
}

function settingsOf(entry: any): Record<string, any> | undefined {
  const settings = entry?.settings
  return settings && typeof settings === "object" ? settings : undefined
}

/** Pure selection: does this provider match the configured ids or `modelInfoFormat`? */
export function toTargetProvider(entry: any, config: Pick<PluginConfig, "providers" | "modelInfoFormat">): TargetProvider | undefined {
  const provider = entry?.provider ?? entry
  const settings = settingsOf(provider)
  if (!settings || typeof provider?.id !== "string") return undefined
  const discovery = settings.modelsDiscovery
  const byFormat = config.modelInfoFormat !== "" && discovery?.modelInfoFormat === config.modelInfoFormat
  if (!byFormat && !config.providers.includes(provider.id)) return undefined
  const options = settings.options ?? settings
  const baseURL = options.baseURL ?? discovery?.baseURL
  if (typeof baseURL !== "string") return undefined
  const apiKey = options.apiKey ?? discovery?.apiKey
  return { id: provider.id, baseURL: baseURL.replace(/\/+$/, ""), apiKey: typeof apiKey === "string" ? apiKey : undefined }
}

async function listTargets(ctx: any, config: PluginConfig): Promise<TargetProvider[]> {
  const listed = await ctx.provider.list()
  const entries: any[] = Array.isArray(listed) ? listed : Array.isArray(listed?.data) ? listed.data : []
  return entries.flatMap((entry) => toTargetProvider(entry, config) ?? [])
}

// The provider registry may not have read opencode.jsonc yet when setup runs, so
// an empty result is retried after a reload (same approach as models-discovery).
async function targetProviders(ctx: any, config: PluginConfig): Promise<TargetProvider[]> {
  const first = await listTargets(ctx, config)
  if (first.length > 0) return first
  await ctx.provider.reload()
  return listTargets(ctx, config)
}

async function fetchCatalog(provider: TargetProvider, config: PluginConfig): Promise<EffortCatalog> {
  try {
    const headers: Record<string, string> = provider.apiKey && provider.apiKey !== "none"
      ? { Authorization: `Bearer ${provider.apiKey}` }
      : {}
    const response = await fetch(`${provider.baseURL}/models`, { headers, signal: AbortSignal.timeout(config.timeoutMs) })
    return response.ok ? parseEffortCatalog(await response.json(), config) : new Map()
  } catch {
    return new Map() // an unreachable server leaves the model list as discovered
  }
}

export default {
  id: "opencode-llama-swap-variants",
  async setup(ctx: any) {
    const controller = new AbortController()
    const config = resolveConfig(ctx.options)
    const catalogs = new Map<string, EffortCatalog>()
    let dependencyReady = false

    // Registered only once a target provider exists: transforms run in
    // registration order, and models-discovery (which creates the provider and
    // its models) must have run before this one can see them.
    let transformRegistered = false
    const registerTransform = async () => {
      if (transformRegistered) return
      transformRegistered = true
      await ctx.provider.transform((editor: any) => {
        if (!dependencyReady || controller.signal.aborted) return
        for (const record of editor.list()) {
          const catalog = catalogs.get(record.provider.id)
          if (!catalog || catalog.size === 0) continue
          const models = [...record.models.values()] as ModelInfo[]
          editor.models.set(record.provider.id, foldEfforts(models, catalog, config))
        }
      })
    }

    const refresh = async () => {
      if (!dependencyReady || controller.signal.aborted) return
      try {
        const providers = await targetProviders(ctx, config)
        catalogs.clear()
        await Promise.all(providers.map(async (provider) => catalogs.set(provider.id, await fetchCatalog(provider, config))))
        if (!dependencyReady || controller.signal.aborted) return
        if (catalogs.size > 0) await registerTransform()
        await ctx.provider.reload()
      } catch {
        // Provider listing unavailable; keep whatever catalogs were fetched before.
      }
    }

    // Recheck inventory updates too: dependency installation can finish in the
    // background, and a previously active dependency can fail or be disabled.
    let validation: Promise<void> | undefined
    const validate = (): Promise<void> => {
      if (validation) return validation
      validation = (async () => {
        try {
          if (!await requireDiscovery(ctx, controller.signal)) return
          if (dependencyReady) return
          dependencyReady = true
          await refresh()
          // Config may still be loading: poll briefly until a target provider shows up.
          for (let attempt = 0; attempt < 10 && catalogs.size === 0 && !controller.signal.aborted; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 250))
            await refresh()
          }
        } catch (error) {
          const wasReady = dependencyReady
          dependencyReady = false
          catalogs.clear()
          if (!controller.signal.aborted) console.error(error)
          if (wasReady && !controller.signal.aborted) await ctx.provider.reload()
        }
      })().finally(() => { validation = undefined })
      return validation
    }

    void validate().catch((error) => { if (!controller.signal.aborted) console.error(error) })
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (event.type === "plugin.updated") await validate()
          if (event.type === "config.updated") await refresh()
        }
      } catch (error) {
        if (!controller.signal.aborted) console.error(error)
      }
    })()
    return () => controller.abort()
  },
}
