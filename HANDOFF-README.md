# Panorama additions — drop-in bundle

This bundle contains every file that needs to live in your
`D:\claude-projects\PANORAMA\` repo before you start the rebuild work
with Claude Code.

Unzip this bundle and copy the **contents** (not the wrapping folder)
into `PANORAMA\`. Folder structure preserves correctly so `.claude\`
merges with anything you already have there.

```powershell
# After unzipping panorama-additions.zip somewhere:
Copy-Item -Path "C:\path\to\panorama-additions\*" `
          -Destination "D:\claude-projects\PANORAMA\" `
          -Recurse -Force
```

If your repo already has a `.claude\agents\` directory from prior
Claude Code use, the new agent files will be added alongside whatever
is there. None of the new files use names that should collide with
typical project files. Worth a quick `git status` check after the copy
to confirm.

---

## What you get

```
PANORAMA\
├── HANDOFF-README.md                 ← this file (rename or delete after reading)
├── STRATEGY-V2.md                    ← the source of truth for the rebuild
├── REQUIREMENTS-CHECKLIST.md         ← comprehensive feature list
├── generative_panorama.html          ← the original HTML tool, reference
└── .claude\
    ├── agents\
    │   ├── director.md               ← coordinator for review
    │   ├── stylization-engineer.md   ← painter pipeline reviewer
    │   ├── terrain-engineer.md       ← skyline / DEM reviewer
    │   ├── data-layer-engineer.md    ← APIs / caching reviewer
    │   ├── algorithm-specialist.md   ← to-pointillism correctness reviewer
    │   ├── art-director.md           ← aesthetic outcome reviewer
    │   └── pragmatist.md             ← MVP / scope reviewer
    └── prompts\
        ├── REVIEW-PROMPT.md          ← Phase −1: multi-agent strategy review
        ├── SPIKE-PROMPT.md           ← Phase  0: validation prototypes
        ├── BUILD-PROMPT.md           ← Phase  1: MVP build
        └── BUILD-V2-PROMPT.md        ← Phase  2+: V2 features
```

## Order of operations

You are at Phase −1. Do not skip phases. Each phase is a **fresh**
Claude Code session.

```
Phase −1  Multi-agent strategy review     →  STRATEGY-V2-REVISED.md
Phase  0  Spike prototypes                →  PHASE-0-REPORT.md
Phase  1  MVP build                       →  working tool, PHASE-1-CLOSEOUT.md
Phase  2+ V2 features (one PR at a time)  →  feature-complete tool
```

For each phase, paste the contents of the matching prompt file from
`.claude\prompts\` into a fresh Claude Code session as your first
message.

### Phase −1 — strategy review

```powershell
cd D:\claude-projects\PANORAMA
git add STRATEGY-V2.md REQUIREMENTS-CHECKLIST.md generative_panorama.html .claude\
git commit -m "Add strategy v2, requirements checklist, agents, prompts"
claude
# In Claude Code, paste the contents of .claude\prompts\REVIEW-PROMPT.md
```

The review will produce `STRATEGY-V2-REVISED.md` and
`STRATEGY-REVIEW-NOTES.md`. Commit both. Read them. Decide whether to
accept the Director's revisions or hand-edit further.

### Phase 0 — spike prototypes

Start a **new** Claude Code session (close the previous one). Paste
the contents of `.claude\prompts\SPIKE-PROMPT.md`. Three throwaway
prototypes will be built under `test\spikes\`. Each ends with an
assessment and a GO/REVISE/NO-GO decision. The phase ends with
`PHASE-0-REPORT.md` summarising all three.

If any spike returns REVISE, fold the recommended changes into
`STRATEGY-V2-REVISED.md` before Phase 1.

### Phase 1 — MVP build

Start another fresh Claude Code session. Paste the contents of
`.claude\prompts\BUILD-PROMPT.md`. The MVP build runs through 10
sequential PRs ending with a paintable image from one of three
hardcoded preset locations. This is the longest phase — expect
multiple Claude Code sessions across days.

### Phase 2+ — V2 features

Once MVP is shipping and acceptance criteria are met, paste
`.claude\prompts\BUILD-V2-PROMPT.md` into a fresh session. Twelve
incremental PRs add the V2 features one at a time.

---

## Subagent reuse note

The seven subagents in `.claude\agents\` were originally written for
the **review** phase. They are reused during **build** as module
owners (the prompts in `BUILD-PROMPT.md` and `BUILD-V2-PROMPT.md`
explicitly dispatch them at code review time).

Their default stance is critical/sceptical, which is right for review
but can produce friction during build (they may push back on
already-locked decisions). The build prompts explicitly tell Claude
Code to respect locked strategy decisions and only act on the
agents' specific module-level concerns. If you find them too
adversarial during the build, you can edit the agent files directly
to flip the stance from "critique" to "review and approve."

---

## What's *not* in this bundle

These files are already in your `PANORAMA\` repo and don't need
re-adding:

- `ARCHITECTURE.md`
- `ROLES.md`
- `DATA-CONTRACTS.md`
- `README.md`
- `SETUP.md`
- `CLAUDE.md`
- `package.json` and existing `src/` code

The strategy docs reference these — make sure they're committed and
up to date before starting Phase −1.
