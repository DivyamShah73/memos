import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0b0f",
        surface: "#12141c",
        "surface-2": "#181b26",
        border: "#252a38",
        muted: "#8a92a6",
        fg: "#e7eaf3",
        accent: "#7c8cff",
        "accent-2": "#34d399",
        warn: "#fbbf24",
        danger: "#f87171",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      keyframes: {
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        "pulse-dot": "pulse-dot 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
