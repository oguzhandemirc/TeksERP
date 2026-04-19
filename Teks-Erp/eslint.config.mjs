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
          selector:
            "CallExpression[callee.object.name='Promise'][callee.property.name='all'] Identifier[name='tx']",
          message:
            "Tx client üzerinde Promise.all YASAK — pg@9'da hard-error, paralellik de illüzyon. Sıralı await kullan.",
        },
      ],
    },
  },
];
