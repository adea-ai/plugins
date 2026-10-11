# Source policy

The public allow-list contains four official discovery repositories across
three dialect families: OpenAI, Cursor, and Claude. Anthropic maintains two
Claude sources, the official plugin list and the knowledge-work list.

| Source ID                 | Repository                                              | Manifest                           | Dialect |
| ------------------------- | ------------------------------------------------------- | ---------------------------------- | ------- |
| `openai-official`         | `https://github.com/openai/plugins`                     | `.agents/plugins/marketplace.json` | OpenAI  |
| `cursor-official`         | `https://github.com/cursor/plugins`                     | `.cursor-plugin/marketplace.json`  | Cursor  |
| `claude-official`         | `https://github.com/anthropics/claude-plugins-official` | `.claude-plugin/marketplace.json`  | Claude  |
| `knowledge-work-official` | `https://github.com/anthropics/knowledge-work-plugins`  | `.claude-plugin/marketplace.json`  | Claude  |

`hashgraph-online/awesome-codex-plugins` is intentionally not configured.
Private Codex Desktop caches and undocumented plugin endpoints are out of scope.

Local source strings are resolved beneath the source repository. `url`, `git`,
and `git-subdir` entries are accepted only over HTTPS, with no credentials,
query, or fragment. A mutable ref is resolved to a 40-character commit before
it enters the catalog. A supplied SHA is retained as the immutable pin.

Upstream source content is untrusted input despite the official discovery
classification. License, author, homepage, policy, and raw entry metadata are
retained as attribution and provenance, never as marketplace authority.
