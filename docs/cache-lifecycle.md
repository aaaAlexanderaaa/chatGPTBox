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

To prevent data loss and allow for migration, the cache can be exported and imported:

- **Export**: Creates schema-2 JSON volumes containing the local index, cached snapshots, metadata, and continuation state. Both settings **Export ChatGPT History** and API Server **Export Cache** use the same exporter. Export does not fetch missing remote history.
- **Import**: Merges volumes into the local cache, preserving native pagination cursors for incomplete snapshots. The former API Server version-1 cache exports remain readable.

Snapshot merges prefer the newer server revision. For the same revision, a complete snapshot wins over a partial one, a complete legacy tree wins over current-branch coverage, and a partial snapshot with more downloaded messages wins over a shorter one. Download time breaks equal-coverage ties; importing a recently interrupted copy does not discard history already cached locally.

### How to use:

For one conversation, open **ChatGPT History Backup** in the ChatGPT Web settings or **ChatGPT Conversations** on the API Server Bridge page. Both use the same conversation browser:

- Search the local list by title or ID, filter active/archived conversations, and page through the results. Listing reads metadata and storage keys, not every cached body.
- Click a title to preview cached messages. Missing bodies are loaded only for that conversation using the native pagination described above. A partial cache can be previewed offline and resumed with **Load remaining history**.
- Use a row's **JSON** / **MD** buttons, or paste a ChatGPT `/c/…` link or conversation ID and use **Export JSON** / **Export Markdown**. A fresh complete cache is reused; missing, stale, or incomplete contents are read for that selected conversation before export. A failed/partial read is reported instead of producing a complete-looking export.
- A selected JSON backup contains only that conversation's index entry and raw snapshot. Other snapshots, global metadata, session snapshots, and continuation threads are excluded. It stays compatible with the existing schema-2 importer. Markdown includes the readable user/assistant transcript.
- Preview renders 20 messages at a time, initially showing the newest messages. Export includes the full loaded transcript, regardless of the preview page.

1.  Open the **API Server Bridge** page.
2.  Locate the **Conversations** section.
3.  Use the **Export Cache** and **Import Cache** buttons.

## Risks and Limitations

- **Browser Storage**: The cache is stored in `Browser.storage.local`. If the browser's local storage is cleared, the cache will be lost.
- **Data Freshness**: While sync intervals and event-driven invalidation help, the cache may still be out of sync if changes occur in another browser tab or on another device.
- **Performance**: Volume sizes are estimated in UTF-8 bytes, and files are serialized/downloaded one at a time. A single conversation remains one snapshot and can exceed the approximately 16 MiB volume target; this change deliberately keeps the existing backup format. A very large local cache can still affect export/import memory use.
- **API Limits**: Full sync is deliberately opt-in and RPM-limited. Use a conservative RPM and leave automatic sync off if another client already accesses the account frequently.

## Troubleshooting

If the cache seems stuck or inconsistent:

- Review the synchronization status in **Advanced → ChatGPT Web History**. Resume a partial full sync, or unlock a job stopped by HTTP 429 after lowering its RPM.
- Use the **Refresh Conversation** button for a specific thread.
- Perform a manual **Export** followed by an **Import** if you need to migrate to a new profile.
