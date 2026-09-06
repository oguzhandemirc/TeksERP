// =============================================================================
// TeksERP Mobil (Expo/React Native) — ESLint guardrail'i (formatter DEĞİL)
// =============================================================================
// Bu config bir stil aracı değil, bir KAPI setidir: her kural ya sahada ısırmış
// bir yasağı ya da `docs/standart/` altındaki bir kuralı mekanik olarak korur.
// Biçim ve gerekçe disiplini backend config'iyle aynıdır
// (`Teks-Erp/eslint.config.mjs`).
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
// ⚠️ KAPSAM TEK KOMUT (E-04, 2026-09-05): tek lint komutu `eslint .` (398 dosya).
// Eski `expo lint` Expo CLI'ın DEFAULT_INPUTS'unu (`src` `app` `components`)
// lint ediyordu ve App.tsx · index.ts · app.config.js · eslint.config.js ·
// jest.config.js · plugins/** · scripts/** dahil 12 dosyayı HİÇ görmüyordu
// (üstelik varsayılan `--cache` ile). Bu argv `package.json > scripts.lint` ve
// `scripts/check-lint-baseline.mjs` PROJELER tablosuyla BİREBİR aynı olmalı —
// ayrışırsa tavan başka bir kümeyi ölçer ve "tavan aşılmadı" anlamını yitirir.
//
// ── ÖLÇÜLÜP REDDEDİLENLER (yeniden denemeden önce buraya bak) ────────────────
//  · `Card` + `onPress` yasağının `no-restricted-syntax` yazımı — ölçüm dosyası
//    "yazma" diyordu (0 ihlal, `<Card` hiç geçmiyor). KARAR GÖZDEN GEÇİRİLDİ ve
//    kural YAZILDI, ama BAŞKA ruleId altında: yasak mobil/CLAUDE.md'de zaten
//    yazılı ve gerekçesi somut (`Card.Content` dokunmayı yutar), alternatifi de
//    var (`TouchableRipple`/`Button`/`List.Item`) — yani bedava ve gerçek bir
//    kapı. `no-restricted-syntax` yazımı REDDEDİLDİ: o kural TEK severity taşır
//    ve yuvayı ham hex (2173 ihlal, warn+tavan) tutuyor; Card oraya girseydi ya
//    hex'i "error"a çıkarıp kampanya dayatırdı ya da kendi ihlali hex'in
//    2173'lük tavanının ALTINDA görünmez kalırdı. Aynı yasak
//    `react/forbid-component-props` + `disallowedFor` ile kendi ruleId'sinde,
//    "error" olarak yazıldı (eslint-plugin-react 7.37.5 expo preset'iyle GELİYOR
//    — yeni paket kurulmadı).
//  · `no-console` DÜZ yasak — src/ altındaki 11 çağrının TAMAMI `console.warn`
//    (ölçüldü: `console.log/info/debug/error` = 0). Hepsi bilinçli teşhis
//    kanalı: best-effort audit hataları, SimplePortal geri-besleme uyarısı,
//    yavaş istek eşiği, bekçinin körlük zemini. Mobilde yapılandırılmış logger
//    YOK; bunları silmek KODUN ANLAMINI (teşhis yeteneğini) değiştirirdi.
//    → Kural `{ allow: ["warn", "error"] }` ile YAZILDI: yasaklanan şey
//    `console.log` sınıfı hata ayıklama artığıdır, bugün sıfırdır ve bedavadır.
//  · Türkçe tanımlayıcı yasağının `no-restricted-syntax` yazımı — backend'de
//    öyle duruyor ama burada aynı severity yuvasını ham hex tutuyor (yukarı).
//    → Aynı yasak `@typescript-eslint/naming-convention` altında `custom` regex
//    olarak yazıldı; ölçülen 2 ihlal (styles.boş) düzeltildikten sonra 0.
//
// Ölçüm tarihi ve tam sayılar:
// docs/history/standart-2026-09-05/olcum/eslint-mobil.json (+ …-sonuc.json)
// =============================================================================

const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// ⚠️ Uygulama kodu = TS/TSX. `scripts/**` (build-apk, yayinla-ota), `plugins/**`
// ve kök `*.config.js` bilinçli olarak DIŞARIDA: onlar Node CLI araçlarıdır,
// `console` orada TEK çıkış kanalıdır ve boyut disiplini bir sinyal üretmez
// (aynı ayrım backend'de `scripts/` için yapıldı). Yasaklar yine de her dosyada
// koşar — aşağıdaki evrensel bloklara bak.
const UYGULAMA_KODU = ['**/*.ts', '**/*.tsx'];

// Bölme planı `docs/history/standart-2026-09-05/kesif/mobil-ekran.json`'da olan
// beş dev ekran. ⚠️ Bu liste ADLIDIR ve yalnız KISALIR: bir ekran bölününce
// satırı buradan silinir, yenisi EKLENMEZ. `max-lines` onlarda kapalı, çünkü
// tavan (baseline) beş dosya yüzünden şişerdi; `max-lines-per-function` AÇIK
// kalır — fonksiyon boyu dosya boyundan bağımsız bir disiplindir (ölçüm: bu beş
// dosya mlpf ihlallerinin %25'ini taşıyor ve bunlar tek tek düzeltilebilir).
const BOLUNMEYI_BEKLEYEN_EKRANLAR = [
  'src/screens/Modules/Tambur/TamburScreen.tsx',
  'src/screens/Modules/FasonKabul/FasonKabulScreen.tsx',
  'src/screens/Modules/KK1/KK1Screen.tsx',
  'src/screens/Modules/KursunQc/KursunQcScreen.tsx',
  'src/screens/Modules/FasonSevk/FasonSevkScreen.tsx',
];

// Renk TEK KAYNAK `src/theme/tokens.ts`. Ham hex, temayı (ve ileride koyu
// modu / müşteri paletini) tek noktadan çözülemez hale getirir. 2173 ihlal
// ölçüldü → "warn" + tavan: devralınan kod donar, YENİ kod jeton kullanır.
const HAM_HEX_RENK = {
  selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]',
  message:
    "Ham hex renk literali YASAK — `src/theme/tokens.ts`'teki jetonu kullan (renk tek kaynak). bkz. docs/standart/MOBIL.md.",
};

/**
 * Adlandırma sözleşmesi. Üç varyant ölçüldü; bu (en gevşek olan) 0 ihlal verdi:
 *  · `variable` + `leadingUnderscore:"allow"` → `__resetXForTests` bilinçli test
 *    kapıları ve destructuring'deki `_drop` atma-işareti muaf kalır.
 *  · `trailingUnderscore:"allow"` → `isBonded_` (SessionHardwareCard) muaf.
 * Ek filter/allow listesi GEREKMEDİ.
 *
 * ⚠️ `custom` regex HER kayıtta TEKRARLANIR ve bu tekrar LOAD-BEARING: kural
 * bir tanımlayıcıya YALNIZ TEK kayıt uygular (önce özgüllüğe, sonra dizi
 * sırasına göre). Yasak sadece `default` kaydında dursaydı `variable` /
 * `function` / `typeLike` kayıtları onu GÖLGELERDİ — negatif sonda tam bunu
 * gösterdi: `kağıtSayısı`, `şablonUret` ve `Şablon` sessizce geçti, yalnız
 * nesne özelliği (`boşluk`) yakalandı. `camelCase` biçim denetimi Türkçe
 * harfleri REDDETMİYOR (ilk harf küçük + alt çizgi yok, hepsi bu).
 *
 * Yasağın kendisi: tanımlayıcılar ASCII/İngilizce, Türkçe yalnız UI metni,
 * hata mesajı ve yorumda kalır (docs/standart/ILKELER.md § İsimlendirme).
 * Backend aynı yasağı `no-restricted-syntax` ile yazar; burada o yuva ham hex'e
 * (warn) ait olduğu için yasak buraya taşındı — kapsam aynı, severity ayrı
 * tutulabiliyor. Ölçüm: 2 ihlal (`styles.boş`, SackContentsModal) → 0.
 */
const ASCII_TANIMLAYICI = { regex: '[çğıöşüÇĞİÖŞÜ]', match: false };

const NAMING_CONVENTION = [
  'error',
  { selector: 'default', format: null, custom: ASCII_TANIMLAYICI },
  {
    selector: 'variable',
    format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
    leadingUnderscore: 'allow',
    trailingUnderscore: 'allow',
    custom: ASCII_TANIMLAYICI,
  },
  {
    selector: 'function',
    format: ['camelCase', 'PascalCase'],
    leadingUnderscore: 'allowDouble',
    custom: ASCII_TANIMLAYICI,
  },
  {
    selector: 'parameter',
    format: ['camelCase'],
    leadingUnderscore: 'allow',
    custom: ASCII_TANIMLAYICI,
  },
  { selector: 'typeLike', format: ['PascalCase'], custom: ASCII_TANIMLAYICI },
];

module.exports = defineConfig([
  expoConfig,

  // Üretilmiş çıktı lint edilmez: `ota-cikti/` OTA paketleri (derlenmiş JS
  // bundle), `android/` native ağaç. Dosya sayısını DÜŞÜRMEZ (ölçüldü: 398
  // dosya, ignore'lu ve ignore'suz aynı) — ileride üretilen bundle kapsamı
  // şişirmesin diye peşin yazıldı.
  { ignores: ['dist/*', 'node_modules/*', 'coverage/*', 'android/*', 'ota-cikti/*'] },

  // ── 1) Evrensel: ölü `eslint-disable` bir YALAN taşır ─────────────────────
  // Okuyan "burada bilinçli bir istisna var" sanır. 3 ölü direktif 2026-09-05'te
  // temizlendi; App.tsx'teki 4 `no-explicit-any` direktifi ise kural açılınca
  // ÖLÜ olmaktan çıkıp CANLI bastırmaya döndü (RN `defaultProps` yaması).
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },

  {
    rules: {
      // Türkçe arayüz metinleri doğal olarak kesme işareti/tırnak içerir
      // (örn. "İş Emri'ne", "Çuval'a"). Bu stilistik kural doğal dille çakışır;
      // Expo/RN projelerinde yaygınca kapatılır. JSX metni güvenli (React kaçırır).
      'react/no-unescaped-entities': 'off',
    },
  },

  // ── 2) Node CommonJS dosyaları ────────────────────────────────────────────
  // `scripts/lib/feed.cjs` bilinçli olarak CJS'tir (app.config.js `.mjs`
  // require edemez, script'ler ESM — `.cjs` ikisinden de okunur). Expo preset'i
  // `__dirname`'i yalnız metro.config.js için tanımlıyor; tek komuta geçilince
  // bu dosya `no-undef` ile KIRMIZI veriyordu (E-04'ün tek gerçek error'ı).
  // Kök `*.config.js` dosyaları (bu dosya dahil) aynı zemindedir.
  {
    files: ['**/*.cjs', '**/*.config.js', 'plugins/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { __dirname: 'readonly', __filename: 'readonly' },
    },
  },

  // Test dosyaları: jest global'leri (describe/it/expect/jest) tanımlı say.
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        jest: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  },

  // ── 3) Uygulama kodu: kapılar ─────────────────────────────────────────────
  // ⚠️ `@typescript-eslint` plugin'i BURADA KAYIT EDİLMEZ — expo preset'i onu
  // `**/*.ts,**/*.tsx` için zaten kaydediyor; ikinci kayıt ESLint 9'da
  // "Cannot redefine plugin" ile çöker.
  {
    files: UYGULAMA_KODU,
    rules: {
      // `any` tip sisteminin kapatma düğmesidir: sözleşme kırılınca tsc susar.
      // 12 ihlal (React ref/ComponentType köşeleri) 2026-09-05'te gerçek tiplere
      // çevrildi → kapsam sıfır ihlalli.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/naming-convention': NAMING_CONVENTION,

      // `console.log` sınıfı hata ayıklama artığı YASAK; `warn`/`error` bilinçli
      // teşhis kanalıdır ve mobilde tek log yoludur (bkz. ÖLÇÜLÜP REDDEDİLENLER).
      'no-console': ['error', { allow: ['warn', 'error'] }],

      // `Card.Content` dokunma olayını YUTAR: `<Card onPress>` sahada "basıyorum
      // ama açılmıyor" olarak görünür (mobil/CLAUDE.md § UI/UX). Dokunulur kart
      // `TouchableRipple` / `Button` / `List.Item` ile kurulur. Bugün 0 ihlal —
      // kural ihlali önlemek için var, temizlemek için değil.
      'react/forbid-component-props': [
        'error',
        {
          forbid: [
            {
              propName: 'onPress',
              disallowedFor: ['Card', 'Card.Content'],
              message:
                "`Card`/`Card.Content` üzerinde `onPress` YASAK — Card.Content dokunmayı yutar; TouchableRipple / Button / List.Item kullan. bkz. mobil/CLAUDE.md § UI/UX.",
            },
          ],
        },
      ],

      // Altı konumlu argümanın hangisinin ne olduğu çağrı yerinde okunmuyor.
      // Tek ihlal (OrderLineFilterSheet `row`) nesne parametresine çevrildi.
      'max-params': ['error', 4],

      // ── Tavanlı (warn) kurallar — devralınan kod donar, yeni kod uyar ──────
      'no-restricted-syntax': ['warn', HAM_HEX_RENK],

      // ⚠️ `skipComments` + `skipBlankLines` LOAD-BEARING: bu repoda yorum bir
      // DEĞERDİR (karar kaydı koruduğu kodun yanında yaşar). Skip'siz ölçüm 72
      // dosya, skip'li 51 verdi — yani skip'siz kural 21 dosyayı sırf karar
      // kaydı yazdığı için cezalandırırdı.
      'max-lines': ['warn', { max: 300, skipComments: true, skipBlankLines: true }],
      'max-lines-per-function': [
        'warn',
        { max: 80, skipComments: true, skipBlankLines: true, IIFEs: true },
      ],
    },
  },

  // Renk jetonlarının TANIM yeri: hex literali burada meşrudur (tek kaynak).
  { files: ['src/theme/tokens.ts'], rules: { 'no-restricted-syntax': 'off' } },

  // Bölünmeyi bekleyen beş dev ekran — gerekçe yukarıdaki liste yorumunda.
  { files: BOLUNMEYI_BEKLEYEN_EKRANLAR, rules: { 'max-lines': 'off' } },

  // ── 4) Tip bilgili kural: sahipsiz promise ────────────────────────────────
  // Ayrı blok, çünkü tip bilgisi lint süresini 13,0s → 16,3s'ye çıkarıyor
  // (+%25, ölçüldü). Mobilde sahipsiz promise sessiz bir arızadır: hata
  // yakalanmaz, `catch` çalışmaz, kullanıcı hiçbir şey görmez. 291 ihlal
  // (%58'i beş dev ekranda) → warn + tavan; düşürmenin yolu bilinçli
  // ateşle-unut'u `void` ile işaretlemek.
  {
    files: UYGULAMA_KODU,
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
    rules: { '@typescript-eslint/no-floating-promises': 'warn' },
  },
]);
