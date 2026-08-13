export function isSafari() {
  return typeof navigator === 'object' && navigator.vendor === 'Apple Computer, Inc.'
}
