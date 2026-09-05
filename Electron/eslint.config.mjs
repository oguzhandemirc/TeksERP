// =============================================================================
// TeksERP Panel (Electron) — ESLint guardrail'i (formatter DEĞİL)
// =============================================================================
// Bu config bir stil aracı değil, bir KAPI setidir: her kural ya sahada ısırmış
// bir yasağı ya da `docs/standart/` altındaki bir kuralı mekanik olarak korur.
// Biçimlendirme Prettier'ın işidir (`npm run format`), buranın değil.
//
// ⚠️ KURAL EKLEME ÖLÇÜTÜ (docs/standart/README.md): kural ancak AST'den KESİN
// yakalanabiliyorsa girer ve kararı ÖLÇÜM verir:
//     ölçülen ihlal 0        → "error"
//     ölçülen ihlal ≤ 15     → ihlaller düzeltilir, sonra "error"
//     ölçülen ihlal > 15     → "warn" + tavan (lint-baseline.json), tavan yalnız DÜŞER
//     ölçüm kuralı çürütüyor → KURAL YAZILMAZ, gerekçe buraya yazılır
// Her yeni kural NEGATİF SONDADAN geçer: kasıtlı ihlal → lint kırmızı → geri al.
//
// ── ÖLÇÜLÜP REDDEDİLENLER (yeniden denemeden önce buraya bak) ────────────────
//  · `import/no-cycle` — KÜTÜPHANE KARARI: `eslint-plugin-import` üç projenin
//    hiçbirinde kurulu değil ve `eslint-import-resolver-typescript` peer'ı ister;
//    TS alias'ları (`@/*`, `@shared/*`) çözülmezse kural SESSİZCE 0 döner (en kötü
//    sınıf). Varsayılan maxDepth ile bu kod tabanında kullanılamaz: ölçüm 1888
//    döngüsel kenar / 634 dosya buluyor — çünkü `routes/content-routes.tsx` her
//    sayfayı, sayfalar `store/tabs`i import eder (KASITLI registry topolojisi).
//    Derinlik duyarlılığı: maxDepth 1→0 · 2→3 · 3→23 · 4→64 · 5→149. maxDepth=2'deki
//    3 kenar TEK gerçek döngüdür: store/auth.ts → services/authService.ts →
//    services/apiClient.ts → store/auth.ts. Plugin'in bedeli, bağımlılıksız bir
//    bekçinin verdiği bilgiden fazlasını vermiyor → kural YAZILMADI, döngü kapısı
//    açık iş (bekçi idiomu: `src/test/import-cycles.test.ts`).
//  · Türkçe tanımlayıcı — HAM selector (`Identifier[name=/[çğıöşü…]/]`) YAZILMADI:
//    24 isabetin 22'si YANLIŞ POZİTİF, çünkü ham selector nesne literali
//    ANAHTARLARINI da vurur ve onlar tanımlayıcı değil VERİdir
//    (`{ Müşteri: "CUSTOMER" }` rol eşlemesi, `{ ş:"s", ı:"i", … }` slug haritası).
//    TR etiketli veri anahtarını yasaklamak TR-only ürün kararıyla çelişir.
//    Yazılan sürüm backend ile BİREBİR aynı DAR selector (aşağıda) → 7 isabet /
//    2 gerçek tanımlayıcı, ikisi de düzeltildi → bugün 0.
//  · Çıplak `no-console` — 3 isabet, üçü de MEŞRU tanı çıktısı (ErrorBoundary
//    componentDidCatch · useIdleLogout `window.api.power` yok → fallback ·
//    netStats YAVAŞ İSTEK ölçümü). `allow: ["warn","error"]` ile 0: kural gerçek
//    hedefi (unutulmuş `console.log`) yasaklar, tanıyı susturmaz.
//  · Renderer'da `electron`/`fs`/`path`/`child_process`/`os` importu — kural ZATEN
//    VAR (aşağıdaki `no-restricted-imports`), negatif sondayla canlı olduğu
//    doğrulandı. İkinci kez yazmak "tek kaynak"ı bozardı.
//
// ── ÖLÇÜTTEN BİLİNÇLİ SAPMA ─────────────────────────────────────────────────
//  · `*FormDialog.tsx ≤ 200` — 12 ihlal ölçüldü, ölçüt "≤15 → düzelt, error" der.
//    Düzeltme burada ~3.500 satırlık form BÖLME işidir (InvoiceFormDialog 647,
//    PeripheralDeviceFormDialog 414, ItemFormDialog 393); ölçütün "≤15" eşiği
//    UCUZ düzeltme varsayar, dosya bölmek ucuz değildir ve bir KAMPANYA olur
//    (kampanyalar docs/standart/README.md § bilinen borç'ta ertelenmiştir).
//    Karar: warn + tavan. Tavan 12 ve ARTMAZ → yeni dialog'lar sınırın altında
//    doğar, devralınanlar bölünene kadar donar.
//
//  · `max-params 4` — 10 ihlal ölçüldü (keşif dosyası 0 diyordu; ÜRETİM config'iyle
//    yeniden ölçüldü, ölçüm YANLIŞTI). 10 ≤ 15 ama düzeltme ~30 çağrı noktasında
//    imza değişikliğidir → warn + tavan. Dosya listesi ve gerekçe `BOYUT_KURALLARI`
//    başlığında.
//
// ── İKİ KONFİG TUZAĞI (aynı sınıf hata iki kez yaşandı) ─────────────────────
//  (a) ESLint bir kurala TEK yapılandırma kabul eder ve sonraki blok öncekini
//      TAMAMEN ezer: `no-restricted-syntax` selector'ları tek dizide toplanır.
//  (b) (a) yüzünden aynı kural adı altında İKİ SEVİYE olamaz. `onError` içindeki
//      çift toast'ın 26 ihlali var (warn+tavan) ama TR/token yasakları bugün 0
//      (error). İkisini tek `no-restricted-syntax` girdisine koymak ya token
//      yasağını warn'a indirirdi ya da lint'i kırmızı bırakırdı → çift toast
//      kuralı BAĞIMLILIKSIZ yerel plugin olarak yazıldı (aşağıda `yerel/`),
//      böylece kendi severity'si ve kendi baseline sayacı var.
//
// Ölçüm tarihi ve tam sayılar:
//   docs/history/standart-2026-09-05/olcum/eslint-electron.json
// Tavan (baseline): Electron/lint-baseline.json — `node scripts/check-lint-baseline.mjs --proje=electron`
// =============================================================================

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

// ── Yasak AST desenleri ──────────────────────────────────────────────────────
// Hepsi ölçüldü; kapsamlarında bugün SIFIR ihlal var (→ "error", bedelsiz).

const TURKISH_IDENTIFIER = {
  // Tanımlayıcılar İngilizce/ASCII; UI metni, hata mesajı, toast ve yorum Türkçe
  // KALIR (docs/standart/ILKELER.md § İsimlendirme). ⚠️ Selector DAR ve backend
  // ile birebir aynı: nesne anahtarları ile üye erişimleri HARİÇ — onlar veri
  // sözlüğüdür (`{ Müşteri: "CUSTOMER" }`), tanımlayıcı değil.
  selector:
    "Identifier[name=/[çğıöşüÇĞİÖŞÜİ]/]:not(Property > .key):not(MemberExpression > .property):not(TSPropertySignature > .key)",
  message:
    "Tanımlayıcı ASCII/İngilizce olmalı — Türkçe karakter YASAK (UI metni, mesaj ve yorum Türkçe KALIR). bkz. docs/standart/ILKELER.md § İsimlendirme.",
};

// Token/JWT web depolamasına YAZILMAZ: tek geçit `src/lib/secure-store.ts`
// (Electron'da `safeStorage` ile şifreli). İki selector ŞART — `localStorage.…`
// ve `window.localStorage.…` biçimlerini tek selector göremez. Anahtar adı
// değişkense yakalanmaz; bu bilinçlidir, secure-store'un belgeli web fallback'i
// (secure-store.ts) o biçimdedir ve bozulmamalıdır.
const TOKEN_STORAGE_MESAJI =
  "Token/JWT localStorage/sessionStorage'a yazılmaz — tek geçit `src/lib/secure-store.ts` (Electron: safeStorage). bkz. docs/kurallar/genel.md.";

const TOKEN_TO_STORAGE = {
  selector:
    "CallExpression[callee.object.name=/^(localStorage|sessionStorage)$/][callee.property.name='setItem'] > Literal[value=/(token|jwt|refresh|bearer)/i]",
  message: TOKEN_STORAGE_MESAJI,
};

const TOKEN_TO_WINDOW_STORAGE = {
  selector:
    "CallExpression[callee.object.property.name=/^(localStorage|sessionStorage)$/][callee.property.name='setItem'] > Literal[value=/(token|jwt|refresh|bearer)/i]",
  message: TOKEN_STORAGE_MESAJI,
};

/** Her kapsamda geçerli yasaklar (tek `no-restricted-syntax` girdisi — tuzak (a)). */
const ORTAK_YASAKLAR = [TURKISH_IDENTIFIER, TOKEN_TO_STORAGE, TOKEN_TO_WINDOW_STORAGE];

// ── Yerel plugin (bağımlılıksız) ─────────────────────────────────────────────
// Tuzak (b): ayrı severity + ayrı baseline sayacı isteyen selector kuralları
// burada yaşar. Yeni paket DEĞİL — ESLint'in kendi selector API'siyle yazılmış
// config kodu.
const yerelPlugin = {
  rules: {
    // Hata toast'ını apiClient interceptor'u ZATEN basar (4xx/5xx). Mutation
    // `onError`'ında ikinci bir `toast.error` kullanıcıya AYNI hatayı iki kez
    // gösterir. İstisna: istek `suppressErrorToast: true` taşıyorsa interceptor
    // susar; o noktada gerekçeli `eslint-disable-next-line` yaz.
    "mutation-onerror-toast": {
      meta: {
        type: "problem",
        docs: { description: "Mutation onError içinde ikinci hata toast'ı" },
        schema: [],
        messages: {
          ciftToast:
            "Mutation onError'da ikinci hata toast'ı YOK — apiClient interceptor 4xx/5xx'i zaten basar (çift toast). İstek `suppressErrorToast: true` taşıyorsa gerekçeli eslint-disable yaz.",
        },
      },
      create(context) {
        return {
          "Property[key.name='onError'] CallExpression[callee.object.name='toast'][callee.property.name='error']"(
            node,
          ) {
            context.report({ node, messageId: "ciftToast" });
          },
        };
      },
    },
  },
};

// ── Adlandırma sözleşmesi ────────────────────────────────────────────────────
// Ölçümle daraltıldı: React'e kör ilk taslak (function → camelCase) 955 ihlal
// verdi, çünkü bileşen adları PascalCase'tir. Bugünkü hâli 0 ihlal:
//  · function/parameter PascalCase alır (bileşen ve bileşen-prop `Icon`).
//  · property'lerde `format: null` — onlar API alan adı / sözlük anahtarıdır,
//    tanımlayıcı değil (TR anahtar yasağı da bu yüzden ayrı ve dar selector'de).
//  · `__dirname` (electron/main.ts) gerçek; `__…ForTests` bugün Electron'da yok
//    ama backend idiomudur, ileriye dönük filter olarak duruyor.
const NAMING_CONVENTION = [
  "error",
  {
    selector: ["variable", "function"],
    filter: { regex: "^(__dirname|__filename|__[A-Za-z0-9]+ForTests)$", match: true },
    format: null,
  },
  {
    selector: "default",
    format: ["camelCase"],
    leadingUnderscore: "allow",
    trailingUnderscore: "allow",
  },
  {
    selector: "variable",
    format: ["camelCase", "UPPER_CASE", "PascalCase"],
    leadingUnderscore: "allow",
  },
  { selector: "function", format: ["camelCase", "PascalCase"] },
  { selector: "parameter", format: ["camelCase", "PascalCase"], leadingUnderscore: "allow" },
  { selector: "typeLike", format: ["PascalCase"] },
  { selector: "enumMember", format: ["UPPER_CASE", "PascalCase"] },
  { selector: "import", format: ["camelCase", "PascalCase"] },
  {
    selector: [
      "objectLiteralProperty",
      "typeProperty",
      "classProperty",
      "typeMethod",
      "objectLiteralMethod",
      "classMethod",
    ],
    format: null,
  },
];

// ── Boyut kuralları ──────────────────────────────────────────────────────────
// ⚠️ `skipComments` ve `skipBlankLines` LOAD-BEARING: bu repoda yorum bir
// DEĞERDİR (karar kaydı koruduğu kodun yanında yaşar). Skip'siz ölçüm 134 dosya,
// skip'li ölçüm 74 verdi — yani skip'siz kural 60 dosyayı YORUM YAZDIĞI İÇİN
// cezalandırırdı. Üçünün de tavanı `lint-baseline.json`'da; tavan yalnız DÜŞER.
//   max-lines 300           → 74 ihlal (katalog muafiyetiyle 70)  · warn
//   max-lines-per-function  → 454 ihlal (423'ü .tsx: bileşen gövdesi bir
//                             fonksiyondur ve JSX satırı ucuzdur) · warn
//   max-params 4            → 10 ihlal · warn (⚠️ aşağıdaki not)
// ⚠️ `max-params` ÖLÇÜM DÜZELTMESİ: keşif dosyası bunu "0 ihlal, bedelsiz error"
// diye kaydetmişti; ÜRETİM config'iyle yeniden ölçüldü ve 10 çıktı (electron/ipc/
// discovery.ipc.ts `verify` 5 · lib/import/overrides.ts `replaceCellValue` 5 ·
// AccountingDispatch/columns.tsx `buildDispatchColumns` 6 · Shipments/roll-search.ts
// `rollMatchesFacets` 5 · PeripheralDevices/schema.ts `range` 5 · Reports/Quality/
// scorecardExport.ts `breakdownTable` 5 · Reports/Sales/orderIntake.ts `table` 5 ·
// üç test yardımcısı 5-6). 10 ≤ 15 olduğu için ölçüt "düzelt ve error" der, ama
// düzeltme konumsal parametreyi obje parametresine çevirmektir ve ~30 ÇAĞRI
// NOKTASINI değiştirir (`verify` 6, `typeString` 6, `dispatch` 10 çağrı; ikisinde
// konumsal VARSAYILAN değer var). Bu, lint turuna sığmayan bir imza refactor'u →
// warn + tavan 10; yeni fonksiyon obje parametresiyle doğar, devralınan imzalar donar.
const BOYUT_KURALLARI = {
  "max-lines": ["warn", { max: 300, skipComments: true, skipBlankLines: true }],
  "max-lines-per-function": [
    "warn",
    { max: 80, skipComments: true, skipBlankLines: true, IIFEs: true },
  ],
  "max-params": ["warn", 4],
};

// Katalog/registry dosyaları: ADLI muafiyet, heuristik DEĞİL. Ölçülen nitelik
// "0 hook çağrısı + gövdesi tek veri/registry ifadesi" — bölmek "tek kaynak
// satır"ı bozar. Heuristik (0 hook + yorum > %15) denendi ve content-routes.tsx'i
// KAÇIRIYOR (%9,3 yorum ama 365 JSX etiketi = rota kayıt defteri), üstelik içinde
// katalog OLMAYAN iş mantığını (stockCountRules, Finance/service) süpürüyordu.
// Yeni dosya bu listeye ancak aynı ölçüm yapılarak eklenir.
const KATALOG_DOSYALARI = [
  "src/pages/GeneralSettings/settings-config.ts",
  "src/services/documentConfig.ts",
  "src/pages/Operations/WorkOrders/service.ts",
  "src/routes/content-routes.tsx",
];

export default [
  js.configs.recommended,

  // Ölü `eslint-disable` bir YALAN taşır: okuyan "burada bilinçli bir istisna var"
  // sanır. Ölçüm: 63 direktifin 0'ı ölü (tip bilgili kural açıkken de) → bedelsiz.
  { linterOptions: { reportUnusedDisableDirectives: "error" } },

  // ── 1) Renderer (React) ────────────────────────────────────────────────────
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
      globals: browserGlobals,
    },
    plugins: { "@typescript-eslint": tsPlugin, "react-hooks": reactHooks, yerel: yerelPlugin },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-redeclare": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // Katman sınırı: renderer Node'a inemez, köprü `window.api`dır (contextIsolation).
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
      "no-restricted-syntax": ["error", ...ORTAK_YASAKLAR],
      "@typescript-eslint/naming-convention": NAMING_CONVENTION,
      // Unutulmuş `console.log` üretimde kullanıcı konsoluna sızar; tanı çıktısı
      // (`warn`/`error`) meşrudur ve ölçümde üçü de gerekçeliydi.
      "no-console": ["error", { allow: ["warn", "error"] }],
      "yerel/mutation-onerror-toast": "warn",
      ...BOYUT_KURALLARI,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // ── 2) Ana süreç ve paylaşılan sözleşme ────────────────────────────────────
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
      "no-restricted-syntax": ["error", ...ORTAK_YASAKLAR],
      "@typescript-eslint/naming-convention": NAMING_CONVENTION,
      // Ana süreçte log kanalı `electron-log`; ölçümde `console.` kullanımı 0.
      "no-console": ["error", { allow: ["warn", "error"] }],
      ...BOYUT_KURALLARI,
    },
  },

  // ── 3) Test/E2E altyapısı ──────────────────────────────────────────────────
  // TS parser ile lint edilir (aksi halde `type` import'u parse error verir).
  // Boyut kuralları BİLEREK yok: bekçi uzun ve konuşkandır, orada kural gürültüdür.
  {
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
      "no-restricted-syntax": ["error", ...ORTAK_YASAKLAR],
      "@typescript-eslint/naming-convention": NAMING_CONVENTION,
    },
  },

  // ── 4) Sayfa ve form dialog'u: 300 değil 200 ───────────────────────────────
  // Electron/CLAUDE.md'nin "Page ≤200" kuralının mekanik karşılığı. Desen
  // `src/pages/**` ile SINIRLI: `components/layout/CrudPage.tsx` ve
  // `components/forms/EntityFormDialog.tsx` bir sayfa/dialog DEĞİL, ortak
  // sarmalayıcıdır ve genel 300 sınırına tabidir.
  // Ölçüm: 131 Page.tsx → 41 ihlal · 26 FormDialog.tsx → 12 ihlal. İkisi de
  // warn + tavan (FormDialog'un gerekçesi başlıkta § ÖLÇÜTTEN BİLİNÇLİ SAPMA).
  {
    files: ["src/pages/**/*Page.tsx", "src/pages/**/*FormDialog.tsx"],
    rules: {
      "max-lines": ["warn", { max: 200, skipComments: true, skipBlankLines: true }],
    },
  },

  // ── 5) Katalog/registry muafiyeti (adlı) ───────────────────────────────────
  { files: KATALOG_DOSYALARI, rules: { "max-lines": "off" } },

  // ── 6) Tip bilgili kural: sahipsiz promise ─────────────────────────────────
  // Ayrı blok, çünkü tip bilgisi lint süresini 5,2 → 11,4 sn'ye çıkarıyor
  // (ölçüldü, 3'er koşum medyanı). 35 ihlal → warn + tavan. İhlallerin çoğu tek
  // kalıp: `invalidate()` / `qc.invalidateQueries(...)` başına `void` konmamış
  // (useCrudMutations.ts tek başına 6 tanesini üretiyor). Düzeltme mekanik ve
  // tek kelimeliktir; tavan sıfırlanınca kural "error"a yükseltilir.
  {
    files: ["src/**/*.{ts,tsx}", "electron/**/*.ts", "shared/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: { "@typescript-eslint/no-floating-promises": "warn" },
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
