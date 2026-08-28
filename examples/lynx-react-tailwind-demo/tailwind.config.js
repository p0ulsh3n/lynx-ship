import lynxPreset from "@lynx-js/tailwind-preset";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  presets: [lynxPreset],
  theme: {
    extend: {
      colors: {
        ink: "#07121f",
        panel: "#0e2033",
        panelStrong: "#142c43",
        mint: "#16e0b0",
        sky: "#5aa7ff",
        violet: "#a78bfa",
      },
      boxShadow: {
        glow: "0 12px 40px rgba(22, 224, 176, 0.14)",
      },
    },
  },
};
