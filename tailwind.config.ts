import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#FFC20E", dark: "#E0A800", soft: "#FFF4CC" },
        ink: { DEFAULT: "#000000", 800: "#1C1C1E", 700: "#2C2C2E", 600: "#3A3A3C" },
        steel: { 50: "#F7F7F8", 100: "#EFEFF1", 200: "#E1E1E5", 300: "#C9C9CF", 400: "#9A9AA2", 500: "#6E6E76", 600: "#52525A" },
      },
      fontFamily: {
        sans: ["Barlow", "Arial", "Helvetica", "sans-serif"],
        display: ['"Barlow Semi Condensed"', "Barlow", "Arial Narrow", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
