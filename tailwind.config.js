/** @type {import('tailwindcss').Config} */

// Helper function to create color values that support opacity modifiers
// This allows usage like bg-primary/20, text-foreground/50, etc.
function withOpacity(variableName) {
  return ({ opacityVariable, opacityValue }) => {
    if (opacityValue !== undefined) {
      if (typeof opacityValue === 'number') {
        return `color-mix(in srgb, var(${variableName}) ${opacityValue * 100}%, transparent)`
      }
      // Tailwind may pass a CSS variable (e.g. var(--tw-bg-opacity)) as a string.
      return `color-mix(in srgb, var(${variableName}) calc(${opacityValue} * 100%), transparent)`
    }
    if (opacityVariable !== undefined) {
      return `color-mix(in srgb, var(${variableName}) calc(var(${opacityVariable}) * 100%), transparent)`
    }
    return `var(${variableName})`
  }
}

export default {
  content: ['./src/**/*.{js,jsx,mjs,html}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        background: withOpacity('--background'),
        foreground: withOpacity('--foreground'),
        card: {
          DEFAULT: withOpacity('--card'),
          foreground: withOpacity('--card-foreground'),
        },
        popover: {
          DEFAULT: withOpacity('--popover'),
          foreground: withOpacity('--popover-foreground'),
        },
        primary: {
          DEFAULT: withOpacity('--primary'),
          foreground: withOpacity('--primary-foreground'),
        },
        secondary: {
          DEFAULT: withOpacity('--secondary'),
          foreground: withOpacity('--secondary-foreground'),
        },
        muted: {
          DEFAULT: withOpacity('--muted'),
          foreground: withOpacity('--muted-foreground'),
        },
        accent: {
          DEFAULT: withOpacity('--accent'),
          foreground: withOpacity('--accent-foreground'),
        },
        destructive: {
          DEFAULT: withOpacity('--destructive'),
          foreground: withOpacity('--destructive-foreground'),
        },
        border: withOpacity('--border'),
        input: withOpacity('--input'),
        ring: withOpacity('--ring'),
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'bounce-slow': 'bounce 1.5s infinite',
      },
    },
  },
  plugins: [],
}
