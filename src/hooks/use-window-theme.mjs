import { useEffect, useState } from 'react'

export function useWindowTheme() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return 'light'
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return

    const mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (e) => {
      setTheme(e.matches ? 'dark' : 'light')
    }

    if (typeof mediaQueryList.addEventListener === 'function') {
      mediaQueryList.addEventListener('change', listener)
      return () => mediaQueryList.removeEventListener('change', listener)
    }

    mediaQueryList.addListener(listener)
    return () => mediaQueryList.removeListener(listener)
  }, [])
  return theme
}
