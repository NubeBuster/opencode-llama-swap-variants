/** Plugin options, as written under `options` in the opencode.jsonc plugin entry. */
export interface PluginConfig {
  /** Provider ids to always handle, in addition to the `modelInfoFormat` match. */
  providers: readonly string[]
  /** Handle every provider whose `settings.modelsDiscovery.modelInfoFormat` equals this; "" disables the match. */
  modelInfoFormat: string
  /** Key under `meta.llamaswap` in `/v1/models` that lists a model's efforts. */
  metadataKey: string
  /** Dotted path in the request body that receives the effort. */
  bodyPath: string
  /** Remove `<model><separator><effort>` alias entries from the model list. */
  hideAliases: boolean
  separator: string
  timeoutMs: number
  /** Static efforts per model id (`false` = no variants), overriding server metadata. */
  models: Readonly<Record<string, readonly string[] | false>>
}

export const DEFAULT_CONFIG: PluginConfig = {
  providers: [],
  modelInfoFormat: "llama-swap",
  metadataKey: "reasoning_efforts",
  bodyPath: "chat_template_kwargs.reasoning_effort",
  hideAliases: true,
  separator: ":",
  timeoutMs: 5000,
  models: {},
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item !== "") : []
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback
}

function resolveModels(value: unknown): PluginConfig["models"] {
  if (!isRecord(value)) return {}
  const models: Record<string, readonly string[] | false> = {}
  for (const [id, entry] of Object.entries(value)) {
    if (entry === false) models[id] = false
    else if (Array.isArray(entry)) models[id] = stringList(entry)
  }
  return models
}

/** Merge user options over the defaults; a malformed value falls back to its default. */
export function resolveConfig(options: unknown): PluginConfig {
  const raw = isRecord(options) ? options : {}
  const { timeoutMs } = raw
  return {
    providers: stringList(raw.providers),
    modelInfoFormat: typeof raw.modelInfoFormat === "string" ? raw.modelInfoFormat : DEFAULT_CONFIG.modelInfoFormat,
    metadataKey: nonEmptyString(raw.metadataKey, DEFAULT_CONFIG.metadataKey),
    bodyPath: nonEmptyString(raw.bodyPath, DEFAULT_CONFIG.bodyPath),
    hideAliases: typeof raw.hideAliases === "boolean" ? raw.hideAliases : DEFAULT_CONFIG.hideAliases,
    separator: nonEmptyString(raw.separator, DEFAULT_CONFIG.separator),
    timeoutMs: typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : DEFAULT_CONFIG.timeoutMs,
    models: resolveModels(raw.models),
  }
}

/** Build the request-body fragment for a dotted path: `a.b` + "x" -> `{a: {b: "x"}}`. */
export function bodyForEffort(bodyPath: string, effort: string): Record<string, unknown> {
  const keys = bodyPath.split(".").filter((key) => key !== "")
  return keys.reduceRight<unknown>((inner, key) => ({ [key]: inner }), effort) as Record<string, unknown>
}
