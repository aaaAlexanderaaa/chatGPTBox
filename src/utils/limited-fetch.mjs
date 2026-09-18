// https://stackoverflow.com/questions/64304365/stop-request-after-x-amount-is-fetched

export async function limitedFetch(url, maxBytes) {
  return new Promise((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest()
      xhr.onprogress = (ev) => {
        if (ev.loaded < maxBytes) return
        const status = ev.target.status
        if (status >= 200 && status < 300) {
          resolve(ev.target.responseText.substring(0, maxBytes))
          xhr.abort()
          return
        }
        if (status) {
          reject(new Error(status))
          xhr.abort()
        }
      }
      xhr.onload = (ev) => {
        const status = ev.target.status
        if (status >= 200 && status < 300) {
          resolve(ev.target.responseText.substring(0, maxBytes))
          return
        }
        reject(new Error(status))
      }
      xhr.onerror = (ev) => {
        reject(new Error(ev.target.status))
      }

      xhr.open('GET', url)
      xhr.send()
    } catch (err) {
      reject(err)
    }
  })
}
