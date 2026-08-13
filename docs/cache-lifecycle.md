# Conversation Cache Lifecycle

This document explains how the ChatGPT Web conversation cache works in ChatGPTBox.

## Overview

The conversation cache stores snapshots of ChatGPT Web conversations and their metadata to improve performance and enable features like reasoning data extraction and local API server integration.

## Data Stored

- **Conversation Index**: A list of all conversations with basic metadata (title, update time, etc.).
- **Conversation Snapshots**: Detailed JSON snapshots of individual conversations, including message history and current node information.
- **Metadata**: Global cache state, including last synchronization timestamps.

## Synchronization Mechanism

The cache uses a safety-first, opt-in approach:

1. **Manual Full List Sync**: After history synchronization is enabled, a user can explicitly start a full list sync. It reads 100 conversations per request, applies the configured RPM limit, and saves every page immediately. It does not pre-download every conversation body.
2. **Optional Background Sync**: Automatic sync is off by default. Adaptive or fixed scheduling can be enabled; every scheduled run reads only the newest 100 active conversations.
3. **Event-driven Invalidation**: Actions that modify a conversation mark only its cached snapshot as stale. They do not start a full list scan.
4. **On-demand Refresh**: When a stale conversation is accessed via the UI or API, that conversation is immediately re-fetched.
5. **Rate-limit Safety Lock**: HTTP 429 stops the current history job, clears automatic scheduling, preserves completed pages, and remains locked until the user reviews the settings and unlocks it.

## Export and Import

To prevent data loss and allow for migration, the cache can be exported and imported:

- **Export**: Generates a JSON file containing the entire index, all cached snapshots, and metadata.
- **Import**: Allows loading a previously exported JSON file. The import process merges the incoming data with the existing local cache and version-checks the schema.

### How to use:

1.  Open the **API Server Bridge** page.
2.  Locate the **Conversations** section.
3.  Use the **Export Cache** and **Import Cache** buttons.

## Risks and Limitations

- **Browser Storage**: The cache is stored in `Browser.storage.local`. If the browser's local storage is cleared, the cache will be lost.
- **Data Freshness**: While sync intervals and event-driven invalidation help, the cache may still be out of sync if changes occur in another browser tab or on another device.
- **Performance**: A very large cache can impact browser performance during synchronization or export/import.
- **API Limits**: Full sync is deliberately opt-in and RPM-limited. Use a conservative RPM and leave automatic sync off if another client already accesses the account frequently.

## Troubleshooting

If the cache seems stuck or inconsistent:

- Review the synchronization status in **Advanced → ChatGPT Web History**. Resume a partial full sync, or unlock a job stopped by HTTP 429 after lowering its RPM.
- Use the **Refresh Conversation** button for a specific thread.
- Perform a manual **Export** followed by an **Import** if you need to migrate to a new profile.
