# Strategy review — orchestration prompt

Paste the entire contents below into Claude Code as your first message.

---

I want to run a multi-agent review of `STRATEGY-V2.md` before starting
the rebuild. Six expert reviewers are defined in `.claude/agents/`, plus
a Director. Here is the procedure I want you to follow:

**Phase 1 — Read.** Read `STRATEGY-V2.md`, `ARCHITECTURE.md`,
`ROLES.md`, and `README.md` so you have full project context.

**Phase 2 — Dispatch reviewers in parallel.** Invoke each of the six
reviewers as a subagent, giving each one the strategy doc and asking
them to produce a critique focused on their domain. The reviewers are:

- `@stylization-engineer` — painter pipeline (Stage 1 underpainting +
  Stage 2 to-pointillism)
- `@terrain-engineer` — `SkylineCaster.getSkyline()` feasibility, edge
  cases, performance
- `@data-layer-engineer` — Snapshot self-containment, API reality,
  caching, sharing
- `@algorithm-specialist` — to-pointillism correctness, gradient/median
  on synthetic input
- `@art-director` — aesthetic outcome, painter palettes, will-this-be-art
- `@pragmatist` — MVP scope, critical path, what to cut

Each reviewer should output:
- 3 to 5 specific concerns, each with a concrete change recommendation
- A severity label per concern: P0 (blocks start), P1 (should address
  before start), P2 (address during build)
- Any contradictions they expect with other reviewers' likely concerns

**Phase 3 — Cross-talk round.** Show each reviewer's output to the
other reviewers and ask one targeted question: "Of the other reviewers'
concerns, which do you disagree with or think misses something?"
Collect responses. Keep this round short — 2 to 3 sentences per
reviewer per response.

**Phase 4 — Director synthesis.** Invoke `@director` with all reviewer
outputs and cross-talk. The Director should:
- Identify common themes across reviewers (the strongest signals)
- Identify real contradictions and resolve them with explicit
  reasoning
- Produce a prioritised change list (P0 / P1 / P2)
- Write `STRATEGY-V2-REVISED.md` at the repo root, containing the
  full revised strategy with all P0 and P1 changes folded in
- Write `STRATEGY-REVIEW-NOTES.md` summarising the review process,
  reviewer concerns, contradictions, and which concerns were folded
  in vs deferred and why

**Phase 5 — Hand back to me.** Show me the diff summary between
`STRATEGY-V2.md` and `STRATEGY-V2-REVISED.md` (high level — not the
full diff), the contradictions that were resolved, and the P2 issues
deferred. I will decide what to merge.

Do not modify any other files. Do not start any code work. This is a
strategy review only. The goal is to harden the strategy doc before I
hand it to a fresh Claude Code session for the actual rebuild.
