# Extension implementation limits

- Extensions are trusted developer integrations compiled into the app. Runtime marketplace installation and isolation are intentionally outside this foundation.
- Document matchers support filename and flat Markdown frontmatter flags. The current note index/storage continues to support Markdown; arbitrary binary formats require platform/index changes.
- Custom tab components receive a read-only document snapshot. They must use existing save/review APIs for writes. No generic bypass or domain-specific write mechanism was added.
- Modes are loaded at harness initialization; register them in startup setup. Runtime addition/removal of modes requires reloading harness skills. Document tabs and per-run tools/adapters react to registry changes.
- A full server orchestrator is a trusted adapter with a documented history/event/cancellation contract. No remote service or network protocol is shipped.
- No MT5 or investor extension, external account connection, chart package or publishing implementation was added.
