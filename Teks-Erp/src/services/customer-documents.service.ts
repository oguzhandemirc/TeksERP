// =============================================================================
// CARİNİN BELGELERİ — cari kayıt sayfasının "Belgeler" sekmesi (cari-be madde 1)
// =============================================================================
// Yeni tablo YOK: basılı belge defteri (`printed_documents`, polimorfik docType+sourceId) kaynak kaydın carisiyle,
// gelen belge (`customer_delivery_notes`) sahip ∨ gönderen cariyle süzülür. Kimlik ↔ rol: kartın fason profili ve
// her iki bacaktaki cari hesabı AYNI kimliktir. Tür başına okuma izni `DOC_PERMISSIONS` (tek kaynak) + modül
// kapısı; izinsiz/kapalı tür sonuçta HİÇ yok. SUPERSEDED sürüm listelenmez, VOIDED durumuyla listelenir.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { matchesPermission } from "../middlewares/rbac.middleware";
import { DOC_PERMISSIONS } from "../routes/printed-document.routes";
import { factoryDayEndOfKey, factoryDayStartOfKey } from "../constants/time";
import { readFinanceEnabled } from "./system-setting/finance";
import { effectiveIncomingDocsEnabled } from "./system-setting/incoming-docs";
import { readKaliteGuvenceEnabled, readMaliyetEnabled, readProductionEnabled, readTicaretEnabled } from "./system-setting/modules";

export const INCOMING_DELIVERY_NOTE = "INCOMING_DELIVERY_NOTE" as const;

/** Cariye bağlanan basılı belge türleri → kaynak kaydın panel türü (satır tıklaması için). Cariyle ilgisiz
 *  türler (TRANSFER_DISPATCH, STOCK_COUNT, TRAVELER_CARD) bilinçle yok. */
export const PRINTED_TARGET = {
  SHIPMENT_DISPATCH: "shipment",
  QUALITY_CERTIFICATE: "shipment",
  INSPECTION_REPORT: "shipment",
  RETURN_DISPATCH: "return",
  SUBCONTRACTOR_DISPATCH: "subcontractor-dispatch",
  SUBCONTRACTOR_RECEIPT: "subcontractor-receipt",
  SUBCONTRACTOR_DIRECT_SHIP: "direct-shipment",
  KARTELA_DISPATCH: "kartela-dispatch",
  GOODS_RECEIPT: "goods-receipt",
  INVOICE_INTERNAL: "invoice",
  PAYMENT_RECEIPT: "payment",
  RECONCILIATION_LETTER: "reconciliation-letter",
  CHEQUE_DELIVERY_NOTE: "cheque-delivery-note",
  SALES_QUOTE: "quote",
  PRICE_LIST: "price-list",
  ORDER_CONFIRMATION: "order",
} as const;

export type CustomerPrintedDocType = keyof typeof PRINTED_TARGET;
export type CustomerDocType = CustomerPrintedDocType | typeof INCOMING_DELIVERY_NOTE;
export const CUSTOMER_DOC_TYPES = [...(Object.keys(PRINTED_TARGET) as CustomerPrintedDocType[]), INCOMING_DELIVERY_NOTE] as const;

type ModuleReader = () => Promise<boolean>;
// Kaynak modülün route kapısıyla aynı zincir: maliyet = üretim ∧ maliyet (`requireMaliyetEnabled`), gelen belge =
// emanet ∧ gelen belge (`requireGelenBelgeEnabled`). Okuyucu örneği paylaşılır ki istek başına bir kez koşsun.
const finance: ModuleReader = () => readFinanceEnabled();
const maliyet: ModuleReader = async () => (await readProductionEnabled()) && (await readMaliyetEnabled());
const ticaret: ModuleReader = () => readTicaretEnabled();
const kaliteGuvence: ModuleReader = () => readKaliteGuvenceEnabled();
const incomingDocs: ModuleReader = () => effectiveIncomingDocsEnabled();
/** Tür → modül kapısı. Burada olmayan tür çekirdektir (hep açık). */
const TYPE_MODULE: Partial<Record<CustomerDocType, ModuleReader>> = {
  INVOICE_INTERNAL: finance,
  PAYMENT_RECEIPT: finance,
  RECONCILIATION_LETTER: finance,
  CHEQUE_DELIVERY_NOTE: finance,
  SALES_QUOTE: maliyet,
  PRICE_LIST: maliyet,
  GOODS_RECEIPT: ticaret,
  INSPECTION_REPORT: kaliteGuvence,
  [INCOMING_DELIVERY_NOTE]: incomingDocs,
};

/** Türün okuma izinleri: basılı belge `DOC_PERMISSIONS[tür].read` (baskı ucuyla hizalı), gelen belge kendi okuma izni. */
export function customerDocReadPermissions(type: CustomerDocType): string[] {
  return type === INCOMING_DELIVERY_NOTE ? ["gelen-belge:read"] : DOC_PERMISSIONS[type].read;
}

/** Kullanıcının görebildiği türler (izin ∧ modül); modül okuyucusu istek başına bir kez koşar (sorgu bütçesi sabit). */
export async function visibleCustomerDocTypes(permissions: string[]): Promise<CustomerDocType[]> {
  const permitted = CUSTOMER_DOC_TYPES.filter((t) => customerDocReadPermissions(t).some((p) => matchesPermission(permissions, p)));
  const readers = [...new Set(permitted.map((t) => TYPE_MODULE[t]).filter((r): r is ModuleReader => !!r))];
  const open = new Map(await Promise.all(readers.map(async (r) => [r, await r()] as const)));
  return permitted.filter((t) => { const r = TYPE_MODULE[t]; return !r || open.get(r) === true; });
}

// ── Kaynak bağları: tür → "bu carinin kaynak kimlikleri" alt sorgusu ─────────────────────────────────────────
const subOf = (c: string) => Prisma.sql`SELECT id FROM subcontractors WHERE "customerId" = ${c}::uuid`;
const accountsOf = (c: string) =>
  Prisma.sql`SELECT id FROM cari_accounts WHERE "customerId" = ${c}::uuid OR "subcontractorId" IN (${subOf(c)})`;
const shipmentsOf = (c: string) => Prisma.sql`SELECT id FROM shipments WHERE "customerId" = ${c}::uuid`;
const bySub = (table: string) => (c: string) =>
  Prisma.sql`SELECT id FROM ${Prisma.raw(table)} WHERE "subcontractorId" IN (${subOf(c)})`;
const byCari = (table: string) => (c: string) => Prisma.sql`SELECT id FROM ${Prisma.raw(table)} WHERE "cariId" IN (${accountsOf(c)})`;
const byCustomer = (table: string) => (c: string) => Prisma.sql`SELECT id FROM ${Prisma.raw(table)} WHERE "customerId" = ${c}::uuid`;

const SOURCE_IDS: Record<CustomerPrintedDocType, (c: string) => Prisma.Sql> = {
  SHIPMENT_DISPATCH: shipmentsOf,
  QUALITY_CERTIFICATE: shipmentsOf,
  INSPECTION_REPORT: shipmentsOf,
  RETURN_DISPATCH: byCustomer("roll_returns"),
  SUBCONTRACTOR_DISPATCH: bySub("subcontractor_dispatches"),
  SUBCONTRACTOR_RECEIPT: bySub("subcontractor_receipts"),
  KARTELA_DISPATCH: bySub("kartela_dispatches"),
  // Doğrudan sevk iki tarafındır: alan müşteri ∨ sevki yapan fasoncu.
  SUBCONTRACTOR_DIRECT_SHIP: (c) => Prisma.sql`SELECT ds.id FROM direct_shipments ds JOIN subcontractor_dispatches d ON d.id = ds."dispatchId"
    WHERE ds."customerId" = ${c}::uuid OR d."subcontractorId" IN (${subOf(c)})`,
  GOODS_RECEIPT: (c) => Prisma.sql`SELECT id FROM goods_receipts WHERE "supplierId" = ${c}::uuid OR "subcontractorId" IN (${subOf(c)})`,
  INVOICE_INTERNAL: byCari("invoices"),
  PAYMENT_RECEIPT: byCari("payments"),
  RECONCILIATION_LETTER: byCari("reconciliation_letters"),
  CHEQUE_DELIVERY_NOTE: byCari("cheque_delivery_notes"),
  SALES_QUOTE: byCustomer("sales_quotes"),
  PRICE_LIST: byCustomer("price_lists"),
  ORDER_CONFIRMATION: byCustomer("orders"),
};

export interface CustomerDocumentsQuery {
  page: number;
  pageSize: number;
  /** İstenen türler; boş = görünen hepsi. Görünmeyen tür sessizce kesişimden düşer. */
  types: CustomerDocType[];
  from?: string;
  to?: string;
}

export interface CustomerDocumentRow {
  kind: "printed" | "incoming";
  docType: CustomerDocType;
  id: string;
  sourceId: string;
  documentNo: string;
  date: string;
  status: string;
  version: number | null;
  target: { type: string; id: string };
}

interface RawDocRow { kind: "printed" | "incoming"; docType: CustomerDocType; id: string; sourceId: string; documentNo: string; date: Date; status: string; version: number | null }

function dateClause(column: Prisma.Sql, q: Pick<CustomerDocumentsQuery, "from" | "to">): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (q.from) parts.push(Prisma.sql`${column} >= ${factoryDayStartOfKey(q.from)}`);
  if (q.to) parts.push(Prisma.sql`${column} <= ${factoryDayEndOfKey(q.to)}`);
  return parts.length ? Prisma.sql` AND ${Prisma.join(parts, " AND ")}` : Prisma.empty;
}

/** Liste + toplam TEK gövdeden (tek where): görünen türlerin dalları UNION ALL. */
function documentsSql(customerId: string, types: CustomerDocType[], q: CustomerDocumentsQuery): Prisma.Sql | null {
  const branches: Prisma.Sql[] = [];
  const printed = types.filter((t): t is CustomerPrintedDocType => t !== INCOMING_DELIVERY_NOTE);
  if (printed.length) {
    const links = printed.map((t) => Prisma.sql`(pd."docType" = ${t}::"PrintedDocType" AND pd."sourceId" IN (${SOURCE_IDS[t](customerId)}))`);
    branches.push(Prisma.sql`SELECT 'printed' AS kind, pd."docType"::text AS "docType", pd.id, pd."sourceId", pd."documentNo",
      pd."createdAt" AS date, pd.status::text AS status, pd.version FROM printed_documents pd
      WHERE pd.status <> 'SUPERSEDED' AND (${Prisma.join(links, " OR ")})${dateClause(Prisma.sql`pd."createdAt"`, q)}`);
  }
  if (types.includes(INCOMING_DELIVERY_NOTE)) {
    branches.push(Prisma.sql`SELECT 'incoming' AS kind, ${INCOMING_DELIVERY_NOTE} AS "docType", n.id, n.id AS "sourceId", n."noteNo" AS "documentNo",
      n."createdAt" AS date, n.status::text AS status, NULL::int AS version FROM customer_delivery_notes n
      WHERE (n."ownerCustomerId" = ${customerId}::uuid OR n."senderCustomerId" = ${customerId}::uuid)${dateClause(Prisma.sql`n."createdAt"`, q)}`);
  }
  return branches.length ? Prisma.join(branches, " UNION ALL ") : null;
}

function toRow(r: RawDocRow): CustomerDocumentRow {
  const targetType = r.kind === "incoming" ? "incoming-delivery-note" : PRINTED_TARGET[r.docType as CustomerPrintedDocType];
  return { ...r, date: r.date.toISOString(), target: { type: targetType, id: r.sourceId } };
}

export async function listCustomerDocuments(customerId: string, q: CustomerDocumentsQuery, permissions: string[]) {
  const exists = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!exists) throw AppError.notFound("Cari bulunamadı.", { code: "CUSTOMER_NOT_FOUND", customerId });
  const visible = await visibleCustomerDocTypes(permissions);
  const wanted = q.types.length ? visible.filter((t) => q.types.includes(t)) : visible;
  const body = documentsSql(customerId, wanted, q);
  const empty = { data: [] as CustomerDocumentRow[], pagination: { page: q.page, pageSize: q.pageSize, total: 0, totalPages: 0 }, types: visible };
  if (!body) return empty;
  const [rows, [count]] = await Promise.all([
    prisma.$queryRaw<RawDocRow[]>(Prisma.sql`WITH docs AS (${body}) SELECT * FROM docs
      ORDER BY date DESC, id DESC LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`),
    prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`WITH docs AS (${body}) SELECT COUNT(*) AS total FROM docs`),
  ]);
  const total = Number(count?.total ?? 0);
  return { ...empty, data: rows.map(toRow), pagination: { ...empty.pagination, total, totalPages: Math.ceil(total / q.pageSize) } };
}
