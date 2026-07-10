# TauriTavern Embeddings

Adds remote-API embedding / semantic search support to [TauriTavern](https://github.com/Darkatse/TauriTavern) — something it doesn't ship with, unlike SillyTavern's built-in Vector Storage extension.

Two independently toggleable features:

- **Semantic chat memory** — embeds chat messages and injects the most relevant past context into the prompt before each generation, instead of relying only on recency.
- **Semantic Lorebook matching** — embeds your World Info entries and surfaces the ones most relevant to the current context by meaning, as a supplement to keyword-based activation.

Embeddings are generated via a remote API (OpenAI-compatible endpoints, Cohere, or a local OpenAI-compatible server like Ollama/LM Studio) — nothing runs on-device, which keeps it light on mobile battery and storage.

## Requirements

- TauriTavern (or plain SillyTavern, with reduced persistence — see [Compatibility](#compatibility))
- An API key for an embeddings provider (OpenAI, Cohere, or a self-hosted OpenAI-compatible server)

## Installation

### TauriTavern — install from URL (recommended, especially on Android)

1. Open the Extensions panel.
2. Use the "Install extension from URL" option.
3. Paste this repo's URL:
   ```
   https://github.com/<your-username>/tt-embeddings
   ```
4. TauriTavern clones it into its own sandboxed extension storage — no manual file access needed, which matters on Android where `Android/data/<package>` is restricted on modern versions.

### Manual install (desktop / rooted devices / ADB)

Copy this repo's contents into:

```
data/default-user/extensions/tt-embeddings/    (local, takes priority)
data/extensions/third-party/tt-embeddings/     (global)
```

The folder must contain `manifest.json` at its root. Restart the app and enable the extension from the Extensions panel.

## Setup

Open the extension's settings panel (Extensions → Embeddings (TauriTavern)) and fill in:

| Field | Description |
|---|---|
| Provider | `openai` (or any OpenAI-compatible server), `local`, or `cohere` |
| Base URL | e.g. `https://api.openai.com/v1` |
| API Key | Your provider key. Leave blank for local servers that don't require one. |
| Model | e.g. `text-embedding-3-small` |

Then flip on whichever of the two toggles you want:

- **Semantic chat memory**
- **Semantic Lorebook matching**

Both are off by default. They can be toggled independently — turning one off doesn't clear the vectors already cached for the other, so re-enabling later resumes from what's already stored.

## How it works

- Vectors are cached per-chat, keyed by a content hash, so unchanged messages/Lorebook entries are never re-embedded.
- On TauriTavern, persistence uses the host's `store.*` KV API (per-chat, doesn't bloat message payloads). On plain SillyTavern, it falls back to `localStorage`.
- Retrieval uses cosine similarity with a configurable score threshold; only matches above the threshold get injected.
- Embedding calls are batched (max 16 texts per request) to keep individual requests small on mobile connections.
- If the embedding API call fails, generation proceeds without injected context rather than blocking — failures are logged to console, not surfaced as a hard error.

## Known limitations / TODO

- Similarity threshold (`0.72` cosine) is a starting point — tune it for your chosen embedding model.
- World Info entry shape is inferred from upstream SillyTavern 1.18.0 conventions; verify against your TauriTavern build if entries aren't being picked up.
- No backfill progress indicator yet — enabling chat memory on a long existing chat will batch-embed the whole history on the first run, which may take a moment.
- No UI for inspecting/clearing cached vectors yet.

## Compatibility

Built primarily for TauriTavern, using its `store.*` and `metadata.*` host APIs. Falls back to plain SillyTavern behavior (settings-based config, `localStorage`-based vector cache) when `window.__TAURITAVERN__` isn't present, so it won't crash there — but per-chat isolation and persistence robustness are weaker outside TauriTavern.

## License

MIT (or your choice — update before publishing).
