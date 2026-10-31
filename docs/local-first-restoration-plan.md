# Incremental identity-restoration adoption

Status: implementation for review; Finance restoration tests have not been updated or run yet.
Branch: `feat/identity-restoration-main`, created from main `629bd82` after PR #35 merged.
This follow-up can target main directly; it no longer needs a stacked PR base.
Library branch: `feat/identity-restoration-plan` (reviewed working-tree snapshot, not yet committed).

Finance consumes `vendor/delightful-local-first-0.0.0-restoration.tgz`, SHA-256
`6a7f3aef5dcc2fa2f656c0d3d49f22fcb3ff7f9154e6109c44989b3d7c692f05`.
The superseded recovery archive is removed. The current DUI archive is retained.

## Implemented ownership

`src/lib/machines/identity/session-recovery.ts` currently owns validation, preparation acknowledgement,
the issued Jazz restoration, identity reading, and navigation. Its application parent outlives the
login route, drains workspace resources, and reattaches after mutation settlement. Preserve those
lifetimes. A component-owned promise would lose an issued operation when navigation unmounts it.

Validation and restoration now run in an invoked library child. The existing Finance wrapper
keeps navigation and protocol translation; application readiness remains the workspace drain owner.
LoginForm, the login route, startup, schemas, and catalogs are unchanged.

```text
application readiness
└─ existing session-recovery wrapper
   ├─ invoked library restoration child
   └─ existing navigation/check/retry states
```

The library child reports validation and preparation request using attempt + session binding.
The wrapper forwards the existing `RECOVERY_VALIDATED` / `RECOVERY_DRAIN_REQUESTED` notices;
application readiness still owns draft reset and actual resource cleanup. The wrapper forwards a
matching `WORKSPACE_DRAINED` acknowledgement as the child's preparation permit. Reject stale
correlation and duplicates. No parent reads child context to infer progress.

The layout supplies a synchronous binding factory to application readiness. The factory creates
the adapter for its existing session using `getCurrentJazzSession` as the live accessor, only for
restore requests. Navigation-only retries acquire no adapter. The wrapper supplies that fixed
capability through actor input to the library `restorationMachine`, since the session becomes
available after machine definition. It clears its own phrase request after child input is bound,
and invalidates/releases the adapter when the restoration compound state exits. No SDK parsing,
credential context, session mutation, or identity-read actor remains in the Finance wrapper.

Once the SDK restoration is issued, cancellation/shutdown retains the invocation until settlement.
The child clears its phrase/credential references and returns sanitized output without secrets.
The wrapper checks the current identity, readiness, and origin URL before navigation. Navigation-only
retry preserves the existing guarantee that it cannot repeat the identity mutation. The application
keeps observer/startup-failure priority and reattaches from actual session facts, including same-client
failure. A rejection does not imply rollback, unchanged identity, or permission to automatically retry.

## Recursive machine-first audit

The library owns assessing → validating → awaitingPreparation → restoring/settlingCancellation →
readingIdentity and its finite outcomes. The wrapper's validating/awaitingDrain/operating states own
only the host handshake; it forwards matching binding/attempt reports and one preparation permit.
Its closing state keeps the same library invocation until terminal output. Wrapper navigation facts
are one related synchronous snapshot/URL projection; navigation is one existing leaf call.
`identityUnavailable` maps to Finance's existing navigation-failure result without a retry identity,
not a claimed usable identity. A rejected restore maps to restoreFailed; cancellation maps to closed.
Unexpected child crashes propagate as a sanitized application failure rather than a fabricated
settled result. Stopping/crashing an owner cannot guarantee settlement of an SDK call already issued.

No hidden async preparation, promise bridge, registry, second client, or duplicate restoration owner
is introduced. Report correlation is checked in the wrapper; application readiness retains its
existing attempt correlation and workspace/observer/startup/shutdown priority.

## Static verification

`pnpm check` reports zero errors/warnings. Frozen-lockfile install, focused formatting, and diff
checks pass. Installed module resolution confirms shared physical Jazz, DUI, Svelte, and XState
instances. Library package validation passes. These checks do not establish runtime correctness.
The earlier 47 library tests qualify the pre-adoption fixed-capability API; the new invocation-input
entry and the Finance wrapper need the next approved tests.

## Focused verification after review

1. Add coverage for the library's new supplied-capability entry and repeat affected library tests.
2. Inject a typed binding factory into Finance readiness fixtures before running them. Omission is
   supported for non-recovery callers, but a host enabling RECOVER must supply the factory.
3. Adapt the old child-context assertions to the public protocol and actual cleanup/settlement.
4. Exercise protected authentication browser scenarios on a disposable agent server; do not rerun
   unrelated domain suites. Only after those checks qualifies this adoption for a main-targeted PR.

Affected unit coverage is the application-owned account recovery block in
`src/lib/machines/runtime/application-readiness.test.ts`: invalid draft, matching drain, stale
notices, duplicate requests, interruption, retained issued restore, same-client failure, and
navigation-only retry. Existing fixtures inspect old child context; replace those with observable
protocol/cleanup assertions where the extraction makes the context private.

Affected browser coverage is `tests/authentication.e2e.ts`: invalid inputs preserve identity/data,
restoration across contexts, restore failure/session retry, navigation failure/retry, route departure,
and empty restored-workspace behavior. Keep its credential artifact protections. Reuse only a known
disposable agent server and finish generated-environment checks before browser work. No Finance tests have been changed or run in this implementation review cycle.
