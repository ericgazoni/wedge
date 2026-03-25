/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{vue,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0f14",
        panel: "#121922",
        panel2: "#0f141c",
        text: "#d6deeb",
      },
    },
  },
  plugins: [],
};
