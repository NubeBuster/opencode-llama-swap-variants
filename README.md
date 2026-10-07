# opencode-llama-swap-variants

An [OpenCode](https://opencode.ai) v2 plugin that turns the reasoning efforts a
[llama-swap](https://github.com/mostlygeek/llama-swap) model advertises into real
model **variants** (`provider/model#high`), so the effort is picked in the model
selector instead of through duplicated `model:high` aliases.

- Reads each model's effort list from llama-swap's `/v1/models` metadata.
- Adds one variant per effort (list order = picker order) that injects the effort
  into the request body.
- Removes the now-redundant `<model>:<effort>` alias entries from the picker.
- Adding a new effort is a one-line `config.yaml` change; no OpenCode config edit.

It builds on [`opencode-models-discovery`](https://www.npmjs.com/package/opencode-models-discovery),
which creates the provider and its models; this plugin only decorates them.

## Install

Requires OpenCode v2 and `opencode-models-discovery` with `modelInfoFormat: "llama-swap"`.

```jsonc
// opencode.jsonc
{
  "plugins": [
    "opencode-models-discovery",
    "opencode-llama-swap-variants"
    // or with options:
    // { "package": "opencode-llama-swap-variants", "options": { "bodyPath": "chat_template_kwargs.reasoning_effort" } }
  ]
}
```

or `opencode plugin add opencode-llama-swap-variants`. Pin a version
(`opencode-llama-swap-variants@0.1.0`) to stop OpenCode checking for updates.
The transform is registered lazily, so it runs after `opencode-models-discovery`
has created the models regardless of plugin order.

Alternatives (the clone-based routes run the TypeScript source directly, no build needed):

- **Directory entry** (verified): clone the repo and list its directory; the directory must contain a root `index.ts` (it does). A path to a single
  file is rejected ("configured plugin path must be a directory").
  ```jsonc
  { "package": "/path/to/opencode-llama-swap-variants", "options": { } }
  ```
- **Drop-in directory**: put a copy of the repo under `~/.config/opencode/plugins/` (or a
  project's `.opencode/plugins/`); plugins found there load automatically, without options.
- **Packed tarball** (verified): `{ "package": "opencode-llama-swap-variants@file:/path/to.tgz" }`
  loads `dist/index.js` through OpenCode's npm cache.

Options reach the plugin as `ctx.options` and come only from the object form of the
`plugins` entry (see below).

## llama-swap setup

Advertise the efforts in each model's `metadata:`; llama-swap serves it at
`/v1/models` as `meta.llamaswap.reasoning_efforts`.

```yaml
models:
  gpt-oss-20b:
    cmd: llama-server --port ${PORT} -hf ggml-org/gpt-oss-20b-GGUF
    metadata:
      reasoning_efforts: [low, medium, high]
    # Optional default effort. Note the trailing "?": see the pitfall below.
    filters:
      setParamsByID:
        "${MODEL_ID}":
          reasoning_effort?: medium
```

### Pitfall: `setParamsByID` without `?`

A llama-swap filter entry that sets `reasoning_effort` **without** the trailing `?`
overwrites whatever the client sent, so every variant would silently run at the
default effort. Use `reasoning_effort?:` (set only if absent) or no base entry at all.

### Pitfall: template support

The effort only does something if the backend maps it into the model's chat template.
By default it is sent as the standard top-level `reasoning_effort` field, which stock
llama-server maps into the template (and vLLM and other OpenAI-compatible backends accept).
If your server ignores the top-level field, set `bodyPath: "chat_template_kwargs.reasoning_effort"`
to pass it as a template kwarg instead (read by the gpt-oss and Qwen3 templates). When both
reach llama-server, the top-level field wins over the kwarg.

## Options

All optional; defaults reproduce the behaviour above.

```jsonc
"plugins": [
  { "package": "github:NubeBuster/opencode-llama-swap-variants",
    "options": { "providers": ["my-server"], "bodyPath": "chat_template_kwargs.reasoning_effort" } }
]
```

| Option | Default | Meaning |
| --- | --- | --- |
| `modelInfoFormat` | `"llama-swap"` | Handle every provider whose `settings.modelsDiscovery.modelInfoFormat` equals this. `""` disables the match (use `providers` only). |
| `providers` | `[]` | Extra provider ids to handle regardless of `modelInfoFormat`. Needs `settings.baseURL`. |
| `metadataKey` | `"reasoning_efforts"` | Key under `meta.llamaswap` holding a model's effort list. |
| `bodyPath` | `"reasoning_effort"` | Dotted request-body path that receives the effort. `"chat_template_kwargs.reasoning_effort"` sends it as a chat-template kwarg instead. |
| `hideAliases` | `true` | Remove `<model><separator><effort>` entries that llama-swap lists as aliases of the model. |
| `separator` | `":"` | Separator in those alias ids. |
| `timeoutMs` | `5000` | Timeout for the `/v1/models` fetch. |
| `models` | `{}` | Static efforts per model id, overriding server metadata, e.g. `{"qwen": ["low","high"]}`. `false` disables variants for that model. Lets servers without metadata work. |

Aliases that are not an advertised effort (e.g. `:bg`) and models without effort
metadata are left untouched. A bad option value falls back to its default.

## Known limitation

The first `opencode run` after an OpenCode service restart can fail with
"Model unavailable" until `opencode-models-discovery` finishes its first discovery.
This happens without this plugin too.

## Develop

```sh
npm install && npm run build && bun test
```

Publishing: push a `v*` tag; the GitHub Action publishes with provenance and needs an `NPM_TOKEN` repository secret.

## License

MIT
