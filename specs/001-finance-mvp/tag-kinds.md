# Tag kinds and duplicate-name implementation design

Status: compatibility policy and implementation approved; focused automated verification passed.

## Behavior

New tags require `kind: 'expense' | 'income'`, whether created in settings or
inline with a transaction. Their optional category must belong to the same
organization and kind. Active tag names are unique within organization + kind,
using the same `normalizedName` helper as accounts and categories. A tag may
share its name with a category or with a tag of the other kind.

Settings must expose the kind selector and distinguish same-name income and
expense tags in the list. Changing kind filters category choices and clears a
selected category that no longer matches. The machine independently rejects an
incompatible submitted category.

## Accepted compatibility policy

Use an additive optional storage column so existing tags remain readable. Require
a kind in canonical validation for every new tag; do not default old tags to
expense. Preserve existing transaction-tag links and historical display. Tags
without a kind remain visible in settings with localized feedback that their kind
is unassigned, and are excluded from new transaction selection. A later reviewed
migration assigns or splits them. This is a transitional storage representation,
not permission to create new untyped tags.

Do not automatically infer kinds from partial transaction history: account-scoped
read permissions can hide relevant usage. A linked category alone also does not
prove that all past assignments match that category's kind.

Migration alternatives to review separately include assigning a single supported
kind where complete history agrees, splitting mixed-kind tags while preserving
links, and explicitly assigning unlinked/unused tags. Name collisions and retries
need explicit policy before a migration writes data.

## Ownership and state model

The existing scoped form owner retains reset, close, cancellation, scope change,
and issued-write settlement behavior. No new lifecycle flags or custom actor
bridges are needed.

Management integration owns current tag/category subscriptions. Its assessment
intent includes submitted tag name, kind and optional category ID. The management
machine first applies existing readiness and authorization guards, then rejects
an unavailable or mismatched category, then takes a `duplicateName` guarded
transition or becomes ready. Presentation renders the typed outcome and preserves
form values.

Transaction integration observes current active tags for its organization and
kind. The transaction machine checks account/category authorization first, then
assesses each submitted normalized tag name. Exactly one matching active tag is
reused; no matching active tag means inline creation; multiple matching active
tags produce an explicit ambiguous-name outcome. Other-kind and untyped tags are
not candidates. Archived names may be reused by a new active tag. Reusing a tag
does not change its category.

The database transaction retains a narrow compare/write check against current
organization + kind + normalized name, and inserts new tags with transaction kind
and category. It must not silently choose an arbitrary duplicate or assign a tag
of another kind. Changes between assessment and commit must fail safely. These
local checks do not guarantee uniqueness across disconnected replicas.

## File scope

The coordinated implementation touches schema/tags.ts,
validation/tags.ts, management-contract.ts, machines/management.ts,
components/TagForm.svelte, components/TagList.svelte, settings/tags/+page.svelte,
transaction-entry-contract.ts, machines/transaction-entry.ts,
components/TransactionEntry.svelte, data.ts, and localization as needed. Reuse
existing name normalization and form feedback. Adjust the canonical spec, plan,
and task status to record the accepted compatibility policy.

No existing data has been rewritten or deployed as part of this batch. Schema
migration generation must follow the repository's Jazz workflow, with generated
artifacts reviewed separately if they significantly enlarge the batch.

## Verification after implementation review

Unit coverage must include settings guards for same/other kind, organization,
case/whitespace, archived names, mismatched categories, and stale observations.
Transaction coverage must exercise single-tag reuse, inline creation, ambiguous
names, archived-name reuse, and kind/category persistence. Browser coverage must
exercise both income and expense settings and transaction entry, retained form
values after duplicate feedback, and historical display of untyped tags. Update
existing fixtures to provide kinds without claiming old expectations still cover
the new behavior. Do not add or run tests before implementation review.

## Implementation review notes

Settings guard duplicate active names and mismatched category kinds. Transaction
entry has an explicit `checkingTags` state and `ambiguousTagName` outcome; a single
matching tag is reused by the atomic writer, and an absent active name creates a
new typed tag. Archived names can be reused. Historical displays and link IDs
remain unchanged. The local Jazz migration was generated and reviewed: it adds
nullable `tags.kind` with a null default, preserving all old rows and associations.
The migration and snapshot are prepared locally and have not been deployed.

After implementation approval, canonical validation and persistence expectations
were updated, including archived-name reuse. All 136 focused unit tests and all
three isolated browser scenarios pass, along with application/service-worker and
browser-test type checks and focused formatting/whitespace checks. Browser
verification required fixture/locator corrections and no production changes.
See tasks.md for coverage and limits. Existing-tag reassignment/splitting and
remote schema deployment remain deferred.
