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


## Isolated route delivery

The first route slice is read-only: localized introduction, capture/reconnection
explanations, unavailable import action, and an explicit check of the currently
selected destination workspace. It collects no recovery phrase and performs no
identity replacement, finance mutation or provider operation. It does not claim a
source summary before coherent capture is supported and does not display sample
finance data. Destination eligibility is advisory; import remains unavailable.

`AccountMerge.svelte` is pure presentation receiving the machine's view and
callbacks. The route binds session/selected-workspace facts to its presentation
machine and mounts the concrete destination integration only for an explicit
request. The view owns waiting, session unavailable, workspace selection,
available/checking/eligible/denied outcomes. Each check has a distinct request
object; stale callbacks from cancelled/replaced checks cannot update a newer view.
Navigation/cancel closes active destination checks; teardown closes the child
before stopping the presentation owner. The integration avoids sending shutdown
to already-completed actors. Subsequent feature panels remain on this route.

The page uses existing controls and Paraglide strings with no added styling.
This initial slice awaits implementation review before new tests.
