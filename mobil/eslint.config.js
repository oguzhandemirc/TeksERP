// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "node_modules/*", "coverage/*"],
  },
  {
    rules: {
      // Türkçe arayüz metinleri doğal olarak kesme işareti/tırnak içerir
      // (örn. "İş Emri'ne", "Çuval'a"). Bu stilistik kural doğal dille çakışır;
      // Expo/RN projelerinde yaygınca kapatılır. JSX metni güvenli (React kaçırır).
      "react/no-unescaped-entities": "off",
    },
  },
  {
    // Test dosyaları: jest global'leri (describe/it/expect/jest) tanımlı say.
    files: ["**/*.test.{ts,tsx}", "src/test/**"],
    languageOptions: {
      globals: { describe: "readonly", it: "readonly", expect: "readonly", jest: "readonly", beforeEach: "readonly", afterEach: "readonly", beforeAll: "readonly", afterAll: "readonly" },
    },
  },
]);
