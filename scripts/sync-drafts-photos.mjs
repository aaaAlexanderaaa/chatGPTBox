/* eslint-env node */
// Retained command alias: photos and Projects are now part of the common More action.
import { syncDraftsActions } from './sync-drafts-engines.mjs'
await syncDraftsActions({ check: process.argv.includes('--check') })
