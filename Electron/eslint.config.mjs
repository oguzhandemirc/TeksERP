import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

const browserGlobals = {
  ...globals.browser,
  ...globals.es2021,
};

const nodeGlobals = {
  ...globals.node,
  ...globals.es2021,
};

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
      globals: browserGlobals,
    },
    plugins: { "@typescript-eslint": tsPlugin, "react-hooks": reactHooks },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-redeclare": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "electron", message: "Renderer'da electron import edilemez. window.api üzerinden çağır." },
            { name: "fs", message: "Renderer'da fs import edilemez." },
            { name: "path", message: "Renderer'da path import edilemez." },
            { name: "child_process", message: "Renderer'da child_process import edilemez." },
            { name: "os", message: "Renderer'da os import edilemez." },
          ],
        },
      ],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["electron/**/*.ts", "shared/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
      globals: nodeGlobals,
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-redeclare": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    ignores: [
      "out/**",
      "release/**",
      "node_modules/**",
      "dist/**",
      "electron.vite.config.ts",
    ],
  },
];
