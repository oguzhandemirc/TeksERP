// =============================================================================
// SNAPSHOT KOLONLARI — ÜÇÜNCÜ SINIFIN BEYANI + ŞEMADAN ADAY TÜRETME + YAZICI TARAMASI
// =============================================================================
// `docs/kurallar/defter.md` "ÜÇÜNCÜ SINIF — SNAPSHOT": durum/belge tablosunda OLAY
// ANI değerini taşıyan kolon ne DURUM BAYRAĞI ne DAMGADIR; iki alt türü var:
//   (a) GERİ ALMA GİRDİSİ — ileri yol yazar, geri alma OKUYUP null'lar; başka
//       hiçbir yol dokunmaz. "Tüketilince null, tüketilmeden null değil."
//   (b) DONMUŞ İLERİ DEĞER — ileri kaydın parçasıdır; geri alma onu KÜÇÜLTMEZ,
//       silmez, defter satırsız büyütmez. Tek yazıcı ileri yoldur.
//
// NEDEN ŞEMADAN TÜREYEN KAPI: elle liste, şemaya eklenen yeni snapshot kolonunu
// sormaz (`test_master_data_merge_fk_coverage` dersi — FK'yı şemadan sayan kapı
// P1'in boşluğunu gördü, elle liste görmezdi). Aday = şerhinde snapshot imzası
// taşıyan skaler alan; kapı "aday ⊆ beyan" VE "beyan ⊆ şema" sorar. Beyansız
// gelen yeni snapshot kolonu KIRMIZI, şemadan düşmüş beyan KIRMIZI.
//
// ⚠️ 82'nin `defter-beyan.ts`inden AYRI dosya: o defter OLAYLARININ ters
// mekanizmasını beyan eder, bu durum tablosu KOLONLARININ sınıfını. İki soru,
// iki beyan.
//
// YAZICI TARAMASI tip denetleyicisiz AST'dir (hızlı, DB'siz): `data:` altındaki
// `alan:` atamasını en yakın `<x>.<delegate>.<update|create|…>(…)` çağrısına
// bağlar; `where`/`select`/DTO eşlemesi yazım SAYILMAZ. Sınır beyanı: iç içe
// ilişki yazımı (`roll: { update: { data: { … } } }`) delegate'i çözülemez ve
// AYRI listede ("çözülemeyen") döner — kapı onu sessizce yutmaz.
// =============================================================================
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";
import { walkTs } from "./ts-tarama";

export type SnapshotSinif = "GERI_ALMA_GIRDISI" | "DONMUS_ILERI" | "MUAF";

/**
 * MUAF gerekçesi KAPALI kümedir — serbest metin muafiyet listesi zamanla büyür ve
 * kapı muaf listesiyle dolup ölür (12. ölüm biçimi). Yeni gerekçe türü bir KARARDIR.
 *   BELGE_DEFTERI  → JSON, satırın KENDİSİ append-only belge defteri (`PrintedDocument`)
 *   ONBELLEK       → denormalize önbellek, canlıdan tazelenir, geri alma girdisi değil
 *   KARAR_SATIRI   → append-only karar satırının sorgulanmayan kanıt yükü
 */
export type MuafGerekce = "BELGE_DEFTERI" | "ONBELLEK" | "KARAR_SATIRI" | "DEFTER_SATIRI" | "SERH_ATFI";

export interface SnapshotBeyan {
  model: string;
  alan: string;
  sinif: SnapshotSinif;
  /**
   * Kolonu yazan dosyalar (backend köküne göreli, dosya düzeyi — satır numarası
   * çalkantısına dayanıklı). AST ile ÖLÇÜLÜR ve iki yönlü EŞİT olmalı: beyansız yeni
   * yazıcı (ör. bir geri alma yolu) KIRMIZI, şemadan/koddan düşmüş yazıcı KIRMIZI.
   * (a)'da null DIŞI yazanlar; (b)'de her yazan. MUAF'ta ölçülmez.
   */
  yazan: readonly string[];
  /** (a) için: kolonu `null`'a çeken (tüketen) dosyalar. Ölçülür, eşit olmalı. */
  tuketen?: readonly string[];
  /** Aday olarak TÜREMEYEN kolon (şerhin ilk cümlesinde imza yok) beyana elle girer; neden. */
  adayDegil?: string;
  /** MUAF sınıfı için zorunlu. */
  muaf?: { gerekce: MuafGerekce; neden: string };
  /**
   * DB ayağı — `test_consistency_derived` §27 (a) / §28 (b) olarak koşar; drift 0 olmalı.
   * Kolonlar: `kayit` (id) · `barkod` · `sapma` (metin). Tek kaynak BURASI; SQL ikizi dosyasında YOK.
   */
  sql?: { id: string; baslik: string; sql: string }[];
  /** (a) kolonunun DB ayağı kardeş kolonun `sql`inde ölçülüyorsa: o kolon. */
  ayakOrtak?: string;
  /** Ayrı bir bekçide zaten ölçülen ayak — dosya ve bölüm; kapı bölümün VARLIĞINI ölçer. */
  bekci?: { dosya: string; bolum: string; ne: string }[];
  neden: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// BEYAN — yazıcı kümeleri 2026-09-13'te AST ile ölçüldü (`test_snapshot_kolonlari` her koşumda yeniden ölçer)
// ─────────────────────────────────────────────────────────────────────────────
/** Şema şerhinde kolonu "olay anı kopyası" ilan eden imza — bkz. `serhSnapshotMu`. */
export const SNAPSHOT_SERH_IMZASI = /(?<![\p{L}\p{N}_])(snapshot|anındaki|anindaki|donar|donmuş|donmus)(?![\p{L}\p{N}_])/iu;

const KOK = join(__dirname, "..", "..");
const SEMA_YOLU = join(KOK, "prisma", "schema.prisma");

const SVC = "src/services/";

/**
 * (a) kolonunun "tüketilmeden null DEĞİL" yönü için yürürlük eşiği — kolonun migration'ından
 * SONRAKİ fabrika gününün başı (kapı kesin oradaydı diyebildiğimiz ilk an; `PLAN_GATE_SINCE`
 * emsali). Eşik REPO tarihidir; saha daha geç aldıysa `SNAPSHOT_SINCE` ile hepsi ileri alınır.
 * Fabrika kopyasında ölçüldü 2026-09-13: eşik öncesi null'lar 1 (preShip, 07-20) · 215
 * (preCancel, cancelledAt yok) · 10 (preTambur, ≤ 08-08); eşik sonrası 0/0/0.
 */
function esik(varsayilan: string): string {
  const ham = process.env.SNAPSHOT_SINCE ?? varsayilan;
  return `'${new Date(ham).toISOString()}'::timestamptz`;
}
const PRE_SHIP_ESIK = esik("2026-08-06T00:00:00+03:00"); // 20260805100000_shipment_undo_and_return_group
const PRE_CANCEL_ESIK = esik("2026-08-06T00:00:00+03:00"); // 20260805170000_roll_label_printed_and_cancel_trace
const PRE_TAMBUR_ESIK = esik("2026-08-10T00:00:00+03:00"); // 20260809020429_roll_pre_tambur_close

export const SNAPSHOT_KOLONLARI: readonly SnapshotBeyan[] = [
  // ── (a) GERİ ALMA GİRDİSİ ────────────────────────────────────────────────
  {
    model: "Roll",
    alan: "preShipStatus",
    sinif: "GERI_ALMA_GIRDISI",
    adayDegil: "imza şerhin ilk cümlesinde değil ('SEVK ÖNCESİ statü — …'); emsal atfı sonraki cümlede",
    yazan: [SVC + "shipping.service.ts"],
    tuketen: [SVC + "shipping.service.ts"],
    neden: "sevkte YAZILIR (raf), sevk geri almada OKUNUP null'lanır; iade yolu dokunmaz (RollReturn kendi snapshot'ını taşır)",
    sql: [
      {
        id: "27a",
        baslik: "preShipStatus TÜKETİLMEDEN kalmış — top SHIPPED değil, iade satırı yok, snapshot dolu",
        sql: `
SELECT r.id::text AS kayit, r.barcode AS barkod, (r.status::text || ' / preShip=' || r."preShipStatus"::text) AS sapma
FROM rolls r
WHERE r."preShipStatus" IS NOT NULL
  AND r.status <> 'SHIPPED'
  AND NOT EXISTS (SELECT 1 FROM roll_returns rr WHERE rr."rollId" = r.id)`,
      },
      {
        id: "27e",
        baslik: "preShipStatus TÜKETİLMEDEN NULL — eşik sonrası sevk edilmiş top girdi taşımıyor",
        sql: `
SELECT r.id::text AS kayit, r.barcode AS barkod, ('sevk ' || s."dispatchedAt"::text) AS sapma
FROM rolls r JOIN shipments s ON s.id = r."shipmentId"
WHERE r.status = 'SHIPPED' AND r."preShipStatus" IS NULL AND s."dispatchedAt" >= ${PRE_SHIP_ESIK}`,
      },
    ],
  },
  {
    model: "Roll",
    alan: "preCancelStatus",
    sinif: "GERI_ALMA_GIRDISI",
    adayDegil: "şerhi imza taşımıyor ('İptalden önceki raf' — emsal atfı)",
    yazan: [SVC + "helpers/roll-disposition.helper.ts", SVC + "inventory.service.ts", SVC + "stock-count.service.ts"],
    tuketen: [SVC + "inventory.service.ts", SVC + "stock-count-reversal.service.ts"],
    neden: "iptalde YAZILIR (raf), iptali geri almada / sayım stornosunda OKUNUP null'lanır",
    sql: [
      {
        id: "27b",
        baslik: "preCancelStatus TÜKETİLMEDEN kalmış — top CANCELLED değil ama snapshot dolu",
        sql: `
SELECT r.id::text AS kayit, r.barcode AS barkod, (r.status::text || ' / preCancel=' || r."preCancelStatus"::text) AS sapma
FROM rolls r
WHERE r."preCancelStatus" IS NOT NULL AND r.status <> 'CANCELLED'`,
      },
      {
        id: "27f",
        baslik: "preCancelStatus TÜKETİLMEDEN NULL — eşik sonrası iptal edilmiş top girdi taşımıyor",
        sql: `
SELECT r.id::text AS kayit, r.barcode AS barkod, ('iptal ' || r."cancelledAt"::text) AS sapma
FROM rolls r
WHERE r.status = 'CANCELLED' AND r."preCancelStatus" IS NULL AND r."cancelledAt" >= ${PRE_CANCEL_ESIK}`,
      },
    ],
  },
  {
    model: "Roll",
    alan: "preTamburCloseQty",
    sinif: "GERI_ALMA_GIRDISI",
    yazan: [SVC + "tambur.service.ts"],
    tuketen: [SVC + "tambur-undo.service.ts"],
    neden: "kapanışta (parent TAMBUR_CONSUMED) YAZILIR, FULL/SINGLE_RESTORE geri almada OKUNUP null'lanır",
    sql: [
      {
        id: "27c",
        baslik: "preTamburClose* TÜKETİLMEDEN kalmış — parent TAMBUR_CONSUMED değil ama snapshot dolu",
        sql: `
SELECT r.id::text AS kayit, r.barcode AS barkod,
       (r.status::text || ' / qty=' || COALESCE(r."preTamburCloseQty"::text, '∅') || ' status=' || COALESCE(r."preTamburCloseStatus"::text, '∅')) AS sapma
FROM rolls r
WHERE (r."preTamburCloseQty" IS NOT NULL OR r."preTamburCloseStatus" IS NOT NULL)
  AND r.status <> 'TAMBUR_CONSUMED'`,
      },
      {
        id: "27d",
        baslik: "preTamburCloseStatus var ama preTamburCloseQty yok (dört yazıcının hepsi qty yazar)",
        sql: `
SELECT r.id::text AS kayit, r.barcode AS barkod, r."preTamburCloseStatus"::text AS sapma
FROM rolls r
WHERE r."preTamburCloseStatus" IS NOT NULL AND r."preTamburCloseQty" IS NULL`,
      },
      {
        id: "27g",
        baslik: "preTamburCloseQty TÜKETİLMEDEN NULL — eşik sonrası kapanmış parent girdi taşımıyor",
        sql: `
SELECT r.id::text AS kayit, r.barcode AS barkod, ('kapanış ' || r."statusChangedAt"::text) AS sapma
FROM rolls r
WHERE r.status = 'TAMBUR_CONSUMED' AND r."preTamburCloseQty" IS NULL AND r."statusChangedAt" >= ${PRE_TAMBUR_ESIK}`,
      },
    ],
  },
  {
    model: "Roll",
    alan: "preTamburCloseStatus",
    sinif: "GERI_ALMA_GIRDISI",
    yazan: [SVC + "tambur.service.ts"],
    tuketen: [SVC + "tambur-undo.service.ts"],
    ayakOrtak: "Roll.preTamburCloseQty",
    neden: "yalnız depo kesimi kapanışında YAZILIR (üretim akışında kapanış öncesi hep IN_PRODUCTION), geri almada null'lanır",
  },

  // ── (b) DONMUŞ İLERİ DEĞER ───────────────────────────────────────────────
  {
    model: "Roll",
    alan: "initialQty",
    sinif: "DONMUS_ILERI",
    adayDegil: "şerhi 'Initial measurement' — imza taşımıyor; kural top-duzeltme.md metraj satırında yaşar",
    yazan: [SVC + "inventory.service.ts", SVC + "subcontractor.service.ts", SVC + "tambur-undo.service.ts", SVC + "tambur.service.ts"],
    neden: "üretim anı giriş metrajı; yalnız AŞIM yönünde ve sapma defteri satırı eşliğinde büyür (tambur-undo restoreBumpTx tek kaynak)",
    bekci: [
      { dosya: "test_consistency.ts", bolum: "33", ne: "initialQty = giriş metrajı + Σ canlı TAMBUR aşımı" },
      { dosya: "test_stock_ledger_tambur_undo.ts", bolum: "12", ne: "depo kesimi geri alınınca initialQty 100→100, aşımda bump + OVERAGE" },
    ],
  },
  {
    model: "Roll",
    alan: "qualityGrade",
    sinif: "DONMUS_ILERI",
    yazan: [
      SVC + "helpers/roll-disposition.helper.ts",
      SVC + "inventory.service.ts",
      SVC + "return.service.ts",
      SVC + "subcontractor.service.ts",
      SVC + "tambur.service.ts",
      SVC + "workorder-manual-move.service.ts",
    ],
    neden: "kalite kararı anındaki katalog KODU; `qualityGradeId` canonical'ın yanında donmuş etiket — katalog yeniden adlandırılsa eski top bozulmaz; iade iptali prevQualityGrade'den geri koyar",
    sql: [
      {
        id: "28a",
        baslik: "qualityGradeId var ama donmuş kod (qualityGrade) SİLİNMİŞ",
        sql: `
SELECT r.id::text AS kayit, r.barcode AS barkod, r."qualityGradeId"::text AS sapma
FROM rolls r
WHERE r."qualityGradeId" IS NOT NULL AND r."qualityGrade" IS NULL`,
      },
    ],
  },
  {
    model: "Roll",
    alan: "entryStationId",
    sinif: "DONMUS_ILERI",
    adayDegil: "imza ('donmuş belge mantığının aynısı') ilk cümlede değil",
    yazan: [SVC + "inventory.service.ts", SVC + "subcontractor.service.ts", SVC + "tambur.service.ts"],
    neden: "giriş anında damgalanır, makine sonradan taşınsa da değişmez; hiçbir ters yol dokunmaz",
  },
  {
    model: "RollReturn",
    alan: "itemId",
    sinif: "DONMUS_ILERI",
    yazan: [SVC + "return.service.ts"],
    neden: "iade anındaki ürün — top sonradan kesilse/yeniden etiketlense rapor sağlam kalır",
  },
  {
    model: "RollReturn",
    alan: "qty",
    sinif: "DONMUS_ILERI",
    yazan: [SVC + "return.service.ts"],
    neden: "iade anındaki currentQty; iade iptali satırı damgalar (cancelledAt), metrajı değiştirmez",
    sql: [
      {
        id: "28b",
        baslik: "iade satırında donmuş metraj ≤ 0 (ileri kayıt sıfır/negatif olamaz)",
        sql: `
SELECT rr.id::text AS kayit, r.barcode AS barkod, rr.qty::text AS sapma
FROM roll_returns rr JOIN rolls r ON r.id = rr."rollId"
WHERE rr.qty <= 0`,
      },
    ],
  },
  {
    model: "RollReturn",
    alan: "prevSackId",
    sinif: "DONMUS_ILERI",
    yazan: [SVC + "return.service.ts"],
    neden: "iade anındaki çuval; iptal OKUR (topu çuvala geri koyar) ama null'lamaz — satır iptal damgasıyla yaşar",
  },
  {
    model: "RollReturn",
    alan: "prevQualityGrade",
    sinif: "DONMUS_ILERI",
    yazan: [SVC + "return.service.ts"],
    neden: "iade anındaki kalite etiketi; iptal OKUR, null'lamaz",
    sql: [
      {
        id: "28c",
        baslik: "prevQualityGradeId var ama donmuş etiket (prevQualityGrade) yok — çift yazılır",
        sql: `
SELECT rr.id::text AS kayit, r.barcode AS barkod, rr."prevQualityGradeId"::text AS sapma
FROM roll_returns rr JOIN rolls r ON r.id = rr."rollId"
WHERE rr."prevQualityGradeId" IS NOT NULL AND rr."prevQualityGrade" IS NULL`,
      },
    ],
  },
  {
    model: "RollReturn",
    alan: "prevQualityGradeId",
    sinif: "DONMUS_ILERI",
    yazan: [SVC + "return.service.ts"],
    neden: "prevQualityGrade'in canonical çifti (DB ayağı §28c)",
  },
  {
    model: "RollReturn",
    alan: "appliedStatus",
    sinif: "DONMUS_ILERI",
    adayDegil: "imza ('İade anında topa UYGULANAN statü') — 'anında' tek başına imza değil, 'anındaki' imza",
    yazan: [SVC + "return.service.ts"],
    neden: "iade anında topa uygulanan raf; iptal guard'ı OKUR ('top hâlâ o rafta mı'), null'lamaz",
  },
  {
    model: "SubcontractorDispatchItem",
    alan: "dispatchedQty",
    sinif: "DONMUS_ILERI",
    adayDegil: "şerhsiz kolon; defter.md ÜÇÜNCÜ SINIF satırı adıyla anıyor",
    yazan: [SVC + "subcontractor.service.ts"],
    neden: "fasona çıkan brüt metraj; sevk iptali (cancelledAt) kalemi silmez, metrajı değiştirmez — kısmi kabul topu tüketmez",
    sql: [
      {
        id: "28d",
        baslik: "fason sevk kalemi donmuş metrajı ≤ 0",
        sql: `
SELECT sdi.id::text AS kayit, r.barcode AS barkod, sdi."dispatchedQty"::text AS sapma
FROM subcontractor_dispatch_items sdi JOIN rolls r ON r.id = sdi."rollId"
WHERE sdi."dispatchedQty" <= 0`,
      },
      {
        id: "28e",
        baslik: "iptal edilmiş fason sevkin kalemi SİLİNMİŞ (kalemsiz iptal sevk)",
        sql: `
SELECT sd.id::text AS kayit, sd."dispatchNo" AS barkod, 'kalem 0' AS sapma
FROM subcontractor_dispatches sd
WHERE sd."cancelledAt" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM subcontractor_dispatch_items i WHERE i."dispatchId" = sd.id)`,
      },
    ],
  },
  {
    model: "SubcontractorDispatch",
    alan: "plannedSubcontractorId",
    sinif: "DONMUS_ILERI",
    yazan: [SVC + "helpers/batch-dispatch-surgery.helper.ts", SVC + "subcontractor.service.ts"],
    neden: "sevk anında 'plan ne diyordu' — adımın planı sonra değişse rapor değişmez; iptal dokunmaz; parti cerrahisi yeni sevke KOPYALAR",
  },
  {
    model: "SubcontractorDispatch",
    alan: "totalQty",
    sinif: "DONMUS_ILERI",
    yazan: [SVC + "batch.service.ts", SVC + "helpers/batch-dispatch-surgery.helper.ts", SVC + "subcontractor.service.ts"],
    neden: "kalemlerin toplamı; parti cerrahisi (böl/taşı) kalemle birlikte yeniden kurar — kalem toplamıyla mutabakat ayrı bekçide",
    bekci: [{ dosya: "test_consistency.ts", bolum: "19", ne: "subcontractor_dispatches.totalQty = Σ dispatchedQty" }],
  },
  {
    model: "KartelaDispatch",
    alan: "totalQty",
    sinif: "DONMUS_ILERI",
    yazan: [SVC + "kartela.service.ts"],
    neden: "kartela sevk metrajı, sevkle donar; iptal dokunmaz",
    sql: [
      {
        id: "28f",
        baslik: "kartela sevk toplamı ≠ kalem toplamı (donmuş toplam kalemden kopmuş)",
        sql: `
SELECT kd.id::text AS kayit, kd."dispatchNo" AS barkod, (kd."totalQty"::text || ' ≠ ' || COALESCE(SUM(kdi."dispatchedQty"), 0)::text) AS sapma
FROM kartela_dispatches kd
LEFT JOIN kartela_dispatch_items kdi ON kdi."dispatchId" = kd.id
GROUP BY kd.id, kd."dispatchNo", kd."totalQty"
HAVING kd."totalQty" <> COALESCE(SUM(kdi."dispatchedQty"), 0)`,
      },
    ],
  },
  {
    model: "RollError",
    alan: "errorType",
    sinif: "DONMUS_ILERI",
    yazan: [SVC + "inventory.service.ts", SVC + "kursun-qc.service.ts", SVC + "tambur.service.ts"],
    neden: "DefectType.name'in kayıt anı kopyası; katalog yeniden adlandırılsa tarihî etiket korunur (içe aktarım da kopyalar)",
    sql: [
      {
        id: "28g",
        baslik: "defectTypeId var ama donmuş ad (errorType) yazılmamış/silinmiş",
        sql: `
SELECT e.id::text AS kayit, r.barcode AS barkod, e."defectTypeId"::text AS sapma
FROM roll_errors e JOIN rolls r ON r.id = e."rollId"
WHERE e."defectTypeId" IS NOT NULL AND e."errorType" IS NULL`,
      },
    ],
  },
  {
    model: "MachineStopEvent",
    alan: "lossClass",
    sinif: "DONMUS_ILERI",
    yazan: [SVC + "machine-stop.service.ts"],
    neden: "preset'in kayıp sınıfı duruş satırına KOPYALANIP DONAR; katalog değişse geçmiş rapor değişmez — yazıcı Faz 1b elle giriş (açılışta sebepliyse · sınıfla · yeniden sınıfla), tek dosya",
    sql: [
      {
        id: "28h",
        baslik: "duruş sınıflandırılmış (reasonCode) ama kayıp sınıfı kopyası (lossClass) yok",
        sql: `
SELECT s.id::text AS kayit, s."reasonCode" AS barkod, 'lossClass ∅' AS sapma
FROM machine_stop_events s
WHERE s."reasonCode" IS NOT NULL AND s."lossClass" IS NULL`,
      },
    ],
  },
  {
    model: "MachineRun",
    alan: "unitsPerCm",
    sinif: "DONMUS_ILERI",
    yazan: [SVC + "machine-run.service.ts"],
    neden: "koşumun ham atkı sıklığı, açılışta donar; kapanış/geri alma dokunmaz",
  },
  // ── Vardiya karnesi (dokuma raporları Dilim 1, 01, 2026-09-14) — `yazan: []` ÖLÇÜLMÜŞ:
  //    yazma yüzeyi (kapanış job'u M2 · elle düzeltme M3 · mühür M4) Dilim 3'te doğar; o gün
  //    §4b "yazan ≠ ölçülen" der ve dosya adıyla beyan ister. Dördü de DONMUŞ İLERİ değer:
  //    kaynağı sonradan değişse bu satırın rakamı DEĞİŞMEZ (period-guard "resmî rakam" sınıfı).
  {
    model: "MachineShiftStat",
    alan: "factoryDay",
    sinif: "DONMUS_ILERI",
    yazan: [],
    neden: "`ShiftInstance.factoryDayKey`ten materyalizasyonda kopyalanır; rapor ekseni, tek yazar M2",
  },
  {
    model: "MachineShiftStat",
    alan: "targetPickCapacityApt",
    sinif: "DONMUS_ILERI",
    yazan: [],
    neden: "Σ(target_i × APT dk) — koşumların hedef deviri sonradan düzeltilse karnenin paydası değişmez (kardeşi `targetPickCapacityPot` aynı kural)",
  },
  {
    model: "MachineShiftStat",
    alan: "stopThresholdSec",
    sinif: "DONMUS_ILERI",
    yazan: [],
    neden: "mikro duruş eşiği karneye donar; eşik değişimi geçmişle kıyaslanamaz seri üretmesin (bugün sabit `MINOR_STOP_THRESHOLD_SEC`)",
  },
  {
    model: "MachineShiftStat",
    alan: "monitoringState",
    sinif: "DONMUS_ILERI",
    yazan: [],
    neden: "`MachineSpec.monitoringState`ten kopya; gölge karne tezgah sonradan LIVE'a geçse de gölge kalır (geçmiş geriye dönük yayınlanmaz)",
  },
  {
    model: "RollPlanDeviation",
    alan: "rollValue",
    sinif: "DONMUS_ILERI",
    adayDegil: "imza ('donmuş belge ilkesi') ilk cümlede değil",
    yazan: [SVC + "helpers/tambur-plan-gate.helper.ts"],
    neden: "karar günündeki insan-okur değer; ad sonradan değişse rapor değişmez — karar defteri satırının parçası",
  },
  {
    model: "RollPlanDeviation",
    alan: "planValue",
    sinif: "DONMUS_ILERI",
    adayDegil: "rollValue ile aynı şerh bloğu",
    yazan: [SVC + "helpers/tambur-plan-gate.helper.ts"],
    neden: "rollValue'nun plan tarafı",
  },
  {
    model: "Invoice",
    alan: "exchangeRate",
    sinif: "DONMUS_ILERI",
    yazan: [SVC + "invoice.service.ts"],
    neden: "belgeye damgalanan kur; kur tablosu sonradan düzeltilse belge kendi kuruyla kalır (donmuş belge kuralının muhasebe karşılığı)",
    sql: [
      {
        id: "28i",
        baslik: "faturada donmuş kur ≤ 0",
        sql: `
SELECT i.id::text AS kayit, i."docNo" AS barkod, i."exchangeRate"::text AS sapma
FROM invoices i
WHERE i."exchangeRate" <= 0`,
      },
    ],
  },
  {
    model: "StockCountLine",
    alan: "expectedQty",
    sinif: "DONMUS_ILERI",
    yazan: [SVC + "stock-count.service.ts"],
    neden: "fotoğraf anındaki defter değeri; sayım tamamlanınca fark bundan hesaplanır, storno satıra dokunmaz",
  },

  // ── MUAF (kapalı gerekçe kümesi) ────────────────────────────────────────
  {
    model: "Roll",
    alan: "lastLabelSnapshot",
    sinif: "MUAF",
    yazan: [],
    muaf: { gerekce: "ONBELLEK", neden: "topun üstündeki son etiketin denormalize kopyası; her baskıda tazelenir, müşterisiz baskıda null'a çekilir" },
    neden: "bağ değil bilgi — geri alma girdisi de ileri kaydın parçası da değil",
  },
  {
    model: "TravelerCard",
    alan: "snapshot",
    sinif: "MUAF",
    adayDegil: "imza ilk cümlede değil ('SON BASILAN kopyanın kaydı')",
    yazan: [],
    muaf: { gerekce: "ONBELLEK", neden: "ACTIVE kart her baskıda iş emrinin GÜNCEL hâlinden basılır (resolvePrintPlan); şerh 'doğuşta donan içerik DEĞİLDİR' der" },
    neden: "sunum kaydı, tazelenir",
  },
  {
    model: "Manifest",
    alan: "snapshot",
    sinif: "MUAF",
    yazan: [],
    muaf: { gerekce: "BELGE_DEFTERI", neden: "yazdırma anındaki top listesi; satırın kendisi immutable belge" },
    neden: "kolon değil satır donar",
  },
  {
    model: "PrintedDocument",
    alan: "snapshot",
    sinif: "MUAF",
    adayDegil: "şerhsiz kolon (üstündeki şerh documentNo'nun)",
    yazan: [],
    muaf: { gerekce: "BELGE_DEFTERI", neden: "versiyonlu resmi belge defteri; ters yolu supersededAt/voidedAt satır düzeyinde" },
    neden: "kolon değil satır donar",
  },
  {
    model: "DuplicateReview",
    alan: "evidence",
    sinif: "MUAF",
    yazan: [],
    muaf: { gerekce: "KARAR_SATIRI", neden: "karar anındaki tespit gerekçeleri; şerh 'snapshot, sorgulanmaz'" },
    neden: "append-only karar satırının kanıt yükü",
  },
  {
    model: "WarehouseMovement",
    alan: "qty",
    sinif: "MUAF",
    yazan: [],
    muaf: { gerekce: "DEFTER_SATIRI", neden: "stok defteri satırının metrajı; satır append-only (defter envanteri defter.md)" },
    neden: "defter satırı bütünüyle değişmez, kolon sınıfı sorusu yok",
  },
  {
    model: "YarnMovement",
    alan: "unitPrice",
    sinif: "MUAF",
    adayDegil: "imza ('kabul ANINDA donar') ilk cümlede değil",
    yazan: [],
    muaf: { gerekce: "DEFTER_SATIRI", neden: "iplik defteri satırının fiyatı; satır append-only" },
    neden: "defter satırı bütünüyle değişmez",
  },
  {
    model: "WorkOrder",
    alan: "routeTemplateId",
    sinif: "MUAF",
    yazan: [],
    muaf: { gerekce: "SERH_ATFI", neden: "şerh 'snapshot kopya sonrası bile tutulur' — snapshot olan rota adımlarının kopyasıdır, bu kolon şablona referans" },
    neden: "imza atıfla eşleşti",
  },
  {
    model: "PrintedDocument",
    alan: "documentNo",
    sinif: "MUAF",
    yazan: [],
    muaf: { gerekce: "SERH_ATFI", neden: "şerh 'snapshot JSON'u çekmeden göstermek için' — snapshot olan kardeş kolon, bu kolon liste denormu" },
    neden: "imza atıfla eşleşti",
  },
  {
    model: "StockCountLine",
    alan: "notes",
    sinif: "MUAF",
    yazan: [],
    muaf: { gerekce: "SERH_ATFI", neden: "kendi şerhi yok; outOfScopeReason'ın bloğu onu tırnakla anıp 'donmuş belgede' der — donan sebep satırı, bu kolon sayan kişinin serbest notu" },
    neden: "imza devralınan cümleyle eşleşti",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// ŞEMADAN ADAY TÜRETME
// ─────────────────────────────────────────────────────────────────────────────
export interface SemaAlani {
  model: string;
  alan: string;
  tablo: string;
  tip: string;
  satir: number;
  /** Alana bağlı şerh: hemen üstündeki bitişik `///`/`//` satırları + satır sonu yorumu. */
  serh: string;
}

/** Skaler alan satırı: `  ad  Tip[?][]  @…` — ilişki alanları da eşleşir, tip adıyla süzülür. */
const ALAN_SATIRI = /^\s{2}([A-Za-z_]\w*)\s+([A-Z][A-Za-z]*)(\?|\[\])?\s*(.*)$/;
const MODEL_BASI = /^model\s+([A-Za-z_]\w*)\s*\{/;
const MAP_ATTR = /@@map\("([^"]+)"\)/;

/** `schema.prisma` metnini model → alan → şerh olarak okur (ilişki alanları dâhil, `tablo` @@map'ten). */
export function semaAlanlari(semaMetni: string = readFileSync(SEMA_YOLU, "utf8")): SemaAlani[] {
  const satirlar = semaMetni.split("\n");
  const sonuc: SemaAlani[] = [];
  let model: string | null = null;
  let modelBas = 0;
  let bekleyenSerh: string[] = [];
  let modelBloklari: { model: string; metin: string }[] = [];
  for (let i = 0; i < satirlar.length; i++) {
    const s = satirlar[i]!;
    const mb = MODEL_BASI.exec(s);
    if (mb) {
      model = mb[1]!;
      modelBas = i;
      bekleyenSerh = [];
      continue;
    }
    if (!model) continue;
    if (/^\}/.test(s)) {
      // model kapandı — tabloyu @@map'ten geri yaz, şerhsiz alanlara blok cümlesini devret
      const govde = satirlar.slice(modelBas, i + 1).join("\n");
      const map = MAP_ATTR.exec(govde)?.[1] ?? null;
      const blokMetni = modelBloklari.filter((b) => b.model === model).map((b) => b.metin).join(" ");
      const cumleler = blokMetni.split(/(?<=[.;])\s+|\s+—\s+/);
      for (const a of sonuc) {
        if (a.model !== model) continue;
        if (a.tablo === "") a.tablo = map ?? model;
        if (a.serh === "") {
          const anan = cumleler.filter((c) => c.includes("`" + a.alan + "`"));
          if (anan.length > 0) a.serh = anan.join(" ");
        }
      }
      modelBloklari = [];
      model = null;
      continue;
    }
    const trimmed = s.trim();
    if (trimmed.startsWith("///") || trimmed.startsWith("//")) {
      bekleyenSerh.push(trimmed.replace(/^\/\/\/?\s?/, ""));
      continue;
    }
    if (trimmed === "") {
      bekleyenSerh = [];
      continue;
    }
    const m = ALAN_SATIRI.exec(s);
    if (m) {
      const kuyruk = m[4] ?? "";
      const satirSonu = kuyruk.includes("//") ? kuyruk.slice(kuyruk.indexOf("//")).replace(/^\/\/\s?/, "") : "";
      sonuc.push({
        model,
        alan: m[1]!,
        tablo: "",
        tip: m[2]! + (m[3] ?? ""),
        satir: i + 1,
        serh: [...bekleyenSerh, satirSonu].filter(Boolean).join(" "),
      });
      // Bir şerh bloğu bitişik birkaç alanı birden anlatabilir (`reasonCode … ve
      // \`lossClass\` preset'ten KOPYALANIP DONAR`): kendi şerhi OLMAYAN alan, aynı
      // modelde onu tırnak içinde (\`alan\`) anan blok cümlesini devralır. Kendi şerhi
      // olan alan devralmaz — yoksa komşunun cümlesi her alanı aday yapar.
      modelBloklari.push(...bekleyenSerh.map((b) => ({ model: model!, metin: b })));
    }
    bekleyenSerh = [];
  }
  return sonuc;
}

/** Şerhin İLK cümlesi — kolonun NE olduğunu söyleyen cümle. Nokta/noktalı virgül + boşluk sınır. */
export function serhBasligi(serh: string): string {
  return serh.split(/[.;!?]\s+/)[0] ?? "";
}

/**
 * Şerh, kolonu "olay anı kopyası" ilan ediyor mu — TEK yüklem, kapı ve sonda aynı yerden okur.
 * İmza yalnız İLK cümlede aranır: ilk cümle kolonun ne olduğunu söyler, sonrakiler başka
 * kolona/belgeye atıf yapar (ölçüldü 2026-09-13: tüm şerhte 37 aday, 13'ü atıf; ilk cümlede
 * 24 aday, 4'ü atıf). Bedeli: imzası ilk cümlede olmayan gerçek snapshot aday olarak türemez
 * ve beyana `adayDegil` gerekçesiyle elle girer (preShipStatus · entryStationId · rollValue).
 */
export function serhSnapshotMu(serh: string): boolean {
  return SNAPSHOT_SERH_IMZASI.test(serhBasligi(serh));
}

/** Şerh imzalı SKALER alanlar. İlişki alanı (`Roll`, `Roll[]` gibi model tipi) elenir. */
export function snapshotAdaylari(semaMetni?: string): SemaAlani[] {
  const alanlar = semaAlanlari(semaMetni);
  const modeller = new Set(alanlar.map((a) => a.model));
  return alanlar.filter((a) => !modeller.has(a.tip.replace(/\?|\[\]/g, "")) && serhSnapshotMu(a.serh));
}

// ─────────────────────────────────────────────────────────────────────────────
// YAZICI TARAMASI (tip denetleyicisiz AST + şema ilişki çözümü)
// ─────────────────────────────────────────────────────────────────────────────
const YAZAN_METOD = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert"]);
/** Yazım gövdesini taşıyan anahtarlar — bunlardan birinin altındaki `alan:` yazımdır. */
const YAZIM_ANAHTARI = new Set(["data", "create", "update", "createMany", "connectOrCreate", "upsert"]);
/** Bunlardan birinin altındaki `alan:` yazım DEĞİLDİR (süzgeç/projeksiyon). */
const OKUMA_ANAHTARI = new Set(["where", "select", "include", "orderBy", "distinct", "by", "_count", "_sum", "_avg", "_min", "_max", "having", "cursor"]);

export interface KolonYazimi {
  model: string;
  alan: string;
  dosya: string;
  satir: number;
  metod: string;
  /** `null` literal ile mi yazıldı (tüketen), yoksa değerle mi. Koşullu ifadede ("x ?? null") BELİRSİZ. */
  deger: "null" | "deger" | "belirsiz";
  /** İlişki üzerinden (iç içe) yazıldı — delegate başka model, hedef şema ilişkisinden çözüldü. */
  icIce: boolean;
}

function delegateAdi(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

function degerSinifi(init: ts.Expression | undefined): KolonYazimi["deger"] {
  if (!init) return "belirsiz";
  if (init.kind === ts.SyntaxKind.NullKeyword) return "null";
  if (ts.isConditionalExpression(init) || ts.isBinaryExpression(init)) return "belirsiz";
  return "deger";
}

const PRISMA_GIRDI_TIPI = /\bPrisma\.([A-Z]\w*?)(?:Unchecked)?(Create|Update)(?:Many)?Input\b/;

/**
 * `degisken` bu düğümün KAPSAMINDA Prisma girdi tipiyle bildirilmiş mi (const/let ya da
 * parametre)? En yakın kapsayan fonksiyondan dışa doğru bakılır; ilk bulunan bildirim kazanır.
 */
function tipliVeriNesnesiModeli(sf: ts.SourceFile, n: ts.Node, degisken: string): { model: string; metod: string } | null {
  let kapsam: ts.Node | undefined = n.parent;
  while (kapsam) {
    let bulunan: { model: string; metod: string } | null = null;
    const ara = (d: ts.Node): void => {
      if (bulunan) return;
      if ((ts.isVariableDeclaration(d) || ts.isParameter(d)) && ts.isIdentifier(d.name) && d.name.text === degisken && d.type) {
        const m = PRISMA_GIRDI_TIPI.exec(d.type.getText(sf));
        if (m) bulunan = { model: m[1]!, metod: m[2]!.toLowerCase() };
      }
      if (!ts.isFunctionLike(d) || d === kapsam) d.forEachChild(ara);
    };
    ara(kapsam);
    if (bulunan) return bulunan;
    if (ts.isFunctionLike(kapsam) || ts.isSourceFile(kapsam)) {
      if (ts.isSourceFile(kapsam)) return null;
    }
    kapsam = kapsam.parent;
  }
  return null;
}

/**
 * `hedefler` kolonlarını `data:`/`create:`/`update:` altında yazan her yer — doğrudan
 * delegate çağrısı ya da ilişki üzerinden iç içe (`items: { create: [...] }`; hedef model
 * şemadaki ilişki alanının tipinden çözülür, ad tahmininden değil).
 * `cozulemeyen`: yazım anahtarı altında ama en yakın delegate çağrısına ulaşılamadı (helper'a
 * geçen nesne, `return`le dönen gövde) ya da ilişki zinciri şemada çözülemedi — kapı ayrı gösterir.
 */
export function kolonYazicilari(
  hedefler: readonly { model: string; alan: string; tablo: string }[],
  semaAlanListesi: SemaAlani[] = semaAlanlari(),
  kok: string = KOK,
  dizin: string = join(KOK, "src"),
): { yazimlar: KolonYazimi[]; cozulemeyen: string[]; taranan: number } {
  const alanlar = new Map<string, { model: string; alan: string; tablo: string }[]>();
  for (const h of hedefler) {
    const l = alanlar.get(h.alan) ?? [];
    l.push(h);
    alanlar.set(h.alan, l);
  }
  const modeller = new Set(semaAlanListesi.map((a) => a.model));
  const iliskiTipi = (model: string, alan: string): string | null => {
    const a = semaAlanListesi.find((x) => x.model === model && x.alan === alan);
    if (!a) return null;
    const tip = a.tip.replace(/\?|\[\]/g, "");
    return modeller.has(tip) ? tip : null;
  };
  const yazimlar: KolonYazimi[] = [];
  const cozulemeyen: string[] = [];
  const dosyalar = walkTs(dizin);
  for (const abs of dosyalar) {
    const rel = relative(kok, abs);
    const metin = readFileSync(abs, "utf8");
    const sf = ts.createSourceFile(abs, metin, ts.ScriptTarget.Latest, true);
    const satirNo = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

    const gez = (n: ts.Node): void => {
      if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) && ts.isIdentifier(n.name) && alanlar.has(n.name.text)) {
        const alan = n.name.text;
        // Yukarı tırman: anahtar yolu (içten dışa) + en yakın DELEGATE çağrısı. `.map(r => ({…}))`
        // gibi ifade gövdeli ok fonksiyonları aşılır; `return`/değişken ataması durdurur.
        const yol: string[] = [];
        let delegate: string | null = null;
        let metod: string | null = null;
        let apiYuku = false;
        let p: ts.Node = n.parent;
        while (p && !ts.isSourceFile(p)) {
          if (ts.isPropertyAssignment(p) && p.name) {
            const ad = ts.isIdentifier(p.name) ? p.name.text : p.name.getText(sf);
            yol.push(ad);
            // `{ success, data: … }` — ApiResponse yükü; kardeş anahtar `success` ile tanınır
            if (ad === "data" && ts.isObjectLiteralExpression(p.parent) &&
              p.parent.properties.some((q) => q.name && ts.isIdentifier(q.name) && q.name.text === "success")) { apiYuku = true; break; }
          }
          if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression)) {
            const m = p.expression.name.text;
            const ic = p.expression.expression;
            if (YAZAN_METOD.has(m) && ts.isPropertyAccessExpression(ic)) { delegate = ic.name.text; metod = m; break; }
          }
          if (ts.isReturnStatement(p) || ts.isVariableDeclaration(p) || ts.isFunctionLike(p) && !(ts.isArrowFunction(p) && !ts.isBlock(p.body))) break;
          p = p.parent;
        }
        const ilkAnahtar = yol[0];
        if (!ilkAnahtar || !YAZIM_ANAHTARI.has(ilkAnahtar) || yol.some((k) => OKUMA_ANAHTARI.has(k))) {
          n.forEachChild(gez);
          return;
        }
        if (!delegate) {
          if (!apiYuku) cozulemeyen.push(`${rel}:${satirNo(n)} ${alan} [${[...yol].reverse().join(".")} çağrısız]`);
          n.forEachChild(gez);
          return;
        }
        // Delegate modelinden başlayıp ilişki anahtarlarını şemadan izle (dıştan içe)
        const disaridanIce = [...yol].reverse();
        let model: string | null = [...modeller].find((m) => delegateAdi(m) === delegate) ?? null;
        let icIce = false;
        let kirik: string | null = null;
        for (const k of disaridanIce) {
          if (!model) break;
          if (YAZIM_ANAHTARI.has(k)) continue;
          const sonraki = iliskiTipi(model, k);
          if (!sonraki) { kirik = k; break; }
          model = sonraki;
          icIce = true;
        }
        if (!model || kirik) {
          // Delegate'in modeli şemada yok ya da zincirdeki anahtar bir ilişki değil — bu kolon
          // BİZİM adaylardan biri olabilir de olmayabilir de; fail-closed: göster.
          if (alanlar.get(alan)!.some((h) => delegateAdi(h.model) === delegate) || !model)
            cozulemeyen.push(`${rel}:${satirNo(n)} ${alan} [${disaridanIce.join(".")} @${delegate}.${metod}${kirik ? ` · '${kirik}' ilişki değil` : ""}]`);
          n.forEachChild(gez);
          return;
        }
        const hedef = alanlar.get(alan)!.find((h) => h.model === model);
        if (hedef) {
          const init = ts.isPropertyAssignment(n) ? n.initializer : undefined;
          yazimlar.push({ model, alan, dosya: rel, satir: satirNo(n), metod: metod!, deger: degerSinifi(init), icIce });
        }
        // aynı adlı alan başka modelde (ör. başka modelin `qty`si) → bizim kolon değil
      }
      // ④ TİPLİ VERİ NESNESİNE ATAMA — `rollData.currentQty = m` (nesne sonra `data: rollData`
      // ile geçer). Nesne literali değil, o yüzden ①'in gözünden kaçar; ölçüldü 2026-09-14:
      // `applyManualProperties` initialQty/currentQty'yi tam böyle yazıyordu ve K'nın "yeni üye
      // reçetesi" (`grep currentQty:`) de görmüyordu. Model, değişkenin/parametrenin TİP
      // ADINDAN çözülür: `Prisma.<Model>[Unchecked](Create|Update)[Many]Input`.
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(n.left) && ts.isIdentifier(n.left.expression) && alanlar.has(n.left.name.text)) {
        const alan = n.left.name.text;
        const degisken = n.left.expression.text;
        const tipModeli = tipliVeriNesnesiModeli(sf, n, degisken);
        if (tipModeli) {
          const hedef = alanlar.get(alan)!.find((h) => h.model === tipModeli.model);
          if (hedef) yazimlar.push({ model: tipModeli.model, alan, dosya: rel, satir: satirNo(n), metod: `${tipModeli.metod} (veri nesnesi)`, deger: degerSinifi(n.right), icIce: false });
        }
      }
      // Ham SQL UPDATE/INSERT — tablo + tırnaklı kolon adı
      if (ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isStringLiteral(n)) {
        const t = n.getText(sf);
        if (/\b(UPDATE|INSERT\s+INTO)\b/i.test(t)) {
          for (const h of hedefler) {
            const tabloRe = new RegExp(`\\b(UPDATE|INSERT\\s+INTO)\\s+"?${h.tablo}"?\\b`, "i");
            if (tabloRe.test(t) && new RegExp(`"${h.alan}"`).test(t)) {
              yazimlar.push({ model: h.model, alan: h.alan, dosya: rel, satir: satirNo(n), metod: "SQL", deger: "belirsiz", icIce: false });
            }
          }
        }
      }
      n.forEachChild(gez);
    };
    gez(sf);
  }
  return { yazimlar, cozulemeyen, taranan: dosyalar.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// KAPI YÜKLEMLERİ — bekçi ve sondalar AYNI fonksiyonu çağırır (sonda kopya ölçmesin)
// ─────────────────────────────────────────────────────────────────────────────
export const anahtar = (b: { model: string; alan: string }): string => `${b.model}.${b.alan}`;

/** aday ⊆ beyan ∧ beyan ⊆ şema(skaler). İki liste de boşsa kapı yeşil. */
export function beyanSemaFarki(
  adaylar: SemaAlani[],
  semaAlanListesi: SemaAlani[],
  beyan: readonly SnapshotBeyan[] = SNAPSHOT_KOLONLARI,
): { beyansizAday: string[]; semasizBeyan: string[]; adayDegilCelisik: string[] } {
  const beyanSet = new Set(beyan.map(anahtar));
  const modeller = new Set(semaAlanListesi.map((a) => a.model));
  const skaler = new Set(semaAlanListesi.filter((a) => !modeller.has(a.tip.replace(/\?|\[\]/g, ""))).map(anahtar));
  const adaySet = new Set(adaylar.map(anahtar));
  return {
    beyansizAday: adaylar.map(anahtar).filter((k) => !beyanSet.has(k)),
    semasizBeyan: beyan.map(anahtar).filter((k) => !skaler.has(k)),
    // `adayDegil` beyanı ile türetme birbirini yalanlamasın: aday olan "aday değil" diyemez, aday olmayan susamaz
    adayDegilCelisik: beyan.filter((b) => (b.adayDegil != null) === adaySet.has(anahtar(b))).map(anahtar),
  };
}

/** Beyan edilen yazıcı kümesi ↔ ölçülen (dosya düzeyi, iki yönlü). Boş dizi = eşit. */
export function yaziciFarki(
  b: SnapshotBeyan,
  yazimlar: KolonYazimi[],
): { eksikYazan: string[]; fazlaYazan: string[]; eksikTuketen: string[]; fazlaTuketen: string[] } {
  const benim = yazimlar.filter((w) => w.model === b.model && w.alan === b.alan);
  const olcNull = new Set(benim.filter((w) => w.deger === "null").map((w) => w.dosya));
  const olcDeger = new Set(benim.filter((w) => w.deger !== "null").map((w) => w.dosya));
  // (b)'de null yazım da "yazan"dır (kalitesiz giriş gibi ileri karar); (a)'da ayrı sayılır
  const olcYazan = b.sinif === "GERI_ALMA_GIRDISI" ? olcDeger : new Set([...olcDeger, ...olcNull]);
  const beyYazan = new Set(b.yazan);
  const beyTuketen = new Set(b.tuketen ?? []);
  const olcTuketen = b.sinif === "GERI_ALMA_GIRDISI" ? olcNull : new Set<string>();
  return {
    eksikYazan: [...olcYazan].filter((d) => !beyYazan.has(d)).sort(),
    fazlaYazan: [...beyYazan].filter((d) => !olcYazan.has(d)).sort(),
    eksikTuketen: [...olcTuketen].filter((d) => !beyTuketen.has(d)).sort(),
    fazlaTuketen: [...beyTuketen].filter((d) => !olcTuketen.has(d)).sort(),
  };
}

export { KOK as BACKEND_KOK, SEMA_YOLU };
