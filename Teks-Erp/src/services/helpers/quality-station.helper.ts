// =============================================================================
// TeksERP — İstasyon yetenek İKİZLERİ (2026-09-03 kalite ikizi; 2026-10-24 KQ-D1)
// =============================================================================
// AKIŞ İKİZİ: "Bu ADIM ara-istasyon kart akışında mı yürür (kart → top başına
// tamamla → adımı kapat)? Kurşun kuyruğu / dağıtım adayı mı?" Bu ikiz eskiden
// "kalite" adını taşıyordu ama cevapladığı soru AKIŞTIR (KQ planı T1); ad
// soruya göre düzeltildi, gövde BAYT-EŞİT kaldı.
//
// BOĞAZ TEK DEĞİL İKİZ — çünkü karar noktaları İKİ FARKLI ŞEKİLDE:
//
//   (a) BELLEK-İÇİ kontrol → `stepRunsStepFlow(station)`
//   (b) PRİSMA WHERE parçası → `station: { ...STEP_FLOW_WHERE }`
//
// Saf boolean yüklem (b) noktalarında KULLANILAMAZ: sorgu DB'de koşuyor.
// Özellikle `kursun-qc.setQueueUrgent` F167 atomik claim'inin WHERE'i —
// "önce oku, sonra yüklemle kontrol et, sonra update" biçimine çevrilirse
// check-then-act yarışı geri gelir ve tamamlanmış adıma acil rozeti yazılır.
//
// ⚠️ İKİSİ AYNI KURALI SÖYLER VE BİRLİKTE DEĞİŞİR. Biri yeteneğe, diğeri türe
// bakarsa liste ile kabul koşulu ayrışır (emsal: kursun-bypass'ta makine
// listesi ↔ atama kabulü çifti; ayrışınca listede görünen makine seçilince 400
// alınır ve dağıtımcı sebebi anlayamaz).
//
// ÜÇÜNCÜ ŞEKİL BİLİNÇLİ OLARAK DIŞARIDA: `expectedKind` ARGÜMANI alan jenerik
// yardımcılar. `roll-step.helper.assertWoAtStepKind` TAMBUR ile PAYLAŞILIYOR
// (tambur.service kart okutma) — imzasını yetenekleştirmek Tambur kart-okutma
// yolunu da değiştirirdi. Kurşun kart okutması onu artık ÇAĞIRMAZ: adım oturum
// istasyonundan `station-step-resolve.helper` ile çözülür (KQ-D2).
//
// ⚠️ WHERE parçaları `as const` DEĞİL `satisfies` ile yazılır:
// readonly literal tip `OR:` konumunda Prisma'nın mutable input tipine oturmaz
// ve her çağrı yerinde cast ister (`fason-open-dispatch.helper.ts:30-31` dersi).
// ⚠️ Nesne MUTATE EDİLMEZ — her zaman spread ile kopyalanır (paylaşılan nesne).
// ⚠️ `station: { OR: [...], ...STEP_FLOW_WHERE }` yazılırsa biri SESSİZCE
// kaybolur (aynı anahtar) — spread'e ek `OR` koşulu eklenmez, gerekiyorsa
// `AND: [{ ...STEP_FLOW_WHERE }, { OR: [...] }]` yazılır.
//
// NEDEN AYRI DOSYA: `step-capability.helper.ts` saf TS'tir, Prisma tipi
// import etmez — `Prisma.StationWhereInput` oraya girerse dosyanın karakteri
// bozulur. Emsal: `fason-open-dispatch.helper.ts` (o da ayrı dosya).
//
// KALİTE İKİZİ (KQ-D1): "Bu istasyonda muayene (hata kaydı) açılır mı?" —
// yalnız `Station.inspectionEnabled` okur; akış ikizinden AYRI çünkü Tambur
// muayene yapar ama kart akışına girmez (girerse kurşun dağıtımına düşer).
//
// Bekçi: `scripts/test_station_quality_capability.ts`
// =============================================================================

import { Prisma, StationKind, StationPropertyMode } from "@prisma/client";

/**
 * Yüklemin okuduğu alanlar. Şekil BİLEREK dar (`step-capability.helper.ts`
 * 24-27 notunun aynı gerekçesi): yalnız kaliteyi soran çağıran renk/özellik
 * alanlarını taşımaz.
 */
export interface StepFlowCaps {
  /**
   * ⚠️ FAZ A KÖPRÜSÜ — Faz B'de DÜŞER (aşağıdaki yüklem notu).
   */
  kind: StationKind;
  appliesQuality: boolean;
}

/**
 * Prisma `select` sözleşmesi — çağıranlar bunu spread etsin, alan atlamasın.
 *
 * ⚠️ `STEP_CAPABILITY_SELECT` GENİŞLETİLMEDİ: o dosyanın kendi notu (24-27)
 * "yalnız appliesColor okuyan çağıranı appliesProperty seçmeye zorlama" diyor;
 * kaliteyi oraya eklemek aynı kuralı üçüncü kez ihlal ederdi.
 */
export const STEP_FLOW_SELECT = { kind: true, appliesQuality: true } as const;

/**
 * Bu ADIM ara-istasyon kart akışında (Kurşun + KK2 ekranı) yürür mü?
 *
 * ⚠️ FAZ A KÖPRÜSÜ: `kind === PROCESS_QC` dalı BİLEREK duruyor. Migration
 * backfill'i mevcut satırları doldurur, AMA:
 *   • seed taze kurulumda migration'dan SONRA, tablo boşken koştuğu için o
 *     satır kolon varsayılanıyla doğardı (seed.ts:316-322 notu — `appliesColor`
 *     2026-08-10'da tam bu tuzağa düşmüştü; seed'e açık `appliesQuality: true`
 *     yazıldı, dal onun İKİNCİ sigortasıdır),
 *   • elle SQL / eski dump / migrationsız kopya ile açılmış istasyonlar,
 *   • bekçi fixture'ları (`kind: 'PROCESS_QC'` ile istasyon yaratır, kolon
 *     varsayılanı false).
 * Faz B'de kaldırılmadan ÖNCE seed + prod ölçümü yapılır.
 *
 * ⚠️ TEK ARGÜMANLI — `stepCanApplyColor`ın ikinci `requiredCategory`
 * argümanının kalitede karşılığı YOKTUR: `SubcontractorCategory`de
 * `appliesQuality` kolonu yok, çünkü fason firma kalite notu yazmaz.
 */
export function stepRunsStepFlow(station: StepFlowCaps | null | undefined): boolean {
  if (!station) return false;
  return station.kind === StationKind.PROCESS_QC || station.appliesQuality;
}

/**
 * Yüklemin İKİZİ — "kart akışı yürüten istasyon" PRİSMA WHERE parçası.
 * Kullanım: `station: { ...STEP_FLOW_WHERE }`
 */
export const STEP_FLOW_WHERE = {
  OR: [{ kind: StationKind.PROCESS_QC }, { appliesQuality: true }],
} satisfies Prisma.StationWhereInput;

/**
 * Kart akışı yürütmeyen adım için TEK hata metni.
 *
 * ⚠️ Metin yüklemden AYRIŞMAMALI: yüklem yeteneğe bakıp mesaj türü söylerse
 * (eski metinler "PROCESS_QC tipinde değil" diyordu) operatör, yeteneği kapalı
 * ama türü tam olarak PROCESS_QC olan bir istasyonda yanlış teşhis okur.
 */
export const STEP_FLOW_ERROR =
  "Bu adım ara-istasyon kart akışında yürümüyor (Kurşun + KK2 ekranı).";

// ─────────────────────────────────────────────────────────────────────────────
// KALİTE İKİZİ — muayene yeteneği (KQ-D1, 2026-10-24)
// ─────────────────────────────────────────────────────────────────────────────

/** Kalite yükleminin okuduğu TEK alan — tür ve akış bayrağı BİLEREK yok. */
export interface QualityCaps {
  inspectionEnabled: boolean;
}

/** Kalite ikizinin `select` sözleşmesi — akış select'iyle karıştırılmaz. */
export const STEP_QUALITY_SELECT = { inspectionEnabled: true } as const;

/**
 * Bu istasyonda kalite muayenesi (hata girişi) açılır mı?
 * ⚠️ Gövde `kind`/`appliesQuality` OKUMAZ (bekçi §9): tür dalı eklemek akış
 * sorusunu geri getirir ve yöneticinin kapattığı muayeneyi sessizce açar.
 */
export function stepCanApplyQuality(station: QualityCaps | null | undefined): boolean {
  return !!station && station.inspectionEnabled === true;
}

/** Kalite yükleminin İKİZİ. Kullanım: `station: { ...QUALITY_STATION_WHERE }` */
export const QUALITY_STATION_WHERE = {
  inspectionEnabled: true,
} satisfies Prisma.StationWhereInput;

/** Muayenesi kapalı istasyonda hata yazma/silme için TEK metin. */
export const QUALITY_STEP_ERROR = "Bu istasyonda kalite muayenesi (hata girişi) kapalı.";

/** K4P'nin adı — AYNI fonksiyon nesnesi (bekçi §10); ince sarmalayıcı açılmaz. */
export const stationCanInspect = stepCanApplyQuality;

/**
 * Doğuşta muayene varsayılanı: migration'ın türettiği kümeyle AYNI (bekçi §7
 * SQL ↔ bu tablo). Eski panel alanı göndermezse `station.service` create bunu
 * kullanır; seed ve içe aktarım da buradan okur.
 */
export const INSPECTION_DEFAULT_KINDS = [StationKind.PROCESS_QC, StationKind.TAMBUR] as const;

export function inspectionDefaultForKind(kind: StationKind | null | undefined): boolean {
  return !!kind && (INSPECTION_DEFAULT_KINDS as readonly StationKind[]).includes(kind);
}

// ─────────────────────────────────────────────────────────────────────────────
// KARAR İKİZİ — "Açık hataya CUT/NO_CUT kararını bu adım verir mi?" (KQ-D8, K7)
// ─────────────────────────────────────────────────────────────────────────────
// Bugün yalnız Tambur karar rehberi taşır; tür okuması bu ikizde BİLEREK serbest
// (bekçi §4 muafı helper içi). Karar veren ikinci bir yetenek doğarsa İKİSİ birlikte değişir.

export function stepDecidesDefects(s: { kind: StationKind } | null | undefined): boolean {
  return s?.kind === StationKind.TAMBUR;
}

/** Karar yükleminin İKİZİ. Kullanım: `station: { ...DEFECT_DECISION_STATION_WHERE }` */
export const DEFECT_DECISION_STATION_WHERE = {
  kind: StationKind.TAMBUR,
} satisfies Prisma.StationWhereInput;

export interface DecisionGapStep {
  name: string;
  kind: StationKind;
  inspectionEnabled: boolean;
  /** Atlanmış (SKIPPED) adım ne hata üretir ne karar verir. */
  skipped?: boolean;
}

/**
 * Rota sırasıyla verilen adımlarda: muayenesi açık, kendisi karar vermeyen ve
 * ARDINDAN atlanmamış karar adımı gelmeyen kalite adımlarının adları. Boş = boşluk yok.
 */
export function findDefectDecisionGap(steps: readonly DecisionGapStep[]): string[] {
  const gaps: string[] = [];
  steps.forEach((s, i) => {
    if (s.skipped || !stepCanApplyQuality(s) || stepDecidesDefects(s)) return;
    const decided = steps.slice(i + 1).some((n) => !n.skipped && stepDecidesDefects(n));
    if (!decided) gaps.push(s.name);
  });
  return gaps;
}

/** Tambursuz rota uyarısı — rota şablonu ve iş emri yanıtında AYNI metin. */
export function defectDecisionWarning(gapNames: readonly string[]): string | null {
  if (gapNames.length === 0) return null;
  return (
    `Kalite adımından (${gapNames.join(", ")}) sonra hata kararı veren adım (Tambur) yok — ` +
    "hatalar bilgi olarak etikete/sevk belgesine taşınır."
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLET SÜRÜM UYARISI — varsayılan dışı muayene düzeni (KQ-D8, plan §3.9)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Muayenesi kapalı Ara istasyon / Tambur düzenini çizen ilk APK. Ölçüm: KQ-D3
 * (0885fc976) tablet 1.4.2 (vc64, c1f840581) yayınından SONRA indi → 1.4.3.
 */
export const INSPECTION_LAYOUT_MIN_TABLET = "1.4.3";

/** Varsayılanı muayene AÇIK olan türde kutu kapatılırsa eski APK hata panelini çizer ve 400 alır. */
export function stationLayoutWarning(st: { kind?: unknown; inspectionEnabled?: unknown } | null | undefined): string | null {
  if (!st || typeof st.kind !== "string") return null;
  if (!inspectionDefaultForKind(st.kind as StationKind) || st.inspectionEnabled !== false) return null;
  return `Bu düzen tablet ≥ ${INSPECTION_LAYOUT_MIN_TABLET} ister — eski tablet hata panelini gösterir ama kayıt reddedilir.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// KURŞUN DAĞITIM HEDEFİ — üçüncü yüklem DEĞİL: akış ikizi ∧ KURSUN AUTO
// ─────────────────────────────────────────────────────────────────────────────

/** Kurşun özelliğinin kodu — `code === "KURSUN"` literali tek sabite iner. */
export const KURSUN_PROPERTY_CODE = "KURSUN";

/**
 * `listDistribution` makine listesi ve `assign` kabulü bu TEK parçadan beslenir
 * (liste = kabul). Tambur akışa girmediği için muayenesi açık olsa da düşmez.
 */
export const KURSUN_DISPATCH_STATION_WHERE = {
  AND: [
    { ...STEP_FLOW_WHERE },
    {
      propertyCapabilities: {
        some: { mode: StationPropertyMode.AUTO, property: { code: KURSUN_PROPERTY_CODE } },
      },
    },
  ],
} satisfies Prisma.StationWhereInput;
