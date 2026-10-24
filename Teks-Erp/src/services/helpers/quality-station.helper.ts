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
// yolunu da değiştirirdi. Tek PROCESS_QC çağrısı (kursun-qc getByCardBarcode)
// Faz B'ye bırakıldı, bekçide GEREKÇELİ MUAF olarak durur.
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
// Bekçi: `scripts/test_station_quality_capability.ts`
// =============================================================================

import { Prisma, StationKind } from "@prisma/client";

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
