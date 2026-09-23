// =============================================================================
// Test: Feature-flag ÜÇ-YER SÖZLEŞMESİ (route şeması ↔ servis ↔ Electron paneli)
// =============================================================================
// VAKA (2026-08-04): `kk1DuplicateGuardEnabled` üç ayağın ikisini aldı —
// `system-setting.service` yazma/okuma dalları ve Electron panel satırı vardı —
// ama `routes/feature-flag.routes.ts` `updateSchema`'sına HİÇ yazılmadı. Şema
// `z.strictObject` olduğu için panelden gelen PATCH 400 döndü: bayrak sahada
// **açılamıyordu ve daha kötüsü KAPATILAMIYORDU** (mükerrer tuzağının tek acil
// geri dönüş yolu odur). Sorun aylarca sessiz kaldı çünkü:
//
//   • `setFeatureFlags(input: Partial<FeatureFlags>)` route'tan gelen DAR nesneyi
//     sorunsuz kabul eder (alt küme ataması geçerlidir) → tip sistemi kör.
//   • Mevcut bayrak testleri (`test_kk1_duplicate_guard`, `test_kk1_weight_flag`)
//     bayrağı `systemSettingService.setFeatureFlags()` ile DOĞRUDAN servisten
//     yazıyor → HTTP rotasını ve `updateSchema`'yı hiç geçmiyorlar.
//
// Yani sözleşme yalnız `feature-flag.routes.ts` başındaki YORUMDA yaşıyordu.
// Bu bekçi onu mekanikleştirir. Dört anahtar kümesi:
//
//   A = API'nin DÖNDÜĞÜ     → getFeatureFlags() çıktısının anahtarları (runtime
//                             gerçeği; `FeatureFlags` bir interface, tip silinir)
//   B = PATCH'in KABUL ETTİĞİ → updateSchema.shape
//   C = servisin YAZDIĞI     → setFeatureFlags dalları (kaynak metni taranır)
//   D = panelin GÖSTERDİĞİ   → Electron settings-config.ts (AYRI PROJE — import
//                              edilemez, kendi tsconfig'i ve `@/` alias'ı var)
//
// ⚠️ KÖRLÜK ZEMİNİ: her kümenin alt sınırı vardır. Bir refactor tarayıcıyı boşa
// düşürürse ("ihlal bulunamadı") ile ("hiçbir şeye bakılmadı") aynı yeşile çıkar.
//
// Çalıştır: npx tsx scripts/test_feature_flag_contract.ts
// =============================================================================

import { readFileSync, existsSync } from "fs";
import path from "path";
import { updateSchema } from "../src/routes/feature-flag.routes";
// §11-§12 tüm modülü ad alanı olarak alır: `getFeatureFlags` gövdesinden çözülen
// okuyucu ADI ile çağrı yapılabilsin diye (33 okuyucuyu tek tek import etmek,
// listeyi elle güncel tutma borcu demekti — tam da bekçinin önlediği şey).
import * as systemSettingModule from "../src/services/system-setting.service";
import {
  SETTING_KEYS,
  systemSettingService,
  // §10 — 2026-08-14 dalga 1 okuyucuları. İÇE AKTARIM DERLEME BAĞIDIR: helper
  // silinirse `npm run typecheck:scripts` kırmızı verir (bekçi koşmadan önce).
  readFinanceRiskLimitBlockEnabled,
  readFinanceAutoDraftFromShipmentEnabled,
  readFinanceAutoAllocateOnPaymentEnabled,
  readYarnBlockNegativeBalanceEnabled,
  readPurchaseBlockOverReceiptEnabled,
  readGoodsReceiptRequirePriceEnabled,
  readFinanceAllowZeroPriceLineEnabled,
  readFinanceFutureDatedDocumentBlockEnabled,
  readFinanceYarnOutOnInvoiceEnabled,
  // §15 — modül şalterleri (2026-09-02). Aynı derleme bağı gerekçesi: okuyucu
  // silinirse `npm run typecheck:scripts` bekçi koşmadan ÖNCE kırmızı verir.
  readFinanceEnabled,
  readProductionEnabled,
  readTicaretEnabled,
  readIplikEnabled,
  readDepoMultiEnabled,
  readDevereEnabled,
  readDokumaEnabled,
  readEmanetEnabled,
  readKumasTeknikEnabled,
  readTezgahEnabled,
  // §16 — ENUM ayağı (2026-09-03, Dilim 2). Aynı derleme bağı gerekçesi: okuyucu
  // ya da değer kümesi silinirse `npm run typecheck:scripts` bekçi koşmadan
  // ÖNCE kırmızı verir.
  readSameTypeSessionPolicy,
  readShippingOrderRequirement,
  readShippingInvoiceMode,
  readShippingDocItemNameMode,
  SAME_TYPE_SESSION_POLICIES,
  SHIPMENT_ORDER_REQUIREMENTS,
  SHIPPING_INVOICE_MODES,
  SHIPPING_DOC_ITEM_NAME_MODES,
  DEFAULT_SAME_TYPE_SESSION_POLICY,
  DEFAULT_SHIPMENT_ORDER_REQUIREMENT,
  DEFAULT_SHIPPING_INVOICE_MODE,
  DEFAULT_SHIPPING_DOC_ITEM_NAME_MODE,
} from "../src/services/system-setting.service";
import prisma from "../src/lib/prisma";
import { yorumlariSok } from "./lib/regime-gate-scan";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

// -----------------------------------------------------------------------------
// MUAFLAR — gerekçeli, her koşumda basılır, BAYATLIĞA KARŞI DENETLENİR.
// -----------------------------------------------------------------------------
// Panelde generic toggle olarak GÖRÜNMEYEN boolean bayraklar. Hepsinin kendi
// özel section'ı var (`CategoryKind`: device / session / label), yani "yönetilemez
// bayrak" değiller — yalnız `FlagDef` listesinde durmuyorlar.
const PANEL_EXEMPT: Record<string, string> = {
  devicePairingRequired: "kind:'device' — Mobil Cihazlar section'ı yönetir",
  autoLogoutOnExpiry: "kind:'session' — Oturum section'ı yönetir",
  mobileIdleLockEnabled: "kind:'session' — Oturum section'ı yönetir",
  mobileLockOnBackground: "kind:'session' — Oturum section'ı yönetir",
  pinLockoutEnabled: "kind:'session' — Oturum section'ı yönetir",
  nativeSendEnabled: "kind:'label' — Etiket section'ı yönetir",
  mobileRasterEnabled: "kind:'label' — Etiket section'ı yönetir",
  scrapGradeLabelEnabled: "kind:'label' — Etiket section'ı yönetir",
  // YER TUTUCU MODÜL ANAHTARLARI (2026-09-02). Arkalarında henüz TEK BİR yüzey
  // yok: ne route kapısı, ne ekran, ne kanca. Panele bir toggle koymak,
  // kullanıcıya açtığında hiçbir şeyin değişmediği bir düğme vermek olurdu.
  // Dilim 3/4'te yüzeyleri doğduğunda panele girer ve bu iki satır SİLİNİR
  // (muaf listesi iki yönlü denetlenir — panele girip muafta kalırsa kırmızı).
  kumasTeknikEnabled: "yer tutucu — arkasında yüzey YOK; Dilim 3'te panele girer",
  tezgahEnabled: "yer tutucu — arkasında yüzey YOK; Dilim 4'te panele girer",
};

const ELECTRON_CONFIG = path.resolve(
  __dirname,
  "../../Electron/src/pages/GeneralSettings/settings-config.ts",
);
const SERVICE_SRC = path.resolve(
  __dirname,
  "../src/services/system-setting.service.ts",
);

// -----------------------------------------------------------------------------
// PANEL KÜMESİ (D) — 2026-09-03 SONDALARI (cp+md5 ile geri alındı; taban 55/0):
//   SONDA-27 (YANLIŞ-KIRMIZI sondası): `settings-config.ts`te `depoMultiEnabled`
//     satırı Prettier'ın üretebileceği biçime alındı (`{ key: "…",` — nesnenin ilk
//     alanı süslü parantezle AYNI satırda) → çıkış 0 · 55/0 YEŞİL. Eski satır-başı
//     regex'iyle bu 3 ❌ veriyordu ve satır PANELDE DURUYORDU (gürültülü yanlış
//     kırmızı; ekip böyle kırmızıları görmezden gelmeyi öğrenir).
//   SONDA-28 (GERÇEK-KIRMIZI zemini): AYNI satır SİLİNDİ → çıkış 1 · 3 ❌
//     ("yönetilemez boolean bayrak" + "DÖRT KAPI" + "PANEL_EXEMPT"). Yani regex
//     gevşetilirken bekçi KÖRLEŞMEDİ — iki sonda birlikte bunu kanıtlar.
// -----------------------------------------------------------------------------
/**
 * Kaynak dosyadan anahtar toplar.
 *
 * ⚠️ YORUMLAR SÖKÜLÜR ve bu load-bearing: regex kaynağı düz metin olarak tarar,
 * yani bir AÇIKLAMA satırındaki örnek yazım da kümeye girer. `setFeatureFlags`
 * başlığında bu ders zaten yazılı ("bu YORUMDA da örnek çağrı YAZILMAZ — regex
 * yorumu da okur ve kümeye hayalet bir anahtar ekler") ve 2026-09-03'te panel
 * tarafında birebir tekrarlandı: D kümesi regex'i satır başı şartından
 * kurtarılınca `settings-config.ts`teki bir yorumdaki örnek `...` diye bir
 * anahtar üretti ve "panelin gösterdiği anahtar API'de yok" kırmızısı verdi.
 * Çözüm yorumu düzeltmek DEĞİL (bir sonraki yorum yine ısırır), tarayıcıyı
 * yorum körü yapmaktır.
 */
function readKeys(file: string, re: RegExp): string[] {
  const src = yorumlariSok(readFileSync(file, "utf8"));
  const out = new Set<string>();
  for (const m of src.matchAll(re)) out.add(m[1]!);
  return [...out];
}

async function main() {
  console.log("=== Feature-flag üç-yer sözleşmesi ===\n");

  // ---------------------------------------------------------------------------
  // Kümeleri topla
  // ---------------------------------------------------------------------------
  // ⚠️ `getFeatureFlags` ApiResponse SARMALAR (`{success, data}`) — `.data`'yı
  // almazsan küme {success, data} olur, zemin kontrolleri bunu yakalar.
  const flags = (await systemSettingService.getFeatureFlags()).data as unknown as Record<
    string,
    unknown
  >;
  const A = Object.keys(flags);
  const aBool = A.filter((k) => typeof flags[k] === "boolean");
  // SAYISAL AYAK (2026-08-19): sözleşmenin bu tarafı bugüne kadar HİÇ ölçülmüyordu
  // — `aBool` daraltması sayısal anahtarları (eşik/dakika) eliyordu ve onların
  // A/B/C üçlüsü kopsa kimse görmezdi. `null` değerli anahtar da sayısaldır
  // (girilmemiş eşik): tipi değerden okumak onu kaçırırdı, bu yüzden şemadan
  // türetiyoruz — `updateSchema`da tanımlı VE panelin sayısal alan olarak
  // gösterdiği anahtarlar.
  const aNumeric = A.filter((k) => typeof flags[k] === "number" || flags[k] === null);
  const B = Object.keys(updateSchema.shape);
  const C = readKeys(SERVICE_SRC, /hasOwnProperty\.call\(input,\s*"([^"]+)"\)/g);

  const electronFound = existsSync(ELECTRON_CONFIG);
  // Electron ağacı yoksa SESSİZCE ATLAMA — bu bekçinin en çok işe yaradığı
  // kontrol (D) tam da orada yaşıyor; skip, süse dönüşmenin ilk adımıdır.
  check(
    "Electron settings-config.ts bulundu (D kümesi okunabilir)",
    electronFound,
    ELECTRON_CONFIG,
  );
  // ⚠️ REGEX SATIR BAŞINA BAĞLI DEĞİL (2026-09-02 düzeltmesi). Eski yazım
  // (`/^\s*key:/gm`) `key:`in KENDİ SATIRINDA başlamasını şart koşuyordu ve
  // bu KOZMETİK bir kuraldı: Prettier'ın üretebileceği masum bir biçim
  // (`{ key: "depoMultiEnabled",` — nesnenin ilk alanı süslü parantezle aynı
  // satırda) bekçiyi YANLIŞ KIRMIZIYA düşürüyordu ("panele ekle" diyordu,
  // oysa satır panelde duruyordu). Gerçek kural biçim değil VARLIK.
  // ⚠️ `(?<![A-Za-z])` yalnız kelime sınırı içindir: `numberKey:` zaten büyük
  // K taşıdığı için eşleşmez (regex case-sensitive), ama `foo_key:` gibi bir
  // ad da kümeye sızmasın diye açıkça kapatıldı.
  const D = electronFound ? readKeys(ELECTRON_CONFIG, /(?<![A-Za-z])key:\s*"([^"]+)"/g) : [];
  // ⚠️ Panelin SAYISAL alanları `numberKey:` ile yazılır — `key:` DEĞİL. Ad
  // bilinçli farklı: aynı adla yazılsalardı sayısal anahtarlar boolean
  // kümesine sızar ve 5. kontrol ("yönetilemez boolean bayrak") yanlış şey
  // ölçerdi.
  const DNum = electronFound ? readKeys(ELECTRON_CONFIG, /numberKey:\s*"([^"]+)"/g) : [];

  console.log(
    `\n   A(api)=${A.length} (boolean ${aBool.length}) · B(şema)=${B.length} · ` +
      `C(servis)=${C.length} · D(panel)=${D.length} · ` +
      `A(sayısal)=${aNumeric.length} · D(sayısal alan)=${DNum.length}\n`,
  );

  // ---------------------------------------------------------------------------
  // 0) KÖRLÜK ZEMİNİ — "hiçbir şey bulamadım" ile "ihlal yok" aynı şey değil
  // ---------------------------------------------------------------------------
  check("zemin: A ≥ 30 anahtar", A.length >= 30, `A=${A.length}`);
  check("zemin: A boolean ≥ 15", aBool.length >= 15, `aBool=${aBool.length}`);
  check("zemin: B ≥ 30 anahtar", B.length >= 30, `B=${B.length}`);
  check("zemin: C ≥ 30 yazma dalı", C.length >= 30, `C=${C.length}`);
  check("zemin: D ≥ 10 panel satırı", D.length >= 10, `D=${D.length}`);

  // ---------------------------------------------------------------------------
  // 1) ⭐ ASIL KONTROL — API'nin döndüğü her boolean bayrak PATCH'lenebilmeli
  // ---------------------------------------------------------------------------
  // `kk1DuplicateGuardEnabled` hatası TAM BURADA yaşıyordu. Boolean daraltması
  // `companyName` / `sessionDurationMinutes` / iç içe nesne gürültüsünü eler —
  // onların kendi doğrulama kuralları var, "toggle" değiller.
  const missingInSchema = aBool.filter((k) => !B.includes(k));
  check(
    "⭐ API'nin döndüğü her boolean bayrak updateSchema'da var",
    missingInSchema.length === 0,
    `şemada YOK: ${missingInSchema.join(", ")} → panelden PATCH 400 alır`,
  );

  // ---------------------------------------------------------------------------
  // 2) Şemanın kabul ettiği her anahtarın bir YAZMA dalı olmalı
  // ---------------------------------------------------------------------------
  // Eksik (2) = uç 200 döner, DB'ye hiçbir şey yazılmaz, hata hiçbir yerde görünmez.
  const acceptedButNotWritten = B.filter((k) => !C.includes(k));
  check(
    "updateSchema'daki her anahtarın setFeatureFlags yazma dalı var",
    acceptedButNotWritten.length === 0,
    `yazılmıyor: ${acceptedButNotWritten.join(", ")}`,
  );

  // ---------------------------------------------------------------------------
  // 3) Ulaşılamaz yazma dalı olmamalı (ölü kod)
  // ---------------------------------------------------------------------------
  const writtenButNotAccepted = C.filter((k) => !B.includes(k));
  check(
    "setFeatureFlags'te ulaşılamaz yazma dalı yok",
    writtenButNotAccepted.length === 0,
    `şemada YOK ama serviste var: ${writtenButNotAccepted.join(", ")}`,
  );

  // ---------------------------------------------------------------------------
  // 4) Panelde ÖLÜ toggle olmamalı
  // ---------------------------------------------------------------------------
  const panelGhosts = D.filter((k) => !A.includes(k));
  check(
    "panelin gösterdiği her anahtar API yanıtında var",
    panelGhosts.length === 0,
    `API'de YOK: ${panelGhosts.join(", ")}`,
  );

  // ---------------------------------------------------------------------------
  // 5) Yönetilemez bayrak olmamalı (panelde ne toggle'ı ne özel section'ı olan)
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // 1b/2b) SAYISAL AYAK — A ⊆ B ⊆ C (boolean ile aynı zincir, ayrı küme)
  // ---------------------------------------------------------------------------
  // Zemin: sayısal anahtar bulunamıyorsa (regex/şekil değişti) "ihlal yok" ile
  // "hiçbir şeye bakmadım" aynı yeşile çıkardı.
  check("zemin: A sayısal ≥ 2 anahtar", aNumeric.length >= 2, `aNumeric=${aNumeric.join(", ")}`);
  const nullableNumMissingInSchema = aNumeric.filter((k) => !B.includes(k));
  check(
    "⭐ API'nin döndüğü her SAYISAL ayar updateSchema'da var",
    nullableNumMissingInSchema.length === 0,
    `şemada YOK: ${nullableNumMissingInSchema.join(", ")} → panelden PATCH 400 alır`,
  );
  const nullableNumMissingInService = aNumeric.filter((k) => B.includes(k) && !C.includes(k));
  check(
    "API'nin döndüğü her SAYISAL ayarın setFeatureFlags yazma dalı var",
    nullableNumMissingInService.length === 0,
    `yazılmıyor: ${nullableNumMissingInService.join(", ")} → uç 200 der, DB değişmez`,
  );
  // Panelin sayısal alanı hayalet olmamalı (API'de karşılığı var mı).
  const numPanelGhosts = DNum.filter((k) => !A.includes(k));
  check(
    "panelin sayısal alanları API yanıtında var",
    numPanelGhosts.length === 0,
    `API'de YOK: ${numPanelGhosts.join(", ")}`,
  );

  const unmanaged = aBool.filter((k) => !D.includes(k) && !PANEL_EXEMPT[k]);
  check(
    "yönetilemez boolean bayrak yok (panelde yok + muaf değil)",
    unmanaged.length === 0,
    `${unmanaged.join(", ")} — panele ekle ya da gerekçeli muaf yaz`,
  );

  // ---------------------------------------------------------------------------
  // 6) MUAF BAYATLIĞI — ölü muaf, gerçek bir ihlali sessizce kapsam dışında tutar
  // ---------------------------------------------------------------------------
  const staleUnknown = Object.keys(PANEL_EXEMPT).filter((k) => !aBool.includes(k));
  check(
    "muaf listesinde artık var olmayan bayrak yok",
    staleUnknown.length === 0,
    `API'de yok: ${staleUnknown.join(", ")}`,
  );
  const staleNowInPanel = Object.keys(PANEL_EXEMPT).filter((k) => D.includes(k));
  check(
    "muaf listesindeki bayrak panele eklenmemiş (eklenmişse muafı kaldır)",
    !electronFound || staleNowInPanel.length === 0,
    `artık panelde: ${staleNowInPanel.join(", ")}`,
  );

  // ---------------------------------------------------------------------------
  // 7) DOĞRUDAN SONDA — hatanın kendisini adıyla kilitle
  // ---------------------------------------------------------------------------
  const probe = updateSchema.safeParse({ kk1DuplicateGuardEnabled: true });
  check(
    "⭐ updateSchema `kk1DuplicateGuardEnabled` kabul ediyor (2026-08-04 vakası)",
    probe.success,
    probe.success ? "" : JSON.stringify(probe.error.issues[0]),
  );
  // Ve strictObject hâlâ gerçekten strict — bilinmeyen anahtar 400 vermeli.
  const bogus = updateSchema.safeParse({ __hicBoyleBirBayrakYok: true });
  check(
    "updateSchema strict kalmış (bilinmeyen anahtar reddediliyor)",
    !bogus.success,
    "z.object'e düşürülmüş → yeni bayraklar SESSİZCE atılır",
  );

  // ---------------------------------------------------------------------------
  // 8) SAYISAL ANAHTARLAR — bekçinin KÖR NOKTASI kapatıldı (2026-08-14)
  // ---------------------------------------------------------------------------
  // Bekçi bugüne kadar YALNIZ boolean'ları denetliyordu: sayısal bir anahtar
  // (örn. finance.defaultVatRate) şemadan ya da panelden düşse hiçbir kontrol
  // kırmızı vermezdi — "panel ayağı elle doğrulandı" ile yetinilirdi. Aynı dört
  // küme mantığı sayısallara da uygulanır; panelde özel section'la yönetilenler
  // gerekçeli muaftır (boolean PANEL_EXEMPT'in sayısal ikizi).
  const aNum = A.filter((k) => typeof flags[k] === "number");
  check("zemin: A sayısal ≥ 10 anahtar", aNum.length >= 10, `aNum=${aNum.length}`);

  const NUMERIC_PANEL_EXEMPT: Record<string, string> = {
    sessionDurationMinutes: "kind:'session' — Oturum section'ı yönetir",
    sessionDurationHours: "GERİYE-UYUM türetilmiş alan — panel dakika alanını yönetir",
    idleTimeoutMinutes: "kind:'session' — Oturum section'ı yönetir",
    workSessionIdleTimeoutMinutes: "kind:'session' — Oturum section'ı yönetir",
    mobileIdleLockMinutes: "kind:'session' — Oturum section'ı yönetir",
    absoluteSessionCapDays: "kind:'session' — Oturum section'ı yönetir",
    pinLockoutAttempts: "kind:'session' — Oturum section'ı yönetir",
    pinLockoutPenaltySec: "kind:'session' — Oturum section'ı yönetir",
    pinLockoutEscalateAfter: "kind:'session' — Oturum section'ı yönetir",
    pinLockoutLongPenaltyMin: "kind:'session' — Oturum section'ı yönetir",
    labelCopies: "kind:'label' — Etiket section'ı yönetir",
    backupHour: "Sistem > Yedekler (BackupScheduleCard) yönetir",
  };

  const numMissingInSchema = aNum.filter((k) => !B.includes(k));
  check(
    "⭐ API'nin döndüğü her SAYISAL anahtar updateSchema'da var",
    numMissingInSchema.length === 0,
    `şemada YOK: ${numMissingInSchema.join(", ")} → panelden PATCH 400 alır`,
  );
  const numMissingInService = aNum.filter((k) => !C.includes(k));
  check(
    "her SAYISAL anahtarın setFeatureFlags yazma dalı var",
    numMissingInService.length === 0,
    `yazılmıyor: ${numMissingInService.join(", ")}`,
  );
  // ⚠️ SAYISAL anahtar panelde `numberKey:` ile yazılır → kümesi `DNum`, `D` DEĞİL
  // (2026-09-01 düzeltmesi). Bu iki satır `D`ye bakıyordu ve sonuç İKİ YÖNLÜ
  // yanlıştı: (a) panelde DOĞRU yazılmış `fasonShrinkTolerancePct` ve
  // `duplicatesFuzzyThresholdPct` "yönetilemez" diye kırmızı veriyordu,
  // (b) simetrik olarak, gerçekten yönetilemez bir sayısal anahtar boolean
  // `key:` olarak da geçiyorsa SESSİZCE geçerdi. `DNum` zaten 141. satırda tam
  // bu ayrım için hesaplanıyor — kullanılmıyordu.
  const inPanel = (k: string): boolean => D.includes(k) || DNum.includes(k);
  const numUnmanaged = aNum.filter((k) => !inPanel(k) && !NUMERIC_PANEL_EXEMPT[k]);
  check(
    "yönetilemez SAYISAL anahtar yok (panelde yok + muaf değil)",
    numUnmanaged.length === 0,
    `${numUnmanaged.join(", ")} — panele (numberFlags) ekle ya da gerekçeli muaf yaz`,
  );
  const numStaleUnknown = Object.keys(NUMERIC_PANEL_EXEMPT).filter((k) => !aNum.includes(k));
  check(
    "sayısal muaf listesinde artık var olmayan anahtar yok",
    numStaleUnknown.length === 0,
    `API'de yok: ${numStaleUnknown.join(", ")}`,
  );
  const numStaleNowInPanel = Object.keys(NUMERIC_PANEL_EXEMPT).filter((k) => inPanel(k));
  check(
    "sayısal muaf listesindeki anahtar panele eklenmemiş (eklenmişse muafı kaldır)",
    !electronFound || numStaleNowInPanel.length === 0,
    `artık panelde: ${numStaleNowInPanel.join(", ")}`,
  );

  // ---------------------------------------------------------------------------
  // 9) DOĞRUDAN SONDA — iki yeni finance anahtarı adıyla kilitli (2026-08-14)
  // ---------------------------------------------------------------------------
  const vatOk = updateSchema.safeParse({ financeDefaultVatRate: 20 });
  check(
    "⭐ updateSchema `financeDefaultVatRate` kabul ediyor (sayısal anahtar dört kapıda)",
    vatOk.success,
    vatOk.success ? "" : JSON.stringify(vatOk.error.issues[0]),
  );
  const vatBad = updateSchema.safeParse({ financeDefaultVatRate: 150 });
  check("updateSchema KDV oranında 0–100 sınırını uyguluyor (150 → 400)", !vatBad.success);
  const negCashOk = updateSchema.safeParse({ financeBlockNegativeCashEnabled: true });
  check(
    "⭐ updateSchema `financeBlockNegativeCashEnabled` kabul ediyor",
    negCashOk.success,
    negCashOk.success ? "" : JSON.stringify(negCashOk.error.issues[0]),
  );
  check(
    "API `financeDefaultVatRate` 0–100 aralığında sayı dönüyor",
    typeof flags.financeDefaultVatRate === "number" &&
      (flags.financeDefaultVatRate as number) >= 0 &&
      (flags.financeDefaultVatRate as number) <= 100,
    `değer=${String(flags.financeDefaultVatRate)}`,
  );

  // ---------------------------------------------------------------------------
  // 10) TİCARET/MUHASEBE DALGA 1 — "OKUYANI OLMAYAN" BAYRAKLAR ADIYLA KİLİTLİ
  // ---------------------------------------------------------------------------
  // ⚠️ NEDEN AYRI BİR BÖLÜM GEREKTİ — yukarıdaki dört küme denetimi bu dokuz
  // anahtarı KENDİLİĞİNDEN kapsar (ölçüldü: bir tanesi şemadan düşürülünce §1 ve
  // §3 kırmızı verdi) ama yalnız kümeleri BİRBİRİYLE karşılaştırır. Bir anahtar
  // dört kapıdan da AYNI ANDA silinirse kümeler tutarlı kalır ve her kontrol
  // yeşil olur. Bu dalga tam da o riski taşıyor: dokuzunu da bugün HİÇBİR servis
  // okumuyor (bilinçli ara durum — kapılar önce, guard'lar sonraki dalgada), yani
  // biri "ölü kod" sanılıp temizlenebilir ve panelden yönetilen bir ayar sessizce
  // kaybolur. Adı geçen liste bunu yakalar: küme karşılaştırması "tutarlı mı"
  // sorar, bu bölüm "HÂLÂ VAR MI" sorar.
  //
  // Ayrıca 5. KAPIYI (read helper) kapatır — yukarıdaki hiçbir kontrol okuyucuya
  // bakmıyordu; `getFeatureFlags` üzerinden dolaylı geçiyordu.
  const WAVE1_TRADE_FLAGS = [
    "financeRiskLimitBlockEnabled",
    "financeAutoDraftFromShipmentEnabled",
    "financeAutoAllocateOnPaymentEnabled",
    "yarnBlockNegativeBalanceEnabled",
    "purchaseBlockOverReceiptEnabled",
    "goodsReceiptRequirePriceEnabled",
    "financeAllowZeroPriceLineEnabled",
    "financeFutureDatedDocumentBlockEnabled",
    "financeYarnOutOnInvoiceEnabled",
  ] as const;

  const gateGaps = WAVE1_TRADE_FLAGS.flatMap((k) => {
    const missing = [
      aBool.includes(k) ? null : "api",
      B.includes(k) ? null : "şema",
      C.includes(k) ? null : "servis",
      !electronFound || D.includes(k) ? null : "panel",
    ].filter(Boolean);
    return missing.length ? [`${k}(${missing.join("+")})`] : [];
  });
  check(
    `⭐ dalga 1'in ${WAVE1_TRADE_FLAGS.length} ticaret/muhasebe bayrağı DÖRT KAPIDA da duruyor`,
    gateGaps.length === 0,
    `eksik: ${gateGaps.join(", ")}`,
  );

  // Şema satırı gerçekten `z.boolean()` mı — `z.any()`e gevşetilirse panel bir
  // yazım hatasını (örn. "true" metni) sessizce DB'ye yazdırırdı.
  const typeGaps = WAVE1_TRADE_FLAGS.filter((k) => {
    const ok = updateSchema.safeParse({ [k]: true }).success;
    const rejectsString = !updateSchema.safeParse({ [k]: "evet" }).success;
    return !(ok && rejectsString);
  });
  check(
    "dalga 1 bayrakları şemada boolean doğruluyor (true kabul · metin red)",
    typeGaps.length === 0,
    `gevşek/eksik: ${typeGaps.join(", ")}`,
  );

  // KAYIT YOKKEN VARSAYILAN — dalga 1'in ana vaadi: "davranış değişikliği YOK".
  // Ortam verisinden BAĞIMSIZ ölçülür (satır YOK diyen sahte istemci) — canlı
  // DB'deki değere bakmak, birinin panelden açtığı bir dev kurulumunda sahte
  // kırmızı verirdi.
  const emptyClient = {
    systemSetting: { findUnique: () => Promise.resolve(null) },
  } as unknown as Pick<typeof prisma, "systemSetting">;
  const defaults = await Promise.all([
    readFinanceRiskLimitBlockEnabled(emptyClient),
    readFinanceAutoDraftFromShipmentEnabled(emptyClient),
    readFinanceAutoAllocateOnPaymentEnabled(emptyClient),
    readYarnBlockNegativeBalanceEnabled(emptyClient),
    readPurchaseBlockOverReceiptEnabled(emptyClient),
    readGoodsReceiptRequirePriceEnabled(emptyClient),
    readFinanceAllowZeroPriceLineEnabled(emptyClient),
    readFinanceFutureDatedDocumentBlockEnabled(emptyClient),
    readFinanceYarnOutOnInvoiceEnabled(emptyClient),
  ]);
  const onByDefault = WAVE1_TRADE_FLAGS.filter((_, i) => defaults[i] !== false);
  check(
    "⭐ dalga 1 okuyucuları kayıt YOKKEN false döner (dokunulmamış kurulumda davranış değişmez)",
    onByDefault.length === 0,
    `varsayılanı açık: ${onByDefault.join(", ")}`,
  );

  // ---------------------------------------------------------------------------
  // 11) ⭐ SETTING_KEYS EVRENİ — bekçinin 2026-08-15'e kadarki KÖR NOKTASI
  // ---------------------------------------------------------------------------
  // Yukarıdaki her kontrolün evreni `getFeatureFlags()` ÇIKTISIDIR (A kümesi).
  // Ama `SETTING_KEYS` daha büyüktür: feature-flag yükünde DÖNMEYEN anahtarlar
  // (uygulama açılış yükünü şişirmesin diye) hiçbir kontrole girmez. Sonuç:
  // davranış değiştiren bir ayar panelde HİÇ YÜZEYİ OLMADAN yaşayabilir ve tüm
  // bekçiler yeşil kalır.
  //
  // ÖLÇÜLDÜ (2026-08-15 envanteri): `shipping.toleranceMeters` tam bu
  // durumdaydı — sipariş kaleminin "TAMAMLANDI" eşiğini belirliyor
  // (`order-status.helper.recomputeOrderStatusTx`, varsayılan 5 m) ve panelde
  // hiçbir ekrandan değiştirilemiyordu; tek yol ham `PUT /api/admin/settings/:key`
  // ucuydu ve onu çağıran bir yüzey yoktu.
  //
  // KURAL: her `SETTING_KEYS` satırı ya (a) feature-flag yükünden okunur, ya da
  // (b) burada GEREKÇE + KANIT ile muaftır. Kanıt bir dosya + o dosyada bulunması
  // gereken bir metindir; yüzey silinirse bekçi kırmızı verir (ölü muaf, gerçek
  // bir ihlali sessizce kapsam dışında tutar).
  const REPO_ROOT = path.resolve(__dirname, "../..");
  const NON_FLAG_SETTING_SURFACE: Record<
    string,
    { why: string; file: string; needle: string }
  > = {
    // ⚠️ FEATURE FLAG DEĞİL — makinenin KİMLİĞİ (`system-setting.service.ts:455`
    // başlığı bunu açıkça yazıyor: "`test_feature_flag_contract` bunu görmez
    // (görmemeli)"). Yazarın niyeti muafiyetti, muaf SATIRI eklenmemişti; bu
    // yüzden §11 bugüne kadar kırmızı kaldı (2026-09-01'de `origin/adnansahin`
    // üzerinde de kırmızı olduğu ölçüldü — birleştirmenin ürünü DEĞİL).
    // Panelde yüzeyi YOK ve OLMAMALI: panelden değiştirilebilir olsaydı
    // istemcilerin "bağlandığım sunucu değişti mi" kontrolü tek tıkla
    // geçersizleşirdi. Yüzeyi, değeri ÜRETEN boot işidir.
    // ⚠️ ARTIK BİR AYAR SATIRI DEĞİL, bir GÖÇ GİRDİSİ (D3③, 2026-09-23): bu
    // anahtarın satırı bundan sonra OKUNMAZ da YAZILMAZ da — `partyCodeAuto`
    // `workOrder.numberSource`tan TÜRETİLİR ve eski panel anahtarına yazmak
    // `numberSource`a yazar. Anahtar SETTING_KEYS'te KALIYOR çünkü ① sahadaki
    // kurulumlarda satır hâlâ var ve ② tek seferlik göç onu bir kez okuyor.
    // Panelde yüzeyi VAR (Genel Ayarlar → İş Emirleri anahtarı) ama o yüzey
    // artık bu anahtara değil `numberSource`a yazıyor — bu yüzden `getFeatureFlags`
    // okuyucularında görünmüyor ve muaf satırı gerekiyor.
    WORKORDER_PARTY_CODE_AUTO: {
      why: "Göç girdisi — satır artık okunmuyor/yazılmıyor; bayrak `workOrder.numberSource`tan türetilir (D3③)",
      file: "Teks-Erp/src/jobs/number-series-catalog.job.ts",
      needle: "workorder.partyCodeAuto",
    },
    SYSTEM_INSTALLATION_ID: {
      why: "Feature flag değil, kurulum kimliği — panel yüzeyi YOK (bilinçli); boot işi üretir, /api/discovery/identity okur",
      file: "Teks-Erp/src/jobs/installation-identity.job.ts",
      needle: "SETTING_KEYS.SYSTEM_INSTALLATION_ID",
    },
    SHIPPING_TOLERANCE_METERS: {
      why: "Panel: Genel Ayarlar → Siparişler → 'Sipariş tamamlanma toleransı' (settingFields)",
      file: "Electron/src/pages/GeneralSettings/settings-config.ts",
      needle: "RAW_SETTING_KEYS.SHIPPING_TOLERANCE_METERS",
    },
    ORDER_DEFAULT_DEADLINE_DAYS: {
      why: "Panel: Genel Ayarlar → Siparişler → 'Sipariş termini varsayılanı' (settingFields)",
      file: "Electron/src/pages/GeneralSettings/settings-config.ts",
      needle: "RAW_SETTING_KEYS.ORDER_DEFAULT_DEADLINE_DAYS",
    },
    WORKORDER_DEFAULT_PLAN_DURATION_DAYS: {
      why: "Panel: Genel Ayarlar → İş Emirleri → 'Planlama süresi varsayılanı' (settingFields)",
      file: "Electron/src/pages/GeneralSettings/settings-config.ts",
      needle: "RAW_SETTING_KEYS.WORKORDER_DEFAULT_PLAN_DURATION_DAYS",
    },
    DOCUMENTS_LOGO: {
      why: "Kendi ucu var (base64 yükü flag payload'ına konmaz); panel Şirket Bilgileri kartından yazar",
      file: "Teks-Erp/src/routes/feature-flag.routes.ts",
      needle: "/documents-logo",
    },
    BACKUP_OFFSITE_REMOTE: {
      why: "Panel: Sistem → Yedekler → Offsite Yedek kartı (PATCH /api/admin/backups/offsite)",
      file: "Teks-Erp/src/routes/admin.routes.ts",
      needle: "SETTING_KEYS.BACKUP_OFFSITE_REMOTE",
    },
    BACKUP_OFFSITE_DIR: {
      why: "Panel: Sistem → Yedekler → Offsite Yedek kartı (PATCH /api/admin/backups/offsite)",
      file: "Teks-Erp/src/routes/admin.routes.ts",
      needle: "SETTING_KEYS.BACKUP_OFFSITE_DIR",
    },
  };

  // `getFeatureFlags` gövdesinden çağrılan okuyucular → okudukları SETTING_KEYS.
  // İKİ HOP çünkü tek hop yetmiyor: gövde `apiKey: await readX(...)` yazar,
  // anahtarın kendisi `readX`in İÇİNDEDİR.
  const svc = readFileSync(SERVICE_SRC, "utf8");
  const gffBody = (() => {
    const start = svc.indexOf("async getFeatureFlags(");
    const end = svc.indexOf("\n  }", start);
    return start >= 0 && end > start ? svc.slice(start, end) : "";
  })();
  const readersInGff = [...new Set([...gffBody.matchAll(/\b(read[A-Z]\w*)\s*\(/g)].map((m) => m[1]!))];
  const readerBody = (name: string): string => {
    const re = new RegExp(`export (?:async )?function ${name}\\(`);
    const at = svc.search(re);
    if (at < 0) return "";
    const end = svc.indexOf("\n}", at);
    return end > at ? svc.slice(at, end) : "";
  };
  const coveredConsts = new Set<string>();
  for (const r of readersInGff) {
    for (const m of readerBody(r).matchAll(/SETTING_KEYS\.([A-Z0-9_]+)/g)) coveredConsts.add(m[1]!);
  }

  check(
    "zemin: getFeatureFlags gövdesinden ≥ 25 okuyucu çözüldü",
    readersInGff.length >= 25,
    `okuyucu=${readersInGff.length} — gövde ayrıştırılamadıysa §11/§12 vakumen yeşil kalır`,
  );
  check(
    "zemin: okuyucular üzerinden ≥ 25 SETTING_KEYS satırı kapsandı",
    coveredConsts.size >= 25,
    `kapsanan=${coveredConsts.size}`,
  );

  const allConsts = Object.keys(SETTING_KEYS);
  const uncovered = allConsts.filter(
    (c) => !coveredConsts.has(c) && !NON_FLAG_SETTING_SURFACE[c],
  );
  check(
    "⭐ her SETTING_KEYS satırı ya feature-flag yükünde ya gerekçeli muaf listesinde",
    uncovered.length === 0,
    `YÜZEYSİZ olabilir: ${uncovered.join(", ")} → panele yüzey ekle ya da gerekçeli muaf yaz`,
  );

  // Muaf BAYATLIĞI — iki yönlü.
  const staleSurfaceKeys = Object.keys(NON_FLAG_SETTING_SURFACE).filter(
    (c) => !allConsts.includes(c),
  );
  check(
    "muaf listesinde artık var olmayan SETTING_KEYS yok",
    staleSurfaceKeys.length === 0,
    `SETTING_KEYS'te yok: ${staleSurfaceKeys.join(", ")}`,
  );
  const nowCovered = Object.keys(NON_FLAG_SETTING_SURFACE).filter((c) => coveredConsts.has(c));
  check(
    "muaf listesindeki anahtar flag yüküne alınmamış (alındıysa muafı kaldır)",
    nowCovered.length === 0,
    `artık flag yükünde: ${nowCovered.join(", ")}`,
  );

  // KANIT — muafın söylediği yüzey GERÇEKTEN var mı.
  const brokenProofs = Object.entries(NON_FLAG_SETTING_SURFACE).flatMap(([c, s]) => {
    const abs = path.resolve(REPO_ROOT, s.file);
    if (!existsSync(abs)) return [`${c}(dosya yok: ${s.file})`];
    return readFileSync(abs, "utf8").includes(s.needle) ? [] : [`${c}(iz yok: ${s.needle})`];
  });
  check(
    "⭐ muaf edilen her anahtarın YÜZEYİ hâlâ yerinde (kanıt taraması)",
    brokenProofs.length === 0,
    brokenProofs.join(", "),
  );

  // ---------------------------------------------------------------------------
  // 12) PANELDEKİ "VARSAYILAN" ROZETİ ↔ BACKEND OKUYUCUSUNUN GERÇEK VARSAYILANI
  // ---------------------------------------------------------------------------
  // Panel her satırın altına "Varsayılan: AÇIK/KAPALI" basıyor. Bu bir BEYANDIR
  // ve beyan ikinci bir kaynaktır: `batchShortNumberEnabled` (AÇIK) ile
  // `tamburOverQuantityEnabled` (AÇIK) dışındaki her şey KAPALI olduğu için
  // yanlış yazmak kolay, fark etmek imkânsızdır. Burada beyan ÖLÇÜLÜR: ilgili
  // okuyucu, "kayıt yok" diyen sahte istemciyle çağrılır (§10 emsali) — canlı
  // DB'deki değere BAKILMAZ, çünkü birinin panelden açtığı bir dev kurulumu
  // sahte kırmızı üretirdi.
  const emptyClient2 = {
    systemSetting: { findUnique: () => Promise.resolve(null) },
  } as unknown as Pick<typeof prisma, "systemSetting">;

  // apiKey → okuyucu adı (gövdedeki `apiKey: await readX(` yazımı; çok satırlı
  // sarma da eşleşsin diye araya boşluk/satır sonu serbest).
  const readerByApiKey = new Map<string, string>();
  for (const m of gffBody.matchAll(/(\w+):\s*await\s+(read[A-Z]\w*)\s*\(/g)) {
    readerByApiKey.set(m[1]!, m[2]!);
  }

  // Panelin beyanı: `key: "X"` satırından SONRAKİ ilk `defaultOn:` değeri.
  const declaredDefaults = new Map<string, boolean>();
  if (electronFound) {
    const cfg = readFileSync(ELECTRON_CONFIG, "utf8");
    // ⚠️ ARADAKİ BAŞKA BİR `key:` SATIRI GEÇİLEMEZ. Düz `[\s\S]{0,4000}?` yazımı
    // ilk denemede tam bu yüzden yanlış eşleşti: `defaultOn` TAŞIMAYAN bir satır
    // (sayısal `financeDefaultVatRate`), kendinden SONRAKİ bir bayrağın
    // `defaultOn`ını sahiplendi ve bekçi sahte kırmızı verdi.
    for (const m of cfg.matchAll(
      /key:\s*"([^"]+)"(?:(?!key:\s*")[\s\S])*?defaultOn:\s*(true|false)/g,
    )) {
      if (!declaredDefaults.has(m[1]!)) declaredDefaults.set(m[1]!, m[2] === "true");
    }
  }
  check(
    "zemin: panelde ≥ 20 `defaultOn` beyanı okundu",
    !electronFound || declaredDefaults.size >= 20,
    `beyan=${declaredDefaults.size}`,
  );

  const defaultMismatches: string[] = [];
  const unreadable: string[] = [];
  for (const [key, declared] of declaredDefaults) {
    const readerName = readerByApiKey.get(key);
    const fn = readerName
      ? (systemSettingModule as unknown as Record<string, unknown>)[readerName]
      : undefined;
    if (typeof fn !== "function") {
      unreadable.push(`${key}${readerName ? `(${readerName} export değil)` : "(okuyucu çözülemedi)"}`);
      continue;
    }
    const actual = await (fn as (c: unknown) => Promise<unknown>)(emptyClient2);
    if (actual !== declared) {
      defaultMismatches.push(`${key}: panel=${declared} ↔ backend=${String(actual)}`);
    }
  }
  check(
    "⭐ panelin 'Varsayılan' rozeti backend okuyucusuyla birebir",
    defaultMismatches.length === 0,
    defaultMismatches.join(" · "),
  );
  check(
    "her panel satırının okuyucusu getFeatureFlags'ten çözülebiliyor",
    unreadable.length === 0,
    unreadable.join(", "),
  );

  // ---------------------------------------------------------------------------
  // 13) PANELİN HAM SYSTEM-SETTING ALANLARI ↔ BACKEND SETTING_KEYS
  // ---------------------------------------------------------------------------
  // Panel `settingFields` satırlarını ham anahtarla yazar. Anahtar adı ya da
  // DEĞERİ ayrışırsa panel `system_settings`e kimsenin OKUMADIĞI bir satır yazar:
  // ekran "kaydedildi" der, davranış hiç değişmez, hata hiçbir yerde görünmez.
  const ELECTRON_SETTING_SERVICE = path.resolve(
    __dirname,
    "../../Electron/src/services/systemSettingService.ts",
  );
  if (electronFound && existsSync(ELECTRON_SETTING_SERVICE)) {
    const cfg = readFileSync(ELECTRON_CONFIG, "utf8");
    const usedConsts = [
      ...new Set([...cfg.matchAll(/RAW_SETTING_KEYS\.([A-Z0-9_]+)/g)].map((m) => m[1]!)),
    ];
    check(
      "zemin: panelde ≥ 3 ham system-setting alanı var",
      usedConsts.length >= 3,
      `bulunan=${usedConsts.length}`,
    );
    const unknownConsts = usedConsts.filter((c) => !allConsts.includes(c));
    check(
      "panelin kullandığı her ham ayar anahtarı backend SETTING_KEYS'te var",
      unknownConsts.length === 0,
      `backend'de yok: ${unknownConsts.join(", ")}`,
    );

    const elecSrc = readFileSync(ELECTRON_SETTING_SERVICE, "utf8");
    const elecValues = new Map<string, string>();
    for (const m of elecSrc.matchAll(/^\s+([A-Z0-9_]+):\s*"([^"]+)"/gm)) {
      elecValues.set(m[1]!, m[2]!);
    }
    const valueDrift = usedConsts.filter((c) => {
      const backend = (SETTING_KEYS as Record<string, string>)[c];
      return elecValues.get(c) !== backend;
    });
    check(
      "⭐ panel aynasındaki ham anahtar DEĞERLERİ backend ile birebir",
      valueDrift.length === 0,
      valueDrift
        .map(
          (c) =>
            `${c}: panel="${elecValues.get(c) ?? "—"}" ↔ backend="${(SETTING_KEYS as Record<string, string>)[c]}"`,
        )
        .join(" · "),
    );
  }

  // ---------------------------------------------------------------------------
  // 14) ⭐ REJİMLE GİZLENEN AYAR, REJİMSİZ BİR YOLDAN HÂLÂ TETİKLENİYOR MU?
  // ---------------------------------------------------------------------------
  // VAKA (2026-08-15): panelin "Depo & Satın Alma" sekmesi `financeEnabled`
  // kapısının arkasına alındı. Ama Mal Kabul ekranı O KAPIYA BAĞLI DEĞİL —
  // `goods-receipt.routes.ts` `requireFinanceEnabled` TAŞIMAZ ve karo yalnız
  // izinle süzülür. Sonuç: "mal kabul satırında birim fiyat zorunlu" ayarını
  // açıp ön muhasebeyi bırakan firmada fişler 400 almaya DEVAM eder ve bayrağı
  // kapatacak hiçbir ekran kalmaz (tek yol ham `PUT /api/admin/settings/:key`).
  // Simetrik hâli: ön muhasebe kullanmayan ama mal kabul kullanan firma o ayarı
  // hiç AÇAMAZ. Sınıf tanıdık — "asıl tehlike açamamak değil KAPATAMAMAK".
  //
  // KURAL: bir ayarı rejimle gizlemek ancak ENFORCEMENT'ı o rejim kapalıyken
  // ULAŞILAMAZ ise meşrudur. Burada ölçülür, beyan edilmez: `src/` import
  // grafiği kurulur, REJİMSİZ route dosyalarından BFS yapılır (kendi
  // `readXEnabled()` kapısını taşıyan dosyada durulur) ve panelde gizlenen her
  // bayrağın okuyucusunu tüketen dosya bu kümede mi diye bakılır.
  //
  // ⚠️ 2026-09-02: `productionEnabled` ARTIK GERÇEK BİR KAPI — üretim
  // router'ları `requireProductionEnabled` taşıyor. Eskiden burada "bu anahtar
  // hiçbir kategoriyi kapılayamaz, çünkü backend'de böyle bir middleware
  // YOKTUR" yazıyordu; o cümle artık YANLIŞ ve silindi. Aynı iddiayı taşıyan
  // panel yorumları (`settings-config.ts`, `tile-config.ts`) da birlikte
  // güncellenir.
  //
  // ⚠️ YER TUTUCULAR BURAYA GİRMEZ: `kumasTeknikEnabled`/`tezgahEnabled`ın
  // middleware'i YOK (arkalarında route yok). Satır eklemek, "her REGIME_GATES
  // middleware'i ≥1 route'ta geçer" kontrolüne ÖLÜ bir satır sokardı.
  const SRC_ROOT = path.resolve(__dirname, "../src");
  const REGIME_GATES: Record<string, { middleware: string; selfGate: string }> = {
    financeEnabled: { middleware: "requireFinanceEnabled", selfGate: "readFinanceEnabled(" },
    productionEnabled: {
      middleware: "requireProductionEnabled",
      selfGate: "readProductionEnabled(",
    },
    ticaretEnabled: { middleware: "requireTicaretEnabled", selfGate: "readTicaretEnabled(" },
    iplikEnabled: { middleware: "requireIplikEnabled", selfGate: "readIplikEnabled(" },
    // Devere Faz 2 A2: `devere` ayar kategorisi `moduleKey: "devereEnabled"` taşır.
    devereEnabled: { middleware: "requireDevereEnabled", selfGate: "readDevereEnabled(" },
    // Z1 (2026-09-18): `dokuma` ayar kategorisi `moduleKey: "dokumaEnabled"` taşır (koşum/sipariş bağı bayrakları).
    dokumaEnabled: { middleware: "requireDokumaEnabled", selfGate: "readDokumaEnabled(" },
    depoMultiEnabled: {
      middleware: "requireDepoMultiEnabled",
      selfGate: "readDepoMultiEnabled(",
    },
  };

  // --- src ağacı + import grafiği ---------------------------------------------
  const { readdirSync, statSync } = await import("fs");
  const srcFiles: string[] = [];
  (function walk(dir: string) {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts")) srcFiles.push(p);
    }
  })(SRC_ROOT);
  const relOf = (f: string) => path.relative(SRC_ROOT, f).split(path.sep).join("/");
  const srcText = new Map(srcFiles.map((f) => [relOf(f), readFileSync(f, "utf8")]));
  // ⚠️ YORUM KÖRLÜĞÜ (2026-09-03 / D8 ölçümü). Aşağıdaki üç tarama da KODA
  // bakmak zorunda; ham metne bakan hâli ÜÇ AYRI yönde yalan söylüyordu:
  //   ① tüketici taraması → YANLIŞ KIRMIZI: `readTamburOverQuantityEnabled`
  //      üç "tüketici" gösteriyordu ama ikisi (`cash-balance-guard.helper`,
  //      `yarn-balance-guard.helper`) okuyucuyu yalnız YORUMDA "emsali" diye
  //      anıyordu — bir kategoriye `regime:` eklendiği gün sızıntı listesi
  //      düzeltilemez bir kırmızı verirdi.
  //   ② kapı taraması (`includes(gate.middleware)`) → YANLIŞ YEŞİL: kapı adını
  //      yalnız açıklama satırında anan bir router "kapılı" sayılır, ulaşım
  //      kümesi daralır ve sızıntı GÖRÜNMEZ olur (aynı hata `reports.routes`ta
  //      ölçülmüştü — `regime-gate-scan` başlığındaki AST kararının sebebi).
  //   ③ `selfGate` taraması → YANLIŞ YEŞİL: okuyucuyu yorumda anan bir dosya
  //      "kendi kapısını taşıyor" sayılıp ulaşım grafiğinden düşer.
  // İmport grafiği de koddan kurulur: yorum satırına alınmış bir `from "./x"`
  // sahte kenar üretir (ters yönde yanlış kırmızı).
  const srcCode = new Map([...srcText].map(([rel, text]) => [rel, yorumlariSok(text)]));
  const SETTING_SERVICE_REL = "services/system-setting.service.ts";

  const importsOf = new Map<string, string[]>();
  for (const [rel, text] of srcCode) {
    const dir = path.posix.dirname(rel);
    const outs: string[] = [];
    // ⚠️ DİNAMİK `import("./x")` DE SAYILIR. Yalnız statik `from "./x"` taransa
    // grafik SESSİZCE eksik kalır ve sızıntı kontrolü sahte YEŞİL verir: bu
    // bekçi yazılırken ölçüldü — `shipping.service` (rejimsiz) fatura taslağı
    // kancasını `await import("./helpers/shipment-auto-draft.helper")` ile
    // çağırıyor, yani statik grafikte o dosyaya HİÇ ulaşılamıyordu.
    for (const m of text.matchAll(/(?:from\s+"|import\(\s*")(\.[^"]+)"/g)) {
      const base = path.posix.normalize(path.posix.join(dir, m[1]!));
      for (const cand of [`${base}.ts`, `${base}/index.ts`]) {
        if (srcText.has(cand)) outs.push(cand);
      }
    }
    importsOf.set(rel, outs);
  }
  const routeFiles = [...srcText.keys()].filter(
    (r) => r.startsWith("routes/") && r.endsWith(".routes.ts"),
  );

  check(
    "zemin: src ağacı ve import grafiği tarandı (≥300 dosya · ≥50 route)",
    srcText.size >= 300 && routeFiles.length >= 50,
    `dosya=${srcText.size} route=${routeFiles.length}`,
  );

  // ⚠️ ALT ROUTER KAPIYI MOUNT'TAN MİRAS ALIR (2026-09-03 ölçümü). "Kapı metnini
  // taşımayan her route dosyası kapısızdır" varsayımı YANLIŞ: `finance-allocation.
  // routes.ts` kendi başına mount EDİLMEZ, `finance.routes.ts` onu
  // `router.use("/allocations", …)` ile bağlar ve oradaki `router.use(verifyToken,
  // requireFinanceEnabled)` alt router'ın da kapısıdır. Bu gerçek modellenmezse
  // sızıntı listesi DÜZELTİLEMEZ bir kırmızı verir (dosyaya kapı eklemek
  // gereksiz ikinci kapı olurdu; kaldırmak da gerçeği değiştirmez).
  //
  // ⚠️ Bu körlük yorum ayıklamasıyla ORTAYA ÇIKTI, onun ürünü DEĞİL: ham metin
  // taranırken dosyanın BAŞLIĞINDAKİ "…requireFinanceEnabled kapısını MİRAS ALIR"
  // açıklaması onu tesadüfen "kapılı" gösteriyordu. Yani doğru cevap YANLIŞ
  // sebeple veriliyordu ve mount düzeni değişse kimse görmeyecekti.
  const routeSet = new Set(routeFiles);
  const routeParents = new Map<string, string[]>(routeFiles.map((r) => [r, []]));
  for (const r of routeFiles) {
    for (const c of importsOf.get(r) ?? []) {
      if (routeSet.has(c) && c !== r) routeParents.get(c)!.push(r);
    }
  }
  const altRouterSayisi = routeFiles.filter((r) => routeParents.get(r)!.length > 0).length;
  check(
    "§14 zemin: alt router mount grafiği kuruldu (≥1 route başka route'a bağlanıyor)",
    altRouterSayisi >= 1,
    `alt router=${altRouterSayisi} — 0 ise miras modeli no-op'a düşmüş, ` +
      "kapıyı mount'tan alan router'lar yeniden sahte sızıntı üretir",
  );

  /** Bu rejim kapalıyken hâlâ ULAŞILABİLİR olan `src` dosyaları. */
  const ungatedReach = (regime: string): Set<string> => {
    const gate = REGIME_GATES[regime]!;
    const reached = new Set<string>();
    // Kapısız KÖKLER: kapı metnini taşımayan ve başka bir route'a bağlanmayan
    // (yani `app.ts`'ten doğrudan mount edilen) router'lar. Sonra miras aşağı
    // yayılır: kapısız bir router'ın bağladığı alt router da kapısızdır.
    const kapili = (r: string) => srcCode.get(r)!.includes(gate.middleware);
    const queue = routeFiles.filter((r) => !kapili(r) && routeParents.get(r)!.length === 0);
    const kapisiz = new Set(queue);
    for (let i = 0; i < queue.length; i++) {
      for (const c of importsOf.get(queue[i]!) ?? []) {
        if (!routeSet.has(c) || kapisiz.has(c) || kapili(c)) continue;
        kapisiz.add(c);
        queue.push(c);
      }
    }
    for (let i = 0; i < queue.length; i++) {
      for (const next of importsOf.get(queue[i]!) ?? []) {
        // ⚠️ ROUTE dosyaları bu turda ATLANIR — kapısız route kümesi YUKARIDA
        // (miras yayılımıyla) tam olarak hesaplandı. Burada da yürünseydi,
        // kapısız bir router'ın bağladığı KAPILI alt router "ulaşılabilir"
        // sayılır ve kendi kapısı yok sayılırdı.
        if (routeSet.has(next)) continue;
        // ⚠️ system-setting.service ATLANIR: her okuyucunun TANIMI orada yaşıyor;
        // grafikte geçilirse "tüketici" kavramı anlamını yitirir.
        if (next === SETTING_SERVICE_REL || reached.has(next)) continue;
        // ⚠️ Kendi rejim kapısını taşıyan dosya BİR KAPIDIR: içine girilmez.
        // `shipment-auto-draft.helper` tam bu durumda — rejimsiz sevk yolundan
        // çağrılıyor ama ilk ifadesi `readFinanceEnabled()`.
        if (srcCode.get(next)!.includes(gate.selfGate)) continue;
        reached.add(next);
        queue.push(next);
      }
    }
    return reached;
  };

  // --- panelin gizlediği bayraklar -------------------------------------------
  // ⚠️ BURADAKİ GİRİNTİ ŞARTI GERÇEK BİR KURALDIR, D kümesindeki gibi kozmetik
  // DEĞİL: kategori SINIRINI (`^ {4}id:`) girintiden başka bir şey vermiyor —
  // aynı dosyada `id:` alanı iç nesnelerde de geçiyor. Satır anahtarları da
  // kategori bloğu İÇİNDE arandığı için burada dar kalmaları güvenli.
  // (D kümesi ise dosyanın TAMAMINI tarar ve orada girinti şartı yalnız
  // yanlış kırmızı üretiyordu — 2026-09-02'de kaldırıldı.)
  type PanelCat = {
    id: string;
    regime?: string;
    /** MODÜL KİLİDİ (2026-09-03 / P5) — `regime`in ikizi DEĞİL: rejim GİZLER, bu KİLİTLER. */
    moduleKey?: string;
    flagKeys: string[];
    rawConsts: string[];
  };
  const panelCats: PanelCat[] = [];
  if (electronFound) {
    const cfg = readFileSync(ELECTRON_CONFIG, "utf8");
    const catStart = cfg.indexOf("export const SETTINGS_CATEGORIES");
    const body = catStart >= 0 ? cfg.slice(catStart) : "";
    // Kategori sınırı: 4 boşluk girintili `id: "..."` satırı.
    const marks = [...body.matchAll(/^ {4}id:\s*"([^"]+)",$/gm)];
    for (let i = 0; i < marks.length; i++) {
      const from = marks[i]!.index!;
      const to = i + 1 < marks.length ? marks[i + 1]!.index! : body.length;
      const block = body.slice(from, to);
      panelCats.push({
        id: marks[i]![1]!,
        regime: /^ {4}regime:\s*"([^"]+)",$/m.exec(block)?.[1],
        moduleKey: /^ {4}moduleKey:\s*"([^"]+)",$/m.exec(block)?.[1],
        flagKeys: [...block.matchAll(/^ {8}key:\s*"([^"]+)",$/gm)].map((m) => m[1]!),
        rawConsts: [...block.matchAll(/RAW_SETTING_KEYS\.([A-Z0-9_]+)/g)].map((m) => m[1]!),
      });
    }
  }
  const gatedCats = panelCats.filter((c) => c.regime);
  check(
    "zemin: panel kategorileri ayrıştırıldı (≥12 kategori · ≥25 satır · ≥1 rejim kapılı)",
    !electronFound ||
      (panelCats.length >= 12 &&
        panelCats.reduce((n, c) => n + c.flagKeys.length, 0) >= 25 &&
        gatedCats.length >= 1),
    `kategori=${panelCats.length} satır=${panelCats.reduce((n, c) => n + c.flagKeys.length, 0)} kapılı=${gatedCats.length} — ayrıştırma bozulduysa §14 vakumen yeşil kalır`,
  );

  // Bilinmeyen rejim adı = sessiz kapsam dışı kalma; açıkça düşür.
  const unknownRegimes = gatedCats.filter((c) => !REGIME_GATES[c.regime!]);
  check(
    "panelin kullandığı her rejim anahtarının backend kapısı TANIMLI",
    unknownRegimes.length === 0,
    unknownRegimes.map((c) => `${c.id}→${c.regime}`).join(", "),
  );

  // Rejimin backend'de GERÇEKTEN bir kapısı var mı? Yoksa o rejimle hiçbir şey
  // gizlenemez — ve bunu "0 route kapılı" diye söylemek, aşağıdaki sızıntı
  // listesinden çok daha anlaşılır bir kırmızıdır.
  for (const regime of new Set(gatedCats.map((c) => c.regime!))) {
    const gate = REGIME_GATES[regime];
    const gatedRoutes = gate
      ? routeFiles.filter((r) => srcCode.get(r)!.includes(gate.middleware))
      : [];
    check(
      `rejim '${regime}' backend'de gerçekten bir kapı (≥1 route ${gate?.middleware ?? "?"} taşıyor)`,
      gatedRoutes.length >= 1,
      "kapı yoksa bu rejim hiçbir ayarı gizleyemez — ilgili kategoriden `regime` alanını kaldır",
    );
  }

  // ⚠️ 2026-09-02 — YUKARIDAKİ DÖNGÜNÜN KÖR NOKTASI KAPATILDI. O döngü yalnız
  // PANELDE `regime:` kullanan anahtarlar için koşar; hiçbir ayar kategorisini
  // kapılamayan bir rejim anahtarı (bugün `productionEnabled`, `ticaretEnabled`,
  // `iplikEnabled`, `depoMultiEnabled` — dördü de panelde kategori kapılamıyor)
  // iki kontrolün de DIŞINDA kalırdı. Sonuç: middleware'i olmayan ÖLÜ bir
  // REGIME_GATES satırı sessizce yaşar ve tablo "backend'de kapı var" diye
  // yalan söyler. Aşağıdaki kontrol tabloyu KENDİ evreninde denetler.
  const oluGate = Object.entries(REGIME_GATES).filter(
    ([, g]) => !routeFiles.some((r) => srcCode.get(r)!.includes(g.middleware)),
  );
  check(
    "⭐ REGIME_GATES'teki HER middleware en az bir route dosyasında geçiyor (ölü satır yok)",
    oluGate.length === 0,
    oluGate.length
      ? `hiçbir route'ta geçmeyen kapı: ${oluGate.map(([k, g]) => `${k}→${g.middleware}`).join(", ")} — ` +
        "ya middleware yazılmamış ya route'a takılmamış; yer tutucu anahtarları TABLOYA HİÇ EKLEME"
      : `${Object.keys(REGIME_GATES).length} rejim kapısı canlı`,
  );
  // selfGate metni okuyucunun ADIYLA ve KAPANIŞ PARANTEZİYLE yazılır; parantez
  // unutulursa sızıntı taraması sessizce daralır (`readTicaret` başka ada da uyar).
  const kotuSelfGate = Object.entries(REGIME_GATES).filter(
    ([, g]) => !g.selfGate.endsWith("(") || !srcCode.get(SETTING_SERVICE_REL)!.includes(g.selfGate),
  );
  check(
    "REGIME_GATES `selfGate` metinleri gerçek okuyucuya işaret ediyor (kapanış parantezli)",
    kotuSelfGate.length === 0,
    kotuSelfGate.map(([k, g]) => `${k}→${g.selfGate}`).join(", "),
  );

  // apiKey/ham anahtar → okuyucu adları
  const readersForConst = (constName: string): string[] =>
    [...svc.matchAll(/export (?:async )?function (read[A-Z]\w*)\(/g)]
      .map((m) => m[1]!)
      .filter((n) => readerBody(n).includes(`SETTING_KEYS.${constName}`));

  const leaks: string[] = [];
  for (const cat of gatedCats) {
    const gate = REGIME_GATES[cat.regime!];
    if (!gate) continue;
    const reach = ungatedReach(cat.regime!);
    const readerNames = [
      ...cat.flagKeys.map((k) => readerByApiKey.get(k)).filter((n): n is string => !!n),
      ...cat.rawConsts.flatMap(readersForConst),
    ];
    for (const reader of new Set(readerNames)) {
      const re = new RegExp(`\\b${reader}\\b`);
      const consumers = [...srcCode.entries()]
        .filter(([rel, text]) => rel !== SETTING_SERVICE_REL && !rel.startsWith("routes/") && re.test(text))
        .map(([rel]) => rel);
      const open = consumers.filter((c) => reach.has(c));
      if (open.length > 0) {
        leaks.push(`${cat.id}/${reader} → ${open.join(", ")}`);
      }
    }
  }
  check(
    "⭐ rejimle gizlenen her ayarın enforcement'ı o rejim kapalıyken ULAŞILAMAZ",
    leaks.length === 0,
    leaks.length
      ? `rejimsiz yoldan hâlâ tetiklenebiliyor (kategoriden 'regime' alanını kaldır): ${leaks.join(" · ")}`
      : "",
  );

  // KÖRLÜK ZEMİNİ — yorum ayıklamanın GERÇEKTEN bir fark yarattığını ölçer.
  // Yoksa `yorumlariSok` bir gün no-op'a dönerse (regex bozulur, dosya boş
  // döner) yukarıdaki üç tarama sessizce ham metne geri döner ve bu bölüm
  // "ihlal yok" derken aslında hiçbir şeye bakmamış olur.
  const yorumFarki = [...srcText.entries()].filter(
    ([rel, text]) => srcCode.get(rel)!.length < text.length,
  ).length;
  check(
    "§14 zemin: tüketici/kapı taramaları YORUMSUZ koda bakıyor",
    yorumFarki >= 100,
    `yorumu ayıklanan dosya=${yorumFarki} — 0 ise \`yorumlariSok\` no-op'a düşmüş, ` +
      "tarama ham metne geri dönmüş demektir (yanlış kırmızı + yanlış yeşil birlikte)",
  );

  console.log(
    `\n   §14 — rejim kapılı kategoriler: ${gatedCats.map((c) => `${c.id}(${c.regime})`).join(", ") || "(yok)"}`,
  );

  // ---------------------------------------------------------------------------
  // 14b) MODÜL KİLİDİ — `SettingsCategory.moduleKey` (2026-09-03 / P5)
  // ---------------------------------------------------------------------------
  // ⚠️ §14'ÜN SIZINTI TARAMASI BURAYA UYGULANMAZ ve bu bilinçlidir. O tarama
  // "gizlenen ayarın enforcement'ı gerçekten ulaşılamaz mı" diye sorar; kilit
  // ise hiçbir şeyi ulaşılamaz YAPMAZ — satır salt-okunur çizilir. Aynı yüklemi
  // kilide uygulamak, panelde hiçbir modül kilidinin kurulamaması demekti
  // (üretim/ticaret satırlarının enforcement'ı rejimsiz yollardan da koşuyor;
  // somut zincirler §14'ün ölçümünde duruyor).
  //
  // ⚠️ 2026-09-04 — PANELDE GÖRÜNÜRLÜK ARTIK BU ALANDAN TÜRÜMÜYOR: kapalı
  // modülün SATIRLARI fabrika görünümünde hiç çizilmiyor (tek kaynak
  // `Electron/.../flag-modules.ts`, bekçisi `flag-modules.test.ts`) ve satırı
  // kalmayan kategori de düşüyor. `moduleKey` yalnız YAZMA kilidinin + bandın
  // kaynağı olarak kaldı; aşağıdaki üç kontrolün ölçtüğü şey değişmedi.
  // ⚠️ Ayarın DEĞERİ hâlâ okunabilir kalıyor (satıcı görünümü + Sistem →
  // Modüller ekranı) — "gizlemek geri dönüşü kapatır" itirazı o yüzden düştü.
  //
  // §14b ÜÇ ŞEY ölçer:
  //   ① `moduleKey` değeri REGIME_GATES anahtarlarından biri — yazım hatası
  //      kategoriyi SESSİZCE kilitsiz bırakır (panelde `modules[key]` undefined
  //      → `!undefined` → "kapalı" bile diyemez, TS union'ı tutarsa da runtime'da
  //      bir gün geniş bir string gelirse kapı yön değiştirir).
  //   ② Aynı kategori hem `regime` hem `moduleKey` TAŞIMAZ — "gizli VE kilitli"
  //      anlamsızdır (gizli kategorinin kilidi kimseye görünmez).
  //   ③ `modules` ve `demo` ASLA kilitlenemez: modül anahtarlarının evi kendi
  //      kilidinin arkasına konarsa modüller bir daha AÇILAMAZ (2026-08-05
  //      `kk1DuplicateGuardEnabled` dersinin arayüz ikizi).
  // ⚠️ ZEMİN ŞART: kilitli kategori kalmazsa ayrıştırma bozulmuş olabilir ve üç
  // kontrol de VAKUMEN yeşil kalırdı (§14'ün kendi `gatedCats.length >= 1`
  // kalıbı).
  const lockedCats = panelCats.filter((c) => c.moduleKey);
  check(
    "§14b zemin: `moduleKey` taşıyan kategori ayrıştırıldı (≥1)",
    !electronFound || lockedCats.length >= 1,
    `kilitli=${lockedCats.length} — ayrıştırma bozulduysa §14b vakumen yeşil kalır`,
  );
  const bilinmeyenKilit = lockedCats.filter((c) => !REGIME_GATES[c.moduleKey!]);
  check(
    "§14b ⭐ `moduleKey` değeri backend rejim kapılarından biri (yazım hatası yok)",
    bilinmeyenKilit.length === 0,
    bilinmeyenKilit.length
      ? `${bilinmeyenKilit.map((c) => `${c.id}→${c.moduleKey}`).join(", ")} — geçerli: ${Object.keys(REGIME_GATES).join(", ")}`
      : "",
  );
  const ikisiBirden = panelCats.filter((c) => c.regime && c.moduleKey);
  check(
    "§14b ⭐ hiçbir kategori hem `regime` hem `moduleKey` taşımaz (iki farklı semantik)",
    ikisiBirden.length === 0,
    ikisiBirden.map((c) => `${c.id}(regime=${c.regime}, moduleKey=${c.moduleKey})`).join(", "),
  );
  const YASAKLI_KILIT = ["modules", "demo"];
  const yasakliKilitli = lockedCats.filter((c) => YASAKLI_KILIT.includes(c.id));
  check(
    "§14b ⭐ modül anahtarlarının EVİ (`modules`) ve `demo` kilitlenemez",
    yasakliKilitli.length === 0,
    yasakliKilitli.length
      ? `${yasakliKilitli.map((c) => c.id).join(", ")} — kilitlenirse modüller bir daha yapılandırılamaz`
      : "",
  );
  console.log(
    `   §14b — modül kilitli kategoriler: ${lockedCats.map((c) => `${c.id}(${c.moduleKey})`).join(", ") || "(yok)"}`,
  );

  // ---------------------------------------------------------------------------
  // 15) MODÜL ŞALTERLERİ — ADIYLA KİLİTLİ (§10 kalıbının ikizi)
  // ---------------------------------------------------------------------------
  // NEDEN AYRI BİR BÖLÜM: yukarıdaki dört küme denetimi bu yedi anahtarı
  // kendiliğinden kapsar ama yalnız kümeleri BİRBİRİYLE karşılaştırır. Bir
  // anahtar dört kapıdan da AYNI ANDA silinirse kümeler tutarlı kalır ve her
  // kontrol yeşil olur. Modül şalterlerinde bunun bedeli en yüksektir: bir
  // kurulumun "hangi modülleri kullanıyorum" cevabı sessizce kaybolur ve
  // route kapıları (`module.middleware.ts`) okuyacak ayar bulamaz → varsayılana
  // düşer. `production` için varsayılan AÇIK, diğerleri için KAPALI — yani
  // kaybın yönü modülden modüle değişir; bu da hatayı daha da sinsi yapar.
  //
  // NEGATİF SONDALAR (2026-09-02, md5 ile birebir geri alındı):
  //   SONDA-19 → REGIME_GATES'e middleware'i olmayan bir satır eklendi
  //              (`kumasTeknikEnabled`) → çıkış 1 · 1 ❌ "ölü satır yok" kontrolü.
  //              Eski hâlde bu satır SESSİZCE yaşardı (panelde kategori
  //              kapılamayan anahtar iki eski kontrolün de dışındaydı).
  //   SONDA-20 → `tezgahEnabled` `updateSchema`dan silindi → çıkış 1 · 4 ❌
  //              (§1 + §3 + §15 dört-kapı + §15 boolean tipi).
  //   SONDA-21 → `readProductionEnabled`in "satır yoksa TRUE" sigortası
  //              düşürüldü → çıkış 1 · 2 ❌ (§12 panel rozeti + §15 varsayılan).
  const MODULE_FLAGS = [
    "productionEnabled",
    "financeEnabled",
    "ticaretEnabled",
    "iplikEnabled",
    "depoMultiEnabled",
    "kumasTeknikEnabled",
    "tezgahEnabled",
    "devereEnabled",
    "dokumaEnabled",
    "emanetEnabled",
  ] as const;

  const moduleGaps = MODULE_FLAGS.flatMap((k) => {
    const missing = [
      aBool.includes(k) ? null : "api",
      B.includes(k) ? null : "şema",
      C.includes(k) ? null : "servis",
      // ⚠️ Panel ayağı MUAF LİSTESİNE saygılı: yer tutucu anahtarların
      // (`kumasTeknik`, `tezgah`) arkasında henüz TEK BİR yüzey yok ve panele
      // toggle koymak, açtığında hiçbir şeyin değişmediği bir düğme vermek
      // olurdu. Muaf gerekçeleri PANEL_EXEMPT'te yazılı ve §5 onları iki yönlü
      // denetliyor (panele girerlerse muafta kalmaları KIRMIZI verir).
      !electronFound || D.includes(k) || PANEL_EXEMPT[k] ? null : "panel",
    ].filter(Boolean);
    return missing.length ? [`${k}(${missing.join("+")})`] : [];
  });
  check(
    `⭐ ${MODULE_FLAGS.length} modül şalterinin hepsi DÖRT KAPIDA da duruyor`,
    moduleGaps.length === 0,
    `eksik: ${moduleGaps.join(", ")}`,
  );

  const moduleTypeGaps = MODULE_FLAGS.filter((k) => {
    const ok = updateSchema.safeParse({ [k]: true }).success;
    const rejectsString = !updateSchema.safeParse({ [k]: "evet" }).success;
    return !(ok && rejectsString);
  });
  check(
    "modül şalterleri şemada boolean doğruluyor (true kabul · metin red)",
    moduleTypeGaps.length === 0,
    `gevşek/eksik: ${moduleTypeGaps.join(", ")}`,
  );

  // KAYIT YOKKEN VARSAYILAN — grandfathering'in kod tarafındaki yarısı.
  // Ortam verisinden BAĞIMSIZ ölçülür (satır YOK diyen sahte istemci); canlı
  // DB'ye bakmak, birinin panelden açtığı bir dev kurulumunda sahte kırmızı
  // verirdi.
  const emptyClient3 = {
    systemSetting: { findUnique: () => Promise.resolve(null) },
  } as unknown as Pick<typeof prisma, "systemSetting">;
  const moduleDefaults: Record<string, boolean> = {
    productionEnabled: await readProductionEnabled(emptyClient3),
    financeEnabled: await readFinanceEnabled(emptyClient3),
    ticaretEnabled: await readTicaretEnabled(emptyClient3),
    iplikEnabled: await readIplikEnabled(emptyClient3),
    depoMultiEnabled: await readDepoMultiEnabled(emptyClient3),
    kumasTeknikEnabled: await readKumasTeknikEnabled(emptyClient3),
    tezgahEnabled: await readTezgahEnabled(emptyClient3),
    devereEnabled: await readDevereEnabled(emptyClient3),
    emanetEnabled: await readEmanetEnabled(emptyClient3),
    dokumaEnabled: await readDokumaEnabled(emptyClient3),
  };
  // ⚠️ `productionEnabled` TEK İSTİSNA ve bu kalıcı bir karardır: damgası
  // OLMAYAN bir kopyada (eski dump, dev DB, prova) fabrika üretimsiz kalmasın.
  // Diğer altısında varsayılan KAPALI — dokunulmamış kurulumda davranış değişmez.
  const beklenenVarsayilan: Record<string, boolean> = {
    productionEnabled: true,
    financeEnabled: false,
    ticaretEnabled: false,
    iplikEnabled: false,
    depoMultiEnabled: false,
    kumasTeknikEnabled: false,
    tezgahEnabled: false,
    devereEnabled: false,
    dokumaEnabled: false,
    emanetEnabled: false,
  };
  const varsayilanSapma = MODULE_FLAGS.filter(
    (k) => moduleDefaults[k] !== beklenenVarsayilan[k],
  ).map((k) => `${k}=${moduleDefaults[k]} (beklenen ${beklenenVarsayilan[k]})`);
  check(
    "⭐ modül okuyucularının kayıt YOKKEN varsayılanı (production→AÇIK, diğerleri→KAPALI)",
    varsayilanSapma.length === 0,
    varsayilanSapma.join(", "),
  );

  // Panel `defaultOn` rozeti ↔ backend varsayılanı §12'de zaten karşılaştırılıyor;
  // burada yalnız modül satırlarının o taramaya GİRDİĞİNİ doğruluyoruz (panelde
  // hiç satırı olmayan bir modül §12'de sessizce kapsam dışı kalırdı).
  const panelsizModul = MODULE_FLAGS.filter(
    (k) => electronFound && !D.includes(k) && !PANEL_EXEMPT[k],
  );
  check(
    "her modül şalteri ya panelde ya gerekçeli PANEL_EXEMPT'te",
    panelsizModul.length === 0,
    panelsizModul.join(", "),
  );

  console.log(
    `\n   §15 — modül şalterleri: ${MODULE_FLAGS.map((k) => `${k}=${moduleDefaults[k] ? "açık" : "kapalı"}(varsayılan)`).join(" · ")}`,
  );


  // ---------------------------------------------------------------------------
  // 16) ⭐ ENUM AYAĞI — bekçinin ÜÇÜNCÜ KÖR NOKTASI (2026-09-03, Dilim 2)
  // ---------------------------------------------------------------------------
  // Bekçi bugüne kadar YALNIZ boolean (`aBool`, §1-§6) ve sayısal (`aNumeric`/
  // `aNum`, §8) anahtarları ölçüyordu. METİN değerli (kapalı kümeli = enum) bir
  // ayar HİÇBİR kontrolden geçmiyordu ve bu boşluk KANITLIYDI: `sameTypeSessionPolicy`
  // ne bir kümede ne bir muaf listesindeydi — dört kapıdan biri düşse (örn.
  // `updateSchema` satırı silinse) her kontrol YEŞİL kalır, ayar sahada ne
  // açılabilir ne KAPATILABİLİRDİ. 2026-08-04 `kk1DuplicateGuardEnabled`
  // vakasının birebir tekrarı.
  //
  // Bu ayak eklenmeden yeni enum bayrak yazılmaz (Dilim 2 kararı D1).
  //
  // ⚠️ EVRENİN SINIRI: `typeof === "string"` yetmez — `companyName` de metindir
  // ama ENUM DEĞİLDİR (kapalı değer kümesi yok, kendi kartından yönetilir).
  // Serbest metinler GEREKÇELİ muaf listesindedir ve liste İKİ YÖNLÜ denetlenir:
  // ölü bir satır, gerçek bir enum bayrağını sessizce kapsam dışında tutardı.
  const FREE_TEXT_FLAGS: Record<string, string> = {
    companyName: "serbest METİN — kapalı değer kümesi yok; panel Şirket Bilgileri kartı yazar",
    shippingSackSeqPrefix: "serbest METİN (≤8, zod regex) — panel `freeText` satırı; belgeye HTML kaçışıyla girer (2026-09-22)",
  };
  const aEnum = A.filter((k) => typeof flags[k] === "string" && !FREE_TEXT_FLAGS[k]);

  // Panelde enum satırı `enumKey:` ile yazılır — `key:` DEĞİL. Ad bilinçli farklı:
  // aynı adla yazılsaydı enum anahtarı D (boolean) kümesine sızar ve §5
  // ("yönetilemez boolean bayrak") yanlış şey ölçerdi. `numberKey:` ayrımının
  // varlık sebebi birebir aynıydı.
  const DEnum = electronFound ? readKeys(ELECTRON_CONFIG, /enumKey:\s*"([^"]+)"/g) : [];

  const ENUM_PANEL_EXEMPT: Record<string, string> = {
    sameTypeSessionPolicy: "kind:'session' — Oturum section'ı yönetir (kendi select'i var)",
  };

  console.log(
    `\n   §16 — A(enum)=${aEnum.length} [${aEnum.join(", ")}] · D(enum satırı)=${DEnum.length}`,
  );

  // ZEMİN: enum anahtarı bulunamıyorsa (tip değişti, regex bozuldu) "ihlal yok"
  // ile "hiçbir şeye bakmadım" AYNI yeşile çıkardı.
  check("zemin: A enum ≥ 3 anahtar", aEnum.length >= 3, `aEnum=${aEnum.join(", ")}`);
  check(
    "zemin: panelde ≥ 1 `enumKey` satırı okundu",
    !electronFound || DEnum.length >= 1,
    `DEnum=${DEnum.length} — regex/alan adı bozulduysa §16 panel ayağı vakumen yeşil kalır`,
  );

  const enumMissingInSchema = aEnum.filter((k) => !B.includes(k));
  check(
    "⭐ API'nin döndüğü her ENUM ayar updateSchema'da var",
    enumMissingInSchema.length === 0,
    `şemada YOK: ${enumMissingInSchema.join(", ")} → panelden PATCH 400 alır (ne açılır ne KAPATILIR)`,
  );
  const enumMissingInService = aEnum.filter((k) => !C.includes(k));
  check(
    "API'nin döndüğü her ENUM ayarın setFeatureFlags yazma dalı var",
    enumMissingInService.length === 0,
    `yazılmıyor: ${enumMissingInService.join(", ")} → uç 200 der, DB değişmez`,
  );

  // Şema satırı gerçekten KAPALI KÜME mi? `z.string()`e gevşetilirse panel bir
  // yazım hatasını ("blok", "BLOCK") sessizce DB'ye yazdırır ve okuyucunun kod
  // sigortası devreye girer — yani ayar "kaydedildi" der, davranış değişmez.
  const enumTypeGaps = aEnum.filter((k) => {
    const current = flags[k] as string;
    const acceptsCurrent = updateSchema.safeParse({ [k]: current }).success;
    const rejectsBogus = !updateSchema.safeParse({ [k]: "__hicboylebirdegeryok__" }).success;
    const rejectsBool = !updateSchema.safeParse({ [k]: true }).success;
    return !(acceptsCurrent && rejectsBogus && rejectsBool);
  });
  check(
    "⭐ ENUM ayarlar şemada KAPALI KÜME doğruluyor (geçerli kabul · uydurma red · boolean red)",
    enumTypeGaps.length === 0,
    `gevşek/eksik: ${enumTypeGaps.join(", ")}`,
  );

  const enumUnmanaged = aEnum.filter((k) => !DEnum.includes(k) && !ENUM_PANEL_EXEMPT[k]);
  check(
    "yönetilemez ENUM ayar yok (panelde yok + muaf değil)",
    !electronFound || enumUnmanaged.length === 0,
    `${enumUnmanaged.join(", ")} — panele (enumFlags) ekle ya da gerekçeli muaf yaz`,
  );
  const enumPanelGhosts = DEnum.filter((k) => !A.includes(k));
  check(
    "panelin ENUM satırlarının hepsi API yanıtında var",
    enumPanelGhosts.length === 0,
    `API'de YOK: ${enumPanelGhosts.join(", ")}`,
  );

  // Muaf/serbest-metin BAYATLIĞI — iki yönlü, dört kontrol.
  const enumStaleUnknown = Object.keys(ENUM_PANEL_EXEMPT).filter((k) => !aEnum.includes(k));
  check(
    "ENUM muaf listesinde artık var olmayan anahtar yok",
    enumStaleUnknown.length === 0,
    `API'de enum değil/yok: ${enumStaleUnknown.join(", ")}`,
  );
  const enumStaleNowInPanel = Object.keys(ENUM_PANEL_EXEMPT).filter((k) => DEnum.includes(k));
  check(
    "ENUM muaf listesindeki anahtar panele eklenmemiş (eklenmişse muafı kaldır)",
    !electronFound || enumStaleNowInPanel.length === 0,
    `artık panelde: ${enumStaleNowInPanel.join(", ")}`,
  );
  const freeTextStale = Object.keys(FREE_TEXT_FLAGS).filter((k) => typeof flags[k] !== "string");
  check(
    "serbest-metin muaf listesinde artık metin OLMAYAN anahtar yok",
    freeTextStale.length === 0,
    `metin değil: ${freeTextStale.join(", ")} — muafı kaldır, yoksa gerçek bir enum kapsam dışı kalır`,
  );
  const freeTextInPanel = Object.keys(FREE_TEXT_FLAGS).filter((k) => DEnum.includes(k));
  check(
    "serbest-metin anahtarı `enumFlags` satırı olarak yazılmamış",
    !electronFound || freeTextInPanel.length === 0,
    `panelde enum satırı var: ${freeTextInPanel.join(", ")} — kapalı kümesi olmayan ayar select ile yönetilemez`,
  );
  // Serbest metin panelde `textKey:` satırıyla yönetilir (2026-09-22; `companyName` kendi
  // kartındandır, muaf). Satırı olmayan serbest metin panelden değiştirilemez.
  const DText = electronFound ? readKeys(ELECTRON_CONFIG, /textKey:\s*"([^"]+)"/g) : [];
  const TEXT_PANEL_EXEMPT: Record<string, string> = { companyName: "Şirket Bilgileri kartı yazar" };
  const freeTextNoRow = Object.keys(FREE_TEXT_FLAGS).filter((k) => !TEXT_PANEL_EXEMPT[k] && !DText.includes(k));
  check(
    "serbest-metin anahtarının panelde `textFlags` satırı var",
    !electronFound || freeTextNoRow.length === 0,
    `satırı yok: ${freeTextNoRow.join(", ")}`,
  );
  const textNotFree = DText.filter((k) => !FREE_TEXT_FLAGS[k]);
  check("panel `textKey` satırları FREE_TEXT_FLAGS listesinde (iki yönlü)", textNotFree.length === 0, textNotFree.join(", "));

  // PANELİN "VARSAYILAN" BEYANI ↔ BACKEND OKUYUCUSU — §12'nin enum ikizi.
  // Panel her enum satırının altına "Varsayılan: <etiket>" basar ve bu bir
  // BEYANDIR; ikinci kaynak olduğu için ölçülür (canlı DB'ye BAKILMAZ, sahte
  // "kayıt yok" istemcisiyle çağrılır — birinin panelden değiştirdiği bir dev
  // kurulumu sahte kırmızı üretirdi).
  const declaredEnumDefaults = new Map<string, string>();
  if (electronFound) {
    const cfg = readFileSync(ELECTRON_CONFIG, "utf8");
    // ⚠️ ARADAKİ BAŞKA BİR `enumKey:` SATIRI GEÇİLEMEZ (§12'de birebir aynı
    // tuzak ölçüldü: `defaultOn` taşımayan bir satır, sonrakinin beyanını
    // sahiplenip sahte kırmızı vermişti).
    for (const m of cfg.matchAll(
      /enumKey:\s*"([^"]+)"(?:(?!enumKey:\s*")[\s\S])*?defaultValue:\s*"([^"]+)"/g,
    )) {
      if (!declaredEnumDefaults.has(m[1]!)) declaredEnumDefaults.set(m[1]!, m[2]!);
    }
  }
  check(
    "zemin: panelde her `enumKey` satırının `defaultValue` beyanı okundu",
    !electronFound || declaredEnumDefaults.size === DEnum.length,
    `beyan=${declaredEnumDefaults.size} ↔ satır=${DEnum.length}`,
  );
  const enumDefaultMismatch: string[] = [];
  const enumUnreadable: string[] = [];
  for (const [key, declared] of declaredEnumDefaults) {
    const readerName = readerByApiKey.get(key);
    const fn = readerName
      ? (systemSettingModule as unknown as Record<string, unknown>)[readerName]
      : undefined;
    if (typeof fn !== "function") {
      enumUnreadable.push(`${key}${readerName ? `(${readerName} export değil)` : "(okuyucu çözülemedi)"}`);
      continue;
    }
    const actual = await (fn as (c: unknown) => Promise<unknown>)(emptyClient2);
    if (actual !== declared) enumDefaultMismatch.push(`${key}: panel=${declared} ↔ backend=${String(actual)}`);
  }
  check(
    "⭐ panelin ENUM 'Varsayılan' beyanı backend okuyucusuyla birebir",
    enumDefaultMismatch.length === 0,
    enumDefaultMismatch.join(" · "),
  );
  check(
    "her ENUM panel satırının okuyucusu getFeatureFlags'ten çözülebiliyor",
    enumUnreadable.length === 0,
    enumUnreadable.join(", "),
  );

  // ⭐ KOD SİGORTASI — DB'de ÇÖP değer varken okuyucu VARSAYILANA düşmeli.
  // Enum bayraklarında bu, "varsayılan = bugünkü davranış" vaadinin tek mekanik
  // garantisidir: elle SQL / eski dump / yarım migration bir gün "BLOCK" ya da
  // `true` yazarsa sahayı kilitlememeli. Boolean'da karşılığı `asBoolean`ın
  // kendisidir; enumda okuyucunun `includes` kontrolü YAZILMAK ZORUNDA.
  const junkClient = {
    systemSetting: {
      findUnique: () => Promise.resolve({ value: "__hicboylebirdegeryok__" }),
    },
  } as unknown as Pick<typeof prisma, "systemSetting">;
  const junkFallbacks: Array<[string, unknown, unknown]> = [
    ["sameTypeSessionPolicy", await readSameTypeSessionPolicy(junkClient), DEFAULT_SAME_TYPE_SESSION_POLICY],
    ["shippingOrderRequirement", await readShippingOrderRequirement(junkClient), DEFAULT_SHIPMENT_ORDER_REQUIREMENT],
    ["shippingInvoiceMode", await readShippingInvoiceMode(junkClient), DEFAULT_SHIPPING_INVOICE_MODE],
    [
      "shippingDocItemNameMode",
      await readShippingDocItemNameMode(junkClient),
      DEFAULT_SHIPPING_DOC_ITEM_NAME_MODE,
    ],
  ];
  const junkGaps = junkFallbacks.filter(([, got, want]) => got !== want);
  check(
    "⭐ ENUM okuyucuları DB'deki ÇÖP değerde varsayılana düşüyor (kod sigortası)",
    junkGaps.length === 0,
    junkGaps.map(([k, got, want]) => `${k}: ${String(got)} (beklenen ${String(want)})`).join(" · "),
  );

  // ADIYLA KİLİT — §10/§15 kalıbı. Dört kapıdan AYNI ANDA silinen bir anahtar
  // küme karşılaştırmasında TUTARLI görünür ve her kontrol yeşil kalır; bu
  // bölüm "tutarlı mı" değil "HÂLÂ VAR MI" sorar.
  const ENUM_FLAGS = [
    "sameTypeSessionPolicy",
    "shippingOrderRequirement",
    "shippingInvoiceMode",
    "shippingDocItemNameMode",
  ] as const;
  const enumGaps = ENUM_FLAGS.flatMap((k) => {
    const missing = [
      aEnum.includes(k) ? null : "api",
      B.includes(k) ? null : "şema",
      C.includes(k) ? null : "servis",
      !electronFound || DEnum.includes(k) || ENUM_PANEL_EXEMPT[k] ? null : "panel",
    ].filter(Boolean);
    return missing.length ? [`${k}(${missing.join("+")})`] : [];
  });
  check(
    `⭐ ${ENUM_FLAGS.length} enum bayrağının hepsi DÖRT KAPIDA da duruyor`,
    enumGaps.length === 0,
    `eksik: ${enumGaps.join(", ")}`,
  );

  // Değer KÜMELERİ şemayla birebir mi? Şema `z.enum([...])` ile ayrı bir liste
  // yazar; küme ile şema ayrışırsa panel geçerli bir seçeneği kaydedemez (400)
  // ya da okuyucunun reddedeceği bir değeri yazar (ayar "kaydedildi" der,
  // davranış değişmez).
  const VALUE_SETS: Array<[string, readonly string[]]> = [
    ["sameTypeSessionPolicy", SAME_TYPE_SESSION_POLICIES],
    ["shippingOrderRequirement", SHIPMENT_ORDER_REQUIREMENTS],
    ["shippingInvoiceMode", SHIPPING_INVOICE_MODES],
    ["shippingDocItemNameMode", SHIPPING_DOC_ITEM_NAME_MODES],
  ];
  const valueSetGaps = VALUE_SETS.flatMap(([k, values]) =>
    values.filter((v) => !updateSchema.safeParse({ [k]: v }).success).map((v) => `${k}:${v}`),
  );
  check(
    "⭐ enum değer kümelerinin HER üyesi updateSchema'da kabul ediliyor",
    valueSetGaps.length === 0,
    `şema reddediyor: ${valueSetGaps.join(", ")} — küme ile z.enum listesi ayrışmış`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n   SETTING_KEYS muafları (feature-flag yükünde DÖNMEYEN, kendi yüzeyi olan):");
  for (const [k, s] of Object.entries(NON_FLAG_SETTING_SURFACE)) {
    console.log(`     · ${k} — ${s.why}`);
  }

  console.log("\n   Muaflar (panelde generic toggle olarak görünmeyen boolean bayraklar):");
  for (const [k, why] of Object.entries(PANEL_EXEMPT)) {
    console.log(`     · ${k} — ${why}`);
  }
  console.log("\n   Sayısal muaflar (panelde numberFlags satırı olmayan sayısal anahtarlar):");
  for (const [k, why] of Object.entries(NUMERIC_PANEL_EXEMPT)) {
    console.log(`     · ${k} — ${why}`);
  }
  console.log("\n   ENUM muaflar (panelde enumFlags satırı olmayan kapalı-kümeli ayarlar):");
  for (const [k, why] of Object.entries(ENUM_PANEL_EXEMPT)) {
    console.log(`     · ${k} — ${why}`);
  }
  console.log("\n   Serbest METİN (enum SAYILMAYAN string anahtarlar):");
  for (const [k, why] of Object.entries(FREE_TEXT_FLAGS)) {
    console.log(`     · ${k} — ${why}`);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
