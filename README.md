# opencode-llama-swap-variants

Pick a [llama-swap](https://github.com/mostlygeek/llama-swap) model's reasoning
effort directly in [OpenCode](https://opencode.ai) v2's model selector.
For example, `llama-swap/gpt-oss-20b#high` replaces a separate `gpt-oss-20b:high` alias.

- Reads each model's effort list from llama-swap's `/v1/models` metadata.
- Adds one variant per effort (list order = picker order) that injects the effort
  into the request body.
- Removes the now-redundant `<model>:<effort>` alias entries from the picker.
- Adding a new effort only requires a llama-swap `config.yaml` change, not an
  OpenCode config edit.

It builds on [`opencode-models-discovery`](https://www.npmjs.com/package/opencode-models-discovery),
which creates the provider and its models; this plugin only decorates them.

## Quick start

Requires **OpenCode v2**, **`opencode-models-discovery` with V2 support**
(e.g. 1.8.0), and a running llama-swap server.

### 1. Configure OpenCode

Add both plugins and your provider to `opencode.jsonc` (merge with any existing
configuration). Change the URL to your llama-swap server; keep the `/v1` suffix.

```jsonc
// opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "opencode-models-discovery",
    "opencode-llama-swap-variants"
  ],
  "providers": {
    "llama-swap": {
      "name": "llama-swap",
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "http://127.0.0.1:8080/v1",
        "modelsDiscovery": {
          "enabled": true,
          "modelInfoFormat": "llama-swap"
        }
      }
    }
  }
}
```

For an authenticated server, add `settings.apiKey: "{env:LLAMA_SWAP_API_KEY}"`
and set that variable in the OpenCode server's environment.

**The dependency is checked at runtime.** Once OpenCode's startup plugin inventory
is ready, this plugin checks that `opencode-models-discovery` is active. If it is
missing, disabled, or failed to load, an actionable error is logged and variants
are not enabled. The plugin does **not** install the dependency automatically.
The check runs again when OpenCode's plugin inventory changes, so a completed
background installation can enable variants without a false startup failure.

### 2. Advertise reasoning efforts in llama-swap

In llama-swap's `config.yaml`, add metadata to each model that supports reasoning
effort. llama-swap serves it at `/v1/models` as `meta.llamaswap.reasoning_efforts`.

```yaml
models:
  gpt-oss-20b:
    cmd: llama-server --port ${PORT} -hf ggml-org/gpt-oss-20b-GGUF
    metadata:
      reasoning_efforts: [low, medium, high]
    # Optional default: "?" preserves the effort selected by the client.
    filters:
      setParamsByID:
        "${MODEL_ID}":
          reasoning_effort?: medium
```

**Important:** `reasoning_effort:` without the trailing `?` overwrites the client's
selection, making every variant use the default. Use `reasoning_effort?:` or omit
the default filter. The backend and model template must also support reasoning effort.

### 3. Select a variant

Reload llama-swap's configuration, then start OpenCode and open `/models`.
Choose `gpt-oss-20b` under `llama-swap`, then its `low`, `medium`, or `high` variant.
`high` sends `{"reasoning_effort":"high"}` in the request body.

Existing variants are preserved; an effort with an existing variant ID is not
overwritten. Only aliases advertised by llama-swap that match an effort are hidden;
unrelated aliases such as `:bg` remain. Plugin order does not matter: the transform
is registered after discovery has created the target provider.

## Advanced setup

<details>
<summary>Plugin options and static effort lists</summary>

All options are optional. Use the object form of the variants plugin entry to pass
options via `ctx.options`; keep the discovery plugin and provider configuration.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "opencode-models-discovery",
    {
      "package": "opencode-llama-swap-variants",
      "options": {
        "providers": ["my-server"],
        "bodyPath": "chat_template_kwargs.reasoning_effort"
      }
    }
  ]
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `modelInfoFormat` | `"llama-swap"` | Handle every provider whose `settings.modelsDiscovery.modelInfoFormat` equals this. `""` disables the match (use `providers` only). |
| `providers` | `[]` | Extra provider IDs to handle regardless of `modelInfoFormat`. Needs `settings.baseURL`. |
| `metadataKey` | `"reasoning_efforts"` | Key under `meta.llamaswap` holding a model's effort list. |
| `bodyPath` | `"reasoning_effort"` | Dotted request-body path that receives the effort. `"chat_template_kwargs.reasoning_effort"` sends it as a chat-template kwarg instead. |
| `hideAliases` | `true` | Remove `<model><separator><effort>` entries that llama-swap lists as aliases of the model. |
| `separator` | `":"` | Separator in those alias ids. |
| `timeoutMs` | `5000` | Timeout for the `/v1/models` fetch. |
| `models` | `{}` | Static efforts per model ID, overriding server metadata, e.g. `{"qwen": ["low","high"]}`. `false` disables adding effort variants for that model. |

A bad option value falls back to its default. Static effort lists work without
reasoning metadata, but the model must still appear in a successful `/models`
response; they do not create models or bypass the discovery dependency.

</details>

<details>
<summary>Alternative installation methods and version pinning</summary>

Install both plugins globally with the CLI, then configure the provider as above:

```sh
opencode plugin add opencode-models-discovery
opencode plugin add opencode-llama-swap-variants
```

Pin an exact version (`opencode-llama-swap-variants@1.0.1`) to stop OpenCode checking
that package for updates. You can also use
`github:NubeBuster/opencode-llama-swap-variants` as the package target.

Clone-based routes run the TypeScript source directly; no build is needed:

- **Directory entry** (verified): clone the repo and list its directory in `plugins`.
  The directory must contain a root `index.ts` (this repo does). A path to a single
  file is rejected ("configured plugin path must be a directory").
  ```jsonc
  { "package": "/path/to/opencode-llama-swap-variants", "options": {} }
  ```
- **Drop-in directory**: put a copy of the repo under `~/.config/opencode/plugins/`
  or a project's `.opencode/plugins/`. It loads automatically with default options.
- **Packed tarball** (verified): use
  `{ "package": "opencode-llama-swap-variants@file:/path/to.tgz" }` in configuration.
  This loads `dist/index.js` through OpenCode's npm cache; build before packing.

Every route still requires the discovery plugin. After changing a local plugin
bundle, run `opencode service restart` to load it again.

</details>

## Troubleshooting

- **Dependency error:** run `opencode plugin list`; discovery's runtime ID is
  `opencode.models-discovery`. Install or re-enable it, or fix its reported load
  error. Dependency errors from this plugin appear in OpenCode's server log
  (`~/.local/share/opencode/log/opencode.log` with the default XDG layout).
- **Models appear without variants:** check `modelsDiscovery.enabled: true`,
  `modelInfoFormat: "llama-swap"`, and the server's `/v1/models` metadata. An
  unreachable server, failed HTTP response, or malformed metadata leaves discovered
  models unchanged rather than failing the session.
- **"Model unavailable" just after a service restart:** initial discovery may not
  have finished. Wait briefly and retry; this also happens without this plugin.

<details>
<summary>The variant is selected, but the reasoning effort does not change</summary>

First check that llama-swap isn't overwriting the value with `setParamsByID`
without `?` (see the quick start).

The effort only does something if the backend maps it into the model's chat
template. By default this plugin sends the top-level `reasoning_effort` field.
If your backend ignores it, try
`bodyPath: "chat_template_kwargs.reasoning_effort"` to send a template kwarg
instead. Support depends on the backend version and model template; an arbitrary
model does not gain reasoning support just by advertising efforts.

For llama-server versions that map the top-level field into the template, that
field takes precedence when both it and the kwarg are supplied.

</details>

<details>
<summary>Development and publishing</summary>

```sh
npm install && npm run build && bun test
```

Publishing: push a `v*` tag matching the package version. The GitHub Action uses
npm Trusted Publishing (OIDC), with provenance and no `NPM_TOKEN` secret. Configure
the package's trusted publisher on npm for `NubeBuster/opencode-llama-swap-variants`
and workflow `publish.yml`, allowing `npm publish`. A new trust configuration must
complete a successful publish within two days to validate it.

</details>

## License

MIT
