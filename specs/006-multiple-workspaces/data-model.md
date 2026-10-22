# Creation/startup data model

## Existing durable entities

- **Organization**: UUID id, name, kind, defaultCurrency, ownerId. Trim nonblank name; duplicates permitted. Retain existing enum values for compatibility in this slice; explicitly created workspaces use the existing personal value as a storage placeholder with no privileged product meaning. Do not derive grants, sharing eligibility, or startup preference from kind. Retain ownerId as creator/bootstrap compatibility; do not interpret it as the future complete owner set.
- **Organization member**: stable id for this creation attempt, organizationId, current userId, profileId, owner role and all account mode under current policy compatibility. Future owner/capability work replaces the relevant assumptions explicitly.
- **Profile**: reuse the current identity’s actual profile row. Never replace name/avatar or create another profile for an additional workspace.
- **Category**: stable id derived from organization id + stable seed key/kind; localized initial label, kind, isSystem. Seed optional defaults only as part of creation. Preserve required system-category integrity separately; do not infer a missing optional category needs replenishment.

## Additive initialization receipt

Add optional `initialWorkspaceId` to the identity profile as **initialization provenance**, not a home/selection preference. New bootstrap writes it with profile, organization, membership, and categories in one local transaction. For existing identities with readable workspaces, record a receipt without rewriting their finances; choose a deterministic identity only as receipt provenance, never as an active selection. Validate this optional schema addition and deployed compatibility before use.

The receipt prevents ordinary startup from recreating an initial workspace or owner membership after access loss. It does not prove present access to its referenced workspace. Existing legacy rows with no receipt need an explicit compatibility path: readable workspace means already initialized; no readable workspace plus no receipt is ambiguous. Do not regrant inaccessible legacy data automatically.

## Local creation-attempt record

Device-local durable metadata, one pending slot keyed by app ID + server URL + authenticated identity, with the attempt UUID in its frozen payload. The journal is not a transaction draft and stores no unfinished transaction input or credentials.

Fields: stable attempt/workspace/member/category IDs; current profile reference; frozen validated name, currency, kind and complete category seed payload; identity/environment binding. Lifecycle is represented by machine states, not a journal phase flag. Persist the frozen accepted creation payload before issuing the Jazz transaction. Completion is reconciled from actual matching local records and persistence outcomes, not guessed from a success flag.

The IndexedDB resource statechart performs atomic compare-and-write on that slot. A competing tab with a different payload gets a conflict; explicit Retry reloads the shared slot rather than overwriting it. Create another clears only the matching completed attempt. Do not clear, reuse, or migrate user persistent Jazz storage. If recording fails, do not issue creation; show a retryable local-storage failure. Different deliberate Create another actions use different attempt IDs, even for matching names. Retries/reloads of the same recorded attempt retain IDs and frozen seed/name values. No automatic write replay on reload: reconcile and expose explicit retry.

## Atomicity and conflicts

One Jazz transaction creates organization + owner membership + categories (and bootstrap profile/receipt where applicable). Recheck same identity/binding and required profile observations at issuance. A retry checks exact IDs, relationships, owner authority, currency, and required system records. Reconciliation allows subsequent display-name/category edits and deletion of optional starters without reseeding. Complete matching records yield existing result, absent records permit the same attempt, and inconsistent/incomplete records yield conflict for recovery. Do not upsert existing organizations or categories over user edits. After a completed creation, later user modifications must not be treated as evidence requiring a second workspace: retain the attempt identity and classify existing ownership/record evidence conservatively, with no rewriting.

Stable attempt IDs prevent duplicate logical entities on retries. Concurrent clients have separate deliberate attempts; same names are allowed. This design does not claim globally serialized mergeable transactions or server approval from local reads. Real-server rejection is handled through existing failure observation and does not authorize creating a new ID automatically.
