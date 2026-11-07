// =============================================================================
// İŞ EMRİ ÜRETİM ÇIKTISI KÜMESİ — TEK KAYNAK
// =============================================================================
// Liste ÇIKAN metriği, detay "Üretilen Nihai Toplar" ve kapanış künyesi AYNI
// kümeyi sorar; künye bu tanımı dondurur, canlı başlık bugün okur — ikisi
// ancak aynı yüklemden doğarsa "kapanışta ↔ bugün" farkı gerçek farktır.
// =============================================================================
import { Prisma, RollEntrySource, RollStatus } from "@prisma/client";

/** b) dalı — çocuğa bölünmeden nihai statüye ulaşmış SPLIT-olmayan çıktı. */
const FINALIZED_OUTPUT_BRANCH: Prisma.RollWhereInput = {
  entrySource: { not: RollEntrySource.TAMBUR_SPLIT },
  status: {
    in: [
      RollStatus.WAREHOUSE,
      RollStatus.A1_STOCK,
      RollStatus.SCRAP,
      RollStatus.SHIPPED,
      RollStatus.AT_KARTELA,
      RollStatus.KARTELA_CONSUMED,
    ],
  },
};

/**
 * a) dışlamasının PRISMA İKİZİ — parent'a uygulanır: "aynı WO'nun Tambur
 * kesiminden doğmuş parent". Bellek ikizi `isSameWoSplitParent`; ikisini
 * `test_produced_output_resolve` kilitler.
 */
function sameWoSplitParentWhere(stepIds: string[]): Prisma.RollWhereInput {
  return { entrySource: RollEntrySource.TAMBUR_SPLIT, producedInStepId: { in: stepIds } };
}

/**
 * WO ÜRETİM ÇIKTISI küme tanımı — liste (withProductionMeters) ve detay
 * (producedRolls) AYNI kümeyi kullanır (drift = iki ekranda farklı sayı).
 *
 * 2026-07-27 düzeltmesi: eski tanım `parent.entrySource=SUBCONTRACTOR_RETURN`
 * şartıyla YALNIZ fason-dönüşü açık kumaştan kesilen çocukları sayıyordu —
 * fasonsuz rota (stok top → KK1→KK2→Tambur) ve Tambur'suz biten rota
 * ("her rotanın son adımı final üretir": Kurşun/fason finalize) ÇIKAN=0
 * görünüyordu. Yeni küme iki daldan oluşur:
 *   a) Tambur birinci-nesil çocukları (entrySource=TAMBUR_SPLIT, bu WO'nun
 *      adımında doğmuş). AYNI WO içi re-cut torunları çift sayım nedeniyle
 *      hariç; ama BAŞKA WO'nun deposundan tüketilen TAMBUR_SPLIT parent'ın
 *      çocukları meşru çıktıdır (parent.producedInStepId kapsam şartı).
 *      Snapshot: sonradan TAMBUR_CONSUMED/CANCELLED olan çocuk listede kalır
 *      (detay rozet basar).
 *   b) Çocuğa bölünmeden nihai-ürün statüsüne ulaşan finalize çıktıları —
 *      rota Kurşun/QC2 veya fasonla bitti. Ara-tüketilenler
 *      (TAMBUR_CONSUMED/SUBCONTRACTOR_CONSUMED) ve canlı üretim bu dala giremez.
 *
 * Bildirimsel TANIM ve bekçi referansıdır; servisler `resolveProducedOutputWhere`
 * ile sorar (parent JOIN'i hacimde tam tarama planına düşüyordu, 2026-11-07).
 */
export function producedOutputWhere(stepIds: string[]): Prisma.RollWhereInput {
  return {
    producedInStepId: { in: stepIds },
    OR: [
      { entrySource: RollEntrySource.TAMBUR_SPLIT, NOT: { parent: sameWoSplitParentWhere(stepIds) } },
      FINALIZED_OUTPUT_BRANCH,
    ],
  };
}

/**
 * a) dışlamasının BELLEK İKİZİ. `producedInStepId` NULL olan SPLIT parent da
 * dışlar: SQL `NOT (… AND NULL IN (…))` NULL'a düşüp satırı eler; bayt-eşitlik
 * için aynen korunur.
 */
export function isSameWoSplitParent(
  parent: { entrySource: RollEntrySource; producedInStepId: string | null },
  stepSet: ReadonlySet<string>,
): boolean {
  return (
    parent.entrySource === RollEntrySource.TAMBUR_SPLIT &&
    (parent.producedInStepId === null || stepSet.has(parent.producedInStepId))
  );
}

type RollReader = { roll: Pick<Prisma.TransactionClient["roll"], "findMany"> };

/**
 * Üretim çıktısı kümesini `{ id: { in } }` olarak ÇÖZER — tüketicilerin TEK girişi.
 * `producedOutputWhere` doğrudan sorguda parent'ı LEFT JOIN'ler; liste hacminde
 * planlayıcı `rolls`u baştan sona tarayıp hash'liyordu (tablo boyuyla doğrusal).
 * Burada adaylar `producedInStepId` index'inden, parent'lar PK'dan okunur.
 */
export async function resolveProducedOutputWhere(
  db: RollReader,
  stepIds: string[],
): Promise<Prisma.RollWhereInput> {
  if (stepIds.length === 0) return { id: { in: [] } };
  const candidates = await db.roll.findMany({
    where: {
      producedInStepId: { in: stepIds },
      OR: [{ entrySource: RollEntrySource.TAMBUR_SPLIT }, FINALIZED_OUTPUT_BRANCH],
    },
    select: { id: true, entrySource: true, parentRollId: true },
  });
  const parentIds = [
    ...new Set(
      candidates
        .filter((c) => c.entrySource === RollEntrySource.TAMBUR_SPLIT && c.parentRollId !== null)
        .map((c) => c.parentRollId as string),
    ),
  ];
  const parents =
    parentIds.length === 0
      ? []
      : await db.roll.findMany({
          where: { id: { in: parentIds } },
          select: { id: true, entrySource: true, producedInStepId: true },
        });
  const stepSet = new Set(stepIds);
  const excludedParent = new Set(parents.filter((p) => isSameWoSplitParent(p, stepSet)).map((p) => p.id));
  const ids = candidates
    .filter(
      (c) =>
        c.entrySource !== RollEntrySource.TAMBUR_SPLIT ||
        c.parentRollId === null ||
        !excludedParent.has(c.parentRollId),
    )
    .map((c) => c.id);
  return { id: { in: ids } };
}
