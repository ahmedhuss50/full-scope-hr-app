import type { Config } from 'tailwindcss'

export default {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Full Scope HR brand: white background, slate-900 ink, teal-600 accent
        ink: { DEFAULT: '#0F172A', soft: '#334155' },          // slate-900 / slate-700
        accent: { DEFAULT: '#0D9488', dark: '#0F766E' },       // teal-600 / teal-700
        // Expose CSS variables for globals.css
        'brand-primary': 'var(--brand-primary)',
        'brand-accent': 'var(--brand-accent)',
        ok: '#16A34A',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        // Arabic-aware display font (loaded via globals.css for RTL)
        arabic: ['"IBM Plex Sans Arabic"', 'Inter', 'system-ui', 'sans-serif'],
        serif: ['"Source Serif Pro"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
} satisfies Config
