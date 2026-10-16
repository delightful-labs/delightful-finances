# XState design memory

These are user-approved architectural lessons from the bank-sync refactor. Read this before
implementing complex workflows, authorization, readiness, or derived UI capabilities. The
constitution is authoritative; use the active feature artifacts for behavior requirements.

## Start with the model

Write down the states, observed facts, events, ownership tree, and terminal outcomes before effects.
Include cancellation, identity/workspace changes, retries, and shutdown in that first model. For
larger work, show the statechart to the user before implementation.

Sequential business `if` statements are a signal that a child machine may be missing. State derived
from two or more conditions usually belongs in XState. Apply this review inside actors and helper
files as well as components. Moving a function into a machine directory or wrapping it in
`fromPromise` does not expose its decisions to the statechart.

For example, preparation that checks identity, permissions, ownership, and existing/new connection
selection should be a machine with guarded transitions. Its database queries and UUID generation
are focused actors. The same applies to transaction acceptance/omission, mapping eligibility, and
complete/partial result classification.

Do not mechanically turn every predicate into another actor. Guards express decisions, context
stores data, pure functions transform values, and simple form/disclosure state stays local. Keep
low-level abort/disposal checks in resource adapters. Atomic transactions must recheck invariants
inside the transaction, even when a machine already checked them before the write.

## Compose small actors with clear owners

Put machine definitions in `src/lib/machines/`. Integration components bind subscriptions and
platform dependencies, own or attach actors, forward observations, and compose pure presentation.
Do not replace a large component script with a large controller file.

Use child machines for independently understandable workflows: initialization, authorization,
preparation, setup, mapping, account traversal, and individual transaction processing. Invoke children
whose lifetime follows a state; spawn dynamic children under an explicit parent and stop obsolete
ones. Avoid manually starting child actors and awaiting them through promise bridges.

Application readiness starts before SDK initialization. It owns startup and the workspace/integration
subtree once dependencies become available. Keep identity, workspace, membership, and credential
readiness distinct. Model supported observations only: browser online status is not proof of Jazz
sync connectivity, and a missing SDK observer is a reason to omit that state.

## Let states own behavior

Represent complete success, partial success, cancellation, and failures as actual states. Return typed
terminal results so parents route outcomes without interpreting error-message strings. Classify an
outcome once; persistence receives the chosen outcome rather than recalculating it from counters.

Keep observations, counters, scoped data, current resource payloads, actor references, and result
descriptors in context. Do not keep a second lifecycle in `phase`, `stage`, `message`, or independent
flags that must stay synchronized with the statechart. Discriminants identifying actual data variants
are appropriate; distinguish those from copied lifecycle labels.

Readiness, permission, credential completeness, eligible mapping destinations, and available actions
are part of the model. Presentation must not reconstruct these from combinations of props. Render
explicit model choices or tags; translate descriptors and format dates in presentation so locale
changes remain reactive. State metadata can hold message/step descriptors.

Keep saved historical results independent of the current operation's success/failure state. When
nested actors drive the UI, ensure subscriptions actually notify consumers of child transitions;
check the installed framework adapter's behavior rather than assuming root snapshot identity changes.

## Design cleanup and races explicitly

A normal cancel path is not enough. Account for navigation, component destruction, SDK session
replacement, scope/permission changes, credential replacement, reset, and unexpected child errors.

Do not assume `actor.stop()` runs machine exit actions or clears context. Send explicit shutdown,
let active children reach cleanup/terminal states, and only then stop/release their owners. Inspect
framework hook registration order: automatic actor stopping can run before a later cancellation hook.
Protect resetting/shutting-down states from later events that would downgrade their intended result.

Replace transient resource payloads as work advances; clear setup tokens, plaintext credentials,
sealing functions, and provider responses on terminal cleanup. Keep persisted encrypted data separate.
A cancelled effect's late result must not advance the workflow or start another provider request.
Treat already-issued database writes according to the SDK's actual cancellation semantics.

When identities or integrations are replaced, tie detach/completion notifications to the actor they
belong to. Do not let an old component tear down a newly attached workspace. Preserve progress counts
across child boundaries without losing or counting them twice.

## Review and verification

Review the complete actor tree after focused changes, including startup and presentation boundaries.
Look for hidden branching promises, duplicated result classification, flags outside the model, and
teardown paths that bypass cleanup. Prefer a small reviewed change over another broad mechanical
rewrite.

Follow the repository review gate: do not add or run tests until the user approves the implementation
being covered. Formatting and type checks do not establish runtime correctness. After approval, test
state transitions and visible behavior, especially cancellation/races, cleanup, authorization changes,
partial progress, and parent/child subscription rendering. Do not record an implementation as proven
merely because it type-checks.
