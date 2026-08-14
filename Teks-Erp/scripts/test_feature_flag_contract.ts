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
import {
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

  console.log(
    `\n   A(api)=${A.length} (boolean ${aBool.length}) · B(şema)=${B.length} · ` +
      `C(servis)=${C.length} · D(panel)=${D.length}\n`,
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
