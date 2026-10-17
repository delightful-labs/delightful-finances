# Required source capture guarantee

This is a capability request for SDK design/review, not an implemented API. No SDK
changes are included in this repository change.

## Problem

Merge must save a complete immutable finance graph before replacing identity.
Remote reads exclude pending local writes; local reads do not prove complete remote
scope. Combining arrays can resurrect pending deletions or choose stale versions.
Separate table reads may observe inconsistent versions while another tab edits.

## Required public contract

Provide a capture operation, or a documented composition of public APIs, that:

1. Authenticates the source and hydrates requested authorized query scopes, including
   archived records. Unreachable or unauthorized scope fails explicitly.
2. Establishes one coherent boundary across related tables, with defined handling
   of pending local inserts, edits, deletions and server rejections. Preserve local
   edits or fail explicitly; do not silently substitute remote values.
3. Defines participation of sibling-tab writes sharing storage. Later edits may
   remain outside the snapshot, but the captured graph must be coherent. Do not
   mutate source finance records or permanently disable editing.
4. Supports cancellation and bounded waiting without leaked subscriptions or
   reporting an incomplete graph as complete.
5. Returns typed data and completeness evidence without secrets or internal storage
   handles, and leaves the current session usable on failure.

A live pending-write barrier alone addresses only part of this contract: graph
consistency and writes arriving after the barrier still need defined semantics.
Coordinating every application writer would be a separate larger implementation
proposal, not an implicit addition to the login form.

## Application responsibilities

Validate the captured records and references, reject unsupported attachments before
destination writes, enforce reviewed size limits without truncation, and durably
save the snapshot in IndexedDB before workspace cleanup and identity replacement.
Capture evidence never substitutes for destination authorization.

## Verification after implementation review

Cover pending insert/update/delete, rejected local writes, cold remote scope,
offline timeout, sibling-tab edits across related tables, cancellation and
permission loss. Capture must return a coherent complete graph or fail explicitly,
without source finance mutations or identity replacement.
