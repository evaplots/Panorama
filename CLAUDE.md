# Instructions for Claude Code

This file is read automatically by Claude Code when working in this repository. It tells you how this project is organised and how to work in it productively.

---

## What this project is

**Panorama** is a web app that generates print-quality sunset images from any location on Earth. The user picks a location, time around sunset, and viewing direction; Panorama fetches real-world elevation data and OpenStreetMap features, computes the sun position, and renders a first-person human-height view exportable as A3 300 DPI PNG.

The full purpose, tech stack, and design rationale are in `README.md`. **Read it first.**

---

## Read these documents before writing any code

In this exact order:

1. **`README.md`** — overview and document map.
2. **`SETUP.md`** — how to bootstrap the Vite project, what dependencies to install, what the file tree should look like.
3. **`docs/ARCHITECTURE.md`** — module map, data flow, file structure, communication patterns.
4. **`docs/ROLES.md`** — the role each module plays, what each module owns, and what each module is **not allowed to touch**.
5. **`docs/DATA-CONTRACTS.md`** — exact shapes of all shared types, the state schema, the event bus catalogue, and configuration constants.
6. **`docs/ROADMAP.md`** — the five build phases. Only build the phase you've been asked to build.

Then, for whichever module you're working on, read the corresponding file in `docs/modules/`.

---

## Working rules

These exist because the architecture is designed for long-term maintainability by a team. Breaking them creates technical debt that future developers will have to clean up.

### 1. Stay inside your module's boundaries

Every module has a defined set of "owned files" in `docs/ROLES.md`. If you're working on Terrain, you may modify files in `src/terrain/` only. To consume something from another module, use its **public API** as documented in that module's doc. Never reach into another module's internals.

If you find yourself needing to modify a file you don't own to complete a task, **stop**. That's a contract violation. Either:
- The data contract needs a change (update `docs/DATA-CONTRACTS.md` first, get user confirmation, then proceed), or
- The work belongs in a different module (do it there, or ask the user)

### 2. Modules talk through contracts, not implementation

Three communication patterns, used consistently:
- **Direct API calls** for request/response (`HeightSampler.getHeightAt(lat, lon)`)
- **Event bus via `state.js`** for state changes (`state.set('location', ...)` → `state.on('location:changed', ...)`)
- **Three.js scene graph** for rendering (builders attach Object3Ds to groups; renderer draws them)

Any new cross-module communication must use one of these three patterns. No `import { internal } from '../other-module/secret.js'`.

### 3. Build one phase at a time

The roadmap defines five phases. Phase boundaries are real:
- Phase 1 modules don't import from Phase 3 modules.
- Empty stubs are acceptable for not-yet-built modules — see `docs/ROADMAP.md` for which stubs exist in each phase.

If the user asks for "Phase 1," do **not** add Phase 2 features even if you think they'd be useful. Build the deliverables listed in the roadmap for that phase. Stop. Show the user. Get sign-off before continuing.

### 4. Use the configuration constants

Hard-coded values like `1.7` for eye height, `60` for FOV, or API URLs belong in `src/config.js`, not scattered across modules. The full list of constants is in `docs/DATA-CONTRACTS.md` under "Configuration constants."

### 5. Honour the state schema

The state schema is defined in `docs/DATA-CONTRACTS.md`. Don't add fields to `state` without updating that document. If you need new state, that's an architectural change — flag it to the user, propose the addition, get confirmation, then update the doc *and* the code together.

### 6. Don't introduce new dependencies casually

The stack is fixed: **Vite + vanilla JS + Three.js + SunCalc**. No React, no jQuery, no UI frameworks, no state-management libraries.

If a task seems to need a new dependency:
- First check if it can be done with what's already available
- If not, propose it to the user with rationale before installing

Acceptable additions without asking: small focused utilities (`earcut` for polygon triangulation in Phase 2, `piexifjs` for EXIF metadata in Phase 5 if requested) that match what's described in module docs.

### 7. Dispose Three.js resources

Three.js doesn't garbage-collect GPU memory. Geometries, materials, and textures must be `.dispose()`d when removed. The disposal pattern is documented in `docs/modules/scene.md`. Forgetting this turns the app into a memory leak.

### 8. Async work is cancellable

Anything network-facing returns a Promise. The Scene Orchestrator uses a token-counter pattern (see `docs/modules/scene.md`) to cancel stale rebuilds when the user picks a new location. Builders should respect this — don't write fire-and-forget async chains.

### 9. Verify external URLs before adding them

If a task requires adding an API endpoint, third-party service URL, mirror, or documentation link, **web-search to confirm it exists and works in the current year** before writing it into the code or docs. URLs go stale, services shut down, paths change. A URL that worked when the docs were written may be dead today.

This rule exists because of a real failure: two Overpass mirror URLs (`overpass.kumi.systems`, `overpass.private.coffee`) were added based on memory and turned out to have CORS issues from browsers, producing `ERR_CONNECTION_REFUSED` errors that wasted hours of debugging. A 30-second web search would have surfaced the issue.

The same applies to npm packages (verify they're current), Docker images (verify they exist on Docker Hub and accept the parameters you're passing), and any external data sources. **Trust the search, not the memory.**

### 10. Update phase status when work is complete

When finishing a phase, update `docs/ROADMAP.md` to mark which deliverables actually shipped, what's deferred, and what known issues remain. The next session starts here, so out-of-date roadmap text leads the next developer (human or AI) astray.

---

## How to start a fresh task

When the user asks you to do something:

1. Identify which module(s) the task touches.
2. Re-read those module docs in `docs/modules/`.
3. Re-check the public APIs of any modules you'll consume (in `docs/ROLES.md`).
4. Plan the changes, listing every file you intend to modify.
5. **If your plan touches files outside the relevant module's owned files, stop and surface the contract issue to the user before coding.**
6. Implement.
7. Verify by running `npm run dev` and checking the result.

---

## Current build phase

When starting work, ask the user (or check the most recent commits) what phase Panorama is in. Phases are defined in `docs/ROADMAP.md`:

- **Phase 1** — MVP: terrain + sky + sun + time slider. No buildings, no trees.
- **Phase 2** — Buildings + ground-aware camera.
- **Phase 3** — Vegetation + landmarks.
- **Phase 4** — Print export (A3 300 DPI) + UX polish.
- **Phase 5** — Smart defaults + post-processing.

If unclear, default to extending the most recently-completed phase rather than skipping ahead.

---

## What to do when something seems wrong

The architecture docs were written before any code existed, so they may have small inaccuracies revealed by implementation. When you hit one:

- **If it's a typo or trivial mistake:** fix it in both the doc and the code, mention it in your response.
- **If it's a design issue (e.g., the proposed API doesn't actually work):** stop, explain the issue to the user, propose a fix, get confirmation, then update both doc and code.
- **Never silently deviate from the docs.** If the docs say one thing and your code does another, the next developer will be confused. Either the docs are right and you should follow them, or they're wrong and you should fix them.

Update `docs/ROADMAP.md`'s "Decision log" section when you make an architectural decision worth recording.

---

## Output expectations

- **Code style:** match what's in the existing codebase. If starting fresh, use Prettier defaults (2-space indent, single quotes, semicolons).
- **Comments:** explain *why*, not *what*. The code shows what it does; comments should explain decisions a future reader wouldn't infer.
- **JSDoc on public APIs:** every function in a module's public API gets a JSDoc comment. Internal helpers don't need them.
- **No dead code:** if you write something and don't end up using it, delete it before finishing.
- **No `console.log` debris:** remove debug prints when you're done. Real logging goes through a tiny `src/log.js` helper if you need it (you probably don't, in Phase 1).

---

## When to ask the user vs. proceed

**Ask before proceeding** when:
- The task requires changing a data contract or state field
- The task requires a new dependency
- The task crosses module boundaries in a way the docs don't cover
- The user's request is ambiguous between two reasonable interpretations
- You hit an external service that's down or rate-limited and there's no obvious workaround

**Proceed without asking** when:
- The task fits cleanly within one module's responsibilities
- You're implementing something explicitly described in the docs
- You're fixing a clear bug
- You're improving code quality without changing behaviour

When in doubt, ask. The user prefers a brief check-in over a wrong-direction rewrite.

---

## Final reminder

The whole point of this architecture is that *future you*, or a different developer, can come back in six months and edit one module without understanding the whole system. Every shortcut you take that crosses module boundaries makes that future job harder. Stay inside the lines.
