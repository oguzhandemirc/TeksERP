// =============================================================================
// Roll finalize helper — "her rotanın son adımı final üretir"
// =============================================================================
// Tambur'un kalite→durum finalize mantığının (resolveCutStatus + katalog haritası)
// JENERİK versiyonu: HERHANGİ bir rotanın son adımı bitince (Kurşun/QC2 ya da ileride
// başka bir istasyon) toplar WAREHOUSE'a (kaliteye göre) çekilir — artık PRODUCED
// limbosu yok. Tambur kendi çocuk-üretim akışını korur; bu helper yalnız MEVCUT
// topları son adımda finalize eder.
// =============================================================================
import { WarehouseEventType, Prisma, RollStatus, RollForm, type PrismaClient } from "@prisma/client";
import { WAREHOUSE_STOCK_STATUSES } from "./warehouse-stock.helper";
import { warehouseStampTx } from "./warehouse.helper";
import { postStockMove, qtyYazilabilir } from "./warehouse-ledger.helper";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { reserveRollBarcodesInOrderTx, type RollBarcodeType } from "./roll-barcode.helper";

export type TxClient = Prisma.TransactionClient;

/** Hem havuz client'ı hem transaction client'ı kabul eden okuma tipi (any YOK). */
type ReadDb = PrismaClient | Prisma.TransactionClient;

/**
 * Kalite kodları → katalog `targetStatus` + `id` haritaları (Tambur :637-652 ile aynı
 * desen). null/boş kodlar atlanır → resolveFinalStatus onları WAREHOUSE'a düşürür.
 */
export async function loadQualityTargetMaps(
  tx: TxClient,
  codes: Array<string | null | undefined>,
): Promise<{ statusByCode: Map<string, RollStatus>; idByCode: Map<string, string> }> {
  const uniqueCodes = Array.from(new Set(codes.filter((c): c is string => !!c)));
  const rows = uniqueCodes.length
    ? await tx.qualityGrade.findMany({
        where: { code: { in: uniqueCodes } },
        select: { id: true, code: true, targetStatus: true },
      })
    : [];
  return {
    statusByCode: new Map(rows.map((q) => [q.code, q.targetStatus])),
    idByCode: new Map(rows.map((q) => [q.code, q.id])),
  };
}

/**
 * ÜRETİLEN METRAJ KOVALARI — kalite kodu → kova, KATALOGDAN çözülür.
 *
 * NEDEN KATALOGDAN: `qualityGrade` kolonu katalog `code`'unun snapshot'ıdır ve
 * kod fabrikaya AÇIK bir alandır (admin `KAL-YYMM-XXXX` üretebilir, mevcut
 * kodu yeniden adlandırabilir). `qualityGrade === "FIRE"` gibi gömülü kod, tam
 * da `schema.prisma`'daki QualityGrade notunun yasakladığı kırılganlıktır:
 * fabrika "2. Fire" adında ikinci bir SCRAP kademesi tanımlarsa gömülü liste
 * onu sessizce SAĞLAM ÜRETİM sayar.
 *
 * Kova eşlemesi `targetStatus` üzerinden:
 *   • `SCRAP`     → `fire`      (mal çöpe gitti — üretim SAYILMAZ)
 *   • `A1_STOCK`  → `a1`        (2. kalite, SATILABİLİR — üretim SAYILIR)
 *   • diğer/null  → `warehouse` (1. kalite / kaliteye bakılmadı — üretim SAYILIR)
 *
 * ⚠️ `isActive` SÜZGECİ YOK: pasife alınmış eski bir kalite kodu hâlâ geçmiş
 * topların üstünde durur; süzülürse o toplar "bilinmeyen kod" → warehouse'a
 * düşer ve fire metrajı sessizce üretime karışır.
 *
 * `unknownCodes` = topta duran ama katalogda HİÇ olmayan kodlar (elle DB
 * düzenlemesi / silinmiş katalog satırı). Sessizce warehouse sayılır (üretimi
 * durdurmak yanlış cevap) ama çağıran isterse raporlayabilir.
 */
export type ProducedBucket = "warehouse" | "a1" | "fire";

export interface ProducedBuckets {
  /** Kalite kodunun kovası — null/boş kod ve bilinmeyen kod `warehouse`. */
  bucketOf(code: string | null | undefined): ProducedBucket;
  /** `targetStatus = SCRAP` olan katalog kodları (liste süzgecinin dışlama kümesi). */
  fireCodes: string[];
  /** `targetStatus = A1_STOCK` olan katalog kodları (2. kalite — üretim SAYILIR). */
  a1Codes: string[];
  /** `bucketOf` çağrılarında katalogda bulunamayan kodlar (teşhis için). */
  unknownCodes: Set<string>;
}

export async function loadProducedBuckets(db: ReadDb): Promise<ProducedBuckets> {
  const rows = await db.qualityGrade.findMany({
    select: { code: true, targetStatus: true },
  });
  const byCode = new Map<string, ProducedBucket>();
  const fireCodes: string[] = [];
  const a1Codes: string[] = [];
  for (const q of rows) {
    const bucket: ProducedBucket =
      q.targetStatus === RollStatus.SCRAP
        ? "fire"
        : q.targetStatus === RollStatus.A1_STOCK
          ? "a1"
          : "warehouse";
    byCode.set(q.code, bucket);
    if (bucket === "fire") fireCodes.push(q.code);
    else if (bucket === "a1") a1Codes.push(q.code);
  }
  const unknownCodes = new Set<string>();
  return {
    bucketOf(code) {
      if (!code) return "warehouse";
      const hit = byCode.get(code);
      if (hit) return hit;
      unknownCodes.add(code);
      return "warehouse";
    },
    fireCodes,
    a1Codes,
    unknownCodes,
  };
}

/**
 * Kalite kodundan final durum — kod yok ya da katalogda yoksa WAREHOUSE
 * (Tambur `resolveCutStatus` + "kalite belirsizse WAREHOUSE" kuralı).
 */
export function resolveFinalStatus(
  code: string | null | undefined,
  statusByCode: Map<string, RollStatus>,
): RollStatus {
  return (code ? statusByCode.get(code) : undefined) ?? RollStatus.WAREHOUSE;
}

/** Final duruma göre barkod tipi — satılabilire (WAREHOUSE/A1_STOCK) inen "F", diğer "H". */
export function finalBarcodeType(status: RollStatus): RollBarcodeType {
  return status === RollStatus.WAREHOUSE || status === RollStatus.A1_STOCK ? "F" : "H";
}

export interface FinalizedRoll {
  rollId: string;
  status: RollStatus;
  barcode: string;
  barcodeGenerated: boolean;
}

/**
 * Rotanın SON adımı bitince MEVCUT topları finalize eder. Her top için:
 *  - kalite kodundan durum çöz (varsayılan WAREHOUSE),
 *  - `currentStepId = null` (istasyondan çıktı),
 *  - `form = ACIK` (Tambur-DIŞI çıktı = açık kumaş; Tambur kendi TOP çocuklarını ayrı üretir),
 *  - `qualityGradeId` boşsa katalogdan doldur,
 *  - barkod yoksa üret ("her kumaşa etiket"; barkod KALICI kimlik → varsa dokunulmaz,
 *    böylece re-finalize idempotent).
 *
 * ÇAĞIRAN sorumluluğu: `recomputeStepStatus` + `completeWorkOrderIfStepsDone` bu helper
 * DÖNDÜKTEN SONRA çağrılır (WO/kart tamamlama akışı değişmez). tx'te SIRALI çalışır
 * (Promise.all yasak; barkod sayacı zaten satır-kilidiyle serileşir).
 */
export async function finalizeRollsAtLastStep(
  tx: TxClient,
  rollIds: string[],
  /**
   * Girişi yazan ADIM. Defter satırına damgalanır ki "hangi finish turunun
   * girişi" sorusu defterden cevaplanabilsin — adımı yeniden açma yalnız KENDİ
   * girişini terslemek için bu damgayı kullanır. Adımı bilmeyen çağıran
   * (kurtarma yolu) geçmez; o satırlar damgasız kalır ve geçiş dalıyla bulunur.
   */
  opts?: { workOrderStepId?: string | null },
): Promise<FinalizedRoll[]> {
  if (rollIds.length === 0) return [];
  const rolls = await tx.roll.findMany({
    where: { id: { in: rollIds } },
    select: {
      id: true, barcode: true, qualityGrade: true, qualityGradeId: true,
      // Defter satırı için: mal hangi depoya, ne kadar giriyor.
      warehouseId: true, currentQty: true,
    },
  });
  const { statusByCode, idByCode } = await loadQualityTargetMaps(
    tx,
    rolls.map((r) => r.qualityGrade),
  );

  // Barkod gereken toplar için TEK rezervasyon (tip başına tek ifade).
  // (2026-08-10 denetimi, F-CORE-VER-001) Eskiden döngü her barkodsuz top için
  // ayrı bir sayaç turu atıyordu; N top = N gidiş-dönüş ve sayaç satırının kilidi
  // ilk turdan itibaren zaten tutuluyordu, yani araya giren her tur kilidi o
  // kadar daha uzun tutuyordu. Artık tip başına tek ifade.
  //
  // ⚠️ REZERVASYON BİLİNÇLİ OLARAK TX'İN İÇİNDE KALDI, dışarı taşınmadı.
  // Taşımak imkânsız: çağıranların ikisinde (`kursun-bypass.service` ~1386,
  // `kursun-qc.service` ~866) `rollIds` listesi tx'in İÇİNDE hesaplanıyor
  // (o an hareketi kapanan toplar) — çağıran tx açılmadan hangi topların
  // barkoda ihtiyacı olduğunu BİLEMEZ. Tx içinde kalmanın bir kazancı da var:
  // tx geri sararsa sayaç artışı da geri sarılır, boşluk doğmaz.
  const statusOf = new Map(rolls.map((r) => [r.id, resolveFinalStatus(r.qualityGrade, statusByCode)]));
  const needBarcode = rolls.filter((r) => !r.barcode);
  const reserved = await reserveRollBarcodesInOrderTx(
    tx,
    needBarcode.map((r) => finalBarcodeType(statusOf.get(r.id)!)),
  );
  const barcodeFor = new Map(needBarcode.map((r, i) => [r.id, reserved[i]!]));

  const out: FinalizedRoll[] = [];
  for (const r of rolls) {
    const status = statusOf.get(r.id)!;
    let barcode = r.barcode;
    let barcodeGenerated = false;
    if (!barcode) {
      barcode = barcodeFor.get(r.id)!;
      barcodeGenerated = true;
    }
    const resolvedQualityGradeId =
      r.qualityGradeId ?? (r.qualityGrade ? idByCode.get(r.qualityGrade) ?? null : null);
    // ⚠️ DEPO DAMGASI TERFİNİN PARÇASIDIR: mal stok kümesine giriyorsa deposu
    // DOLU olmak zorunda, yoksa "depoda ama hangi depoda belli değil" bir top
    // doğar — defter satırı da (aşağıda) sessizce atlanır, yani hata görünmez.
    // Damga mevcut depoyu EZMEZ; yalnız NULL'sa varsayılanı yazar.
    const stampedWarehouse = WAREHOUSE_STOCK_STATUSES.includes(status)
      ? await warehouseStampTx(tx, r.warehouseId)
      : {};
    await tx.roll.update({
      where: { id: r.id },
      data: {
        status,
        currentStepId: null,
        form: RollForm.ACIK,
        ...stampedWarehouse,
        ...(barcodeGenerated ? { barcode } : {}),
        ...(resolvedQualityGradeId && resolvedQualityGradeId !== r.qualityGradeId
          ? { qualityGradeId: resolvedQualityGradeId }
          : {}),
      },
    });
    // Damga bir depo yazdıysa defter satırı da ONU kullanmalı — yoksa satır hâlâ
    // `r.warehouseId` (NULL) okuyup atlanır ve damga deftere yansımaz.
    const effectiveWarehouseId = stampedWarehouse.warehouseId ?? r.warehouseId;
    // DEPO DEFTERİ — üretimden depoya GİRİŞ. Fire (SCRAP) satır yazmaz: top
    // üretime girerken zaten stoktan çıkmıştı, geri gelmiyor.
    // ⚠️ 0 metraj kapıya GİRMEZ: taşınacak mal yok, yani hareket de yok — bu
    // SCRAP/deposuz dallarıyla aynı sınıf meşru atlama. Süzülmezse kapı haklı
    // olarak fırlatır ve kurşun açık kumaşın (`currentQty: 0`) depoya inmesi
    // adım kapatmayı 500'e düşürürdü.
    if (effectiveWarehouseId && WAREHOUSE_STOCK_STATUSES.includes(status) && qtyYazilabilir(r.currentQty)) {
      await postStockMove(tx, {
        rollId: r.id,
        eventType: WarehouseEventType.PRODUCTION,
        qty: r.currentQty,
        to: { warehouseId: effectiveWarehouseId, status },
        reasonCode: STOCK_MOVE_REASON.PRODUCTION_RECEIPT,
        workOrderStepId: opts?.workOrderStepId ?? null,
      });
    }
    out.push({ rollId: r.id, status, barcode: barcode as string, barcodeGenerated });
  }
  return out;
}
