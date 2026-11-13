---
doc_type: contract
status: current
authority: normative
implementation: implemented
verification_status: partial
last_reconciled: 2026-11-12
---

# Gemini Web

The 2026-11-12 user request adds Gemini Web with **4 Argon, Thinking level High**
as its only initial model. The user subsequently clarified that the adapter
should reuse native website JavaScript, like the ChatGPT adapter. Account safety
takes priority; an unverified or challenged path must refuse submission.
The [delivery record](plans/2026-11-12-gemini-web.md) separates implementation,
controlled verification, real-account observations and installation.

## Operation and account boundary

Gemini Web is off by default. Enabling it does not open a site, probe an account
or submit a question. `Engines` enables the engine; `Gemini Web` owns its page
check, account-session instructions and recovery. An explicit page check reads
the current website's readiness without sending a prompt. A ready check is not
a durable guarantee of access; every submission checks again.

The first successful page check binds the current account using a random local
salt and a fingerprint of its native account label. Raw account labels remain
in the website context. A later account mismatch refuses work; this version
does not switch or automatically rebind accounts. Use the originally checked
account in the same browser profile.

The local selector `geminiweb/gemini-4-argon-high` identifies this adapter; it is
not a Google API model ID. The adapter reads the selected native model and
thinking state, verifies `4 Argon` and the observed High mapping, and lets the
website build its actual request. It does not silently downgrade or choose
another account/model when access changes. Set the requested options on Gemini
if the readiness check reports a mismatch.

In a fresh extension-owned blank tab, the adapter applies High through the
inspected native thinking-menu setter when that runtime supports it, then
checks the selected value. This handles the website resetting thinking to Low
on a new document. The setter chooses from the site's available options; an
unavailable High remains a refusal. It does not rewrite request fields or
change another model to a fallback. Existing manual tabs are not configured.

Keep the dedicated tab's model selection unchanged during a request. Native
preparation can be asynchronous: the adapter checks before invoking the handler
and verifies the model/High values in the resulting native request. A selection
changed during that interval can already affect the native request; it is
reported and held, without a retry. This is not an atomic lock on Gemini's UI.

An extension conversation or page function reaches the background provider,
then an extension-owned Gemini tab. In the same pinned MAIN document, the
adapter fills the native input control and invokes its existing submission
handler once. That handler retains the website's input checks, request
construction, content-bound attestation and HTTP/streaming transport. There is
no hand-built Google HTTP request, copied cookie/token, synthetic Send event,
CAPTCHA bypass, fake input event or fabricated attestation.

This is a limited desktop Chromium integration for known, inspected runtimes.
Unknown runtimes, missing document identity, mock service instances, account
changes, challenges, quota/errors, drafts, attachments and active generation
refuse further submission. Credentials remain in the website's MAIN context;
the extension receives the salted account fingerprint, readiness, turn metadata
and output. MAIN is not a
security sandbox against the website itself.

## Submission, completion and recovery

Only one extension Gemini operation runs at a time, across all its tabs and
clients. A busy caller is refused rather than queued. A durable submission
record must be acknowledged before native preparation/submission; unreadable
storage refuses the operation. A worker restart cannot erase that record or
authorize a replay. Only the background owns this state; UI and MAIN cannot
clear it directly.

The extension invokes one native submission handler for a logical request.
Gemini retains its own transport fallback and same-turn recovery. This is not
a promise of one HTTP POST or exactly-once server execution. The extension never
invokes Send again after a timeout, disconnect, missing result or parse failure.

Correlate the newly observed native request ID with its response and terminal
action. A local dispatch or visible user bubble alone is not provider acceptance.
Publish `started` only with matching native response evidence, and `finalContent`
only with the matching successful terminal action and a complete final response.
Read content and final state from the same native row. Do not match website DOM
by question text: Angular can rebuild an older same-text answer or render behind
the native final state. Convert known native text, code, list, table and layout
blocks to inert HTML, flatten inline annotations, and refuse unknown interactive
blocks rather than publishing a substituted answer. Stable text or an ended
transport alone cannot prove completion.

Observe native Send actions from preparation onward. An unexpected website/user
submission prevents the adapter from invoking its handler and retains the hold,
even if the draft/busy state subsequently looks unchanged. Stop wins until a
verified final result is synchronously published; after publication, it cannot
replace that result with a second terminal status. Journal cleanup follows the
completed publication; a failed cleanup can retain a hold without invalidating
the already verified result.

Stop ends local observation and attempts the matching native Stop action once.
Its acknowledgement does not promise remote cancellation. A challenge, native
failure, uncertain submission, Stop, lost document or observer failure preserves
a durable hold. Open Gemini to inspect the existing result, then explicitly use
`Allow new requests after checking Gemini`. This permits new work; it never
resubmits or repairs the old request. An uncertain old request remains uncertain.
Keep partial output and the known website tab available for manual inspection.
If an interrupted tab was reloaded, closed or navigated away, inspect the old
result on Gemini. Recovery checks the current account/page without retargeting
a writer. It then requires a separate acknowledgement that the old outcome
remains unconfirmed before allowing new work, records that disposition and
retires the old binding. It cannot restore or replay that request, and the
acknowledgement cannot override an active generation or account challenge.
A check that positively fails before native preparation/submission
does not claim an uncertain write occurred and need not create a hold.

The first version supports text submissions and continuation in the original
live dedicated document. It rejects regeneration, images/attachments, history
import and automatic restoration after navigation/reload. A small bounded set
of owned tabs prevents unbounded tab accumulation; close finished tabs when the
limit is reached. Closing a tab does not delete its website history.
The initial owned-tab limit is three; it also applies to gateway completions.

## External clients and verification limits

The authenticated gateway's explicit Gemini model uses the same provider via
`ApiServer.html`; it must never run ChatGPT uploads, projects or history for that
request. Requests are independent standard completions, with the same durable
Gemini hold and no automatic replay. Gemini history/custom conversation endpoints,
Drafts and an `ask_gemini` MCP tool are outside this change. Existing ChatGPT
defaults and the `ask_chatgpt` MCP interface remain at their current owners.

Synthetic tests establish the stated local guards and event handling, not
Google's account policy or future detection behavior. Reusing native code does
not establish that Google guarantees this calling pattern. A real-account
success, when authorized and observed, establishes only that one execution.
On a challenge or limit, stop account-bound testing rather than trying another
identity, model, transport or prompt. Disable Gemini Web to roll back the adapter;
keep an unresolved submission record until the website has been checked.

The [2026-11-12 installation trial](plans/2026-11-12-gemini-web.md#user-authorized-brave-installation-and-one-live-trial)
initially stopped at a local runtime mismatch. The user clarified that this was
an implementation issue, not a Gemini rejection or withdrawal of test authority.
The current compilation's components, state/event fields and thinking setter
were then mapped separately. The [corrected single-response trial](plans/2026-11-12-gemini-web.md#correction-after-the-users-runtime-check-clarification)
passed in the installed Brave extension: one 4 Argon / High question produced a
complete native response and one saved extension record, without an extension
resubmission. No challenge, rate-limit refusal or account error was observed.
This is one execution's evidence; it does not validate all future account use,
runtime versions, continuations or live gateway traffic.

For maintenance, distinguish local adapter faults from provider responses. A
runtime/profile mismatch before invocation spends no Gemini submission and is
not evidence of a CAPTCHA, quota, account restriction or revoked permission.
Within an authorized trial, inspect the public source and live read-only state,
correct that mapping and continue the permitted test. Keep native prerequisite
checks and the single-invocation journal. After an invocation is uncertain, do
not resubmit; an actual website challenge, rate limit or account anomaly stops
account-bound testing. Local compatibility diagnostics must say they originate
in the adapter rather than implying that Gemini refused a request.
