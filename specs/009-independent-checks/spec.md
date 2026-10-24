# Independent check objects

Status: user approved staged Check creation and deferred exclusive check assignment. Simplified shared contracts ready for review.
Branch: `feat/independent-checks`.

## User outcome

A transaction refers to a check with its own stable identity. A user can create
that check inline when recording a transaction. Correcting the transaction’s
account or payment method does not require destroying or recreating the check.

The user confirmed both received and written checks. Income and expense use the
same check object and optional transaction reference; direction follows transaction
kind rather than a separate received/written discriminator on the check. The first
release keeps inline check controls on income only. The backend must permit an
expense to reference a check, but written-check visual controls are deferred.

The user approved optional paymentMethod for both income and expense. An attached
check requires paymentMethod `check`, and that method requires a check reference.
Other methods or an absent method carry no check reference. Keep current income
controls during adoption; do not introduce written-check controls in this slice.

## Proposed behavior for review

- A Check owns its check number/date and optional party, bank and check-memo data.
  Existing payer metadata remains supported; new payee fields/controls are deferred.
  Its ID is independent of the transaction ID. It belongs to a workspace.
- The transaction stores a check reference, not embedded check fields. One Save
  action first persists the Check, then saves the transaction referencing it.
  The interface treats this as one operation, with explicit partial failure handling.
  Cancellation before saving creates no Check; cancellation after the Check save
  may retain a detached Check.
- Preserve current number/date validation. Do not add amount, payee, clearance,
  deposit or void status requirements without a separate product decision.
- Exclusive check assignment is deferred. More than one transaction may reference
  the same Check ID. Do not add an assignment table, reciprocal assignment pointer,
  duplicate-reference policy or claim of global uniqueness. This does not detect
  separately created records representing the same physical check.
- Editing a check transaction may update check metadata. Switching away from
  Check detaches the reference and preserves the check record. Switching back
  within the same unsaved form restores that draft’s selection.
- Account movement needs a reviewed rule for shared Check references. Do not
  automatically move a Check's visibility scope on behalf of one transaction
  while other transactions may reference it. This contract slice adds no move effect.
- Reusing a detached check needs an explicit selection. Do not match records
  automatically by check number, date, payer or amount. A compact existing-check
  selector is in scope; a separate check catalog/management route is not.
- Detached checks retain an explicit account authorization scope. Workspace
  membership alone does not expose unrelated checks. Owners/admins and permitted
  account members can use the authorized set; viewers cannot mutate checks.
  No recipient obtains data from an account they cannot read merely by following
  a check reference. Account movement checks both old and new authority.
- Retain the saved Check ID if transaction persistence fails. Retry the transaction
  save using that Check rather than creating another one. Report full success only
  when the transaction is saved. Preserve explicit partial and uncertain-settlement
  outcomes; do not silently delete an independently saved Check as rollback.
- Offline local persistence remains separate from remote authority acceptance.
  Staged creation must preserve ordinary local-first saves; verify remote ordering
  and rejection behavior without requiring an authority round trip for every save.
- Imported transaction provenance remains immutable. The common payment/reference contract does not depend on provider source.
  Provider synchronization must retain the existing user-edit preservation rule;
  no automated check matching or provider-driven check association is introduced.

## Unchanged requirements

Money uses exact integer minor units; transaction amount/currency remain on the
transaction. Check separation does not create another ledger entry. Existing
transaction kind, permission, attribution, local-first, cancellation and submitted
write settlement requirements apply. No automatic bank fetching is introduced.

## Review decisions and exclusions

Received/written backend scope is confirmed; written-check visual controls are
deferred. Optional payment method for both kinds is approved. Do not add a new check-direction field or income/expense check tables. Review detach/reuse and detached-record visibility
before implementation. These are proposed choices, not silently approved rules.
No existing alpha data is flushed and no schema is deployed in this design cycle.

## Approved simplification

The user approved deferring the one-transaction-per-Check restriction and creating
Checks before their transactions. This supersedes the earlier atomic creation and
check-assignment proposals. Canonical scope/payment compatibility remains required
for direct SDK writes. Written-check visual controls remain deferred.
