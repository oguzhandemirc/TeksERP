// =============================================================================
// DEPODA YAŞLANAN STOK — "bu top kaç gündür depoda" sorusunun TEK yüklemi (`stok.yaslanan`)
// =============================================================================
// Küme: şu an depoda olan top (`WAREHOUSE_STOCK_STATUSES` + depolu; ölü küme `K18_DEAD_STATUSES` ayrıca dışarıda).
// Yaş çıpası iki kipli (kullanıcı kararı 2026-11-14, `bildirim.stokYaslanan.kaynak`):
//   • `depo-giris` (varsayılan): depo defterinde topun SON GERÇEK GİRİŞİ — dışarıdan depoya satır
//     (`from` boş, `to` dolu). Ters kayıt satırı giriş sayılmaz; terslenmiş satır hiç olmamış sayılır
//     (sevk stornosu topu eski girişine döndürür). ADJUST/TRANSFORM/OPENING_BALANCE giriş değildir
//     (miktar · kesim · kesme anı fotoğrafı). Girişten SONRA terslenmemiş bir çıkış varsa defter o top
//     için tutarsızdır. Girişi olmayan ya da tutarsız top `statusChangedAt`e DÜŞER ve `fallback` sayılır
//     — metinde açıkça yazılır, sessiz tahmin yok (defter geçmişi eski toplarda yok: backfill yok kararı).
//   • `durum-degisimi`: `Roll.statusChangedAt` (trigger damgası; Stok & Ölü Stok raporunun raf yaşı çıpası).
// "En son giriş" okuyucusu `MOVEMENT_DESC` ikizidir: `createdAt DESC, id DESC` (eşitlik bozucu, defter.md).
// Çıpası bilinmeyen (NULL) top sayılmaz. Yaş mutlak farktır: çıpa ≤ `cutoff` (= an − N gün).
// =============================================================================
import { Prisma, WarehouseEventType } from "@prisma/client";
import { K18_DEAD_STATUSES } from "../batch.service";
import { WAREHOUSE_STOCK_STATUSES } from "./warehouse-stock.helper";
import type { StockAgingSource } from "../system-setting/defaults";

type Db = { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> };

/** Konum değiştirmeyen satırlar: giriş/çıkış sayılmaz. */
const NON_PLACEMENT_EVENTS: WarehouseEventType[] = [WarehouseEventType.ADJUST, WarehouseEventType.TRANSFORM, WarehouseEventType.OPENING_BALANCE];

export interface AgedStockGroup {
  warehouseId: string;
  warehouseName: string;
  rollCount: number;
  meters: number;
  /** `depo-giris` kipinde defter girişi olmadığı/tutarsız olduğu için durum tarihinden sayılan top. */
  fallbackCount: number;
}

/** Satır, kendisi terslenmemiş bir ters kayıtla terslenmemişse "olmuş"tur (iki kademe: ters kaydın tersi). */
function effectiveSql(alias: string): Prisma.Sql {
  const a = Prisma.raw(alias);
  return Prisma.sql`NOT EXISTS (
    SELECT 1 FROM warehouse_movements rv WHERE rv."reversesMovementId" = ${a}.id
      AND NOT EXISTS (SELECT 1 FROM warehouse_movements rr WHERE rr."reversesMovementId" = rv.id))`;
}

/** `depo-giris` çıpası: `s` aliaslı stok satırına son gerçek giriş (`e`) + tutarsızlık bayrağı. */
function entryAnchorSql(): Prisma.Sql {
  return Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT m.id, m."createdAt"
      FROM warehouse_movements m
      WHERE m."rollId" = s.id AND m."reversesMovementId" IS NULL
        AND m."fromWarehouseId" IS NULL AND m."toWarehouseId" IS NOT NULL
        AND m."eventType" <> ALL(${NON_PLACEMENT_EVENTS}::"WarehouseEventType"[])
        AND ${effectiveSql("m")}
      ORDER BY m."createdAt" DESC, m.id DESC
      LIMIT 1
    ) e ON true`;
}

function laterExitSql(): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM warehouse_movements x
    WHERE x."rollId" = s.id AND (x."createdAt", x.id) > (e."createdAt", e.id)
      AND x."reversesMovementId" IS NULL AND x."fromWarehouseId" IS NOT NULL AND x."toWarehouseId" IS NULL
      AND x."eventType" <> ALL(${NON_PLACEMENT_EVENTS}::"WarehouseEventType"[])
      AND ${effectiveSql("x")})`;
}

/**
 * Çıpası `cutoff`a eşit ya da daha eski olan depo toplarını depo başına toplar.
 * `warehouseIds` verilirse yalnız o depolar (bekçi körlük zemini; koşul kaynağı tüm depoları okur).
 */
export async function loadAgedStockGroups(
  db: Db,
  opts: { source: StockAgingSource; cutoff: Date; warehouseIds?: readonly string[] },
): Promise<AgedStockGroup[]> {
  const byEntry = opts.source === "depo-giris";
  const whFilter = opts.warehouseIds ? Prisma.sql`AND r."warehouseId" = ANY(${[...opts.warehouseIds]}::uuid[])` : Prisma.empty;
  const anchored = byEntry
    ? Prisma.sql`
      SELECT s.*, CASE WHEN f.fb THEN s."statusChangedAt" ELSE e."createdAt" END AS "anchorAt", f.fb AS fallback
      FROM stock s ${entryAnchorSql()}
      CROSS JOIN LATERAL (SELECT (e.id IS NULL OR ${laterExitSql()}) AS fb) f`
    : Prisma.sql`SELECT s.*, s."statusChangedAt" AS "anchorAt", false AS fallback FROM stock s`;
  const rows = await db.$queryRaw<Array<{ warehouseId: string; warehouseName: string; rollCount: number; meters: number; fallbackCount: number }>>(Prisma.sql`
    WITH stock AS (
      SELECT r.id, r."warehouseId", r."currentQty", r."statusChangedAt"
      FROM rolls r
      WHERE r.status = ANY(${[...WAREHOUSE_STOCK_STATUSES]}::"RollStatus"[])
        AND NOT (r.status = ANY(${K18_DEAD_STATUSES}::"RollStatus"[]))
        AND r."warehouseId" IS NOT NULL ${whFilter}
    ), anchored AS (${anchored})
    SELECT a."warehouseId"::text AS "warehouseId", w.name AS "warehouseName",
           COUNT(*)::int AS "rollCount", COALESCE(SUM(a."currentQty"), 0)::float AS meters,
           (COUNT(*) FILTER (WHERE a.fallback))::int AS "fallbackCount"
    FROM anchored a JOIN warehouses w ON w.id = a."warehouseId"
    WHERE a."anchorAt" IS NOT NULL AND a."anchorAt" <= ${opts.cutoff}
    GROUP BY a."warehouseId", w.name
    ORDER BY a."warehouseId"`);
  return rows.map((r) => ({ ...r, rollCount: Number(r.rollCount), meters: Number(r.meters), fallbackCount: Number(r.fallbackCount) }));
}
