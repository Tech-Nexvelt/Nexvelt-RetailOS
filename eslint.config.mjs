import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  { ignores: ["ui-prototype-archive/**", ".next/**", "node_modules/**", "coverage/**", "next-env.d.ts"] },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // Money must never be handled as floating point; see src/domain/money.ts
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: "Do not parse money with parseFloat. Use parseRupees() from @/domain/money.",
        },
      ],
    },
  },
  {
    // Test helpers deal with loosely typed DB rows and mocks.
    files: ["tests/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
];

export default config;
