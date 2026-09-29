// =============================================================================
// Satıcı portalı web arayüzü — ESLint guardrail'i (formatter DEĞİL). Kalıp `Electron/eslint.config.mjs`
// (aynı paket sürümleri): kural ancak AST'den KESİN yakalanabiliyorsa girer, kararı ÖLÇÜM verir
// (ihlal 0 → "error"). Kapsam `package.json > scripts.lint` ile birebir.
//
// ── Electron'dan BİLEREK farklı olanlar ─────────────────────────────────────────
//  · Boyut kuralları (max-lines · max-lines-per-function · max-params) YOK: tavan dosyası
//    (lint-baseline.json) açmadan "warn" yalnız gürültüdür; bileşen gövdesi tek fonksiyondur.
//  · Renderer/Node katman yasağı yerine TARAYICI yasağı: `node:*` modülü yalnız bekçide (src/test).
//  · Web depolamasına HİÇBİR ŞEY yazılmaz (oturum httpOnly çerezde; bir kez gösterilen sır
//    bileşen durumunda yaşar) — anahtar adından bağımsız, `setItem`in kendisi yasak.
// =============================================================================

import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

const TURKISH_IDENTIFIER = {
  // Tanımlayıcılar İngilizce/ASCII; UI metni, hata mesajı ve yorum Türkçe KALIR. Selector backend
  // ve Electron ile birebir: nesne anahtarları ve üye erişimleri veri sözlüğüdür, tanımlayıcı değil.
  selector:
    "Identifier[name=/[çğıöşüÇĞİÖŞÜİ]/]:not(Property > .key):not(MemberExpression > .property):not(TSPropertySignature > .key)",
  message: "Tanımlayıcı ASCII/İngilizce olmalı — Türkçe karakter YASAK (UI metni, mesaj ve yorum Türkçe KALIR).",
};

const WEB_STORAGE_WRITE = {
  // Sır (etkinleştirme kodu · TOTP) ve oturum tarayıcı deposuna düşmez: kalıcı iz bırakır.
  selector: "CallExpression[callee.property.name='setItem'][callee.object.name=/^(localStorage|sessionStorage)$/], CallExpression[callee.property.name='setItem'][callee.object.property.name=/^(localStorage|sessionStorage)$/]",
  message: "Web depolamasına yazma YASAK — oturum httpOnly çerezde, sır yalnız bileşen durumunda (satici/web/CLAUDE.md).",
};

const RESPONSE_BODY_CODE = {
  // Hata kodu `details.code` altındadır; kök `code` hep undefined (sahte yeşil).
  selector: "MemberExpression[object.property.name='body'][property.name='code'], MemberExpression[object.name='json'][property.name='code']",
  message: "Yanıt gövdesinden `code` okuma YASAK — hata kodu `details.code` altındadır (ApiError.code).",
};

const NAMING_CONVENTION = [
  "error",
  { selector: "default", format: ["camelCase"], leadingUnderscore: "allow", trailingUnderscore: "allow" },
  { selector: "variable", format: ["camelCase", "UPPER_CASE", "PascalCase"], leadingUnderscore: "allow" },
  { selector: "function", format: ["camelCase", "PascalCase"] },
  { selector: "parameter", format: ["camelCase", "PascalCase"], leadingUnderscore: "allow" },
  { selector: "typeLike", format: ["PascalCase"] },
  { selector: "import", format: ["camelCase", "PascalCase"] },
  {
    selector: ["objectLiteralProperty", "typeProperty", "classProperty", "typeMethod", "objectLiteralMethod", "classMethod"],
    format: null,
  },
];

const TS_BASE = {
  "no-unused-vars": "off",
  "no-undef": "off",
  "no-redeclare": "off",
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
  "@typescript-eslint/naming-convention": NAMING_CONVENTION,
  "no-console": ["error", { allow: ["warn", "error"] }],
};

export default [
  js.configs.recommended,
  { linterOptions: { reportUnusedDisableDirectives: "error" } },

  // ── Uygulama (tarayıcı) ─────────────────────────────────────────────────────
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/test/**"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: { "@typescript-eslint": tsPlugin, "react-hooks": reactHooks },
    rules: {
      ...TS_BASE,
      "no-restricted-imports": ["error", { patterns: [{ group: ["node:*"], message: "Tarayıcı paketine Node modülü girmez (yalnız src/test bekçileri)." }] }],
      "no-restricted-syntax": ["error", TURKISH_IDENTIFIER, WEB_STORAGE_WRITE, RESPONSE_BODY_CODE],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },

  // ── Bekçiler ve yapılandırma (Node) ─────────────────────────────────────────
  {
    files: ["src/test/**/*.{ts,tsx}", "vite.config.ts", "vitest.config.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
      globals: { ...globals.node, ...globals.browser, ...globals.es2021 },
    },
    plugins: { "@typescript-eslint": tsPlugin, "react-hooks": reactHooks },
    rules: {
      ...TS_BASE,
      "no-restricted-syntax": ["error", TURKISH_IDENTIFIER],
      "react-hooks/rules-of-hooks": "error",
    },
  },

  { ignores: ["dist/**", "node_modules/**", "eslint.config.mjs"] },
];
