# Opt-in actor inspection

Status: D010–D012 complete and verified under the user's combined authorization.
The user requested all remaining work in one pass, including implementation and verification.

## Design and scope

Use XState 5.33.2's supported `inspect` actor option. Add a small inspection hook at the existing
application, shared form, archive, account-order, recovery-phrase and developer sample actor roots;
invoked/spawned descendants are covered by their own XState system. Production-only PWA actors are
excluded because this diagnostic is development-only. Do not merge independent actor systems,
attach presentation actors to domain parents, or change their lifetimes just to inspect them.

Enable only in a development browser by setting sessionStorage `delightful:actor-inspection` to `1`
and reloading. The default and production behavior installs no inspection callback and exposes no
browser API. Storage access failures leave it disabled. The flag is the only persisted value.
When enabled, `window.__delightfulActorTrace` provides `read()`, `clear()` and `disable()`.
No new UI, console logging, exporter, remote collector or network request is introduced.

The trace contains at most 500 records and observes at most 128 independent actor systems. Records
contain a sequence number, anonymous numeric actor/system identities, an optional parent/source
identity, a fixed event category or allowlisted event name, lifecycle status and an allowlisted
machine label. Ownership comes from public snapshot `children`, not private `_parent` fields.
Weak maps assign actor identities and correlate delivered event objects with resulting snapshots;
weak keys do not retain actors or payloads. Correlation queues are bounded. A bounded history can
refer to an earlier message/actor outside the retained window; it is not a complete audit log.

Never copy event payloads, snapshot context/value/output/error, action parameters, arbitrary actor or
machine IDs, SDK references, identity/workspace/record IDs, URLs, credentials or recovery material.
Internal event names containing actor/state IDs are normalized to fixed categories; unknown names
become `other`. Redaction occurs synchronously before a record is buffered or exposed. The observer
never calls actor `send`, starts/stops actors, performs SDK effects or changes readiness policy.
Projection failures are contained so diagnostics cannot fail an application actor.

This is a bounded data projection/platform adapter, not an async workflow or resource-owning actor.
There are no business steps to orchestrate, so adding another XState machine would be redundant.
Its only lifecycle is the explicit browser opt-in; it remains usable while old actors drain after
layout destruction. Disabling clears records and makes existing callbacks inert.

## Justified cleanup

Remove the startup machine's SESSION_FAILED/SESSION_READY events: production has no senders and
application readiness already owns SDK status observation. Retain startup acquisition and its
existing retry/failed-actor recovery boundary. Remove workspace spawn `syncSnapshot: true` from the
application: the parent has no snapshot-event consumer, and WorkspaceBootstrap already subscribes
to the exact workspace actor. Keep all domain report and finite completion protocols.

No broad machine/controller consolidation is justified. Fixed children retain invocation ownership;
dynamic mapping rows and replaceable workspace attachments retain their independent lifetimes.
Record final ownership and remaining platform limits in plan.md and XState memory.

## Validation

Use real XState actors to verify creation/ownership, event-to-snapshot correlation, completion/error/
stop lifetimes, independent roots, bounded buffering and adversarial private values. Verify development
opt-in, disabled/production/storage-failure behavior and immutable detached read results. Browser checks
must show root/workspace/form coverage, an empty/default API, safe recovery input, and clear/disable.
Run the affected startup/application/form checks and a final orchestration unit regression set before
starting the disposable browser server. Record actual results and any exclusions when complete.

## Developer usage

In a development browser console:

```js
sessionStorage.setItem('delightful:actor-inspection', '1')
location.reload()
```

After reload, use `window.__delightfulActorTrace.read()` for a detached array of immutable sanitized
records. `clear()` drops the visible history; `disable()` clears it and makes the installed observers
inert for the rest of that page lifetime. To keep it disabled after reload, remove the flag with
`sessionStorage.removeItem('delightful:actor-inspection')`. Reload starts a fresh system budget.
Never wire a raw XState event logger or external inspector alongside this API to obtain payloads.

Each event record names an anonymous target actor and optional source. A snapshot's `cause` points
to its delivery sequence when correlation is available; ownership records link parent/child numbers.
System numbers distinguish independent actor roots. Lifecycle status establishes creation, activity,
completion, error and stop observations; domain policy/outcome reconstruction is deliberately excluded.
Use the [ownership map](architecture.md) and machine source to interpret fixed labels. Unknown labels
and dynamic event names are suppressed rather than guessed or emitted verbatim.

## Implementation review and verification

Inspection is a synchronous allowlist projection and bounded buffer. Its public view contains no
inspection callback or actor operations. Actor/system references and event payloads are never stored
as trace values; anonymous metadata and weak-key correlation are the only bookkeeping. The adapter
contains projection exceptions and storage failures. The normal disabled path omits the inspect option
entirely. Fixed allowlists and scalar projection prevent nested private data from escaping indirectly.

Source review covered every production actor creation boundary. PWA update code runs only outside
development and is intentionally untouched; remaining matches are test fixtures. No native HTML,
permission policy, provider behavior, actor parentage or lifetime changed for instrumentation. The only
behavioral cleanup is removal of the two proven unused startup commands and unused snapshot forwarding.

- 1,049 unit tests pass across 68 src/lib test files, including 11 new inspection tests and affected
  startup/application/form regressions. The final projection narrowing rerun passes all 11 inspection tests.
- `pnpm check` passes with zero errors and warnings; `pnpm check:tests` passes.
- `FINANCE_PREVIEW=true pnpm build` passes, including production client, server and service worker.
- Three diagnostic browser checks pass: default off, opted-in multiple roots/private data/clear/disable,
  and unavailable storage. Nine shared-form browser regression checks also pass.
- Nine final recovery browser regression checks pass, bringing the focused browser total to 21.
- Prettier and `git diff --check` pass.

The privacy unit cases include recovery/provider/finance-shaped payloads, arbitrary actor/machine/event
names, raw outputs/errors and getters that throw if context/state/output/error/action parameters are read.
Real actors verify message correlation, ownership, completion/error/stop and independence. History and
system bookkeeping are bounded; overflow omits uncertain correlation rather than assigning a false cause.
These checks validate the trace boundary; they do not constitute a production telemetry/privacy guarantee
for unrelated SDK logging, browser extensions or code that deliberately exposes raw inspection events.
