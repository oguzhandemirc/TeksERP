// =============================================================================
// e-İrsaliye KAYITLARI listesi (E7-PANEL) — liste + cursor + özet şeridi TEK where'den
// =============================================================================
// `buildEIrsaliyeListWhere` iki ucun (liste, özet) tek yazarıdır: özet ayrı where kursaydı
// şeritteki sayı tabloyla çelişirdi (filtre-liste.md). Süzme sunucuda; XML gövdesi dönmez.
// =============================================================================
import { EIrsaliyeStatus, type Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { buildNextCursor, cursorWhere, decodeCursor } from "../../utils/cursor";
import { readFilterList } from "../../utils/query-parser";
import { isSimulationAdapter } from "./adapters/registry";

/** Uçun okuduğu süzgeç adları — çıplak-süzgeç kapısı da bu listeyi kullanır. */
export const EIRSALIYE_RECORD_FILTER_NAMES = ["status", "adapter"] as const;

const STATUS_SET = new Set<string>(Object.values(EIrsaliyeStatus));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EIrsaliyeListQuery {
  search?: string;
  filters: Record<string, string | string[] | undefined>;
}

/** Tek where yazarı: durum (çoklu) + yöntem + arama (belge no · sevkiyat no · müşteri · tam ETTN). */
export function buildEIrsaliyeListWhere(q: EIrsaliyeListQuery): Prisma.EIrsaliyeWhereInput {
  const and: Prisma.EIrsaliyeWhereInput[] = [];
  const statuses = readFilterList(q.filters.status);
  const unknown = statuses.filter((s) => !STATUS_SET.has(s));
  if (unknown.length > 0) {
    throw AppError.badRequest(`Tanınmayan e-İrsaliye durumu: ${unknown.join(", ")}.`, { code: "EIRSALIYE_FILTER_INVALID" });
  }
  if (statuses.length > 0) and.push({ status: { in: statuses as EIrsaliyeStatus[] } });
  const adapters = readFilterList(q.filters.adapter);
  if (adapters.length > 0) and.push({ adapter: { in: adapters } });
  const s = q.search?.trim();
  if (s) {
    const or: Prisma.EIrsaliyeWhereInput[] = [
      { documentNo: { contains: s, mode: "insensitive" } },
      { confirmedNo: { contains: s, mode: "insensitive" } },
      { shipment: { is: { shipmentNo: { contains: s, mode: "insensitive" } } } },
      { shipment: { is: { customer: { is: { name: { contains: s, mode: "insensitive" } } } } } },
    ];
    // ETTN uuid kolonu: `contains` P2007 verir; yalnız tam ETTN eşlenir.
    if (UUID_RE.test(s)) or.push({ ettn: s }, { confirmedEttn: s });
    and.push({ OR: or });
  }
  return and.length === 0 ? {} : { AND: and };
}

const ROW_SELECT = {
  id: true, status: true, documentNo: true, ettn: true, confirmedNo: true, adapter: true,
  shipmentId: true, sentAt: true, responseAt: true, downloadCount: true, createdAt: true, updatedAt: true,
  shipment: { select: { shipmentNo: true, dispatchedAt: true, customer: { select: { name: true } } } },
} satisfies Prisma.EIrsaliyeSelect;

export async function listEIrsaliyeRecords(q: EIrsaliyeListQuery & { cursor?: string; limit: number; withTotal: boolean }) {
  const where = buildEIrsaliyeListWhere(q);
  const cur = decodeCursor(q.cursor);
  const rows = await prisma.eIrsaliye.findMany({
    where: cur ? { AND: [where, cursorWhere(cur)] } : where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
    select: ROW_SELECT,
  });
  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
  const totalEstimate = q.withTotal ? await prisma.eIrsaliye.count({ where }) : undefined;
  return {
    items: page.map((r) => ({ ...r, simulasyon: isSimulationAdapter(r.adapter) })),
    pagination: { nextCursor: hasMore ? buildNextCursor(page[page.length - 1]) : null, hasMore, limit: q.limit, totalEstimate },
  };
}

/** Özet şeridi: durum başına adet — listeyle AYNI where. */
export async function summarizeEIrsaliyeRecords(q: EIrsaliyeListQuery) {
  const where = buildEIrsaliyeListWhere(q);
  const groups = await prisma.eIrsaliye.groupBy({ by: ["status"], where, _count: { _all: true } });
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const g of groups) {
    byStatus[g.status] = g._count._all;
    total += g._count._all;
  }
  return { total, byStatus };
}
