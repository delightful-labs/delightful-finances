# Paired transfer authorization investigation

The transfer recovery regression was caused by two independent permission issues, not the
application drain barrier. Experiments use the real full Finance policy on the pinned
`jazz-tools@2.0.0-alpha.59`, in a disposable isolated checkout.

## Evidence

A new policy regression creates both marked transaction endpoints and their transfer in one
mergeable transaction and waits for global acceptance. Older transfer policy tests seeded these
rows through the trusted fixture before testing subsequent operations, so did not exercise this
creation authorization graph.

| Policy shape                                                                                                                    | Actual result                                                           |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Two nested account-write predicates and mutual new-row reference checks                                                         | Global wait does not finish within the existing deadline                |
| Factored transfer account-write predicate, retaining both reference directions                                                  | Authority explicitly rejects the new pair                               |
| Factored account predicate, removing only transfer endpoint validation (diagnostic only)                                        | Accepted                                                                |
| Factored account predicate, removing only endpoint-to-transfer insertion validation (diagnostic only)                           | Accepted                                                                |
| Equivalent distributed boolean expressions                                                                                      | Still rejected                                                          |
| Equivalent joined endpoint query                                                                                                | SDK rejects policy publication for unsupported nested outer correlation |
| Factored account predicate, direct manual-insert authorization, retaining transfer endpoint validation and marker-update checks | Accepted                                                                |
| Direct manual-insert authorization, retaining the original nested transfer account predicate                                    | Global wait still does not finish within the existing deadline          |

The original browser recovery regression reaches SDK readiness with the factored account predicate,
but the authority rejects and rolls back the transfer. That is not a fix: retaining the rows is part
of the regression and remains asserted. Existing linking/unlinking passes with this factored
predicate in the current browser fixture; the older memory warning is not proof for this version's
entire behavior.

[Jazz's permission documentation](https://jazz.tools/docs/auth/permissions) explicitly disallows
new rows granting one another access in a cycle. A transaction may reference its own authorized
writes, but authorization must ultimately be grounded in existing records or independently
admissible new records. Write order does not resolve the cycle. The existing account and workspace
membership facts are suitable roots; the new transfer and its new endpoints are not independent roots.

## Approved acyclic insertion boundary

1. Use the existing `canWriteTransferAccounts` expression for transfer insertion. It checks
   owner/admin or all-account member rights, or selected-member write grants to both endpoint
   accounts. Keep `transferEndpointFactsMatch` unchanged.
2. Continue requiring `canWriteTransaction` for every new transaction. This retains account/workspace
   write access, category/account tenancy, currency/archive checks, and check-reference validation.
3. Permit new manual transactions under those direct checks, including their forward transfer
   marker. Unmarked insertion and the existing relationship-based insertion path remain available.
4. Keep all marker-update, existing financial-fact immutability, read, delete and complete-transfer
   validation unchanged. Keep the three-row operation atomic and locally settled; no remote preflight,
   exclusive transaction, timeout increase, SDK shutdown bypass, or data migration is introduced.

The implemented insertion guard is:

```ts
allOf([
	canWriteTransaction(transaction),
	anyOf([
		transactionHasNoTransfer(),
		{ source: TRANSACTION_SOURCE.MANUAL },
		transactionTransferRelationshipExists(transaction)
	])
])
```

This is a real integrity-policy change: a manually constructed standalone manual transaction with
an orphan transfer marker is no longer denied at insertion solely because its transfer is
absent. It still requires ordinary account authorization, and creating an actual transfer row
still requires full endpoint facts and write access to both accounts. Finance's existing
transaction statechart validates and stages a complete pair; observed malformed/conflicting links
remain integrity errors. The user explicitly selected this smaller fix. It does not preserve the old marker-reference
insertion guarantee. No account-access or complete-transfer fact check was removed.

If server enforcement of every marked new transaction's relationship is mandatory, merely
rearranging predicates cannot meet it on this SDK. A larger acyclic representation needs a separate
schema/permission design; splitting the current pair across commits would lose atomicity and is
not an acceptable workaround.

## Verification coverage

- Real global acceptance of same- and cross-currency pairs and the held-write recovery browser case.
- Creation/linking/unlinking/deletion under the complete policy, not trusted seeding alone.
- Owner/admin/all-account and selected-member access to both endpoints; deny a missing grant,
  read-only grants, viewers, strangers, and cross-workspace/account/category mismatches.
- Reject forged transfer endpoint facts, and retain existing marker-update/financial-fact protections.
- Explicitly cover the changed orphan-marker insertion boundary rather than concealing it.
- Relevant source/browser types and formatting, then update the ownership plan and Jazz memory
  with the agreed boundary and results.

The five-case real browser run passes: held-write identity recovery with both transfer rows retained,
cross-currency creation, ordinary linking/unlinking, delete-both, and unlink-and-delete. The complete
permission suite adds a role/grant matrix, cross-currency global acceptance, forged-fact atomic
rollback, and explicit manual/provider orphan-marker boundaries. All 102 full-policy cases pass,
including 20 new paired-insertion and boundary cases. The full 21-scenario focused browser rerun
passes. Recovery additionally passes with a stronger assertion requiring SDK readiness, a live
client, no pending operation and no SDK error, plus exactly-once retained source rows. Full
source/service-worker checking reports zero errors/warnings; browser-test types, formatting and
diff checks pass. Refreshed GitHub CI remains a merge gate.
