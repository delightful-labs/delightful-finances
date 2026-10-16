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
