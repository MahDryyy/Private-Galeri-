import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0b0d10",
          900: "#12151a",
          800: "#1a1f27",
          700: "#242b35",
        },
      },
    },
  },
  plugins: [],
};

export default config;
