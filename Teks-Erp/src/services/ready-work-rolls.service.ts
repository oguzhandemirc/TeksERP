// =============================================================================
// SEVKE HAZIR İŞ BİRİMİNİN TOPLARI (D4-J1) — `/api/shipping/ready-works/:unit/:id/rolls`
// =============================================================================
// Üyelik `ready-works.service` `membershipSql`inden (liste ucuyla aynı parça), sınıf `readinessClassSql`den.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { readinessClassSql, type ReadinessClass } from "./helpers/ship-readiness.helper";
import { UUID_RE, membershipSql, parseLimit, parseReadyWorkUnit, readQueryList } from "./ready-works.service";

const ROLLS_DEFAULT_LIMIT = 200;
const ROLLS_MAX_LIMIT = 1000;

export interface ReadyWorkRollRow {
  id: string;
  barcode: string | null;
  status: string;
  readinessClass: ReadinessClass;
  currentQty: number;
  itemName: string | null;
  colorName: string | null;
  ownerCustomerId: string | null;
  /** Hızlı Sevk yüklemi (`SHIPPABLE_ROLL_WHERE`) çuvaldaki / sevkiyattaki topu reddeder — istemci ön-seçimde ayırır. */
  inSack: boolean;
  inShipment: boolean;
  /** Hızlı Sevk tek depodan çıkar; çekmece depoya göre ayırır. */
  warehouseId: string | null;
  warehouseName: string | null;
}

/** Birimin canlı topları (sınıflı); `rollClass` süzgeci, `id` sıralı imleç. */
export async function listReadyWorkRolls(
  unitRaw: unknown,
  idRaw: unknown,
  q: { rollClass?: unknown; cursor?: unknown; limit?: unknown },
): Promise<{ success: true; data: { items: ReadyWorkRollRow[]; nextCursor: string | null } }> {
  const unit = parseReadyWorkUnit(unitRaw);
  const rawId = typeof idRaw === "string" ? idRaw : "";
  const idOk = unit === "customerBatch"
    ? UUID_RE.test(rawId.slice(0, 36)) && rawId[36] === ":" && rawId.slice(37).trim() !== ""
    : UUID_RE.test(rawId);
  if (!idOk) throw AppError.badRequest("Birim kimliği geçersiz");
  // Kanonik biçim (liste ucunun ürettiği): UUID küçük harf, parti no kırpılmış — aksi metin eşitliği sessizce boş döner.
  const id = unit === "customerBatch" ? `${rawId.slice(0, 36).toLowerCase()}:${rawId.slice(37).trim()}` : rawId.toLowerCase();
  const classes = readQueryList(q.rollClass);
  const allowed: ReadinessClass[] = ["READY", "IN_PROCESS", "GONE", "SCRAP"];
  if (classes.some((c) => !allowed.includes(c as ReadinessClass))) throw AppError.badRequest(`Top sınıfı yalnız ${allowed.join(", ")} olabilir`);
  const limit = parseLimit(q.limit, ROLLS_DEFAULT_LIMIT, ROLLS_MAX_LIMIT);
  const cursor = typeof q.cursor === "string" && q.cursor ? q.cursor : null;
  if (cursor && !UUID_RE.test(cursor)) throw AppError.badRequest("Geçersiz sayfa imleci");

  const rows = await prisma.$queryRaw<
    Array<{ id: string; barcode: string | null; status: string; cls: ReadinessClass; qty: Prisma.Decimal; item_name: string | null; color_name: string | null; owner: string | null; in_sack: boolean; in_shipment: boolean; wh_id: string | null; wh_name: string | null }>
  >(Prisma.sql`
    WITH members AS (${membershipSql(unit, id)})
    SELECT r.id::text AS id, r.barcode, r.status::text AS status, ${readinessClassSql("r")} AS cls, r."currentQty" AS qty,
      i.name AS item_name, co.name AS color_name, r."ownerCustomerId"::text AS owner,
      (r."sackId" IS NOT NULL) AS in_sack, (r."shipmentId" IS NOT NULL) AS in_shipment, r."warehouseId"::text AS wh_id, w.name AS wh_name
    FROM (SELECT DISTINCT roll_id FROM members) m
    JOIN rolls r ON r.id = m.roll_id
    LEFT JOIN items i ON i.id = r."itemId"
    LEFT JOIN colors co ON co.id = r."colorId"
    LEFT JOIN warehouses w ON w.id = r."warehouseId"
    WHERE ${readinessClassSql("r")} IS NOT NULL
      ${classes.length ? Prisma.sql`AND ${readinessClassSql("r")} IN (${Prisma.join(classes)})` : Prisma.empty}
      ${cursor ? Prisma.sql`AND r.id > ${cursor}::uuid` : Prisma.empty}
    ORDER BY r.id
    LIMIT ${limit + 1}`);
  const page = rows.slice(0, limit);
  const items = page.map((r) => ({
    id: r.id,
    barcode: r.barcode,
    status: r.status,
    readinessClass: r.cls,
    currentQty: Number(r.qty),
    itemName: r.item_name,
    colorName: r.color_name,
    ownerCustomerId: r.owner,
    inSack: r.in_sack,
    inShipment: r.in_shipment,
    warehouseId: r.wh_id,
    warehouseName: r.wh_name,
  }));
  return { success: true, data: { items, nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null } };
}
