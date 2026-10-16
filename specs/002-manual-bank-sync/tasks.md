# Implementation tasks

- [x] Align plan, research, model, contract and quickstart with passkey specification.
- [x] Implement validated, scope-bound PRF encrypted credentials.
- [x] Add encrypted connection schema and owner permissions.
- [x] Add schema migrations and the mapping-to-connection relationship; verify dev-server deployment and workspace startup/reload without resetting data.
- [x] Add restricted SimpleFIN Bridge relay and provider adapter.
- [x] Add explicit XState connection/discovery/sync workflows and mapping UI.
- [x] Split setup into explanatory XState views with explicit encryption, unlocking, and final-save actions; hide the form while setup is active.
- [x] Default discovered accounts to adding a provider-named local account and mapping in one transaction; show optional existing-account mapping only when local accounts exist.
- [x] Add deterministic validated transaction import and outcomes.
- [x] Run formatting and type checks.
- [x] After implementation approval, add and run focused unit/Playwright coverage (34 unit tests and 4 Playwright tests; synthetic WebAuthn and mocked provider responses).
- [ ] Validate physical-device passkey compatibility and encrypted replication.

- [x] Add a standalone XState passkey demo accepting dummy text, without SimpleFIN requests, token validation, or finance writes.

## Environment-controlled bank demo

- [x] Add optional `PUBLIC_SIMPLEFIN_DEMO` (default false), simulated provider responses, and relay protection. Implementation awaiting review; tests not added or run.
- [x] After review, retain identical bank-page presentation, add opposite-mode connection guards, and remove standalone demo artifacts. Implementation awaiting review; tests not added or run.
- [ ] After review, update documentation and add/run approved unit and Playwright coverage for demo and real modes.

- [x] Add the DUI visual stepper to active bank setup, retaining existing workflow controls. Awaiting review; tests not added or run.

- [x] Refactor authorization and operation sequencing into XState states and expose the application-scoped actor, typed snapshot, status, and events through getBankSync(). Awaiting implementation review; no tests added or run.

- [x] Review the full bank integration and split workflows into focused machine files with smaller invoked actors, direct child authorization, state-driven import traversal, and inferred global actor types. Awaiting implementation review; no tests added or run.

- [x] Model neutral connection states, complete/partial success, cancellation, and specific failures as explicit ready substates; move presentation keys to state metadata and remove message/phase flags and forwarding events. Awaiting implementation review; no tests added or run.

- [x] Move remaining readiness, last-sync summary, scoped account/mapping data, status descriptors, and setup-step progression into the machine model; forward raw query observations and keep only translation/date formatting in presentation. Awaiting implementation review; no tests added or run.

- [x] Add an observable application-readiness parent actor owning the bank child, with explicit session and organization-membership states and a shared context API. Omit unobservable Jazz transport state. Awaiting implementation review; no tests added or run.

- [x] Replace setup/operation preparation promises with a shared preparation machine and invoked identity-check child; expose authorization decisions as guarded transitions with focused query/ID actors. Awaiting implementation review; no tests added or run.

- [x] Split account routing, creation, mapping, unlinking, and shared write validation into invoked machines; retain atomic conflict checks. Formatting and type checks pass. Awaiting implementation review; no tests added or run.

- [x] Decompose import traversal into account and transaction child machines with explicit omission, duplicate, imported, and failure outcomes. Awaiting implementation review; no tests added or run.

- [x] Model bank access, credential readiness, and sync-control visibility in an observable availability child and remove flag-based classification from observation/view helpers. Formatting and type checks pass. Awaiting implementation review; no tests added or run.

- [x] Move provider mapping status, eligible destinations, and mapping action availability from presentation into per-provider child actors. Awaiting implementation review; no tests added or run.

- [x] Unify operation classification, persisted sync outcomes, and parent results through explicit complete/partial/failed/cancelled states. Formatting and type checks pass. Awaiting implementation review; no tests added or run.

- [x] Move setup baseline checks and insert/update selection into child machines; remove duplicated Flow.stage lifecycle state. Formatting and type checks pass. Awaiting implementation review; no tests added or run.

- [x] Replace conditional saved-result projection with an observable history child containing absent/succeeded/partial/failed states. Formatting and type checks pass. Awaiting implementation review; no tests added or run.

- [x] Fix all five lifecycle review findings: cancel-before-stop, global startup/workspace ownership, machine-owned bank section visibility, typed setup outcomes, and reset/cancel precedence on child errors. Formatting and type checks pass. Awaiting implementation review; no tests added or run.
