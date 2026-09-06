// =============================================================================
// TeksERP Backend — ESLint guardrail'i (formatter DEĞİL)
// =============================================================================
// Bu config bir stil aracı değil, bir KAPI setidir: her kural ya sahada ısırmış
// bir yasağı ya da `docs/standart/` altındaki bir kuralı mekanik olarak korur.
//
// ⚠️ KURAL EKLEME ÖLÇÜTÜ (docs/standart/README.md): kural ancak AST'den KESİN
// yakalanabiliyorsa girer ve kararı ÖLÇÜM verir:
//     ölçülen ihlal 0        → "error"
//     ölçülen ihlal ≤ 15     → ihlaller düzeltilir, sonra "error"
//     ölçülen ihlal > 15     → "warn" + tavan (lint-baseline.json), tavan yalnız DÜŞER
//     ölçüm kuralı çürütüyor → KURAL YAZILMAZ, gerekçe buraya yazılır
// Ölçüm yapılmadan kural eklenmez: kırmızı veren bir kural, kuralın değil
// KAPSAMIN yanlış okunduğunun işaretidir.
//
// ── ÖLÇÜLÜP REDDEDİLENLER (yeniden denemeden önce buraya bak) ────────────────
//  · `toLocaleUpperCase("tr")` yasağı — DAR kapsamlıdır (yalnız koşullu etiket
//    elemanı ↔ QualityGrade.code). src'de 59 meşru kullanım, bazıları ZORUNLU
//    (query-parser.ts Türkçe büyük/küçük harf) → kural YAZILMADI.
//  · `z.enum([...])` literalinin Prisma enum aynası olduğu kuralı — 110 isabet ve
//    yazılabilen en dar selector meşru literal listeleriyle ayırt EDİLEMİYOR
//    (aynası olan ile olmayan AST'de aynı görünür) → kural YAZILMADI, ölçüm
//    docs/history/standart-2026-09-05/olcum/eslint-backend.json'da.
//  · `findUnique → if → update` (atomik claim yerine check-then-act) — en dar
//    makul selector 53 isabet verdi ve desenin özü "AYNI kaydı" okuyup yazmaktır;
//    AST bunu ifade edemez → kural YAZILMADI, koruma bekçilerde
//    (test_consistency, alan bekçileri) ve incelemede.
//  · `@typescript-eslint/no-explicit-any` — BEKÇİ kapsamında (scripts/ + prisma/)
//    ölçüldü: 28 ihlal / 9 dosya. Karar tablosu ">15 → warn + tavan" derdi AMA
//    §5 bloğunun yazılı politikası bekçi kapsamını BİLEREK dar tutuyor
//    ("orada kural gürültüdür, sinyal değil") ve `scripts/` bugün 0 uyarıyla
//    yeşil — kural, korunacak bir tavan değil YENİ BİR BORÇ KAYDI açardı.
//    Politikayı çevirmek ayrı bir karardır; ölçüm burada duruyor ki ucuz olsun.
//    (İpucu: 5 ölü direktif tam bu kuralı kapatmaya çalışıyordu — niyet vardı.)
//  · `no-console` (backend) — ⚠️ BU MADDE ARTIK GEÇERSİZ (2026-09-07). O gün
//    verilen karar `src/lib/logger.ts`tir: 142 çağrının tamamı `hata/uyari/bilgi`
//    (+ banner için `satir`) ile seviye ve alan etiketi taşır hâle geldi ve kural
//    `src/` blokunda "error" olarak AÇILDI (tek istisna kanalın kendi dosyası).
//    Kararın gerekçesi ölçümdür: fabrikanın 5 haftalık hata log'unda etiketli 531
//    satır saniyede gruplanabildi, etiketsiz ~5100 satır elle okundu.
//
// Ölçüm tarihi ve tam sayılar: docs/history/standart-2026-09-05/olcum/eslint-backend.json
// =============================================================================

import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

// ── Yasak AST desenleri (docs/KOD-KURALLARI.md § Yasaklar) ───────────────────
// Hepsi ölçüldü: kapsamlarında SIFIR ihlal (isabetlerin tamamı kuralı ANLATAN
// yorum satırlarıydı; AST yorumları görmez).

const TX_PROMISE_ALL = {
  // F15: hem Promise.all hem Promise.allSettled yakala. Guard isim-tabanlı
  // (`tx` Identifier) — $transaction closure parametresini DAİMA `tx` adlandır
  // (docs/standart/ILKELER.md [IL-19]).
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
    "Jenerik `requireModule(\"x\")` YASAK — adlandırılmış kapı kullan (requireProductionEnabled / requireTicaretEnabled / requireIplikEnabled / requireDepoMultiEnabled / requireFinanceEnabled). bkz. docs/kurallar/modul-bayrak.md.",
};

const PROCESS_QC_COMPARE = {
  // "Bu adım KK yürütür mü" sorusunun TEK cevabı boğaz-ikizdir: saf yüklem
  // `stepCanApplyQuality` + Prisma parçası `QUALITY_STATION_WHERE`. Yeni bir
  // literal karşılaştırma, ikizin iki ayağını sessizce üçe çıkarır.
  selector:
    "BinaryExpression[operator=/^[!=]==$/] MemberExpression[property.name='PROCESS_QC'], BinaryExpression[operator=/^[!=]==$/] Literal[value='PROCESS_QC']",
  message:
    "`kind === PROCESS_QC` karşılaştırması YASAK — soruyu `stepCanApplyQuality` / `QUALITY_STATION_WHERE` cevaplar (boğaz-ikiz). bkz. docs/kurallar/kalite.md.",
};

const CLIENT_TYPE_MOBILE = {
  // `clientType` gövdeden gelir ve UYDURULABİLİR; uzak/LAN ayrımı SOKETTEN
  // (`req.socket.localPort`) çözülür. `!== "mobile"` bir güvenlik kapısı gibi
  // okunur ama değildir.
  selector: "BinaryExpression[operator='!=='] Literal[value='mobile']",
  message:
    '`!== "mobile"` YASAK — `clientType` opsiyoneldir ve güvenlik sınırı DEĞİL; uzak/LAN ayrımı soketten yapılır. bkz. docs/kurallar/kesif-cihaz.md.',
};

const RESPONSE_BODY_CODE = {
  // Hata kodu `details.code` altındadır; kök `code` HER ZAMAN undefined döner.
  // `body.code` okuyan bir kontrol sessizce hep yanlış dala girer (sahte yeşil).
  // ⚠️ Selector DAR: `object.property.name='body'` (res.body.code). Geniş yazım
  // (`object.name='body'`) Zod ile parse edilmiş TOTP gövdesinin `code` alanını
  // yanlış pozitif olarak yakalıyordu (ölçüldü).
  selector: "MemberExpression[object.property.name='body'][property.name='code']",
  message:
    "`body.code` okuma YASAK — hata kodu `details.code` altındadır, kök `code` hep undefined döner (sahte yeşil). bkz. docs/kurallar/modul-bayrak.md.",
};

const APPLIED_STEPS_COUNT = {
  // `migrate resolve --applied` ile işaretlenen migration `applied_steps_count=0`
  // taşır; bu sayı SQL'in gerçekten koştuğunu KANITLAMAZ.
  selector:
    "Literal[value=/applied_steps_count/], TemplateElement[value.raw=/applied_steps_count/], Identifier[name='applied_steps_count'], Property[key.name='applied_steps_count']",
  message:
    "`applied_steps_count` ile migration doğrulama YASAK — elle resolve edilmiş migration 0 taşır, SQL'in koştuğunu kanıtlamaz. bkz. docs/kurallar/deploy-kurulum.md.",
};

const BARE_DATE_TRUNC = {
  // Fabrika günü TEK KAYNAK `src/constants/time.ts` (factoryDaySql/…): çıplak
  // DATE_TRUNC, gün sınırını sessizce UTC'ye kaydırır.
  // ⚠️ Bu kural 2026-09-05'e dek TANIMLIYDI AMA HİÇ KOŞMUYORDU: `ORTAK_YASAKLAR`
  // listesine hiç girmemiş, yalnız time.ts bloğunun `filter`ında adı geçiyordu
  // (olmayan bir üyeyi eleyen filtre). Ölçüm: src 0 · prisma 0 · scripts 10 —
  // hepsi ya yasağın KONUSUNU ölçen bekçi ya da donmuş Faz C2 bench'i.
  selector: "Literal[value=/DATE_TRUNC/i], TemplateElement[value.raw=/DATE_TRUNC/i]",
  message:
    "Çıplak `DATE_TRUNC` YASAK — fabrika günü tek kaynak `src/constants/time.ts`. bkz. docs/kurallar/raporlar.md.",
};

const NOW_AT_TIME_ZONE = {
  // Kolonlar timestamptz (315 DateTime alanının 311'i; 4 muaf `@db.Date`).
  // `(now() AT TIME ZONE 'UTC')` bugün yalnız KİMLİK DÖNÜŞÜMÜDÜR ve doğruluğu
  // OTURUM saat dilimine bağlar. 11 tarihsel yazım 2026-09-05'te düz `now()` +
  // gerekçeli `-- tz-ok:` işaretine çevrildi → kapsam artık sıfır ihlalli.
  selector:
    "Literal[value=/now\\(\\)\\s*AT TIME ZONE/i], TemplateElement[value.raw=/now\\(\\)\\s*AT TIME ZONE/i]",
  message:
    "`now() AT TIME ZONE 'UTC'` YASAK — kolon timestamptz, düz `now()` doğru anı yazar; sarmal doğruluğu oturum tz'sine bağlar. Gerekçeli `-- tz-ok:` işareti koy. bkz. scripts/test_raw_sql_hygiene.ts.",
};

const TURKISH_IDENTIFIER = {
  // Tanımlayıcılar İngilizce/ASCII; UI metni, hata mesajı ve yorum Türkçe kalır
  // (docs/standart/ILKELER.md [IL-16]). ⚠️ Selector DAR: nesne anahtarları ve
  // üye erişimleri HARİÇ — onlar veri/sözlük anahtarıdır, tanımlayıcı değil
  // (ham selector 24 yanlış pozitif veriyordu, ölçüldü).
  selector:
    "Identifier[name=/[çğıöşüÇĞİÖŞÜİ]/]:not(Property > .key):not(MemberExpression > .property):not(TSPropertySignature > .key)",
  message:
    "Tanımlayıcı ASCII/İngilizce olmalı — Türkçe karakter YASAK (UI metni, mesaj ve yorum Türkçe KALIR). bkz. docs/standart/ILKELER.md § İsimlendirme.",
};

/** Her kapsamda geçerli yasaklar. */
const ORTAK_YASAKLAR = [
  TX_PROMISE_ALL,
  NOT_IN_EMPTY,
  ORDER_BY_BATCH_NUMBER,
  GENERIC_REQUIRE_MODULE,
  PROCESS_QC_COMPARE,
  CLIENT_TYPE_MOBILE,
  RESPONSE_BODY_CODE,
  APPLIED_STEPS_COUNT,
  NOW_AT_TIME_ZONE,
  TURKISH_IDENTIFIER,
  BARE_DATE_TRUNC,
];

const FACTORY_TZ_LITERAL = {
  // Fabrika saat dilimi TEK KAYNAK `src/constants/time.ts`; literali kopyalamak
  // çok-şubeli senaryoda tek noktadan çözümü imkânsızlaştırır.
  selector: "Literal[value='Europe/Istanbul']",
  message:
    "`'Europe/Istanbul'` literalini kopyalama — `FACTORY_TIMEZONE` (src/constants/time.ts) kullan. bkz. docs/kurallar/raporlar.md.",
};

/**
 * Adlandırma sözleşmesi. Üç kademeli ölçümle daraltıldı (43 → 37 → 2 ihlal):
 *  · `__…ForTests` bilinçli test kapılarıdır → filter ile muaf.
 *  · classProperty/classMethod UPPER_CASE alır: dispatch tabloları ve sabitler
 *    (record-info 24 Prisma model anahtarı, label-renderer ZPL/PPLA/PPLB…).
 *  · objectLiteralProperty / typeProperty `format: null` — bunlar SÖZLÜK
 *    anahtarıdır (Prisma model adı, yazıcı dili, ayar anahtarı), tanımlayıcı değil.
 */
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
  {
    selector: "function",
    format: ["camelCase", "PascalCase"],
    leadingUnderscore: "allow",
    filter: { regex: "^__.*ForTests$", match: false },
  },
  { selector: "parameter", format: ["camelCase"], leadingUnderscore: "allow" },
  { selector: "typeLike", format: ["PascalCase"], leadingUnderscore: "allow" },
  { selector: "enumMember", format: ["UPPER_CASE", "PascalCase"] },
  {
    selector: ["classProperty", "classMethod"],
    format: ["camelCase", "UPPER_CASE"],
    leadingUnderscore: "allow",
  },
  { selector: ["objectLiteralProperty", "objectLiteralMethod", "typeProperty"], format: null },
  { selector: "import", format: ["camelCase", "PascalCase", "UPPER_CASE"] },
];

/**
 * Boyut kuralları — `warn` + tavan (docs/standart/ILKELER.md §6).
 * ⚠️ `skipComments` ve `skipBlankLines` LOAD-BEARING: bu repoda yorum bir
 * DEĞERDİR (karar kaydı koruduğu kodun yanında yaşar). Skip'siz ölçüm 145 dosya
 * / 391 fonksiyon, skip'li ölçüm 90 / 305 verdi — yani skip'siz kural, 55 dosyayı
 * yorum yazdığı için cezalandırırdı.
 */
const BOYUT_KURALLARI = {
  "max-lines": ["warn", { max: 300, skipComments: true, skipBlankLines: true }],
  "max-lines-per-function": [
    "warn",
    { max: 80, skipComments: true, skipBlankLines: true, IIFEs: true },
  ],
  "max-params": ["warn", 4],
};

export default [
  // ── 1) Uygulama kaynağı ────────────────────────────────────────────────────
  {
    files: ["src/**/*.ts"],
    ignores: ["src/services/helpers/quality-station.helper.ts", "src/constants/time.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    // Ölü `eslint-disable` bir yalan taşır: okuyan "burada bilinçli bir istisna
    // var" sanır. src'deki 8 ölü direktif 2026-09-05'te temizlendi.
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "no-restricted-syntax": ["error", ...ORTAK_YASAKLAR, FACTORY_TZ_LITERAL],
      "@typescript-eslint/naming-convention": NAMING_CONVENTION,
      "@typescript-eslint/no-explicit-any": "error",
      // Tembel `require` YALNIZ gerekçeli tek bir yerde meşrudur (mdns reklamcısı:
      // paket yüklenemezse yol fail-open kapanır) ve orada satır bazlı disable
      // TAŞIR. Kural açık olduğu için o disable CANLIDIR — ölü direktif kalmaz.
      "@typescript-eslint/no-require-imports": "error",
      // 2026-09-07: AÇILDI. Başlıktaki eski gerekçe ("logger kararı ayrı bir
      // iştir") artık geçersiz — `src/lib/logger.ts` var ve 142 çağrının
      // TAMAMI oraya taşındı. Kural tavan değil SIFIR: yeni çıplak `console`
      // sessizce kanala karışmasın (seviye + alan etiketi kaybolur).
      "no-console": "error",
      ...BOYUT_KURALLARI,
    },
  },

  // ── 1b) Log kanalının KENDİ tanım yeri ─────────────────────────────────────
  // `console`u saran TEK dosya. Kanalın kendisi burada yazılır; başka her yerde
  // `no-console` hata verir (yukarıdaki blok). Dar ve ADLI istisna.
  {
    files: ["src/lib/logger.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "no-restricted-syntax": ["error", ...ORTAK_YASAKLAR, FACTORY_TZ_LITERAL],
      "@typescript-eslint/naming-convention": NAMING_CONVENTION,
      "@typescript-eslint/no-explicit-any": "error",
      // Flat config MERGE eder: üstteki blokta açılan `no-console` burada
      // AÇIKÇA kapatılmazsa yine geçerli olur (ölçüldü — 5 hata).
      "no-console": "off",
      ...BOYUT_KURALLARI,
    },
  },

  // ── 2) Tek kaynakların KENDİ tanım yerleri ─────────────────────────────────
  // `no-restricted-syntax` tek kuraldır; sonraki blok öncekini TAMAMEN ezer →
  // ortak yasaklar burada TEKRAR sayılır, yalnız o dosyaya ait selector düşer.
  {
    files: ["src/constants/time.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      // Fabrika saat dilimi ve DATE_TRUNC'ın TANIM yeri: literal burada meşrudur.
      "no-restricted-syntax": [
        "error",
        ...ORTAK_YASAKLAR.filter((k) => k !== BARE_DATE_TRUNC && k !== NOW_AT_TIME_ZONE),
      ],
      "@typescript-eslint/naming-convention": NAMING_CONVENTION,
      "@typescript-eslint/no-explicit-any": "error",
      ...BOYUT_KURALLARI,
    },
  },
  {
    files: ["src/services/helpers/quality-station.helper.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      // Boğaz ikizin TANIM yeri: `PROCESS_QC` karşılaştırması burada Faz A
      // köprüsüdür ve gerekçesi dosya başlığında yazılıdır.
      "no-restricted-syntax": [
        "error",
        ...ORTAK_YASAKLAR.filter((k) => k !== PROCESS_QC_COMPARE),
        FACTORY_TZ_LITERAL,
      ],
      "@typescript-eslint/naming-convention": NAMING_CONVENTION,
      "@typescript-eslint/no-explicit-any": "error",
      ...BOYUT_KURALLARI,
    },
  },

  // ── 3) Katman guardrail'i: route/controller'da prisma client YASAK ─────────
  // Routes → Controllers → Services → Prisma. Prisma client'ı yalnız servis
  // katmanı import eder; route/controller'dan DB'ye inen kod katman ihlali +
  // audit/sanitize bypass'ıdır. Enum TİPLERİ (`@prisma/client`) serbesttir.
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
                "Route/controller katmanında prisma client import'u YASAK — iş mantığını servise taşı. bkz. docs/standart/BACKEND.md § Katman sözleşmesi.",
            },
          ],
        },
      ],
    },
  },

  // ── 4) Tip bilgili kural: sahipsiz promise ────────────────────────────────
  // Ayrı blok, çünkü tip bilgisi lint süresini 3sn → 12sn'ye çıkarıyor (ölçüldü)
  // ve YALNIZ `src` tsconfig kapsamında çalışır (scripts/ include edilmemiş).
  // Ölçüm: 0 ihlal — `void AuditService.log(...)` gibi bilinçli ateşle-unut
  // kalıpları `void` ile zaten işaretli.
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: { "@typescript-eslint/no-floating-promises": "error" },
  },

  // ── 5) KAPSAM: bekçiler ve seed (2026-09-05'te açıldı) ─────────────────────
  // `scripts/` 555 dosya ve 455 bekçi taşıyor, `prisma/` seed'leri var; ikisi de
  // bugüne dek HİÇ lint edilmiyordu. Aynı boşluk tsc'de yaşanmış ve 87 tip hatası
  // birikmişti — kapsam dışı kod sessizce bayatlar.
  // Kural seti DAR ve bilinçli: yasaklar (`no-restricted-syntax`) + adlandırma
  // (`@typescript-eslint/naming-convention`). Boyut kuralları ve `no-console` bu
  // bloğa GİRMEZ (bekçiler uzun ve konuşkandır: ölçüm scripts/'te 341 fonksiyon /
  // 4700 console — orada kural gürültüdür, sinyal değil).
  //
  // ⚠️ `naming-convention` 2026-09-05'te EKLENDİ: başlık bu cümleyi zaten
  // söylüyordu ama kural bu blokta YOKTU (`--print-config scripts/test_helpers.ts`
  // → undefined) — belge ile kapı ayrışmıştı. Ölçüm 6 ihlal / 3 dosya (≤15 →
  // "düzelt, sonra error"): `test_advisory_lock_namespaces` kodda_yok /
  // envanterde_yok · `test_manual_props_claim_pin` araya_girildi (snake_case) ·
  // `test_settings_password` __bitti (type method) + HTTP_KONTROL (parametre).
  // Hepsi camelCase'e çevrildi; ölçüm 0.
  //
  // KAPSAM AÇILDIĞINDA ÖLÇÜLEN 25 İHLAL — hükümleri (hepsi kapatıldı, 0 error):
  //   · 4 × `'Europe/Istanbul'` → DÜZELTİLDİ (`FACTORY_TIMEZONE` import edildi;
  //     emsal zaten vardı: find_dead_labels, fix_fire_rolls_to_scrap).
  //   · 8 × Türkçe tanımlayıcı → YENİDEN ADLANDIRILDI (`hariçUserId`→`haricUserId`,
  //     `pasifleşenler`→`pasiflesenler`). superadmin-olustur.ts'te SIR/ÇIKTI
  //     davranışına dokunulmadı; bekçi `test_superadmin_provision` yeşil (79/79).
  //   · 2 × `PROCESS_QC` → GEREKÇELİ SATIR-İÇİ DISABLE. İkisi de yetenek sorusu
  //     DEĞİL: biri fixture kimlik çözümü (seed-test-full), diğeri rota topolojisi
  //     iddiası (test_e2e_full_flow) — `stepCanApplyQuality` orada yanlış cevap verir.
  //   · 3 × `now() AT TIME ZONE` → 2'si konu bekçisi (ignores), 1'i disable.
  //   · 2 × `body.code` → tek `rootCode` sabitine çekildi + 1 disable: kök alanın
  //     geriye uyum için HÂLÂ dolduğunu ölçen tek yer orası.
  //   · 6 × ölü `eslint-disable` → SİLİNDİ, taşıdıkları bilgi DÜZ YORUMA çevrildi
  //     (kapatmaya çalıştıkları kurallar bu blokta zaten AÇIK DEĞİL).
  //
  // AYRICA: `BARE_DATE_TRUNC` bu turda İLK KEZ KOŞTURULDU (tanımlıydı ama
  // ORTAK_YASAKLAR'a hiç eklenmemişti). Ölçüm 10 ihlal, tamamı scripts/:
  //   · test_report_day_boundary → konu bekçisi, ignores.
  //   · test_demand_analysis · test_db_invariants → tek satır, gerekçeli disable.
  //   · bench_audit_{summary,probe,final} → 2026-08-01 tz dönüşümü ÖNCESİNİN sorgu
  //     şeklini DONMUŞ olarak taşıyan Faz C2 A/B bench'leri. `factoryDaySql`e
  //     çevirmek ölçtükleri şeyi değiştirir (kaydedilmiş sayılar karşılaştırılamaz
  //     olur) → düzeltme DEĞİL, gerekçeli disable.
  {
    files: ["scripts/**/*.ts", "prisma/**/*.ts"],
    // Bu dört bekçi yasağın KONUSUNU ölçer: yasaklı diziyi kendi metninde taşımak
    // zorundadır (aramak için). Kapsam dışı bırakılmazsa kural, kendisini
    // koruyan bekçiyi cezalandırır.
    // ⚠️ Ölçüt DAR: dosyanın KONUSU yasağın kendisi olmalı. Yasağa tek satırda
    // değen bekçi buraya GİRMEZ, gerekçeli satır-içi disable taşır (emsal:
    // test_module_grandfathering.ts:159, test_remote_access_guard.ts:431).
    ignores: [
      "scripts/test_migration_hygiene.ts",
      "scripts/test_raw_sql_hygiene.ts",
      "scripts/test_station_quality_capability.ts",
      // `now() AT TIME ZONE 'UTC'`ı ÇALIŞTIRARAK kimlik dönüşümü olduğunu kanıtlar
      // (SHOW TimeZone + sapma=0 ölçümü). Kalıp burada iddianın kendisidir.
      "scripts/test_timestamptz_contract.ts",
      // Çıplak `DATE_TRUNC`ın günü UTC'ye kaydırdığını ÖLÇEREK kanıtlar (fabrika
      // ifadesiyle yan yana koşar) ve ayrıca src/ ağacını aynı kalıba karşı tarar.
      "scripts/test_report_day_boundary.ts",
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "no-restricted-syntax": ["error", ...ORTAK_YASAKLAR, FACTORY_TZ_LITERAL],
      "@typescript-eslint/naming-convention": NAMING_CONVENTION,
    },
  },
];
