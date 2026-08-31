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
    // Test/E2E altyapısı (TS) — TS parser ile lint et (aksi halde `type` import'u
    // parse error verir). Node ortamı.
    files: ["e2e/**/*.{ts,tsx}", "playwright.config.ts", "vitest.config.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
      globals: nodeGlobals,
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    ignores: [
      "out/**",
      "release/**",
      "node_modules/**",
      "dist/**",
      // WEB hedefinin build çıktısı (`npm run build:web` → vite.config.web.ts).
      // .gitignore'a eklenmişti ama eslint'e eklenmemişti: `npm run lint`
      // minify edilmiş paketi tarayıp onlarca sahte hata basıyor ("'S' is
      // defined but never used", satır 1 sütun 3671) ve gerçek hataları
      // gürültüde boğuyordu.
      "dist-web/**",
      "electron.vite.config.ts",
      // Aynı sınıf: Node bağlamında koşan build yapılandırması (`process` vb.
      // globalleri kullanır). Kardeşi `electron.vite.config.ts` zaten muaf;
      // web hedefi eklenirken bu satır atlanmıştı.
      "vite.config.web.ts",
    ],
  },
];
