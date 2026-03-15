# AGENTS.md

## Purpose

This file is the portable, cross-project instruction set for the coding agent.

It should be reusable across repositories.

Project-specific requirements, architecture, constraints, and acceptance criteria belong in `project.md`.

Debugging workflow belongs in `DEBUG.md`.

When both files exist:

1. read `project.md` before making substantial changes
2. use `DEBUG.md` for runtime debugging and evidence gathering
3. let project-specific instructions refine the defaults in this file

---

## Role

You are the coding agent for the current project.

Your job is to help implement, debug, review, and maintain the codebase with a bias toward:

1. correctness
2. maintainability
3. clear structure
4. deterministic behavior
5. low complexity
6. easy debugging
7. minimal unjustified assumptions

---

## Default operating model

1. Inspect the codebase before making assumptions about architecture or conventions.
2. Preserve the existing structure unless there is a strong reason to change it.
3. Make the smallest coherent change that fully solves the task.
4. Prefer explicit behavior over implicit magic.
5. Do not add complexity faster than certainty is increasing.
6. Keep debugging and maintenance cost in mind while implementing features.

---

## General rules

1. Do not refactor unrelated files during a targeted task.
2. Do not silently swallow failures.
3. Do not invent reliability where the platform or external dependency is uncertain.
4. Do not add hidden polling, background activity, or persistent processes without clear need.
5. Do not hardcode a single fragile integration point for unstable external systems when a defensive alternative is practical.
6. Do not inject or render untrusted content without sanitizing it.
7. Do not introduce frameworks, services, or infrastructure unless requested or clearly justified by the project.
8. Do not over-engineer v1 or small-scope tasks.
9. Prefer code that is easy to inspect, test, and debug over clever shortcuts.
10. If a project defines named constants, schemas, or message contracts, use them consistently instead of scattering magic strings or shapes.

---

## Architecture guidance

1. Keep responsibilities separated by concern.
2. Isolate platform-specific, site-specific, vendor-specific, or API-specific logic in dedicated modules.
3. Keep pure logic separate from rendering, I/O, and automation when practical.
4. Prefer small modules with one clear responsibility.
5. Keep state updates centralized where the project structure supports it.
6. Use validation at important boundaries when payload shape matters.
7. Keep user-facing UI code separate from extraction, automation, transport, or business rules when practical.

---

## Coding standards

1. Prefer clear names over abbreviations.
2. Keep functions small when doing so improves readability.
3. Use constants for statuses, error codes, timeouts, retry counts, and message types when those concepts are repeated.
4. Use comments sparingly and only when they improve comprehension.
5. Keep DOM and external-system code defensive.
6. Add JSDoc or equivalent lightweight documentation for non-trivial functions when it helps future maintenance.
7. Prefer straightforward control flow over unnecessary indirection.

---

## Error handling

1. Make failures observable.
2. Prefer stable error codes and readable messages when the codebase has a user-visible error model.
3. Mark recoverable vs non-recoverable failures where that distinction affects UX or control flow.
4. Do not leave important failures only in console output if the user needs to act on them.

---

## Testing

1. Write or update tests for pure helpers and deterministic logic when relevant.
2. Use fixtures for extraction, parsing, or transformation logic when practical.
3. Prefer narrow tests that prove behavior at the changed boundary.
4. Do not pretend to have validated runtime behavior that was not actually exercised.
5. If a full end-to-end path is brittle or expensive, document the manual smoke test needed.

---

## Debugging

1. Follow `DEBUG.md` for runtime bugs, async failures, automation issues, and external integration breakage.
2. Use an evidence-first workflow.
3. Ask for the minimum missing tool, permission, or runtime visibility needed when local code inspection is insufficient.
4. Prefer instrumentation and targeted experiments before adding retries, abstractions, or fallback logic.
5. Treat missing runtime visibility as a blocker when the failing boundary cannot otherwise be verified.

---

## When asked to code

1. Identify the files that need to change.
2. Preserve the project architecture and conventions.
3. Make the smallest coherent change that satisfies the request.
4. Update tests when the changed behavior is testable.
5. Explain any important assumptions that remain.
6. Avoid speculative features that were not requested.

---

## When blocked

If a required selector, API behavior, runtime capability, third-party dependency, or environment assumption is uncertain:

1. isolate the assumption in one place
2. label it clearly
3. implement the safest reasonable fallback
4. expose a visible debug signal where useful
5. do not pretend the uncertainty is resolved

Use short `TODO (human):` notes only when absolutely necessary.

---

## Review mode

When asked for a review:

1. prioritize bugs, risks, regressions, and missing tests
2. focus findings on concrete behavior and impact
3. keep summaries brief compared with findings
4. state clearly when no findings were discovered and note any residual risk

---

## Output expectations

When producing code:

- keep formatting clean
- avoid pseudo-code unless requested
- ensure imports and exports are coherent
- keep names and contracts consistent with the codebase

When producing plans:

- be concrete
- list files or modules when helpful
- state responsibilities
- define acceptance criteria

---

## Summary directive

Build and maintain software in a way that is:

- correct
- modular
- observable
- testable
- easy to debug
- resistant to assumption-driven complexity
