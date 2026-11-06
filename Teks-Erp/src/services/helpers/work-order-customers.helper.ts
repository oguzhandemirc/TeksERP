// =============================================================================
// İŞ EMRİ LİSTESİ — MÜŞTERİ ROLLUP'I (kullanıcı isteği 2026-09-15)
// =============================================================================
// İş emri ↔ müşteri bağı: ÖNCE `orderLinks(aktif) → orderLine → order → customer`
// (top↔sipariş bağı yok; `WorkOrder.type` bağın aynasıdır). AÇIK BAĞ YOKSA (2026-11-06, fason/Gülkesim:
// boyahane kâğıdından siparişsiz doğan İE) iş emrinin TOPLARININ sahibi (`Roll.ownerCustomerId` — emanet
// doğum niteliği; gelen belge onayı belgenin sahibini buraya yazar, belge cari'si ayrı kaynak DEĞİL). Bir iş emri N bağ ⇒ N müşteri
// olabilir; liste satırı DISTINCT müşterileri BAĞLANMA SIRASIYLA (ilk bağlanan = birincil;
// ad sırası değil — iş emri kimin için açıldıysa o öne çıkar, sonradan eklenen sipariş öne
// geçmez), ilk `WO_CUSTOMER_PREVIEW` tanesini + toplam sayıyı taşır (panel: 0 "—" · 1 ad ·
// 2+ ad + "+N"). Saf fonksiyon: liste/detay select'i bağları `createdAt asc` getirir ve
// müşteriyi AYNI sorguda taşır; burada yalnız bellekten süzülür (N+1 yok). `createdAt` yoksa
// dizi sırası korunur (eşit damgada da dizi sırası — sıralama kararlı).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { buildTextSearch } from "../../utils/query-parser";
import { ACTIVE_ORDER_LINK } from "./order-link.helper";
import { whereWorkOrdersOfRolls } from "./workorder-rolls.helper";

export const WO_CUSTOMER_PREVIEW = 5;

export interface WorkOrderCustomerRef {
  id: string;
  name: string;
}

export interface WorkOrderCustomerRollup {
  /** DISTINCT, bağlanma sırasıyla (ilk bağlanan önce = birincil), en çok `WO_CUSTOMER_PREVIEW`. */
  customers: WorkOrderCustomerRef[];
  /** DISTINCT müşteri TOPLAMI (önizlemeden fazlası için). */
  customerCount: number;
}

type LinkLike = { createdAt?: Date | string | null; orderLine?: { order?: { customer?: WorkOrderCustomerRef | null } | null } | null } | null | undefined;

/** Bağları bağlanma sırasına koyar (`createdAt` asc; damgasız/eşit damgada dizi sırası) — TEK sıralama kaynağı. */
export function sortLinksByLinkedAt<T extends LinkLike>(links: readonly T[] | null | undefined): T[] {
  const ts = (l: LinkLike): number => (l?.createdAt ? new Date(l.createdAt).getTime() : 0);
  return (links ?? []).map((l, i) => ({ l, i })).sort((a, b) => ts(a.l) - ts(b.l) || a.i - b.i).map((x) => x.l);
}

export function rollupWorkOrderCustomers(links: readonly LinkLike[] | null | undefined): WorkOrderCustomerRollup {
  const byId = new Map<string, WorkOrderCustomerRef>();
  for (const l of sortLinksByLinkedAt(links)) {
    const c = l?.orderLine?.order?.customer;
    if (c && !byId.has(c.id)) byId.set(c.id, { id: c.id, name: c.name });
  }
  const ordered = [...byId.values()];
  return { customers: ordered.slice(0, WO_CUSTOMER_PREVIEW), customerCount: ordered.length };
}

// ── SİPARİŞSİZ İE: TOP SAHİBİ (2026-11-06) ─────────────────────────────────────
// Liste satırı · süzgeç · arama AYNI kuralı söyler: açık sipariş bağı varsa sipariş müşterisi (bugünkü davranış),
// yoksa toplarının sahibi. İE ↔ sahip kenarları `whereRollsOfWorkOrder`un SQL ikizi (üç bağ: parti · durduğu adım ·
// üretildiği adım), TEK parçadan (`rollOwnerEdges`) okunur; ikizlik `test_workorder_customer_owner` §5'te ölçülür.

/** İE ↔ top sahibi kenarları (wo_id · owner_id · born); `cond` her dalın WHERE'ine eklenir (`wo` = o dalın İE kolonu). */
function rollOwnerEdges(cond: (wo: Prisma.Sql) => Prisma.Sql): Prisma.Sql {
  const branch = (from: Prisma.Sql, wo: Prisma.Sql) => Prisma.sql`
      SELECT ${wo} AS wo_id, r."ownerCustomerId" AS owner_id, r."createdAt" AS born
        FROM rolls r ${from}
       WHERE r."ownerCustomerId" IS NOT NULL AND ${cond(wo)}`;
  return Prisma.sql`${branch(Prisma.sql`JOIN batches b ON b.id = r."batchId"`, Prisma.sql`b."workOrderId"`)}
      UNION ALL${branch(Prisma.sql`JOIN work_order_steps s ON s.id = r."currentStepId"`, Prisma.sql`s."workOrderId"`)}
      UNION ALL${branch(Prisma.sql`JOIN work_order_steps s ON s.id = r."producedInStepId"`, Prisma.sql`s."workOrderId"`)}`;
}

/** İş emri başına DISTINCT top sahipleri, ilk sahipli top doğuş sırasıyla (birincil = ilk gelen mal). Sayfa başına TEK sorgu. */
export async function loadRollOwnersByWorkOrder(workOrderIds: readonly string[]): Promise<Map<string, WorkOrderCustomerRef[]>> {
  const out = new Map<string, WorkOrderCustomerRef[]>();
  if (workOrderIds.length === 0) return out;
  const ids = [...new Set(workOrderIds)];
  const rows = await prisma.$queryRaw<Array<{ wo_id: string; id: string; name: string }>>(Prisma.sql`
    SELECT x.wo_id, c.id, c.name
      FROM (${rollOwnerEdges((wo) => Prisma.sql`${wo} = ANY(${ids}::uuid[])`)}) x
      JOIN customers c ON c.id = x.owner_id
     GROUP BY x.wo_id, c.id, c.name
     ORDER BY x.wo_id, MIN(x.born), c.id`);
  for (const r of rows) {
    const list = out.get(r.wo_id) ?? [];
    list.push({ id: r.id, name: r.name });
    out.set(r.wo_id, list);
  }
  return out;
}

/** Liste satırının müşterisi: açık bağdan gelen müşteri varsa o; yoksa top sahipleri (sırası korunur). */
export function resolveWorkOrderCustomers(links: readonly LinkLike[] | null | undefined, rollOwners: readonly WorkOrderCustomerRef[] | undefined): WorkOrderCustomerRollup {
  const fromOrders = rollupWorkOrderCustomers(links);
  if (fromOrders.customerCount > 0 || !rollOwners?.length) return fromOrders;
  return { customers: rollOwners.slice(0, WO_CUSTOMER_PREVIEW).map((c) => ({ id: c.id, name: c.name })), customerCount: rollOwners.length };
}

/** Açık sipariş bağı YOK — top sahibi dalının ön koşulu (gösterimle aynı: bağ varsa sahip okunmaz). */
const NO_ACTIVE_ORDER_LINK: Prisma.WorkOrderWhereInput = { orderLinks: { none: { ...ACTIVE_ORDER_LINK } } };

/** Sahip dalı kimlik listesine çevrilir; bu tavanın üstünde (sorgu parametre sınırı) EXISTS biçimine düşülür — doğru ama yavaş. */
export const OWNER_FILTER_ID_CAP = 20_000;

/**
 * `filter[customerId]` — `resolveWorkOrderCustomers` ile aynı kural (seçilen müşteri satırda görünür). Sahip dalı
 * Prisma'da üç `EXISTS`in OR'u olurdu: planlayıcı maliyeti ~100 kat şişirip JIT derlemesine (≈2 sn) giriyordu
 * (EXPLAIN 2026-11-06, 10 bin İE / 200 bin top; yürütme 58 ms). Kimlikler aynı kenar parçasından indeksle okunur.
 */
export async function workOrderCustomerWhere(customerCond: string | { in: string[] }, cap = OWNER_FILTER_ID_CAP): Promise<Prisma.WorkOrderWhereInput> {
  const ownerIds = typeof customerCond === "string" ? [customerCond] : customerCond.in;
  const rows = await prisma.$queryRaw<Array<{ wo_id: string }>>(Prisma.sql`
    SELECT DISTINCT x.wo_id
      FROM (${rollOwnerEdges(() => Prisma.sql`r."ownerCustomerId" = ANY(${ownerIds}::uuid[])`)}) x
     WHERE NOT EXISTS (SELECT 1 FROM work_order_to_order_lines t WHERE t."workOrderId" = x.wo_id AND t."unlinkedAt" IS NULL)
     LIMIT ${cap + 1}`);
  const ownerBranch: Prisma.WorkOrderWhereInput = rows.length > cap
    ? whereWorkOrdersOfRolls({ ownerCustomerId: customerCond })
    : { id: { in: rows.map((r) => r.wo_id) } };
  return {
    OR: [
      { orderLinks: { some: { ...ACTIVE_ORDER_LINK, orderLine: { order: { customerId: customerCond } } } } },
      { AND: [NO_ACTIVE_ORDER_LINK, ownerBranch] },
    ],
  };
}

/** Arama: siparişsiz İE'de top sahibinin adı (sipariş müşterisi adı `buildWhereClause` yolunda kalır). */
export function workOrderOwnerNameSearchWhere(q: string): Prisma.WorkOrderWhereInput | null {
  const leaves = buildTextSearch<Prisma.RollWhereInput>(q, { text: ["ownerCustomer.name"] });
  if (leaves.length === 0) return null;
  return { AND: [NO_ACTIVE_ORDER_LINK, whereWorkOrdersOfRolls({ OR: leaves })] };
}

/**
 * İE'nin KENDİ müşterisi (yalnız Fason (müşteri malı) türü yazar) varsa liste müşterisi odur — bağdan/türetmeden
 * gelen rollup yalnız kendi müşterisi olmayan İE'de geçerli (2026-11-06).
 */
export function withOwnCustomer(own: WorkOrderCustomerRef | null | undefined, derived: WorkOrderCustomerRollup): WorkOrderCustomerRollup {
  return own ? { customers: [{ id: own.id, name: own.name }], customerCount: 1 } : derived;
}
