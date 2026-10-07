import { bodyForEffort, stringList, type PluginConfig } from "./config"

export interface Variant {
  id: string
  settings?: Record<string, unknown>
  headers?: Record<string, string>
  body?: Record<string, unknown>
}

export interface ModelInfo {
  id: string
  variants?: readonly Variant[]
  [key: string]: unknown
}

/** Efforts advertised per base model id, plus the alias ids the server lists for it. */
export type EffortCatalog = ReadonlyMap<string, { efforts: readonly string[]; aliases: readonly string[] }>

type CatalogConfig = Pick<PluginConfig, "metadataKey" | "models">

/**
 * Parse a llama-swap `/v1/models` payload into an EffortCatalog. Static
 * `models` entries replace the server metadata for that id; `false` drops it.
 */
export function parseEffortCatalog(payload: unknown, config: CatalogConfig): EffortCatalog {
  const catalog = new Map<string, { efforts: string[]; aliases: string[] }>()
  const data = (payload as { data?: unknown } | undefined)?.data
  const entries: any[] = Array.isArray(data) ? data : []
  const llamaswap = (entry: any): Record<string, unknown> | undefined => entry?.meta?.llamaswap
  // llama-swap repeats a model's metadata on each alias entry; only the base owns the efforts.
  const aliasIDs = new Set(entries.flatMap((entry) => stringList(llamaswap(entry)?.aliases)))
  for (const entry of entries) {
    if (typeof entry?.id !== "string" || aliasIDs.has(entry.id)) continue
    const meta = llamaswap(entry)
    const override = config.models[entry.id]
    const efforts = override === undefined ? stringList(meta?.[config.metadataKey]) : override === false ? [] : [...override]
    if (efforts.length > 0) catalog.set(entry.id, { efforts, aliases: stringList(meta?.aliases) })
  }
  return catalog
}

type FoldConfig = Pick<PluginConfig, "bodyPath" | "hideAliases" | "separator">

/** Add effort variants to the catalogued models and (optionally) remove their effort aliases. */
export function foldEfforts(models: readonly ModelInfo[], catalog: EffortCatalog, config: FoldConfig): ModelInfo[] {
  const folded = new Set<string>()
  if (config.hideAliases) {
    for (const [base, { efforts, aliases }] of catalog) {
      const known = new Set(aliases)
      for (const effort of efforts) {
        const alias = `${base}${config.separator}${effort}`
        if (known.has(alias)) folded.add(alias)
      }
    }
  }

  return models
    .filter((model) => !folded.has(model.id))
    .map((model) => {
      const efforts = catalog.get(model.id)?.efforts
      if (!efforts) return model
      const existing = model.variants ?? []
      const existingIDs = new Set(existing.map((variant) => variant.id))
      const added = efforts
        .filter((effort) => !existingIDs.has(effort))
        .map((effort): Variant => ({ id: effort, body: bodyForEffort(config.bodyPath, effort) }))
      return added.length === 0 ? model : { ...model, variants: [...existing, ...added] }
    })
}
