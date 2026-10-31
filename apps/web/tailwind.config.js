/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          700: '#1e3a6e',
          900: '#0f1f3d',
        },
      },
    },
  },
  plugins: [],
};
