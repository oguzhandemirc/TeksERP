// =============================================================================
// Satıcı sunucusu — ESLint guardrail'i (formatter DEĞİL). Kalıp `Teks-Erp/eslint.config.mjs`:
// her kural ya sahada ısırmış bir yasağı ya da çekirdek kuralı mekanik korur; kural ancak AST'den
// KESİN yakalanabiliyorsa girer ve kararı ÖLÇÜM verir (ihlal 0 → "error"; > 15 → "warn" + tavan
// `lint-baseline.json`, tavan yalnız DÜŞER). Kapsam `package.json > scripts.lint` ile birebir
// (`scripts/check-lint-baseline.mjs` PROJELER.satici) — ayrışırsa tavan başka kümeyi ölçer.
//
// ── Backend'den BİLEREK farklı olanlar ──────────────────────────────────────────
//  · `no-console` YOK: satıcı günlüğü `[satici] …` önekli console satırlarıdır (erişim günlüğü,
//    açılış, bakım adımı); ayrı bir logger kanalı yok — kural 30+ meşru satırı cezalandırırdı.
//  · Fabrika-özgü yasaklar (parti no sıralaması, PROCESS_QC, `clientType`, fabrika günü DATE_TRUNC,
//    `Europe/Istanbul` tek kaynağı, modül kapısı adı) satıcıda konusuz — alınmadı.
//  · `src/lisans-protokol/` Teks-Erp'teki tek kaynağın BAYT-EŞİT aynasıdır: burada düzenlenmez,
//    lint'i kaynağında olur (ayna bekçisi `test_lisans_protokol_aynasi`) → kapsam dışı.
// =============================================================================

import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

const TX_PROMISE_ALL = {
  // `$transaction` geri çağrısının parametresi DAİMA `tx` — tx istemcisi paralelleştirilmez.
  selector:
    "CallExpression[callee.object.name='Promise'][callee.property.name=/^(all|allSettled)$/] Identifier[name='tx']",
  message: "Tx client üzerinde Promise.all/allSettled YASAK — sıralı await kullan (kök CLAUDE.md § Eşzamanlılık).",
};

const NOT_IN_EMPTY = {
  selector: "Property[key.name='notIn'] > ArrayExpression[elements.length=0]",
  message: "`notIn: []` YASAK — küme boşsa süzgeci HİÇ yazma (docs/KOD-KURALLARI.md § Yasaklar).",
};

const RESPONSE_BODY_CODE = {
  // Hata kodu `details.code` altındadır; kök `code` hep undefined döner (sahte yeşil).
  selector: "MemberExpression[object.property.name='body'][property.name='code']",
  message: "`body.code` okuma YASAK — hata kodu `details.code` altındadır.",
};

const NOW_AT_TIME_ZONE = {
  selector:
    "Literal[value=/now\\(\\)\\s*AT TIME ZONE/i], TemplateElement[value.raw=/now\\(\\)\\s*AT TIME ZONE/i]",
  message: "`now() AT TIME ZONE 'UTC'` YASAK — kolonlar timestamptz, düz `now()` doğru anı yazar.",
};

const TURKISH_IDENTIFIER = {
  // Tanımlayıcılar İngilizce/ASCII; tel şeması anahtarları, kod değerleri ve metinler Türkçe kalır.
  selector:
    "Identifier[name=/[çğıöşüÇĞİÖŞÜİ]/]:not(Property > .key):not(MemberExpression > .property):not(TSPropertySignature > .key)",
  message: "Tanımlayıcı ASCII olmalı — Türkçe karakter YASAK (metin, mesaj ve yorum Türkçe KALIR).",
};

const YASAKLAR = [TX_PROMISE_ALL, NOT_IN_EMPTY, RESPONSE_BODY_CODE, NOW_AT_TIME_ZONE, TURKISH_IDENTIFIER];

/** Adlandırma: Teks-Erp sözleşmesiyle aynı (sözlük anahtarları `format: null`). */
const NAMING_CONVENTION = [
  "error",
  {
    selector: "default",
    format: ["camelCase"],
    leadingUnderscore: "allow",
    trailingUnderscore: "allow",
    filter: { regex: "^__.*(ForTests|__)$", match: false },
  },
  {
    selector: "variable",
    format: ["camelCase", "UPPER_CASE", "PascalCase"],
    leadingUnderscore: "allow",
    trailingUnderscore: "allow",
    filter: { regex: "^__.*(ForTests|__)$", match: false },
  },
  { selector: "function", format: ["camelCase", "PascalCase"], leadingUnderscore: "allow" },
  { selector: "parameter", format: ["camelCase"], leadingUnderscore: "allow" },
  { selector: "typeLike", format: ["PascalCase"], leadingUnderscore: "allow" },
  { selector: "enumMember", format: ["UPPER_CASE", "PascalCase"] },
  { selector: ["classProperty", "classMethod"], format: ["camelCase", "UPPER_CASE"], leadingUnderscore: "allow" },
  { selector: ["objectLiteralProperty", "objectLiteralMethod", "typeProperty"], format: null },
  { selector: "import", format: ["camelCase", "PascalCase", "UPPER_CASE"] },
];

/** Boyut — `warn` + tavan; yorum bir DEĞERdir (skipComments load-bearing). */
const BOYUT_KURALLARI = {
  "max-lines": ["warn", { max: 300, skipComments: true, skipBlankLines: true }],
  "max-lines-per-function": ["warn", { max: 80, skipComments: true, skipBlankLines: true, IIFEs: true }],
  "max-params": ["warn", 4],
};

const tsBlok = { languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 2022, sourceType: "module" } }, plugins: { "@typescript-eslint": tsPlugin } };

export default [
  { ignores: ["src/lisans-protokol/**", "node_modules/**", "dist/**"] },

  // ── 1) Uygulama kaynağı ────────────────────────────────────────────────────
  {
    files: ["src/**/*.ts"],
    ...tsBlok,
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "no-restricted-syntax": ["error", ...YASAKLAR],
      "@typescript-eslint/naming-convention": NAMING_CONVENTION,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-require-imports": "error",
      ...BOYUT_KURALLARI,
    },
  },

  // ── 2) Tip bilgili: sahipsiz promise (yalnız src tsconfig kapsamı) ─────────
  {
    files: ["src/**/*.ts"],
    languageOptions: { parser: tsParser, parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: { "@typescript-eslint/no-floating-promises": "error" },
  },

  // ── 3) Bekçiler + CLI (scripts/): yasaklar + adlandırma; boyut ve konsol gürültüdür ──
  {
    files: ["scripts/**/*.ts"],
    ...tsBlok,
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "no-restricted-syntax": ["error", ...YASAKLAR],
      "@typescript-eslint/naming-convention": NAMING_CONVENTION,
    },
  },
];
