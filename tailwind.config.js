/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.bak.html",
        "./index.tsx",
        "./**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                brand: {
                    DEFAULT: 'var(--brand)',
                    hover: 'var(--brand-hover)',
                },
                bg: 'var(--bg)',
                surface: 'var(--surface)',
                panel: 'var(--panel)',
                'border-base': 'var(--border)',
                'text-primary': 'var(--text-primary)',
                'text-secondary': 'var(--text-secondary)',
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace'],
            },
            animation: {
                'fade-in': 'fadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
                'slide-up': 'slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
                'slide-in': 'slideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                'scale-in': 'scaleIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                slideUp: {
                    '0%': { transform: 'translateY(20px)', opacity: '0' },
                    '100%': { transform: 'translateY(0)', opacity: '1' },
                },
                slideIn: {
                    '0%': { transform: 'translateX(20px)', opacity: '0' },
                    '100%': { transform: 'translateX(0)', opacity: '1' },
                },
                scaleIn: {
                    '0%': { transform: 'scale(0.95)', opacity: '0' },
                    '100%': { transform: 'scale(1)', opacity: '1' },
                }
            }
        },
    },
    plugins: [],
}
