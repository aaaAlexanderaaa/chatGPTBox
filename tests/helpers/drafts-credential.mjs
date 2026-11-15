// Drafts host boundary only; provider, request and note behavior remains real.
export const draftsCredential = {
  create: () => ({
    addURLField() {},
    addPasswordField() {},
    authorize: () => true,
    getValue: (name) => ({ baseUrl: 'http://127.0.0.1:18080', apiToken: 'synthetic-token' }[name]),
  }),
}
