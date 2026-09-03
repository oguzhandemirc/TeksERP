// =============================================================================
// TeksERP — "Bu ADIM kalite kontrol yürütür mü?" — İKİZ BOĞAZ (2026-09-03)
// =============================================================================
// Bu soruya eskiden `step.station.kind === StationKind.PROCESS_QC` diye cevap
// veriliyordu ve literal 19 karar noktasına ELLE kopyalanmıştı. Yani "kalite"
// bir YETENEK değil bir TÜR ADIydı: ikinci bir KK istasyonu tanımlamak
// imkânsızdı ve tek bir kopyanın atlanması sessiz bir davranış farkı üretirdi.
//
// BOĞAZ TEK DEĞİL İKİZ — çünkü karar noktaları İKİ FARKLI ŞEKİLDE:
//
//   (a) BELLEK-İÇİ kontrol (7 nokta) → `stepCanApplyQuality(station)`
//   (b) PRİSMA WHERE parçası (12 nokta) → `station: { ...QUALITY_STATION_WHERE }`
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
// (tambur.service:451, :3705) — imzasını yetenekleştirmek Tambur kart-okutma
// yolunu da değiştirirdi, yani Faz A'nın "davranış birebir" iddiasını kırardı.
// Tek PROCESS_QC çağrısı (kursun-qc:245) Faz B'ye bırakıldı, bekçide GEREKÇELİ
// MUAF olarak durur.
//
// ⚠️ `QUALITY_STATION_WHERE` `as const` DEĞİL `satisfies` ile yazılır:
// readonly literal tip `OR:` konumunda Prisma'nın mutable input tipine oturmaz
// ve her çağrı yerinde cast ister (`fason-open-dispatch.helper.ts:30-31` dersi).
// ⚠️ Nesne MUTATE EDİLMEZ — her zaman spread ile kopyalanır (paylaşılan nesne).
// ⚠️ `station: { OR: [...], ...QUALITY_STATION_WHERE }` yazılırsa biri SESSİZCE
// kaybolur (aynı anahtar) — spread'e ek `OR` koşulu eklenmez, gerekiyorsa
// `AND: [{ ...QUALITY_STATION_WHERE }, { OR: [...] }]` yazılır.
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
export interface QualityCaps {
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
export const STEP_QUALITY_SELECT = { kind: true, appliesQuality: true } as const;

/**
 * Bu ADIM kalite kontrol (KK/muayene) süreci yürütür mü?
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
export function stepCanApplyQuality(station: QualityCaps | null | undefined): boolean {
  if (!station) return false;
  return station.kind === StationKind.PROCESS_QC || station.appliesQuality;
}

/**
 * Yüklemin İKİZİ — "kalite yürüten istasyon" PRİSMA WHERE parçası.
 * Kullanım: `station: { ...QUALITY_STATION_WHERE }`
 */
export const QUALITY_STATION_WHERE = {
  OR: [{ kind: StationKind.PROCESS_QC }, { appliesQuality: true }],
} satisfies Prisma.StationWhereInput;

/**
 * Kalite yürütmeyen adım için TEK hata metni.
 *
 * ⚠️ Metin yüklemden AYRIŞMAMALI: yüklem yeteneğe bakıp mesaj türü söylerse
 * (eski metinler "PROCESS_QC tipinde değil" diyordu) operatör, yeteneği kapalı
 * ama türü tam olarak PROCESS_QC olan bir istasyonda yanlış teşhis okur.
 */
export const QUALITY_STEP_ERROR =
  "Bu adım kalite kontrol yürütmüyor (Kurşun + KK2 yeteneği yok).";
