# Drafts Actions For ChatGPTBox

These Drafts scripts use the default ChatGPTBox API gateway at `http://127.0.0.1:18080`.

Before running them:

1. Open `Advanced -> API Server Bridge -> Open API Server Bridge` in the extension.
2. Turn on `Enable API Server Bridge`.
3. Start the local gateway with `npm run api-server`.
4. Keep the bridge page open and stay logged in at `https://chatgpt.com`.

If you changed the gateway host or port, update the `BASE_URL` constant in all three action files.
If you want Drafts notes to include ChatGPT reasoning blocks, set `INCLUDE_THINKING = true` in
`action-2-open-checked-conversation.js` and `action-3-send-waiting-reply.js`.
`action-3-send-waiting-reply.js` now declares its model choice explicitly:

- `DEFAULT_MODEL = 'gpt-5-4-thinking'` is the script's built-in default for new conversations.
- `MODEL_OVERRIDE = null` means follow-up replies keep using the conversation's stored default model when one exists.
- Set `MODEL_OVERRIDE = 'gpt-5-4-pro'` when you want this Drafts action to force GPT-5.4 Pro for both new conversations and follow-up replies.

Files:

- `action-1-list-conversations.js`
- `action-2-open-checked-conversation.js`
- `action-3-send-waiting-reply.js`

Suggested Drafts action names:

- `ChatGPTBox List Conversations`
- `ChatGPTBox Open Checked Conversation`
- `ChatGPTBox Send Waiting Reply`

Expected workflow:

1. Run action 1 to force-sync the cached conversation list and replace the draft with a Markdown task list.
2. Check exactly one conversation line, then run action 2 to load that conversation into the note. The script defaults to a compact user/assistant transcript; turn on `INCLUDE_THINKING` if you also want the `Thinking` section.
3. Type the next user message between the `chatgptbox-waiting-reply` markers at the bottom of the note, then run action 3 to `POST /chatgpt/conversations/:id/messages` and refresh the transcript.

Action 3 also supports two shortcut modes:

- If the note has no `chatgptbox-waiting-reply` block yet, it treats the entire note as a new user prompt, creates a ChatGPT conversation without waiting for the answer, and rewrites the note into a pending conversation draft.
- If the note already has a `chatgptbox-waiting-reply` block but the block is empty, it refreshes the current conversation instead of sending a new follow-up.

The scripts rely on the official Drafts scripting runtime objects documented in the Drafts scripting reference, especially [HTTP](https://scripting.getdrafts.com/classes/HTTP.html) and [Draft](https://scripting.getdrafts.com/classes/Draft.html).
