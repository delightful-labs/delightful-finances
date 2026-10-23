# Actor inspection decision

The custom development trace adapter, browser API, actor wiring and dedicated tests were removed
at the user's request in favor of using the XState tooling ecosystem when inspection is needed.
No replacement inspector is installed or configured.

XState provides an inspection API; Stately Inspector consumes it to visualize state machines and
actor communication. Evaluate that tooling before adding custom instrumentation. Any future
integration must exclude provider credentials and private finance payloads (FR-015).

The earlier custom implementation passed its scoped checks before removal. Historical test counts
in the feature artifacts describe that implementation and do not represent verification of this removal.

Removal verification: all 1,042 src/lib unit tests passed. All 34 selected browser cases passed,
including reruns after correcting stale route, workspace URL and checkbox-label expectations in
the existing account-order, pagination and authentication tests. Coverage includes shared forms,
account archive/order, sample transactions, recovery phrases, avatars and session recovery.
Application and test type checks passed. No unrelated full browser-suite rerun is claimed.
