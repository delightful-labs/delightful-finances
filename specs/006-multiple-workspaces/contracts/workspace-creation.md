# Workspace creation UI and operation contract — proposal

## Entry and result

Use existing `/settings/workspace` integration with an explicitly labeled Create workspace form separate from rename semantics. This creation foundation introduces no route moves; the approved route-scoping cycle will provide its workspace-specific URL. Inputs: name only; trim and reject blank values, permit duplicates. No account or transaction cloning, currency choice, capability editor, or kind selector.

Eligibility: ready application identity, exact live database binding, usable matching profile. Existing workspace role/membership is not a prerequisite to owning a new workspace. Eligibility/readiness are machine-owned. UI receives typed presentation props and callbacks only.

Events: observe facts, submit name, retry/reconcile current attempt, explicit create another, cancel, shutdown. Repeated submit while active cannot create another attempt. After validation, freeze request and IDs before persistence. Ordinary name field state is not a financial transaction draft.

Output outcomes: locally persisted workspace, cancelled before issue, cancelled after actual settlement, failed before issue, known persistence failure, unresolved submitted write, or conflict. Outcomes include original identity/environment/attempt/workspace identifiers and actual settlement where known. No outcome says remotely confirmed without authority evidence.

Success leaves active workspace unchanged and exposes the new workspace in the existing selector. If route/identity attachment is stale, do not send selection/reset events to replacement owners. No automatic provider request.

## Bootstrap and selection

Warm initialized startup must not create more workspaces, prefer kind personal, or replenish deleted optional starter categories. An initialization receipt must not regrant lost membership. Unknown cold empty data shows unavailable/retry rather than pretending a globally new identity. First initialization can use an authoritative prerequisite while preserving warm offline operation.

D3 is approved: derive active workspace from the route’s stable workspace ID, independently per tab. The selector navigates to the corresponding scoped route; reload, direct links, and history retain that scope. Unavailable explicit workspace links must not fall back to another ledger. Concrete route mapping, legacy links, and workspace-less entry are addressed in the focused routing design. No synchronized global selection or device-default storage is implied.

## Deferred contracts

Invitations, capability/role bundles, owner administration, narrow shared metadata policies, archive, and account merge remain later contracts. New local creation code must not treat kind or ownerId as an exclusive-owner invariant. D3 now approves route-based workspace persistence, implemented in a separate focused navigation cycle.
