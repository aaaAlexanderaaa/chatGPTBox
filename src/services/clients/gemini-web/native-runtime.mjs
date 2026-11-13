// Serialized into a pinned top-level MAIN document. Keep this self-contained;
// build.mjs excludes it from Babel helpers, as for the ChatGPT MAIN bridge.
// It observes native state and invokes the existing input handler, not fetch,
// reconstructed RPCs, synthetic clicks, copied tokens or replacement checks.
export async function runGeminiNativeOperation(options) {
  const KEY = '__chatgptboxGeminiNativeV1'
  const { action, ownerId, requestId, question, contracts = [] } = options
  let context = window[KEY]
  const fail = (code, message) => ({
    ok: false,
    code,
    message,
    ...(context?.turn?.invoked || context?.turn?.externalSubmission ? {} : { dispatched: false }),
  })
  const visible = (element) =>
    !!element &&
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden' &&
    getComputedStyle(element).display !== 'none'
  const normalized = (value) =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
  const sample = (observable) => {
    let value,
      received = false
    const subscription = observable?.subscribe((next) => {
      value = next
      received = true
    })
    subscription?.unsubscribe()
    if (!received) throw new Error('Native Gemini state is not ready; check the website.')
    return value
  }
  const dispose = (turn) => {
    for (const subscription of turn?.subscriptions || []) subscription?.unsubscribe()
    if (turn) turn.subscriptions = []
  }
  try {
    if (
      location.origin !== 'https://gemini.google.com' ||
      !/^\/app(?:\/[a-zA-Z0-9_-]+)?\/?$/.test(location.pathname) ||
      window.top !== window
    )
      return fail('GEMINI_PAGE_REQUIRED', 'Open Gemini in this browser and sign in first.')

    // Cleanup only releases our subscriptions. It must still work after the
    // account/model/runtime changes, and must not touch a newer request.
    if (action === 'close') {
      if (context?.ownerId !== ownerId || context?.turn?.requestId !== requestId)
        return fail('GEMINI_TURN_CHANGED', 'The Gemini observer no longer belongs to this request.')
      dispose(context.turn)
      context.turn = null
      return { ok: true }
    }

    const runtime = window.default_BardChatUi
    const urls = [...document.scripts]
      .map((script) => script.src)
      .concat(performance.getEntriesByType('resource').map((entry) => entry.name))
    const candidates = contracts.filter((contract) =>
      urls.some((raw) => {
        try {
          const url = new URL(raw)
          return (
            url.origin === 'https://gemini.gstatic.com' &&
            url.pathname.includes(`/k=${contract.version}/`)
          )
        } catch {
          return false
        }
      }),
    )
    if (!runtime || candidates.length !== 1)
      return fail(
        'GEMINI_RUNTIME_UNSUPPORTED',
        'The Gemini adapter needs an update for this website runtime. This local compatibility check did not send a Gemini request.',
      )
    const contract = candidates[0]
    const fields = contract.fields || {}
    const views = runtime[contract.viewMap]
    const Input = runtime[contract.inputClass],
      Service = runtime[contract.serviceClass]
    if (
      !(views instanceof Map) ||
      typeof Input !== 'function' ||
      typeof Service !== 'function' ||
      views.size > 10000
    )
      return fail('GEMINI_RUNTIME_UNSUPPORTED', 'The native Gemini component registry changed.')
    const editors = [
      ...document.querySelectorAll('rich-textarea .ql-editor[contenteditable="true"]'),
    ].filter(visible)
    if (editors.length !== 1)
      return fail('GEMINI_EDITOR_UNAVAILABLE', 'Gemini has no unique ready editor. Check its tab.')
    const editor = editors[0],
      host = editor.closest('input-area-v2')
    const inputs = [
      ...new Set(
        [...views.values()].flatMap((view) =>
          Array.isArray(view) && view[0] === host && view[8] instanceof Input ? [view[8]] : [],
        ),
      ),
    ]
    if (!host || inputs.length !== 1 || !(inputs[0][fields.service || 'Ta'] instanceof Service))
      return fail(
        'GEMINI_RUNTIME_UNSUPPORTED',
        'The real Gemini input service could not be identified.',
      )
    const input = inputs[0],
      service = input[fields.service || 'Ta']
    const form = input[fields.form || 'Fl']
    const nativeState = service[fields.state || 'Ue']
    const nativeActions = service[fields.actions || 'Mb']
    const rows = (state) => state?.[fields.rows || 'Ob']
    const generating = () => input[fields.generating || 'Lca']()
    const busyNow = () =>
      generating() ||
      input[fields.preparing || 'U7']() ||
      input[fields.dictating || 'uD']() ||
      input[fields.disabled || 'D1']() ||
      input[fields.editing || 'Wu']()
    const functions = {
      submit: input[fields.submit || 'kNa'],
      send: service.sendRequest,
      prepare: runtime[contract.prepareFunction || 'hEe'],
      attestation: runtime[contract.attestationFunction || 'Gce'],
      ...(contract.thinkingSetter && { thinking: runtime[contract.thinkingSetter] }),
    }
    for (const [name, expected] of Object.entries(contract.hashes)) {
      const fn = functions[name]
      if (typeof fn !== 'function')
        return fail('GEMINI_RUNTIME_UNSUPPORTED', 'The native Gemini submission contract changed.')
      const bytes = new TextEncoder().encode(Function.prototype.toString.call(fn))
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const actual = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
      if (actual !== expected)
        return fail(
          'GEMINI_RUNTIME_UNSUPPORTED',
          'The native Gemini submission contract changed. Update the adapter before sending.',
        )
    }
    if (!editor.isConnected || !host.isConnected)
      return fail(
        'GEMINI_DOCUMENT_CHANGED',
        'The Gemini input document changed during its readiness check.',
      )
    if (
      context &&
      (window[KEY] !== context ||
        context.ownerId !== ownerId ||
        context.input !== input ||
        context.service !== service)
    )
      return fail(
        'GEMINI_DOCUMENT_CHANGED',
        'The Gemini document or its owner changed. Inspect the website before starting new work.',
      )

    const account = [...document.querySelectorAll('a[href]')].find((element) => {
      try {
        const url = new URL(element.href)
        return url.origin === 'https://accounts.google.com' && url.pathname === '/SignOutOptions'
      } catch {
        return false
      }
    })
    if (input[fields.eligible || 'kd'] !== true || !account)
      return fail(
        'GEMINI_SIGN_IN_REQUIRED',
        'Sign in to Gemini in this browser. No login or account switch is automated.',
      )
    // Keep this identity inside MAIN; never return the label/email to callers.
    const accountIdentity =
      account.getAttribute('aria-label') || account.getAttribute('title') || account.textContent
    if (!accountIdentity || (context && context.accountIdentity !== accountIdentity))
      return fail(
        'GEMINI_ACCOUNT_CHANGED',
        'The Google account could not be confirmed or changed. Check Gemini before continuing.',
      )
    if (
      typeof options.accountSalt !== 'string' ||
      !options.accountSalt ||
      options.accountSalt.length > 128
    )
      return fail(
        'GEMINI_ACCOUNT_CHECK_REQUIRED',
        'Check the Gemini page in Settings before using this connection.',
      )
    const identityBytes = new TextEncoder().encode(options.accountSalt + '\n' + accountIdentity)
    const identityDigest = await crypto.subtle.digest('SHA-256', identityBytes)
    const accountFingerprint = [...new Uint8Array(identityDigest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    if (
      !account.isConnected ||
      (account.getAttribute('aria-label') ||
        account.getAttribute('title') ||
        account.textContent) !== accountIdentity ||
      !editor.isConnected
    )
      return fail(
        'GEMINI_ACCOUNT_CHANGED',
        'The Google account or document changed during its readiness check.',
      )
    if (
      options.expectedAccountFingerprint &&
      options.expectedAccountFingerprint !== accountFingerprint
    )
      return fail(
        'GEMINI_ACCOUNT_CHANGED',
        'This Gemini account differs from the connection checked in Settings. No account switch is automated.',
      )
    if (action !== 'inspect' && !options.expectedAccountFingerprint)
      return fail(
        'GEMINI_ACCOUNT_CHECK_REQUIRED',
        'Check the Gemini page in Settings before using this connection.',
      )
    if (
      [
        ...document.querySelectorAll(
          '[role="dialog"],iframe[src*="recaptcha"],iframe[src*="accounts.google.com"]',
        ),
      ].some(visible)
    )
      return fail(
        'GEMINI_CHECK_REQUIRED',
        'Gemini requires attention on its website. No confirmation or challenge is handled automatically.',
      )
    if (
      [...document.querySelectorAll('[role="alert"],.error-message,.response-error')].some(
        (element) => visible(element) && normalized(element.textContent),
      )
    )
      return fail(
        'GEMINI_CHECK_REQUIRED',
        'Gemini displays an error or account notice. Check its website before another request.',
      )
    const mode = sample(service.bardModeService?.oa)
    const thinking = sample(service.bardModeService?.Ca)
    const state = sample(nativeState)
    if (!Array.isArray(rows(state)) || !mode?.id || typeof nativeActions?.subscribe !== 'function')
      return fail('GEMINI_RUNTIME_UNSUPPORTED', 'The native Gemini turn state changed.')
    const modelMatches =
      mode.description === contract.modelDescription && thinking === contract.thinkingLevel
    const busy = busyNow()
    if (action === 'inspect')
      return {
        ok: true,
        ready: modelMatches && !busy && !normalized(form?.value),
        model: mode.description || '',
        thinking,
        busy: !!busy,
        draft: !!normalized(form?.value),
        version: contract.version,
        accountFingerprint,
      }
    if (action === 'configure') {
      if (
        context ||
        location.hash !== `#chatgptbox-gemini-${ownerId}` ||
        rows(state).length ||
        busy ||
        normalized(form?.value) ||
        input.initialPrompt?.shouldSubmit
      )
        return fail(
          'GEMINI_OWNED_TAB_REQUIRED',
          'Only a fresh, idle extension-owned Gemini tab can apply its requested thinking setting.',
        )
      if (mode.description !== contract.modelDescription)
        return fail(
          'GEMINI_MODEL_MISMATCH',
          'Select 4 Argon in Gemini. No alternate model will be used.',
        )
      if (thinking !== contract.thinkingLevel) {
        if (!contract.thinkingSetter)
          return fail(
            'GEMINI_MODEL_MISMATCH',
            'Select Thinking level High in Gemini before sending.',
          )
        // The same native setter as the menu: it selects only from the site's
        // available thinking options and preserves its own preference handling.
        runtime[contract.thinkingSetter](service.bardModeService, contract.thinkingLevel)
        if (sample(service.bardModeService.Ca) !== contract.thinkingLevel)
          return fail(
            'GEMINI_MODEL_MISMATCH',
            'Gemini did not make Thinking level High available. No submission was attempted.',
          )
      }
      return { ok: true }
    }
    if (!modelMatches)
      return fail(
        'GEMINI_MODEL_MISMATCH',
        'Select 4 Argon and Thinking level High in the Gemini tab before sending. No model fallback is used.',
      )

    if (action === 'connect') {
      if (!context) {
        if (
          location.hash !== `#chatgptbox-gemini-${ownerId}` ||
          rows(state).length ||
          normalized(form?.value) ||
          busy
        )
          return fail(
            'GEMINI_OWNED_TAB_REQUIRED',
            'Use a fresh extension-owned Gemini tab without a draft or active turn.',
          )
        context = { ownerId, input, service, editor, accountIdentity, turn: null }
        window[KEY] = context
      }
      return { ok: true }
    }
    if (!context || context.ownerId !== ownerId)
      return fail(
        'GEMINI_DOCUMENT_CHANGED',
        'The original Gemini document is unavailable. Start a new extension conversation after checking the website.',
      )
    if (action === 'review') {
      if (busy || normalized(form?.value))
        return fail(
          'GEMINI_CHECK_REQUIRED',
          'Finish or cancel the current Gemini turn and review its draft before allowing new requests.',
        )
      dispose(context.turn)
      context.turn = null
      return { ok: true }
    }
    if (action === 'prepare') {
      if (
        context.turn ||
        busy ||
        normalized(form?.value) ||
        normalized(editor.innerText || editor.textContent)
      )
        return fail(
          'GEMINI_PAGE_BUSY',
          'Gemini has an active operation or a draft. Check its tab; nothing will be overwritten.',
        )
      if (typeof question !== 'string' || !question.trim() || question.length > 50000)
        return fail(
          'GEMINI_INPUT_UNSUPPORTED',
          'Gemini Web accepts a nonempty text prompt of at most 50,000 characters.',
        )
      if (
        input.initialPrompt?.shouldSubmit ||
        input[fields.attachments || 'e8b']() ||
        input[fields.references || 'mRb']() ||
        input[fields.embedded || 'jc'] ||
        input[fields.feature || 'Ie']() !== 0
      )
        return fail(
          'GEMINI_INPUT_UNSUPPORTED',
          'Use ordinary Gemini text chat without attachments, dictation, embedded mode or another pending prompt.',
        )
      if (options.conversationId ? state.id !== options.conversationId : rows(state).length > 0)
        return fail(
          'GEMINI_CONVERSATION_CHANGED',
          'The Gemini conversation changed. Start a new extension conversation instead of replaying history.',
        )
      if (
        options.lastNativeId &&
        rows(state).at(-1)?.request?.clientTurnId !== options.lastNativeId
      )
        return fail(
          'GEMINI_CONVERSATION_CHANGED',
          'Gemini has another turn. Reopen or start a new extension conversation.',
        )
      const turn = {
        requestId,
        question,
        invoked: false,
        nativeId: null,
        accepted: false,
        successful: false,
        error: null,
        state,
        modelId: mode.id,
        thinking,
        baselineIds: new Set(rows(state).map((item) => item.request?.clientTurnId)),
        subscriptions: [],
      }
      context.turn = turn
      turn.subscriptions.push(
        nativeState.subscribe((next) => {
          turn.state = next
        }),
      )
      turn.subscriptions.push(
        nativeActions.subscribe((event) => {
          if (context.turn !== turn) return
          const request =
            event?.[fields.metadata || 'um']?.request ||
            event?.[fields.dispatch || 'AB']?.request ||
            event?.request ||
            event?.turn?.request
          const id = request?.clientTurnId || event?.[fields.failure || 'Kya']?.clientTurnId
          if (event?.type === '[Conversations] Send Request' && !turn.baselineIds.has(id)) {
            if (!turn.invoked) {
              turn.externalSubmission = true
              turn.error =
                'Gemini submitted another request during preparation. Inspect its existing turn; the extension will not submit again.'
              return
            }
            if (
              !id ||
              normalized(request?.textQuery) !== normalized(turn.question) ||
              (turn.nativeId && turn.nativeId !== id)
            ) {
              turn.error = 'Another Gemini request appeared in the dedicated document.'
              return
            }
            turn.nativeId = id
            if (
              request[fields.requestMode || 'jj'] !== turn.modelId ||
              request.thinkingLevel !== turn.thinking
            )
              turn.error =
                'Gemini changed the model or thinking level during native preparation. Inspect the website; this request will not be repeated.'
          }
          if (!turn.invoked) return
          if (!turn.nativeId || id !== turn.nativeId) return
          if (
            event.type === '[Conversations] Streaming Response: Turn' &&
            event.turn?.response?.turnId
          ) {
            turn.accepted = true
            turn.serverTurnId = event.turn.response.turnId
            turn.successful = false
          }
          if (event.type === '[Conversations] Generate Response Success') turn.successful = true
          if (
            event.type === '[Conversations] Generate Response Failure' ||
            event.type === '[Conversations] Request Attestation Failure'
          )
            turn.error =
              'Gemini rejected or interrupted this request. Inspect the existing turn on its website before starting another.'
        }),
      )
      // Native FormControl drives the site's own editor. No synthetic input,
      // telemetry, pointer event, private transport or challenge is fabricated.
      form.setValue(question)
      return { ok: true }
    }
    const turn = context.turn
    if (!turn || turn.requestId !== requestId)
      return fail(
        'GEMINI_TURN_CHANGED',
        'The Gemini request identity changed. Inspect the website before starting another.',
      )
    if (action === 'send') {
      if (turn.error) return fail('GEMINI_PREPARATION_CHANGED', turn.error)
      if (turn.invoked)
        return fail(
          'GEMINI_ALREADY_INVOKED',
          'This Gemini request was already invoked. It will not be sent again.',
        )
      if (
        busy ||
        generating() ||
        normalized(form.value) !== normalized(turn.question) ||
        context.editor !== editor
      )
        return fail(
          'GEMINI_PREPARATION_CHANGED',
          'The Gemini draft or readiness changed before submission. Inspect its tab.',
        )
      turn.invoked = true
      input[fields.submit || 'kNa'](false) // native event-free entry also used by voice flows
    } else if (action === 'stop') {
      if (
        !turn.stopInvoked &&
        turn.nativeId &&
        generating() &&
        input.turn()?.request?.clientTurnId === turn.nativeId
      ) {
        turn.stopInvoked = true
        input[fields.submit || 'kNa'](true)
      }
      return { ok: true, stopAttempted: turn.stopInvoked === true }
    } else if (action !== 'observe')
      return fail('GEMINI_ACTION_UNSUPPORTED', 'Unsupported Gemini native operation.')

    const row = rows(turn.state)?.find((item) => item.request?.clientTurnId === turn.nativeId)
    const conversationId = row?.request?.conversationId || turn.state?.id || ''
    const snapshot = {
      ok: true,
      nativeId: turn.nativeId,
      accepted: turn.accepted,
      conversationId,
      url: `${location.origin}${location.pathname}`,
      completed: false,
      answer: '',
    }
    if (turn.error)
      return { ...snapshot, ok: false, code: 'GEMINI_TURN_FAILED', message: turn.error }
    if (!row || !turn.accepted || row.response?.turnId !== turn.serverTurnId) return snapshot
    // Read content and completion from the SAME native row. Rendered website
    // DOM can lag or rebuild an older same-text turn, so it is never an answer
    // source. These block shapes were inspected in this runtime's public gH /
    // fH converters. Unknown/interactive blocks refuse completion.
    const tree = row.response?.draft?.structuredContent
    const final =
      turn.successful &&
      row.response?.isFinal === true &&
      row.response?.draft?.completeness === 'COMPLETE'
    if (!Array.isArray(tree?.children)) {
      if (final) throw new Error('The final native answer has no supported content.')
      return snapshot
    }
    let count = 0,
      characters = 0
    const text = (value, parent) => {
      if (typeof value !== 'string') throw new Error('Unsupported native text.')
      characters += value.length
      if (characters > 1000000) throw new Error('Native output exceeded the supported limit.')
      if (parent.tagName === 'CODE') parent.appendChild(document.createTextNode(value))
      else
        value.split('\n').forEach((line, index) => {
          if (index) parent.appendChild(document.createElement('br'))
          parent.appendChild(document.createTextNode(line))
        })
    }
    const children = (nodes, parent, depth) => {
      if (!Array.isArray(nodes)) throw new Error('Unsupported native children.')
      for (const node of nodes) render(node, parent, depth + 1)
    }
    const element = (tag, parent) => {
      const next = document.createElement(tag)
      parent.appendChild(next)
      return next
    }
    const render = (node, parent, depth) => {
      if (++count > 50000 || depth > 64 || !node) throw new Error('Unsupported native output.')
      switch (node.nodeType) {
        case 18:
          text(node.text, parent)
          break
        case 1:
        case 9:
          text(node.code, element('code', element('pre', parent)))
          break
        case 12:
          text(node[fields.math || 'GXa'], element('code', parent))
          break
        case 13:
          element('hr', parent)
          break
        case 19:
          element('br', parent)
          break
        case 21:
          break // native empty/unsupported placeholder, has no content
        case 2: {
          const block = element('div', parent)
          text(node.title, element('strong', block))
          children(node.children, block, depth)
          break
        }
        case 7:
        case 8:
        case 11:
        case 15:
        case 16:
          children(node.children, element(node.nodeType === 11 ? 'p' : 'div', parent), depth)
          break
        case 3:
        case 4:
        case 5: {
          if (!Array.isArray(node.children)) throw new Error('Unsupported native layout.')
          const block = element('div', parent)
          for (const item of node.children) render(item.child, block, depth + 1)
          break
        }
        case 14:
        case 20: {
          if (!Array.isArray(node.items)) throw new Error('Unsupported native list.')
          const list = element(node.nodeType === 14 ? 'ol' : 'ul', parent)
          for (const item of node.items) children(item.children, element('li', list), depth)
          break
        }
        case 17: {
          if (!Array.isArray(node.rows)) throw new Error('Unsupported native table.')
          if (node.caption) render(node.caption, element('p', parent), depth + 1)
          const table = element('table', parent)
          for (const row of node.rows) {
            if (!Array.isArray(row.cells)) throw new Error('Unsupported native table row.')
            const tr = element('tr', table)
            for (const cell of row.cells) children(cell.children, element('td', tr), depth)
          }
          break
        }
        case 6: {
          if (!Array.isArray(node.entries)) throw new Error('Unsupported native definitions.')
          const list = element('dl', parent)
          for (const item of node.entries) {
            if (item[fields.definitionTerm || 'jw'])
              render(item[fields.definitionTerm || 'jw'], element('dt', list), depth + 1)
            children(item.description, element('dd', list), depth)
          }
          break
        }
        default:
          throw new Error('Unsupported native output block. Inspect the result on Gemini.')
      }
    }
    const result = document.createElement('div')
    children(tree.children, result, 0)
    if (!normalized(result.textContent)) {
      if (final) throw new Error('The final native answer is empty or unsupported.')
      return snapshot
    }
    if (result.innerHTML.length > 1000000)
      throw new Error('Gemini output exceeded the supported rendering limit.')
    snapshot.answer = result.innerHTML
    snapshot.completed = final
    return snapshot
  } catch {
    return fail(
      'GEMINI_NATIVE_OPERATION_FAILED',
      'The Gemini native operation could not be confirmed. Inspect its tab; no automatic retry will be made.',
    )
  }
}
