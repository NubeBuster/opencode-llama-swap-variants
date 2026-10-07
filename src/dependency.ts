const PLUGIN_ID = "opencode-llama-swap-variants"
const DISCOVERY_ID = "opencode.models-discovery"
const DISCOVERY_PACKAGE = "opencode-models-discovery"

/** Wait for OpenCode's startup inventory before validating the dependency. */
export async function requireDiscovery(ctx: any, signal: AbortSignal): Promise<boolean> {
  while (!signal.aborted) {
    const listed = await ctx.plugin.list()
    if (signal.aborted) return false
    const plugins: any[] = Array.isArray(listed) ? listed : Array.isArray(listed?.data) ? listed.data : []
    // OpenCode publishes the inventory only after all plugin setup calls finish.
    // Waiting inside setup would deadlock; the caller runs this in the background.
    if (!plugins.some((plugin) => plugin.id === PLUGIN_ID)) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      continue
    }
    // Match the runtime ID, not the install path: local and Git installs work too.
    const discovery = plugins.find((plugin) => plugin.id === DISCOVERY_ID)
      ?? plugins.find((plugin) => plugin.source?.type === "package"
        && (plugin.source.target === DISCOVERY_PACKAGE || plugin.source.target?.startsWith(`${DISCOVERY_PACKAGE}@`)))
    if (discovery?.state?.status === "active") return true

    const reason = discovery?.state?.status === "failed"
      ? `${DISCOVERY_PACKAGE} failed to load: ${discovery.state.error}`
      : `${DISCOVERY_PACKAGE} is missing or disabled`
    throw new Error(`${PLUGIN_ID}: ${reason}. Variants are disabled. Enable it in opencode.json(c)'s plugins array or run "opencode plugin add ${DISCOVERY_PACKAGE}". Check "opencode plugin list" for its status.`)
  }
  return false
}
