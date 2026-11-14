// =============================================================================
// RAF KÜMESİ — "bu top rafta mı (satılabilir/işlenebilir stok olarak bekliyor mu)" sorusunun TEK yüklemi
// =============================================================================
// Stok & Ölü Stok + Kalem Bazında raporu (`reports/stock-scorecard.report.service.ts#loadShelfCells`) ve
// `stok.yaslanan` bildiriminin `raf` kapsamı (`helpers/stock-aging.helper.ts`) BURADAN okur; ikinci bir
// raf tanımı yazılmaz (`test_bildirim_stok_yaslanan` §0e kaynak metnini ölçer). Küme: bitmiş (WAREHOUSE,
// A1_STOCK) + ham/yarı mamul (STOCK); sevkiyata okutulmuş (`shipmentId`) ya da çuvala girmiş (`sackId`)
// top raf değildir — kalırsa ölü/yaşlı stok çıkmak üzere olan malı da sayardı.
// Emanet (müşteri malı) ayrımı bu yüklemde DEĞİL: `stock-ownership.helper.ts` (`consignedRollSql`) üstüne biner.
// =============================================================================
import { Prisma, RollStatus } from "@prisma/client";

/** Bitmiş depo topu statüleri (kutu "Bitmiş depo"). */
export const SHELF_FINISHED_STATUSES: readonly RollStatus[] = [RollStatus.WAREHOUSE, RollStatus.A1_STOCK];
/** Ham stok + dışarıdan alınan yarı mamul (ayıran `entrySource`). */
export const SHELF_RAW_STATUSES: readonly RollStatus[] = [RollStatus.STOCK];

/** SQL yüklemi — `alias` sabit tablo takma adıdır (kullanıcı girdisi DEĞİL). */
export function shelfRollSql(alias: string): Prisma.Sql {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`shelfRollSql: geçersiz takma ad ${alias}`);
  const a = Prisma.raw(alias);
  return Prisma.sql`(${a}.status = ANY(${[...SHELF_FINISHED_STATUSES, ...SHELF_RAW_STATUSES]}::"RollStatus"[])
      AND ${a}."shipmentId" IS NULL
      AND ${a}."sackId" IS NULL)`;
}
