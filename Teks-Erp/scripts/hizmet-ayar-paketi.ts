// =============================================================================
// HİZMET VEREN AYAR PAKETİ — DALGA2-HIZMET-TASARIM §4 "Gülkesim" sütunu, §7
// =============================================================================
// Profil yalnız modül anahtarlarını taşır (`module-profiles.ts`); ölçüm/faturalama
// DAVRANIŞ ayarları profile GİRMEZ, bu paketle ve BİLEREK uygulanır.
//
// Koşum (DATABASE_URL ortamdan):
//   tsx scripts/hizmet-ayar-paketi.ts                        → KURU KOŞU: listeler, 0 yazım
//   tsx scripts/hizmet-ayar-paketi.ts --apply --kullanici=<ad> → listeler, sonra yazar
// Yazım `systemSettingService.setFeatureFlags` üzerinden (doğrulama + audit + önbellek).
// Kodda henüz olmayan anahtar ATLANIR ve "ANAHTAR YOK (dilim)" diye listelenir —
// H1/H2/H7 indikçe aynı paket kendiliğinden kapsar.
// Pakete GİRMEYENLER (veri, ayar değil): `CariAccount.defaultOfficial` (cari başına),
// etiket müşteri top no (şablon), sayaç sıfırlama (cihaz kaydı), brode yeri (rota).
// Çıkış: 0 tamam · 1 uygulanamadı · 2 kullanım.
// =============================================================================
import { hedefDbAdi } from "./lib/hedef-db-kapisi";

export interface PaketSatiri {
  /** DB anahtarı (`SETTING_KEYS` değeri). */
  anahtar: string;
  /** `FeatureFlags` alan adı (okuma + `setFeatureFlags` girdisi). */
  alan: string;
  hedef: boolean | string | number;
  /** Anahtarı getiren dilim (yokken raporda gösterilir). */
  dilim: string;
}

/** §4 Gülkesim sütunu; "ya da" / "müşteriye göre" seçeneklerinde dar olan seçildi. */
export const HIZMET_AYAR_PAKETI: readonly PaketSatiri[] = [
  { anahtar: "kursun.meterCapture", alan: "kursunMeterCapture", hedef: "OUT", dilim: "H1" },
  { anahtar: "kursun.meterStockMode", alan: "kursunMeterStockMode", hedef: "RECORD", dilim: "H1b" },
  { anahtar: "kursun.meterVarianceThresholdM", alan: "kursunMeterVarianceThresholdM", hedef: 2, dilim: "H2" },
  { anahtar: "kursun.meterVarianceThresholdPct", alan: "kursunMeterVarianceThresholdPct", hedef: 1, dilim: "H2" },
  { anahtar: "kursun.meterVarianceBasis", alan: "kursunMeterVarianceBasis", hedef: "DECLARED_IN", dilim: "H2" },
  { anahtar: "kursun.meterVarianceApproval", alan: "kursunMeterVarianceApproval", hedef: "NONE", dilim: "H2" },
  { anahtar: "kursun.simulatedMeterEnabled", alan: "kursunSimulatedMeterEnabled", hedef: false, dilim: "H1" },
  { anahtar: "tambur.listByStationEnabled", alan: "tamburListByStationEnabled", hedef: true, dilim: "T2" },
  // DALGA4 §3.6 (K4/K5): Gülkesim simüle kesim metresini reddeder; ölçüm kaynağı zorunluluğu
  // tablet OTA'sı (D4-B3 sürümü) tüm cihazlara inince açılır — önce açılırsa eski APK çıkışsız 400 alır.
  { anahtar: "tambur.simulatedMeterEnabled", alan: "tamburSimulatedMeterEnabled", hedef: false, dilim: "D4-B1a" },
  { anahtar: "tambur.olcumKaynagiZorunlu", alan: "tamburMeasureSourceRequired", hedef: false, dilim: "D4-B1a" },
  { anahtar: "finance.serviceBilling.enabled", alan: "financeServiceBillingEnabled", hedef: true, dilim: "H7" },
  { anahtar: "finance.serviceBilling.meterBasis", alan: "financeServiceBillingMeterBasis", hedef: "OUT", dilim: "H7" },
  {
    anahtar: "finance.serviceBilling.missingMeter",
    alan: "financeServiceBillingMissingMeter",
    hedef: "DECLARED_WITH_WARNING",
    dilim: "H7",
  },
  { anahtar: "finance.serviceBilling.trigger", alan: "financeServiceBillingTrigger", hedef: "PER_SHIPMENT", dilim: "H7" },
  { anahtar: "finance.serviceBilling.priceDate", alan: "financeServiceBillingPriceDate", hedef: "SERVICE_DAY", dilim: "H7" },
  { anahtar: "finance.masraf.kategoriOnerisi", alan: "financeExpenseCategorySuggestions", hedef: "ON", dilim: "D4-H1" },
  // DALGA4 §12.1 / K20: cari kilidi — ön seçim iş kabulü + sevk, koyan kişi kendi kilidini açabilir (Gülkesim de aynı).
  { anahtar: "finance.cariHold.defaultScope", alan: "financeCariHoldDefaultScope", hedef: "INTAKE,SHIPMENT", dilim: "D4-I1a" },
  // DALGA4 §12.1: Gülkesim kârlılık kaynakları varsayılanla aynı (açık yazılır ki paket raporunda görünsün).
  { anahtar: "maliyet.karlilik.disFasonKaynagi", alan: "costProfitSubcontractSource", hedef: "FATURA_ONCE", dilim: "D4-G2a" },
  { anahtar: "maliyet.karlilik.sarfFiyatKaynagi", alan: "costProfitConsumablePriceSource", hedef: "ALIS_FIYATI", dilim: "D4-G2a" },
  { anahtar: "finance.cariHold.releaseBySamePerson", alan: "financeCariHoldReleaseBySamePerson", hedef: "ALLOW", dilim: "D4-I1a" },
  // S11: kilitli caride emanet sevki — hapis hakkı seçimi fabrikanın (hukuki teyit); paket bugünkü EXEMPT'i yazar.
  { anahtar: "finance.cariHold.emanetShipment", alan: "financeCariHoldEmanetShipment", hedef: "EXEMPT", dilim: "D4-I1c" },
  // DALGA4 §12.1: risk limiti iş kabulü/sevk kapısı — Gülkesim değeri kullanıcı kararı (S12 para), varsayılan bırakıldı.
  { anahtar: "finance.riskLimitBlock.intake", alan: "financeRiskLimitBlockIntake", hedef: false, dilim: "D4-I2" },
  { anahtar: "finance.riskLimitBlock.shipment", alan: "financeRiskLimitBlockShipment", hedef: false, dilim: "D4-I2" },
  // S12 (kullanıcı kararı 2026-10-31): risk limiti günün kuruyla TL'ye çevrilmiş toplamla ölçülür.
  { anahtar: "finance.riskLimit.currencyMode", alan: "financeRiskLimitCurrencyMode", hedef: "TRY_CONVERTED", dilim: "D4-I2b" },
  // DALGA4 §12.1: tambur en kapısı — Gülkesim de bugünkü değerde başlar (etek payı gerekirse elle).
  { anahtar: "tambur.planGate.widthToleranceCm", alan: "tamburPlanGateWidthToleranceCm", hedef: 10, dilim: "D4-E1" },
  { anahtar: "tambur.planGate.widthCheck", alan: "tamburPlanGateWidthCheck", hedef: "ENFORCE", dilim: "D4-E1" },
  // DALGA4 §12.1 / K26: ister "tüm metraj aşağı yukarı tamamlandığında" sevke hazır = metre eşiği, %2 tolerans.
  { anahtar: "shipping.ready.rule", alan: "shippingReadyRule", hedef: "METER_THRESHOLD", dilim: "D4-J1" },
  { anahtar: "shipping.ready.tolerancePct", alan: "shippingReadyTolerancePct", hedef: 2, dilim: "D4-J1" },
  { anahtar: "scan.customerCodeLookup", alan: "scanCustomerCodeLookupEnabled", hedef: true, dilim: "D4-F1" },
  // DALGA4 §12.1: müşteri barkodu basan şablonda kodsuz top basılmaz (Gülkesim BLOCK = varsayılan; açık beyan).
  { anahtar: "label.customerCodeMissing", alan: "labelCustomerCodeMissing", hedef: "BLOCK", dilim: "D4-F3" },
  // DALGA4 §12.1: dokumasız fabrikada kurşun/tambur/brode makinesi duruşu (ister 5.5).
  { anahtar: "uretim.makineDurusTakibi", alan: "machineStopTrackingEnabled", hedef: true, dilim: "D4-A1" },
  // DALGA4 §2.5/5 (K2): açık duruşta tablet gramaj/metre dokunuşu uyarır (göndermeyi kesmez).
  { anahtar: "uretim.makineDurusAcikUyarisi", alan: "machineStopOpenWarningEnabled", hedef: true, dilim: "D4-A2b" },
];

export type PlanDurumu = "DEGISECEK" | "AYNI" | "ANAHTAR_YOK" | "ALAN_YOK";

export interface PlanSatiri extends PaketSatiri {
  durum: PlanDurumu;
  mevcut: unknown;
}

/**
 * SAF plan: anahtar kodda yoksa ATLA; kodda var ama okuma alanı yoksa ALAN_YOK
 * (paket ile servis ayrışmış — bekçi kırmızı verir, sessizce atlanmaz).
 */
export function paketPlani(
  flags: Readonly<Record<string, unknown>>,
  bilinenAnahtarlar: ReadonlySet<string>,
  paket: readonly PaketSatiri[] = HIZMET_AYAR_PAKETI,
): PlanSatiri[] {
  return paket.map((s) => {
    if (!bilinenAnahtarlar.has(s.anahtar)) return { ...s, durum: "ANAHTAR_YOK", mevcut: undefined };
    if (!Object.prototype.hasOwnProperty.call(flags, s.alan)) return { ...s, durum: "ALAN_YOK", mevcut: undefined };
    const mevcut = flags[s.alan];
    return { ...s, durum: mevcut === s.hedef ? "AYNI" : "DEGISECEK", mevcut };
  });
}

/**
 * Yazar, sonra YENİDEN OKUYUP planı tekrar kurar: `setFeatureFlags` yalnız tanıdığı
 * alanları yazar; yazma dalı unutulmuş alan sessizce yok sayılmasın diye kalan
 * DEGISECEK satırları döndürülür (boş = hepsi tuttu).
 */
export async function paketiYazVeDogrula(
  degisecek: readonly PlanSatiri[],
  userId: string,
  paket: readonly PaketSatiri[] = HIZMET_AYAR_PAKETI,
): Promise<PlanSatiri[]> {
  const { systemSettingService, SETTING_KEYS } = await import("../src/services/system-setting.service");
  type Girdi = Parameters<typeof systemSettingService.setFeatureFlags>[0];
  const girdi: Record<string, unknown> = Object.fromEntries(degisecek.map((p) => [p.alan, p.hedef]));
  await systemSettingService.setFeatureFlags(girdi as Girdi, userId);
  const sonra = await systemSettingService.getFeatureFlags();
  const flags = (sonra.data ?? {}) as unknown as Record<string, unknown>;
  const yazilan = new Set(degisecek.map((p) => p.anahtar));
  return paketPlani(flags, new Set<string>(Object.values(SETTING_KEYS)), paket).filter(
    (p) => yazilan.has(p.anahtar) && p.durum !== "AYNI",
  );
}

function goster(v: unknown): string {
  return v === undefined ? "—" : JSON.stringify(v);
}

async function main(): Promise<number> {
  const arg = process.argv.slice(2);
  const uygula = arg.includes("--apply");
  const kullanici = arg.find((a) => a.startsWith("--kullanici="))?.slice("--kullanici=".length);
  const bilinmeyen = arg.filter((a) => a !== "--apply" && !a.startsWith("--kullanici="));
  if (bilinmeyen.length > 0 || (uygula && !kullanici)) {
    console.error("❌ kullanım: tsx scripts/hizmet-ayar-paketi.ts [--apply --kullanici=<kullanıcı adı>]");
    return 2;
  }
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL ortamda yok.");
    return 2;
  }
  const { default: prisma } = await import("../src/lib/prisma");
  const { systemSettingService, SETTING_KEYS } = await import("../src/services/system-setting.service");
  try {
    const okunan = await systemSettingService.getFeatureFlags();
    const flags = (okunan.data ?? {}) as unknown as Record<string, unknown>;
    const plan = paketPlani(flags, new Set<string>(Object.values(SETTING_KEYS)));
    console.log(`=== Hizmet veren ayar paketi — ${uygula ? "UYGULAMA" : "KURU KOŞU"} ===`);
    console.log(`🎯 Hedef veritabanı: ${hedefDbAdi()}`);
    for (const p of plan) {
      const ek = p.durum === "ANAHTAR_YOK" ? ` (anahtar ${p.dilim} ile gelir)` : "";
      console.log(`  ${p.durum.padEnd(11)} ${p.anahtar}: ${goster(p.mevcut)} → ${goster(p.hedef)}${ek}`);
    }
    const alanYok = plan.filter((p) => p.durum === "ALAN_YOK");
    if (alanYok.length > 0) {
      console.error(`❌ paket ↔ servis ayrışmış (alan yok): ${alanYok.map((p) => p.alan).join(", ")}`);
      return 1;
    }
    const degisecek = plan.filter((p) => p.durum === "DEGISECEK");
    // §4: PER_SHIPMENT mevcut çift kapının altında çalışır; o bayrak pakete bilerek alınmadı.
    const tetik = HIZMET_AYAR_PAKETI.find((p) => p.alan === "financeServiceBillingTrigger");
    if (tetik?.hedef === "PER_SHIPMENT" && flags.financeAutoDraftFromShipmentEnabled !== true) {
      console.log("⚠️  PER_SHIPMENT için otomatik taslak bayrağı (finance.autoDraftFromShipmentEnabled) kapalı — sevkte taslak doğmaz; gerekiyorsa ayarlardan ayrıca açın.");
    }
    if (!uygula) {
      console.log(`KURU KOŞU — ${degisecek.length} ayar değişecekti; yazılan 0. Uygulamak için --apply --kullanici=<ad>.`);
      return 0;
    }
    if (degisecek.length === 0) {
      console.log("Yazılacak ayar yok; yazılan 0.");
      return 0;
    }
    const user = await prisma.user.findUnique({ where: { username: kullanici }, select: { id: true } });
    if (!user) {
      console.error(`❌ kullanıcı bulunamadı: ${kullanici}`);
      return 1;
    }
    const kalan = await paketiYazVeDogrula(degisecek, user.id);
    if (kalan.length > 0) {
      console.error(`❌ yazım tutmadı (yeniden okumada farklı): ${kalan.map((p) => p.anahtar).join(", ")}`);
      return 1;
    }
    console.log(`✅ ${degisecek.length} ayar yazıldı ve yeniden okumayla doğrulandı.`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().then(
    (k) => {
      process.exitCode = k;
    },
    (e) => {
      console.error(`❌ paket uygulanamadı: ${(e as Error).message}`);
      process.exitCode = 1;
    },
  );
}
