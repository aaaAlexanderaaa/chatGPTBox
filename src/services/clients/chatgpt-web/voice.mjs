/**
 * Voice-lane fragments that actually appear in
 * `resources/chatgpt-web/current/*.js`.
 *
 * There is no hardcoded model slug `gpt-live-1` in those bundles or in the
 * official `GET /models` catalog. The UI fallback display is `"GPT Live 1"`
 * when account policy omits `wingman_model_name`. The picker slug, if any,
 * arrives later from `wingman_model_picker_alternative_options[].slug`.
 *
 * Session URLs are concatenated, not stored as `/realtime/wm`:
 *   voicePath(mode) → `/realtime` + (`/wm` | `/vp` | `/vps`)
 *   status override  → `${base}/realtime/status`
 */

export const CHATGPT_WEB_VOICE_MODE_WINGMAN = 'wingman'
export const CHATGPT_WEB_VOICE_SESSION_TYPE_WM = 'wm'
export const CHATGPT_WEB_VOICE_SESSION_TYPE_VP = 'vp'

export const CHATGPT_WEB_REALTIME_PREFIX = '/realtime'
export const CHATGPT_WEB_REALTIME_STATUS_SUFFIX = '/realtime/status'
export const CHATGPT_WEB_VOICE_STATUS_PATH = '/conversation/voice/status'
export const CHATGPT_WEB_WINGMAN_DISPLAY_FALLBACK = 'GPT Live 1'

export function chatgptWebVoiceTelemetryName(voiceMode) {
  switch (voiceMode) {
    case 'advanced':
      return 'avm'
    case CHATGPT_WEB_VOICE_MODE_WINGMAN:
      return 'bidi'
    case 'standard':
      return 'svm'
    default:
      return 'unknown'
  }
}

export function chatgptWebRealtimePath(voiceMode, sessionType) {
  if (sessionType === CHATGPT_WEB_VOICE_SESSION_TYPE_WM) {
    return `${CHATGPT_WEB_REALTIME_PREFIX}/wm`
  }
  if (voiceMode === 'standard') return `${CHATGPT_WEB_REALTIME_PREFIX}/vps`
  return `${CHATGPT_WEB_REALTIME_PREFIX}/vp`
}
