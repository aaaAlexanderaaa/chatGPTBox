// Kept dependency-free: the document-start entry reads only these settings,
// without importing engine configuration, credentials or migration machinery.
export const NATIVE_CHATGPT_DEFAULTS = Object.freeze({
  chatgptNativeRewriteEnabled: false,
  chatgptNativePasteEnabled: false,
  chatgptNativePasteTerms: [],
})

export function nativeChatgptConfig(value = {}) {
  return {
    chatgptNativeRewriteEnabled: value.chatgptNativeRewriteEnabled === true,
    chatgptNativePasteEnabled: value.chatgptNativePasteEnabled === true,
    chatgptNativePasteTerms:
      value.chatgptNativePasteTerms === undefined ? [] : value.chatgptNativePasteTerms,
  }
}
