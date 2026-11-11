---
doc_type: contract
status: current
authority: normative
implementation: implemented
verification_status: partial
last_reconciled: 2026-11-11
---

> The 2026-10-22 review classified this existing interface document and
> checked its source ownership. It did not repeat live-account validation
> of every protocol claim. Verification remains partial.

# Conversation Cache Lifecycle

This document explains how the ChatGPT Web conversation cache works in ChatGPTBox.

## Overview

The conversation cache stores snapshots of ChatGPT Web conversations and their metadata to improve performance and enable features like reasoning data extraction and local API server integration.

## Data Stored

- **Conversation Index**: A list of all conversations with basic metadata (title, update time, etc.).
- **Conversation Snapshots**: The native conversation JSON, including message history, current node, and (for paginated responses) `page_info`.
- **Metadata**: Global cache state, including last synchronization timestamps.

## Synchronization Mechanism

The cache uses a safety-first, opt-in approach:

1. **Manual Full List Sync**: After history synchronization is enabled, a user can explicitly start a full list sync. It reads 100 conversations per request, applies the configured RPM limit, and saves every page immediately. It does not pre-download every conversation body.
2. **Optional Background Sync**: Automatic sync is off by default. Adaptive or fixed scheduling can be enabled; every scheduled run reads only the newest 100 active conversations.
3. **Event-driven Invalidation**: Actions that modify a conversation mark only its cached snapshot as stale. They do not start a full list scan.
4. **On-demand Refresh**: When a stale conversation is accessed via the UI or API, that conversation is immediately re-fetched.
5. **Rate-limit Safety Lock**: HTTP 429 stops the current history job, clears automatic scheduling, preserves completed pages, and remains locked until the user reviews the settings and unlocks it.

## Concurrent index updates

The background owns the single serialized read/merge/write queue for the
conversation index. Proxy list pages, snapshots and extension-page imports send
restricted mutations through `CHATGPT_WEB_CACHE_MUTATION`; acknowledged creates
and turn-status changes use the same owner locally. The router explicitly
registers the local writer in both MV3 workers and MV2
background pages; DOM availability does not determine ownership. Snapshot index
messages contain metadata, not duplicated conversation bodies. Callers await
persistence before clearing their acknowledgement or reporting a page saved. A failed write
does not poison subsequent queue entries. Delayed list/snapshot metadata cannot
clear a newer locally acknowledged turn's running status.

This serializes index changes across extension contexts; it does not make body,
metadata, and continuation backups one atomic multi-key transaction. Import's
index merge reads the latest index inside that owner, while other imported keys
retain the idle-use requirement below. Local Box records and remote binding
snapshots have separate identities; cross-provider binding generations prevent
an old provider snapshot from resurrecting a discarded continuation.

Local Box session mutations also use a named background owner. A connection
switch declares its parent binding generation; an older window cannot replace
a later stored binding. Such a save fails visibly in the independent panel,
which offers reopening the stored conversation while retaining the current view.
This guards binding changes, not automatic merging of simultaneous transcripts
that still use the same binding: those writes replace the stored session in
queue order, so a later stale snapshot can overwrite same-generation updates.

Persisted-panel sends join this same queue before the provider starts. Admission
checks that the session still exists, validates its binding transition and saves
the chosen snapshot; a deleted or superseded session is rejected before dispatch.
The token-bearing start acknowledgement admits that request and lets the input
clear. A later connection switch does not cancel a request already admitted.
Retry admission retains the original completed record. A separate replacement
target lets API prompt context omit that answer while storage keeps it; only a
successful producer commits its replacement. Failed, stopped, incomplete and
rejected retries preserve the record on reopening. A new ordinary question or
connection choice clears that replacement intent.
Closing or switching a DSH observation view only disconnects it; the explicit
Stop agent session action requests shared-session cancellation.

Input drafts use `inputbox-draft:<draftKey>` in extension storage. Within one
live extension context, reads wait for prior queued writes and writes/removals
serialize by key. Edit versions prevent late loads or older saves from replacing
new typing or marking it saved. Explicit panel navigation/reopening awaits a
flush; failure keeps the view and draft. Blur, pagehide and unmount initiate a
final write. A delayed autosave checks the current edit/key and dirty flag when
it runs, so a cleared, admitted draft is not written back by its old timer.
Separate windows do not merge draft edits, and a process lost before
storage acknowledges the write has no durability guarantee.

## Long conversations

History reads follow the website's existing loading sequence:

1. Read `/backend-api/conversations/:id?num_turns=10&include_has_versions=true` for the newest page.
2. While `page_info.has_previous_page` is true, read `/backend-api/conversations/:id/messages?before=<start_cursor>&num_turns=10&include_has_versions=true`.
3. Prepend the older messages in their native order, deduplicate overlapping message IDs, and save the accumulated snapshot after every successful page.

The existing snapshot record holds `messages` and the server's `page_info`; there is no additional chunk format or independent paging protocol. Body backup applies the existing RPM gate to each request. Each page has its own request timeout, which starts after the RPM wait.

A 502, timeout, or Stop preserves successful pages. A subsequent read/body retry can continue from the native cursor when the cached conversation is still fresh. An updated conversation or explicit force refresh starts from the newest page. An `invalid_cursor` response permits one restart from the newest page, matching the website's behavior. Repeated cursors and invalid message IDs stop the load instead of silently completing it.

Only an unavailable initial pagination endpoint (HTTP 404/405) falls back to the legacy singular `/backend-api/conversation/:id` full-tree request. Auth errors, HTTP 429/502, and later-page failures do not trigger a full-tree fallback.

Native pages cover **the current branch**, including messages carrying version indicators; those indicators do not mean that every alternate branch was downloaded. Legacy full-tree snapshots retain their original mapping. The formatted history, library viewer, Markdown export, and settings statistics distinguish partial snapshots and current-branch coverage. Incomplete snapshots remain eligible for body backup even if the list update time is unchanged. Message traversal uses cycle detection without the former 256-node cutoff.

API reads with `userMessageId` or `assistantMessageId` select the requested branch using the native `include_message_id` parameter on the initial page. An explicit assistant ID takes precedence when both IDs are supplied, so regenerated answers remain selectable. A cache missing either requested ID is refreshed rather than reused, and cursor restarts preserve the selection. Anchored pages that exclude the server's current node do not replace the shared current-branch cache.

If an older page fails after a successful download, GET and answer refresh return that request's latest checkpoint with its own status, `history.complete: false`, and `cache.refreshError`. Refresh includes this metadata under `conversation` and can still read the resume stream. A failure before any new page is downloaded remains an error for refresh; it does not substitute an old cached answer. Full body backup and selected exports still require complete history.

## Export and Import

### Resource boundaries during large backups

The November 4 user report describes freezes/crashes after several hundred
conversations in a library of thousands. Inspection found that the generic
configuration hook retained snapshot storage events as configuration, and the
settings statistics reread every body on each progress event. These mechanisms
can amplify memory and work across open pages; the reporter's crash and exact
heap limit have not been reproduced.

Configuration consumers accept only declared configuration keys. Body snapshots,
indexes and job progress stay with their history owners. Live library statistics
read catalog metadata and key names, never all conversation bodies; coverage
without indexed metadata is shown as unknown. Refreshes are coalesced and have
at most one read in flight. Progress and Stop remain available during backup.
The backup still writes successful pages immediately and preserves its existing
RPM, HTTP 429 lock, and resume behavior.
The [November 4 evidence](evidence/2026-11-04-history-backup-and-functions.md)
records the regressions, controlled browser checks and resource-probe limits.

Full-file export reads one snapshot at a time and awaits the volume writer
before reading the next volume. It retains catalog metadata and the current
volume, rather than all raw bodies. Schema 2 and the importer remain unchanged.
A single unusually large conversation can exceed the volume target and still
requires memory for that snapshot. Export/import are not atomic snapshots of
concurrent history writes; use them while history jobs and chats are idle.

To prevent data loss and allow for migration, the cache can be exported and imported:

- **Export**: Creates schema-2 JSON volumes containing the local index, cached snapshots, metadata, and continuation state. Both settings **Export ChatGPT History** and API Server **Export Cache** use the same exporter. Export does not fetch missing remote history.
- **Import**: Merges volumes into the local cache, preserving native pagination cursors for incomplete snapshots. The former API Server version-1 cache exports remain readable.

Provider continuation snapshots retain both local session identity and binding
generation. Import preserves their composite keys rather than merging different
generations into one session entry. Clear removes that session's saved generations
and advances the authoritative local binding; a late old snapshot cannot restore
the cleared remote conversation.
If snapshot deletion fails after the binding commits, Clear keeps the new empty
conversation and reports the remaining cleanup so the user can retry it.
Surviving older bare-key entries remain readable only for a matching session
and generation. Import normalizes aliases before merging by freshness; a later
save writes the canonical key without letting an older alias replace the new
continuation position.
Conflicting conversation IDs within the same binding key are not combined with
each other's parent/message/WebSocket IDs.

Snapshot merges prefer the newer server revision. For the same revision, a complete snapshot wins over a partial one, a complete legacy tree wins over current-branch coverage, and a partial snapshot with more downloaded messages wins over a shorter one. Download time breaks equal-coverage ties; importing a recently interrupted copy does not discard history already cached locally.

### How to use:

For one conversation, open **ChatGPT History Backup** in the ChatGPT Web settings or **ChatGPT Conversations** on the API Server Bridge page. Both use the same conversation browser:

- Search the local list by title or ID, filter active/archived conversations, and page through the results. Listing reads metadata and storage keys, not every cached body.
- Click a title to preview cached messages. Missing bodies are loaded only for that conversation using the native pagination described above. A partial cache can be previewed offline and resumed with **Load remaining history**.
- Use a row's **JSON** / **MD** buttons, or paste a ChatGPT `/c/…` link or conversation ID and use **Export JSON** / **Export Markdown**. A fresh complete cache is reused; missing, stale, or incomplete contents are read for that selected conversation before export. A failed/partial read is reported instead of producing a complete-looking export.
- Select a conversation or paste its link/ID, then use **Copy as JSON** / **Copy as Markdown** to put the same contents on the clipboard. JSON keeps the importable backup format. Copying includes the full loaded transcript, regardless of the preview page; success is shown only after the clipboard write completes.
- A selected JSON backup contains only that conversation's index entry and raw snapshot. Other snapshots, global metadata, session snapshots, and continuation threads are excluded. It stays compatible with the existing schema-2 importer. Markdown includes the readable user/assistant transcript.
- Preview renders 20 messages at a time, initially showing the newest messages. Export includes the full loaded transcript, regardless of the preview page.

## Risks and Limitations

- **Browser Storage**: The cache is stored in `Browser.storage.local`. If the browser's local storage is cleared, the cache will be lost.
- **Data Freshness**: While sync intervals and event-driven invalidation help, the cache may still be out of sync if changes occur in another browser tab or on another device.
- **Concurrent Import**: Import reads the existing cache and writes its merged result in batches. Import while history synchronization, content backup, and chats that update the cache are idle: a write between that read and the import write can be overwritten, including a newer body snapshot or continuation record. Index merges separately use the background owner described above. Import is not an atomic transaction across all keys; retain the original volume files if a write fails. This limitation concerns the local cache, not deletion of conversations on ChatGPT's server.
- **Mixed Timestamp Imports**: Index merging does not yet normalize numeric Unix timestamps and ISO dates to the same unit. Older or mixed-format backups without a newer `lastSeenAt` can prefer older titles, archive flags, or list update times. Snapshot revision comparison separately normalizes seconds and milliseconds. Retain the original backup and verify list metadata after importing such files; v4.3.2 does not fix this boundary.
- **Performance**: File export measures records individually, then reads/writes one volume at a time, retaining the catalog and current volume. A single conversation or catalog can exceed the approximately 16 MiB target. Import and the explicit in-memory export helper still materialize their input; importing a very large cache can require substantial memory. The backup format is unchanged.
- **API Limits**: Full sync is deliberately opt-in and RPM-limited. Use a conservative RPM and leave automatic sync off if another client already accesses the account frequently.

## Troubleshooting

If the cache seems stuck or inconsistent:

- Review the synchronization status in **ChatGPT Web → ChatGPT Web History → History sync**. Resume a partial full sync, or unlock a job stopped by HTTP 429 after lowering its RPM.
- Use the **Refresh Conversation** button for a specific thread.
- Perform a manual **Export** followed by an **Import** if you need to migrate to a new profile.
