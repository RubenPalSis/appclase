/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: { colors: { ink: '#17231f', forest: '#126a53', mint: '#dff5ec', paper: '#f6f8f6', line: '#e8ece9', surface: 'var(--surface)', 'surface-2': 'var(--surface-2)', muted: 'var(--muted)' }, boxShadow: { card: '0 8px 28px rgba(29, 54, 43, .055)' }, fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] } } },
  plugins: [],
};
