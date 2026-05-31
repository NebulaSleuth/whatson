/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Mirror apps/mobile/constants/theme.ts so the web and TV
        // builds share visual language.
        background: '#0F0F0F',
        surface: '#1A1A1A',
        'surface-hover': '#252525',
        'card-border': '#2A2A2A',
        primary: '#E5A00D',
        text: '#FFFFFF',
        'text-muted': '#666666',
        'text-secondary': '#B0B0B0',
        // Pale gold for focus rings. Distinguishes focus from the
        // brand-gold-filled buttons (Play, Add, etc.) — focus drawn in
        // the same brand shade is invisible against those fills.
        focus: '#F5D87A',
      },
    },
  },
  plugins: [],
};
