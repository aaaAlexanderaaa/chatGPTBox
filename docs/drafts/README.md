# Drafts Actions For ChatGPTBox

These Drafts scripts are currently configured for the ChatGPTBox API gateway at
`http://127.0.0.1:18080`, which is the gateway's default port.

Before running them:

1. Open `Advanced -> API Server Bridge -> Open API Server Bridge` in the extension.
2. Turn on `Enable API Server Bridge`.
3. Start the local gateway with `npm run api-server`.
4. Keep the bridge page open and stay logged in at `https://chatgpt.com`.
5. Enable ChatGPT history synchronization in Advanced settings and choose a conservative RPM, so the cache action 1 reads from stays populated.

If you changed the gateway host or port, update the `BASE_URL` constant in all three action files.
Thinking time is per turn, not per conversation. Every reasoning turn in a snapshot carries its
own `thoughtDurationLabel` / `thoughtDurationText`, so actions 2 and 3 print ChatGPT's own
sentence on that turn's heading (`### ASSISTANT (Worked for 2 minutes 30 seconds)`) even when
`INCLUDE_THINKING` is false. Official timing can be `finished_duration_sec` or the `Worked for` /
`Thought for` sentence on the recap or the answer itself. Turns without either get no annotation
rather than an estimate. If you also want the full ChatGPT
reasoning blocks, set `INCLUDE_THINKING = true` in `action-2-open-checked-conversation.js` and
`action-3-send-waiting-reply.js`.
`action-3-send-waiting-reply.js` now declares its model choice explicitly:

- `DEFAULT_MODEL = 'gpt-5-4-thinking'` is the script's built-in default for new conversations.
- `MODEL_OVERRIDE = null` means follow-up replies keep using the conversation's stored default model when one exists.
- Set `MODEL_OVERRIDE = 'gpt-5-4-pro'` when you want this Drafts action to force GPT-5.4 Pro for both new conversations and follow-up replies.

The custom conversation write API requires `Idempotency-Key`. Action 3 handles this internally: it
writes a generated operation ID into the draft before sending a new-conversation or follow-up
request, then reuses that ID if the action is retried after an uncertain result. No manual header or
ID setup is required in Drafts.

Files:

- `action-1-list-conversations.js`
- `action-2-open-checked-conversation.js`
- `action-3-send-waiting-reply.js`

Suggested Drafts action names:

- `ChatGPTBox List Conversations`
- `ChatGPTBox Open Checked Conversation`
- `ChatGPTBox Send Waiting Reply`

Expected workflow:

1. Run action 1 to read the cached conversation list and replace the draft with a Markdown task list. Listing does not sync; run Full Sync in the extension when you want fresh data.
2. Check exactly one conversation line, then run action 2 to load that conversation into the note. The script defaults to a compact user/assistant transcript with per-turn `Thought:` annotations; turn on `INCLUDE_THINKING` if you also want the `Thinking` section.
3. Type the next user message between the `chatgptbox-waiting-reply` markers at the bottom of the note, then run action 3 to `POST /chatgpt/conversations/:id/messages`.
4. Run action 2 on the same note whenever you want to collect the answer. You do not need to List first, and you can come back to it much later. Action 2 keeps any unsent text already typed in the waiting-reply block.

Sending is asynchronous by design. The gateway acknowledges the message and ChatGPT keeps generating in
the browser, so action 3 returns immediately instead of holding the connection while a thinking model
works. It does not rewrite the note: your question is appended to the transcript, the answer gets a
`### ASSISTANT (pending)` placeholder, and the waiting-reply metadata records `pendingMessageId` and
`pendingSentAt` for the turn being awaited.

Action 2 resolves that awaited turn against the snapshot it fetches, and keeps the note honest in every
state:

- The snapshot does not contain your question yet (ChatGPT has not stored the send; this is normal for a
  few seconds after action 3 returns). Your `### USER` block and the placeholder stay in the note, the
  header stays `pending`, and the metadata keeps `pendingMessageId` so the next Get is still anchored.
- The snapshot contains the question but no answer. The placeholder stays and so does the anchor.
- The snapshot contains the answer. The placeholder is replaced by the answer and the anchor is dropped.

The turn is matched by `pendingMessageId` when that id is present. Question text is only a fallback
after the id is gone, so sending the same wording again cannot resolve to an earlier turn. A turn is
answered only when that match has a finished assistant reply and the conversation is not still
pending; streaming text does not clear the anchor. `pending` can veto "answered" but never decides
the match by itself, because a snapshot taken right after send can lack both the async status and
the turn. The unsent text in the waiting-reply block survives every Get.

Action 3 also supports two shortcut modes:

- If the note has no `chatgptbox-waiting-reply` block yet, it treats the entire note as a new user prompt, creates a ChatGPT conversation without waiting for the answer, and rewrites the note into a one-turn transcript with the same `### ASSISTANT (pending)` placeholder and anchor a follow-up send would leave.
- If the note already has a `chatgptbox-waiting-reply` block but the block is empty, it refreshes the current conversation instead of sending a new follow-up, with the same anchoring and placeholder handling as action 2. Action 2 is the better "just reload this thread" button after a reply.

The scripts rely on the official Drafts scripting runtime objects documented in the Drafts scripting reference, especially [HTTP](https://scripting.getdrafts.com/classes/HTTP.html) and [Draft](https://scripting.getdrafts.com/classes/Draft.html).
