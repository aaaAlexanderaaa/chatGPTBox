# Conversation Cache Lifecycle

This document explains how the ChatGPT Web conversation cache works in ChatGPTBox.

## Overview

The conversation cache stores snapshots of ChatGPT Web conversations and their metadata to improve performance and enable features like reasoning data extraction and local API server integration.

## Data Stored

- **Conversation Index**: A list of all conversations with basic metadata (title, update time, etc.).
- **Conversation Snapshots**: Detailed JSON snapshots of individual conversations, including message history and current node information.
- **Metadata**: Global cache state, including last synchronization timestamps.

## Synchronization Mechanism

The cache uses a multi-layered approach to stay up-to-date:

1.  **Background Sync**: A recurring alarm (default: every 15 minutes) triggers a full background synchronization of the conversation index.
2.  **Event-driven Invalidation**: Actions that modify conversations (like sending a message) mark specific conversations as stale.
3.  **On-demand Refresh**: When a stale conversation is accessed via the UI or API, it is immediately re-fetched from the ChatGPT Web backend.

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
- **API Limits**: Frequent full re-syncs may hit ChatGPT Web API limits.

## Troubleshooting

If the cache seems stuck or inconsistent:
- Use the **Refresh List** button in the API Server Bridge.
- Use the **Refresh Conversation** button for a specific thread.
- Perform a manual **Export** followed by an **Import** if you need to migrate to a new profile.
