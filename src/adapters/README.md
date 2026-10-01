# Channel adapters

Each folder here implements one inbound channel (e.g. `telegram/`, `bale/`,
`web/`). Adapters are responsible for translating a channel-specific message
into calls against `src/core`, and for formatting core results back into that
channel's reply format.

Rules for adapters:

- They may import from `@/core/*` and `@/lib/*`.
- They must never be imported by `@/core/*` — the core layer stays channel
  agnostic.
- They resolve the acting user via `(channel, externalId)` and then call the
  core services.

No adapter is implemented yet; this directory is intentionally empty of code.
