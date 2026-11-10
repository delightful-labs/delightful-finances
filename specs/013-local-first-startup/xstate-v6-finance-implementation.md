# Finance v6 conversion and worker migration

Status: connected-graph conversion qualified by unit/type checks; application
worker handoff remains in progress. No production deployment is included.

The user authorized completing Finance implementation and tests together while
away, then applying the Clipper findings to the other maintained repositories.
That supersedes the earlier per-batch implementation/test review pauses.

## Converted graph

Finance uses unpatched XState 6.0.0-beta.1 and Svelte binding 6.0.0-beta.0.
The official 0.1.0-beta.1 codemod was followed by manual contract, generic
input/output, resource, parallel-region, invocation and error-handling fixes.
Production machines, their test graphs and browser restoration probes use native
schemas, function transitions, queued effects and logic factories. SDK and
transaction handles retain their owning actors and graceful drain protocols.

The qualified DLF artifact incorporates source commit
`dbc452eda6d874e67f24ec971be0a689dca8ef68`, preserving Finance's existing alpha.60
native adapter delta. DUI uses `7a7f61b236220bb5edb2bef4390b9db075775e43`'s v6
artifact; exact lineage is recorded in `vendor/xstate-v6-provenance.json`.
Superseded archives are removed. Jazz retains its reviewed alpha.60 worker patch;
XState has no patch or declaration override.

Native qualification exposed issues a codemod cannot resolve: replayed mutable
drain bookkeeping, lifecycle handlers consuming unrelated invocation errors,
failed children removed before lease retirement, and invocation input reading
values only assigned by entry. DLF's initial/retried form watcher and workspace
initializer were fixed at their shared source. Finance's integrity and transaction
inputs now bind the admitted facts directly. Test fakes preserve native handle
opacity, and child-crash tests exercise actual actor failure rather than forge
kernel notifications. Stale domain reports remain covered.

Inspection consumes native v6 events and projects bounded, sanitized actor
topology for the hosted viewer. It does not transmit live context, SDK handles,
credentials, finance rows or raw error payloads. Initialization failures are also
observed through actor creation when no transition exists.

## Validation

- Finance unit suite: 140 files, 1,909 tests passed on Node 24.22.2.
- Application check: 2,082 files, zero errors and warnings. Local checks read
  existing generated localization artifacts whose catalogs match this checkout;
  catalogs, localization configuration and generated content were not changed.
- Playwright/probe TypeScript, service-worker TypeScript and isolated worker-state
  TypeScript checks pass.
- Native host tests: 36 passed, included in the full unit suite.
- Isolated worker-state tests: 17 passed, including the published `@xstate/test`
  100-run custody campaign (seed 60401). This is generated coverage, not exhaustive
  native interleaving proof.
- DLF's composed form, readiness and startup regression suites: 22 passed, with
  library TypeScript and declaration packaging checked separately.

## Remaining worker work

Finish the recursive calculation-purity audit before final migration acceptance.
Remaining clock/identifier creation in bank-operation transitions and backup
request preparation in entry calculation need owned effect/leaf boundaries;
passing behavioral tests alone does not establish that these calculations are
safe to preview or repeat. Preserve backup's requirement that raw passwords stay
outside actor snapshots while making that change.

The bounded storage/broker bridge, correlated independent host drain, account
operation charts and bounded AccountStore owner/facade are foundations. They are
not activated in the application. The SDK, domain machines and subscriptions
still belong to Window in this conversion checkpoint.

Before activation, qualify worker termination against queued Window storage
writes and native Web Lock release. Worker-held locks may disappear before a
queued Window write; graceful actor drain alone does not prove crash safety.
Resolve that custody boundary, then implement the worker-owned session/domain
tree and validated UI commands/projections without a duplicate Window SDK owner.
Window retains navigation, WebAuthn, files and canvas capabilities.

Qualify the actual handoff, shutdown, replacement, account switching, offline
writes, cold restart, multiple tabs and host failure in browsers. Preserve explicit
provider consent and uncertain-write custody. The passing conversion checks do
not complete or certify this remaining worker migration.
