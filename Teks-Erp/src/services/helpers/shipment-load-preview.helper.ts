// =============================================================================
// SEVK ÖNCESİ YÜK ÖNİZLEMESİ (9.1, Gülkesim) — "bu yükte hangi iş emrinin kaç topu var, geride top kaldı mı"
// =============================================================================
// Gülkesim'de sipariş yok: mal boyahane kağıdıyla (gelen belge) gelir, iş emri olur, işlenip geri gider. Sevk
// öncesi sorulacak soru siparişin karşılanması değil İŞ EMRİNİN tamamlanmasıdır. Salt-okur, ENGELLEMEZ; uyarır.
// Top ↔ iş emri bağı partiden (`Roll.batchId → Batch.workOrderId`), kaynak belge gelen belge satırının
// topundan. Sabit sorgu sayısı (N+1 yok): iş emri toplamları tek SQL, sahip dağılımı tek SQL.
// =============================================================================
import { Prisma, RollStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { K18_DEAD_STATUSES } from "../batch.service";

/** İş emrinin "sevk edilebilir canlı topu" sayılmayanlar: tüketilmiş/iptal + gerçek fire + fason dönüşünde kapanan. */
const NOT_COUNTED: RollStatus[] = [...K18_DEAD_STATUSES, RollStatus.SCRAP, RollStatus.RETURNED_FROM_SUBCONTRACTOR];
/** Geride kalan topun "hâlâ işlemde" sayıldığı durumlar (gerisi rafta/depoda bekliyor). */
const IN_PROCESS: RollStatus[] = [RollStatus.IN_PRODUCTION, RollStatus.AT_SUBCONTRACTOR, RollStatus.AT_KARTELA];

export interface LoadPreviewInput {
  shipmentId?: string | null;
  sackIds?: string[];
  rollIds?: string[];
  customerId?: string | null;
}

export interface LoadPreviewWorkOrder {
  workOrderId: string;
  workOrderNo: string;
  inLoad: number;
  inLoadMeters: number;
  total: number;
  shippedElsewhere: number;
  remaining: number;
  remainingInProcess: number;
  sourceDocs: { noteNo: string; senderDocNo: string | null }[];
}

export interface LoadPreview {
  rollCount: number;
  totalMeters: number;
  workOrders: LoadPreviewWorkOrder[];
  noWorkOrder: { rollCount: number; meters: number };
  owners: { customerId: string | null; name: string | null; rollCount: number }[];
  warnings: string[];
}

type WoRow = {
  wo_id: string | null; wo_no: string | null; in_load: number; in_load_m: string; total: number; elsewhere: number;
  in_process: number; docs: { noteNo: string; senderDocNo: string | null }[] | null;
};
type OwnerRow = { owner_id: string | null; name: string | null; n: number };

/** Yükün top kümesi: sevkiyatın canlı topları ∪ seçilen çuvalların topları ∪ okutulan toplar. */
function selectionSql(p: LoadPreviewInput): Prisma.Sql {
  const sackIds = p.sackIds ?? [];
  const rollIds = p.rollIds ?? [];
  return Prisma.sql`
    SELECT r.id, r."batchId", r."currentQty", COALESCE(r."ownerCustomerId", r."labelCustomerId") AS owner_id
    FROM rolls r
    WHERE (${p.shipmentId ?? null}::uuid IS NOT NULL AND r."shipmentId" = ${p.shipmentId ?? null}::uuid)
       OR r."sackId" = ANY(${sackIds}::uuid[])
       OR r.id = ANY(${rollIds}::uuid[])`;
}

export async function buildShipmentLoadPreview(p: LoadPreviewInput): Promise<LoadPreview> {
  const sel = selectionSql(p);
  const woRows = await prisma.$queryRaw<WoRow[]>(Prisma.sql`
    WITH sel AS (${sel}),
    grp AS (
      SELECT b."workOrderId" AS wo_id, COUNT(*)::int AS in_load, COALESCE(SUM(sel."currentQty"), 0)::text AS in_load_m
      FROM sel LEFT JOIN batches b ON b.id = sel."batchId" GROUP BY b."workOrderId"
    )
    SELECT g.wo_id, w."workOrderNumber" AS wo_no, g.in_load, g.in_load_m,
      COALESCE(t.total, 0)::int AS total, COALESCE(t.elsewhere, 0)::int AS elsewhere, COALESCE(t.in_process, 0)::int AS in_process,
      d.docs
    FROM grp g
    LEFT JOIN work_orders w ON w.id = g.wo_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE r2.status = 'SHIPPED' AND r2.id NOT IN (SELECT id FROM sel)) AS elsewhere,
        COUNT(*) FILTER (WHERE r2.status::text = ANY(${IN_PROCESS}::text[]) AND r2.id NOT IN (SELECT id FROM sel)) AS in_process
      FROM rolls r2 JOIN batches b2 ON b2.id = r2."batchId"
      WHERE b2."workOrderId" = g.wo_id AND NOT (r2.status::text = ANY(${NOT_COUNTED}::text[]))
    ) t ON g.wo_id IS NOT NULL
    LEFT JOIN LATERAL (
      SELECT json_agg(DISTINCT jsonb_build_object('noteNo', n."noteNo", 'senderDocNo', n."senderDocNo")) AS docs
      FROM customer_delivery_note_lines l
      JOIN rolls r3 ON r3.id = l."rollId"
      JOIN batches b3 ON b3.id = r3."batchId"
      JOIN customer_delivery_notes n ON n.id = l."noteId"
      WHERE b3."workOrderId" = g.wo_id AND n."cancelledAt" IS NULL
    ) d ON g.wo_id IS NOT NULL
    ORDER BY w."workOrderNumber" NULLS LAST`);
  const ownerRows = await prisma.$queryRaw<OwnerRow[]>(Prisma.sql`
    WITH sel AS (${sel})
    SELECT sel.owner_id, c.name, COUNT(*)::int AS n
    FROM sel LEFT JOIN customers c ON c.id = sel.owner_id
    GROUP BY sel.owner_id, c.name ORDER BY n DESC`);
  const customerName = p.customerId
    ? (await prisma.customer.findUnique({ where: { id: p.customerId }, select: { name: true } }))?.name ?? null
    : null;
  return shapePreview(woRows, ownerRows, { customerId: p.customerId ?? null, customerName });
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Saf biçimleme — uyarı metinleri burada kurulur (istemci metin üretmez). */
export function shapePreview(woRows: WoRow[], ownerRows: OwnerRow[], target: { customerId: string | null; customerName: string | null }): LoadPreview {
  const workOrders: LoadPreviewWorkOrder[] = [];
  let noWo = { rollCount: 0, meters: 0 };
  for (const r of woRows) {
    if (!r.wo_id) {
      noWo = { rollCount: r.in_load, meters: round3(Number(r.in_load_m)) };
      continue;
    }
    const remaining = Math.max(0, r.total - r.in_load - r.elsewhere);
    workOrders.push({
      workOrderId: r.wo_id, workOrderNo: r.wo_no ?? "?", inLoad: r.in_load, inLoadMeters: round3(Number(r.in_load_m)),
      total: r.total, shippedElsewhere: r.elsewhere, remaining, remainingInProcess: Math.min(remaining, r.in_process), sourceDocs: r.docs ?? [],
    });
  }
  const warnings: string[] = [];
  for (const w of workOrders) {
    if (w.remaining === 0) continue;
    const where = w.remainingInProcess > 0 ? ` (${w.remainingInProcess} top hâlâ işlemde)` : " (rafta bekliyor)";
    warnings.push(`${w.workOrderNo}: bu sevkte ${w.inLoad}/${w.total} top — ${w.remaining} top eksik${where}`);
  }
  const owners = ownerRows.map((o) => ({ customerId: o.owner_id, name: o.name, rollCount: o.n }));
  const known = owners.filter((o) => o.customerId);
  if (known.length > 1) {
    warnings.push(`Farklı müşterilerin topları karışmış: ${known.map((o) => `${o.name ?? "?"} (${o.rollCount} top)`).join(", ")}`);
  } else if (known.length === 1 && target.customerId && known[0]!.customerId !== target.customerId) {
    warnings.push(`Toplar ${known[0]!.name ?? "başka müşteri"} müşterisine ait — sevkiyat ${target.customerName ?? "başka müşteri"} adına`);
  }
  const rollCount = woRows.reduce((s, r) => s + r.in_load, 0);
  const totalMeters = round3(woRows.reduce((s, r) => s + Number(r.in_load_m), 0));
  return { rollCount, totalMeters, workOrders, noWorkOrder: noWo, owners, warnings };
}
