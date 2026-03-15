# DEBUG.md

## Purpose

This file defines the reusable debugging workflow for runtime bugs, browser automation issues, async failures, lifecycle problems, environment-sensitive behavior, and external integration breakage.

Use this workflow to prevent assumption-driven fixes that add complexity without evidence.

If `project.md` exists, read it for project-specific debugging boundaries, acceptance criteria, and likely failure surfaces.

---

## Core rule

Do not make substantial code changes for runtime bugs until you have:

1. observable facts
2. a clear list of unknowns
3. a falsifiable hypothesis
4. the minimum tooling or instrumentation needed to verify that hypothesis

If those conditions are not met, stop and gather evidence first.

---

## Required workflow

### 1. Establish the failure surface

Before proposing a fix, identify:

- what is definitely observed
- what is inferred but not yet proven
- which boundary is likely failing

Typical boundaries:

- input capture
- message routing
- background or worker lifecycle
- UI lifecycle
- API readiness
- auth state
- transport or request flow
- response start detection
- completion detection
- parsing or normalization
- rendering

Do not collapse multiple boundaries into one vague problem statement.

### 2. State facts and unknowns explicitly

For debugging tasks, present a short checkpoint in this format:

- Facts:
- Unknowns:
- Needed visibility:
- Hypothesis:
- Next experiment:

Do this before substantial edits.

### 3. Ask for the right tools early

If the issue depends on runtime behavior and the current environment does not provide enough visibility, ask for the minimum tool or permission needed.

Examples:

- browser inspection for page, tab, or extension state
- console logs from the relevant runtime context
- worker/background logs
- DOM snapshots from the active page
- permission to run a local build, smoke test, or automation check
- network or storage inspection when relevant

Do not continue with speculative code changes when the failure cannot be observed.

### 4. Prefer instrumentation over architecture changes

Before adding retries, new abstractions, or additional lifecycle logic, first add or use:

- targeted debug logs
- selector or matcher diagnostics
- explicit status transitions
- request and response checkpoints
- timeout-stage reporting
- readiness signals

Instrumentation should answer a specific unknown.

### 5. Use falsifiable hypotheses

Every proposed fix should be tied to a hypothesis that could be disproven.

Good example:

- "The UI opens, but the runtime registration step never reaches the coordinator."

Bad example:

- "The system is flaky, so we should add more retries."

If the hypothesis cannot be tested, it is too vague.

### 6. Do not hide uncertainty with complexity

Stop and reassess if the proposed solution starts adding:

- extra retries
- broader polling
- more fallback branches without diagnostics
- additional state layers
- defensive abstractions around an unproven failure mode

Complexity added before evidence is a debugging smell.

### 7. Treat missing visibility as a blocker

If the agent cannot observe the runtime behavior that determines the bug, it must say so clearly.

Approved phrasing:

- "I cannot verify the failing boundary from local code alone."
- "We need runtime visibility before changing logic."
- "This looks like a lifecycle or environment issue, and I do not have enough evidence yet to justify a fix."

Do not silently substitute assumptions for evidence.

---

## Human-in-the-loop policy

When collaborating with a human:

1. ask for the smallest tool or permission that will reduce uncertainty
2. explain why that visibility matters before changing code
3. pause when evidence and assumptions start diverging
4. keep the human informed when a bug is still unproven
5. recommend stopping speculative edits if complexity is growing without narrowing the cause

---

## Decision rule

If more complexity is being added faster than uncertainty is being reduced, stop coding and gather evidence.
