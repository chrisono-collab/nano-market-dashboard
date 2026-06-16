/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        brand: {
          bg: '#0a0e1a',
          surface: '#111827',
          border: '#1f2937',
          accent: '#22c55e',
          accentDim: '#16a34a',
          muted: '#6b7280',
          text: '#f9fafb',
          subtext: '#9ca3af',
        }
      }
    },
  },
  plugins: [],
}
