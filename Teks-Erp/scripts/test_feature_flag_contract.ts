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
} from "../src/services/system-setting.service";
import prisma from "../src/lib/prisma";

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
};

const ELECTRON_CONFIG = path.resolve(
  __dirname,
  "../../Electron/src/pages/GeneralSettings/settings-config.ts",
);
const SERVICE_SRC = path.resolve(
  __dirname,
  "../src/services/system-setting.service.ts",
);

function readKeys(file: string, re: RegExp): string[] {
  const src = readFileSync(file, "utf8");
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
  const D = electronFound
    ? readKeys(ELECTRON_CONFIG, /^\s*key:\s*"([^"]+)"/gm)
    : [];
  // ⚠️ Panelin SAYISAL alanları `numberKey:` ile yazılır — `key:` DEĞİL. Ad
  // bilinçli farklı: yukarıdaki D regex'i satır başı `key:` yakaladığı için
  // aynı adla yazılsalardı sayısal anahtarlar boolean kümesine sızar ve 5.
  // kontrol ("yönetilemez boolean bayrak") yanlış şey ölçerdi.
  const DNum = electronFound
    ? readKeys(ELECTRON_CONFIG, /^\s*numberKey:\s*"([^"]+)"/gm)
    : [];

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
  const numUnmanaged = aNum.filter((k) => !D.includes(k) && !NUMERIC_PANEL_EXEMPT[k]);
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
  const numStaleNowInPanel = Object.keys(NUMERIC_PANEL_EXEMPT).filter((k) => D.includes(k));
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
  // (`order-status.helper.recomputeOrderStatus`, varsayılan 5 m) ve panelde
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
  // ⚠️ `productionEnabled` bugün hiçbir kategoriyi kapılayamaz ve bu KURALIN
  // SONUCUDUR, ayrı bir istisna değil: backend'de `requireProductionEnabled`
  // diye bir middleware yoktur → hiçbir yol kapalı değildir → her tüketici
  // ulaşılabilir çıkar. Gün gelir üretim yüzeyleri gerçekten rejime alınırsa
  // bu bölüm kendiliğinden izin verir.
  const SRC_ROOT = path.resolve(__dirname, "../src");
  const REGIME_GATES: Record<string, { middleware: string; selfGate: string }> = {
    financeEnabled: { middleware: "requireFinanceEnabled", selfGate: "readFinanceEnabled(" },
    productionEnabled: {
      middleware: "requireProductionEnabled",
      selfGate: "readProductionEnabled(",
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
  const SETTING_SERVICE_REL = "services/system-setting.service.ts";

  const importsOf = new Map<string, string[]>();
  for (const [rel, text] of srcText) {
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

  /** Bu rejim kapalıyken hâlâ ULAŞILABİLİR olan `src` dosyaları. */
  const ungatedReach = (regime: string): Set<string> => {
    const gate = REGIME_GATES[regime]!;
    const reached = new Set<string>();
    const queue = routeFiles.filter((r) => !srcText.get(r)!.includes(gate.middleware));
    for (let i = 0; i < queue.length; i++) {
      for (const next of importsOf.get(queue[i]!) ?? []) {
        // ⚠️ system-setting.service ATLANIR: her okuyucunun TANIMI orada yaşıyor;
        // grafikte geçilirse "tüketici" kavramı anlamını yitirir.
        if (next === SETTING_SERVICE_REL || reached.has(next)) continue;
        // ⚠️ Kendi rejim kapısını taşıyan dosya BİR KAPIDIR: içine girilmez.
        // `shipment-auto-draft.helper` tam bu durumda — rejimsiz sevk yolundan
        // çağrılıyor ama ilk ifadesi `readFinanceEnabled()`.
        if (srcText.get(next)!.includes(gate.selfGate)) continue;
        reached.add(next);
        queue.push(next);
      }
    }
    return reached;
  };

  // --- panelin gizlediği bayraklar -------------------------------------------
  // Kategori blokları 4 boşluk girintili `id:`/`regime:`, satırlar 8 boşluk
  // girintili `key:` ile yazılır (bkz. `SETTINGS_CATEGORIES`).
  type PanelCat = { id: string; regime?: string; flagKeys: string[]; rawConsts: string[] };
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
      ? routeFiles.filter((r) => srcText.get(r)!.includes(gate.middleware))
      : [];
    check(
      `rejim '${regime}' backend'de gerçekten bir kapı (≥1 route ${gate?.middleware ?? "?"} taşıyor)`,
      gatedRoutes.length >= 1,
      "kapı yoksa bu rejim hiçbir ayarı gizleyemez — ilgili kategoriden `regime` alanını kaldır",
    );
  }

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
      const consumers = [...srcText.entries()]
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

  console.log(
    `\n   §14 — rejim kapılı kategoriler: ${gatedCats.map((c) => `${c.id}(${c.regime})`).join(", ") || "(yok)"}`,
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
