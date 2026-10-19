# Account merge interaction contract

All account-merge presentation lives on the dedicated `/account-merge` route,
including source choices/summaries, connection, destination previews, results and
recovery. Keep the existing `/login` route and navigation unchanged while this
feature is developed; no automatic redirects to the merge route. The eventual
merge-specific recovery-phrase form offers Merge local data / Use connected account
only choices, plus Cancel. All strings use Paraglide; reuse existing controls and visual conventions. Never show secret phrases in summaries or logs.

Before switching: show counts, source workspace, scope of copied records and excluded bank connections. Invalid phrases leave the current identity unchanged. After successful target readiness: show destination workspace, additions/existing/conflicts and require Confirm import before finance writes. Cancellation at this stage leaves the connected identity selected and preserves the source snapshot.

Machine commands: CONNECT with transient phrase and merge/remote-only intent; CANCEL; CONFIRM_IMPORT; RETRY; RESUME; RETURN_TO_SOURCE with transient authentication if required; DISCARD_SNAPSHOT; SHUTDOWN. Observations carry SDK identity/client readiness, workspace bindings, permissions and journal availability. Secrets must be cleared on every terminal path and never included in durable events/logging.

Presentation receives machine-owned availability and result descriptors, counts, conflicts and callbacks. It does not derive readiness from prop combinations or access Jazz. The application owner serializes session replacement and waits for workspace/bank cleanup.

Outcomes: completed locally, partial with committed/skipped/conflict counts, cancelled with whether identity changed and whether additions exist, failed with recovery action. Remote synchronization confirmation is a separate supported fact. No automatic provider calls, automatic retries, destructive rollback or silent source deletion.

On reload, detect a pending journal and offer resume/discard before another merge. Resume requires the journal's exact target identity and destination. Prevent overlapping operations across tabs and state clearly when another tab owns the operation.

## Current route delivery: source copy (awaiting review)

The temporary Check-this-workspace panel, capture-unavailable message and separate
presentation machine have been removed. `/account-merge` now composes the merge
coordinator integration and pure `AccountMerge` presentation. Opening the route
loads the device-local journal without capturing source records or changing
finance data or identity.

When no saved copy exists, Prepare a source copy invokes ordinary local-first
reads through the existing capture actor. Show the captured workspace name and
account, transaction, category, tag and excluded-bank-connection counts. Explain
that this copies records currently available on this device; unsynchronized remote
records and later edits are outside this copy. Validation failures and unavailable
sessions/storage expose explicit retry actions.

Save copy for merge creates the journal only after explicit confirmation. A saved
copy is shown after reload; another capture cannot replace it. Discard saved copy
explicitly removes only the journal, with explanatory text before the action.
Concurrent changes are rejected by the existing atomic journal comparison.

State ownership: recovering journal -> assessing source -> available -> capturing
-> review -> preparing journal -> saving -> saved. Journal access also handles
explicit discard. Cancel/shutdown during journal access remain nested under its
owner until the journal actor settles. A commit racing cancellation remains a
saved recoverable copy. Shutdown takes precedence and finishes child cleanup
before the root is stopped. Capture owns subscription cleanup on cancellation or
scope changes. One native SDK session subscription fans observations out to the
coordinator and capture actors, and is released after the last actor detaches.

This source-only coordinator is currently route-owned. Before enabling account
restoration it must move outside the SDK's identity-bound workspace subtree and
integrate workspace/bank shutdown. This slice collects no recovery phrase, switches
no identity, inserts no destination data and makes no provider requests. The saved
view explicitly says that the copy has not been imported. `/login` and navigation
are unchanged.

The old presentation-machine tests were retired with that machine. After review,
add coordinator/capture unit coverage and replace the old Check-oriented browser
scenarios with capture/counts, save/reload/discard, scope/error/cancellation and
read-only finance behavior. No tests were added or run for this implementation.
