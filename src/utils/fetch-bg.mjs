import Browser from 'webextension-polyfill'

/**
 * @param {RequestInfo|URL} input
 * @param {RequestInit=} init
 * @returns {Promise<Response>}
 */
export function fetchBg(input, init) {
  return new Promise((resolve, reject) => {
    Browser.runtime
      .sendMessage({
        type: 'FETCH',
        data: { input, init },
      })
      .then((messageResponse) => {
        const [response, error] = messageResponse
        if (response === null) {
          const err =
            error instanceof Error ? error : new Error(error?.message || String(error || 'Error'))
          reject(err)
        } else {
          const body = response.body ? new Blob([response.body]) : undefined
          resolve(
            new Response(body, {
              status: response.status,
              statusText: response.statusText,
              headers: new Headers(response.headers),
            }),
          )
        }
      })
      .catch((error) => {
        reject(error)
      })
  })
}
