// =============================================================================
// SAPMA DEFTERİ — TEK YAZMA NOKTASI (2026-08-09)
// =============================================================================
// `RollVariance` satırı YALNIZ buradan doğar. Çağıranlar `tx.rollVariance.create`
// yazmaz — sebep doğrulaması, sıfır-eleme ve Decimal disiplini burada yaşar;
// kopyalanırsa üç çağrı noktası zamanla üç farklı kural uygular.
//
// ⚠️ HER ZAMAN tx İÇİNDE: sapma, onu doğuran statü değişikliğiyle ya BİRLİKTE
// olur ya HİÇ. Ayrı tx'te yazılsaydı finalize commit olup sapma düşebilir ve
// defter sessizce eksik kalırdı — tam da bu defterin engellemek için var olduğu
// şey. (Audit best-effort'tur ve tx DIŞINDA yazılır; bu defter audit DEĞİLDİR.)
// =============================================================================

import { Prisma, RollVarianceKind } from "@prisma/client";
import {
  validateVarianceReason,
  type VarianceSource,
  type VarianceReasonInput,
} from "../../constants/variance-reasons";

/** `prisma.$transaction` callback'inin client tipi. */
type Tx = Prisma.TransactionClient;

export interface RecordVarianceInput extends VarianceReasonInput {
  rollId: string;
  /** Depo kesiminde NULL — o akış hiçbir iş emri adımına bağlı değil. */
  workOrderStepId?: string | null;
  kind: RollVarianceKind;
  /** POZİTİF metraj. Sıfır/negatif → satır YAZILMAZ (aşağıdaki nota bak). */
  qty: Prisma.Decimal | number;
  source: VarianceSource;
  /**
   * Sapmayı doğuran kaydın id'si — TERSLEMENİN ADRESİ (bugün: fason makbuzu).
   * Kaynak iptal edilebiliyorsa VER; yoksa satır sonsuza dek defterde kalır ya
   * da tersleme komşu satırları da süpürür (bkz. şema notu).
   */
  sourceRefId?: string | null;
  userId?: string | null;
}

/**
 * Sapma satırı yazar. Yazılan satırın id'sini döner; yazılmadıysa `null`.
 *
 * ⚠️ `qty <= 0` → SESSİZCE ATLANIR ve bu bilinçlidir: `finalizeOpenFabric`
 * kalan 0 iken de `discard` aksiyonuyla çağrılabiliyor (operatör "Bitir"e kalan
 * sıfırken bastı). Orada sapma YOKTUR — sıfır metrajlık bir "kayıt düzeltmesi"
 * satırı defteri gürültüyle doldurur ve `roll_variances_qty_positive` CHECK'ine
 * de çarpardı. Yani atlamak, guard'ı istisna yapmak değil; sapmanın tanımı gereği.
 */
export async function recordVarianceTx(
  tx: Tx,
  input: RecordVarianceInput,
): Promise<string | null> {
  const qtyD =
    input.qty instanceof Prisma.Decimal ? input.qty : new Prisma.Decimal(input.qty);
  if (!qtyD.greaterThan(0)) return null;

  // Sebep doğrulaması ÖNCE — geçersiz sebeple satır yazmaktansa hiç yazmamak
  // değil, ÇAĞRIYI DÜŞÜRMEK doğru: sebep zorunluysa eksikliği sessizce kabul
  // etmek, "sebep zorunlu" kuralını fiilen kaldırır.
  const { reasonCode, reasonText } = validateVarianceReason(input.kind, input);

  const row = await tx.rollVariance.create({
    data: {
      rollId: input.rollId,
      workOrderStepId: input.workOrderStepId ?? null,
      kind: input.kind,
      qty: qtyD,
      reasonCode,
      reasonText,
      source: input.source,
      sourceRefId: input.sourceRefId ?? null,
      createdById: input.userId ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * ÇOK SATIRLI sapma yazımı — `createMany` ile TEK sorgu (`writeWarehouseMovements`
 * emsali; perf kuralı 9). Yazılan satır sayısını döner.
 *
 * ⚠️ TEKİLİN SEMANTİĞİ BİREBİR KORUNUR ve ayrışırsa iki defter iki kural uygular:
 * `qty <= 0` satırı ATLANIR (sıfır metrajlık "kayıt düzeltmesi" defteri kirletir
 * ve `roll_variances_qty_positive` CHECK'ine çarpar), sebep doğrulaması HER satır
 * için ayrı koşar ve geçersiz kod ÇAĞRIYI DÜŞÜRÜR (fail-closed).
 *
 * ⚠️ Doğrulama insert'ten ÖNCE toplu koşar; tekilde satır satır dönüşümlüydü.
 * Gözlenebilir fark YOKTUR: her iki yol da çağıranın tx'i içindedir, hata tüm
 * tx'i geri sarar. Satır ID'sine ihtiyaç duyan çağıran TEKİLİ kullanır —
 * `createMany` id döndürmez.
 */
export async function recordVariancesTx(
  tx: Tx,
  inputs: RecordVarianceInput[],
): Promise<number> {
  const rows = inputs
    .map((input) => {
      const qtyD =
        input.qty instanceof Prisma.Decimal ? input.qty : new Prisma.Decimal(input.qty);
      if (!qtyD.greaterThan(0)) return null;
      const { reasonCode, reasonText } = validateVarianceReason(input.kind, input);
      return {
        rollId: input.rollId,
        workOrderStepId: input.workOrderStepId ?? null,
        kind: input.kind,
        qty: qtyD,
        reasonCode,
        reasonText,
        source: input.source,
        sourceRefId: input.sourceRefId ?? null,
        createdById: input.userId ?? null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return 0;
  const res = await tx.rollVariance.createMany({ data: rows });
  return res.count;
}

/**
 * AŞIM tespiti — kesimlerin toplamı kayıtlı metrajı geçtiyse farkı döner.
 *
 * Tek satırlık iş gibi görünüyor ama TEK KAYNAK olması önemli: aşım üç ayrı
 * kesim yolunda kontrol ediliyor (`cutOpenFabric`, `cutWarehouseRoll`,
 * `processTamburDecision`) ve üçü de `tambur.overQuantityEnabled` bayrağına
 * bakıyor. Hesabı kopyalayan dördüncü bir yol, defteri sessizce eksik bırakır.
 */
export function overageOf(
  cutTotal: Prisma.Decimal | number,
  recordedQty: Prisma.Decimal | number,
): Prisma.Decimal {
  const cut = cutTotal instanceof Prisma.Decimal ? cutTotal : new Prisma.Decimal(cutTotal);
  const rec =
    recordedQty instanceof Prisma.Decimal ? recordedQty : new Prisma.Decimal(recordedQty);
  const diff = cut.minus(rec);
  return diff.greaterThan(0) ? diff : new Prisma.Decimal(0);
}
