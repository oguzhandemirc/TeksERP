// =============================================================================
// TeksERP Backend — Minimal ESLint config
// =============================================================================
// Sadece işletme-kritik kuralları koruyoruz. Genel stil/quality kuralları
// kasıtlı olarak devre dışı; bu config bir formatter değil, bir guardrail.
//
// ⚠️ YENİ KURAL EKLEME ÖLÇÜTÜ (2026-09-05): buraya yalnız `docs/KOD-KURALLARI.md`
// § Yasaklar listesindeki bir kural, YALNIZ mekanik olarak (AST'den) kesin
// yakalanabiliyorsa ve MEVCUT kodda SIFIR ihlal ölçüldüyse girer. Ölçüm
// yapılmadan kural eklenmez: kırmızı veren bir kural, kuralın değil kapsamın
// yanlış okunduğunun işaretidir. Ölçülüp REDDEDİLEN örnek: `toLocaleUpperCase("tr")`
// yasağı DAR kapsamlıdır (yalnız koşullu etiket elemanı ↔ QualityGrade.code);
// src'de 62 meşru kullanım var, bazıları ZORUNLU (`query-parser.ts` Türkçe
// büyük/küçük harf) — bu yüzden kural YAZILMADI.
// =============================================================================

import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

// --- Yasak AST desenleri (docs/KOD-KURALLARI.md § Yasaklar) -----------------
// Hepsi 2026-09-05'te src/ üzerinde ölçüldü: sıfır ihlal (isabetlerin tamamı
// kuralı ANLATAN yorum satırlarıydı; AST yorumları görmez).
const TX_PROMISE_ALL = {
  // F15: hem Promise.all hem Promise.allSettled yakala. Guard isim-tabanlı
  // (`tx` Identifier) — $transaction closure parametresini DAİMA `tx` adlandır.
  selector:
    "CallExpression[callee.object.name='Promise'][callee.property.name=/^(all|allSettled)$/] Identifier[name='tx']",
  message:
    "Tx client üzerinde Promise.all/allSettled YASAK — pg@9'da hard-error, paralellik de illüzyon. Sıralı await kullan.",
};

const NOT_IN_EMPTY = {
  // 2026-08-15 saha çökmesinin kök nedeni: Prisma'da `notIn: []` "tümü" demek
  // değil, sorguyu bozar. Süzgeç boşsa KOŞULU HİÇ YAZMA.
  selector: "Property[key.name='notIn'] > ArrayExpression[elements.length=0]",
  message:
    "`notIn: []` YASAK (2026-08-15 saha çökmesi) — küme boşsa süzgeci HİÇ yazma. bkz. docs/KOD-KURALLARI.md § Yasaklar.",
};

const ORDER_BY_BATCH_NUMBER = {
  // Parti no SARAR (P01…P99) ve benzersiz DEĞİL: ne sözlüksel ne sayısal sıra
  // "yenilik" sırasıdır. Parti listeleyen her yer `createdAt` ile sıralar.
  selector: "Property[key.name='orderBy'] Property[key.name='batchNumber']",
  message:
    "`orderBy: { batchNumber }` YASAK — parti no sarar ve benzersiz değildir; `createdAt` ile sırala. bkz. docs/kurallar/parti.md.",
};

const GENERIC_REQUIRE_MODULE = {
  // Modül kapısı ADLANDIRILMIŞ olmalı (requireProductionEnabled vb.) — bekçiler
  // middleware ADINI AST/metin olarak arar; jenerik fabrika onları kör eder.
  selector: "CallExpression[callee.name='requireModule']",
  message:
    "Jenerik `requireModule(\"x\")` YASAK — adlandırılmış kapı kullan (requireProductionEnabled / requireTicaretEnabled / requireIplikEnabled / requireDepoMultiEnabled). bkz. docs/kurallar/modul-bayrak.md.",
};

const FACTORY_TZ_LITERAL = {
  // Fabrika günü TEK KAYNAK `src/constants/time.ts`. Literali kopyalamak,
  // çok-şubeli/çok-saat-dilimli senaryoda tek noktadan çözümü imkânsızlaştırır.
  selector: "Literal[value='Europe/Istanbul']",
  message:
    "`'Europe/Istanbul'` literalini kopyalama — `FACTORY_TIMEZONE` (src/constants/time.ts) kullan. bkz. docs/kurallar/raporlar.md.",
};

const ORTAK_YASAKLAR = [
  TX_PROMISE_ALL,
  NOT_IN_EMPTY,
  ORDER_BY_BATCH_NUMBER,
  GENERIC_REQUIRE_MODULE,
];

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
      "no-restricted-syntax": ["error", ...ORTAK_YASAKLAR, FACTORY_TZ_LITERAL],
    },
  },
  // --- Saat dilimi sabitinin TANIM yeri: literal orada meşrudur -------------
  // `no-restricted-syntax` tek kuraldır; sonraki blok öncekini TAMAMEN ezer.
  // Bu yüzden burada ortak yasaklar TEKRAR sayılır, yalnız tz seçicisi düşer.
  {
    files: ["src/constants/time.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...ORTAK_YASAKLAR],
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
