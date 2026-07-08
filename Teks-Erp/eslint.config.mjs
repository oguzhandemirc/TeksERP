// =============================================================================
// TeksERP Backend — Minimal ESLint config
// =============================================================================
// Sadece işletme-kritik kuralları koruyoruz. Genel stil/quality kuralları
// kasıtlı olarak devre dışı; bu config bir formatter değil, bir guardrail.
// =============================================================================

import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    // Plugin'i kayıt ediyoruz ki mevcut kodda kullanılan
    // `eslint-disable-next-line @typescript-eslint/…` yorumları geçerli olsun.
    // Kural setinden hiçbir şey aktif DEĞİL — bu config bir formatter değil.
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    rules: {
      // --- pg adapter + $transaction guardrail -----------------------------
      // Prisma $transaction callback'i tek pg bağlantısı kullanır. Aynı tx
      // client üzerinde eş zamanlı sorgu göndermek pg@9'da hard-error olur
      // (pg@8'de DeprecationWarning). Paralellik zaten illüzyondur — tek
      // bir TCP bağlantısı sıralar. Sıralı await kullanın.
      //
      // YASAK:   Promise.all([tx.foo.findMany(), tx.bar.count()])
      // YASAK:   Promise.all(items.map(i => tx.thing.update({...})))
      // OK:      Promise.all([prisma.foo(...), prisma.bar(...)])   // pool
      // OK:      for (...) await tx.thing.update(...)              // sıralı
      // ---------------------------------------------------------------------
      "no-restricted-syntax": [
        "error",
        {
          // F15: hem Promise.all hem Promise.allSettled yakala. Guard isim-tabanlı
          // (`tx` Identifier) — $transaction closure parametresini DAİMA `tx` adlandır.
          selector:
            "CallExpression[callee.object.name='Promise'][callee.property.name=/^(all|allSettled)$/] Identifier[name='tx']",
          message:
            "Tx client üzerinde Promise.all/allSettled YASAK — pg@9'da hard-error, paralellik de illüzyon. Sıralı await kullan.",
        },
      ],
    },
  },
  // --- Katman guardrail'i: route/controller'da prisma client yasak ----------
  // Routes → Controllers → Services → Prisma (CLAUDE.md). Prisma client'ı
  // yalnız service katmanı import eder; route/controller'dan DB'ye inen kod
  // katman ihlali + audit/sanitize bypass'ıdır. Enum TİPLERİ için
  // `import { X } from "@prisma/client"` serbesttir (sadece client instance
  // modülü kısıtlı). Mevcut tarihi ihlaller satır bazlı disable + TODO taşır.
  {
    files: ["src/routes/**/*.ts", "src/controllers/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/lib/prisma"],
              message:
                "Route/controller katmanında prisma client import'u YASAK — iş mantığını servise taşı (CLAUDE.md katman kuralı).",
            },
          ],
        },
      ],
    },
  },
];
