// =============================================================================
// TeksERP — Raporlarda SÜZGEÇ EKSENLERİ (raporlar fazı R5b-c): müşteri · hedef · kalem · fasoncu · sebep
// =============================================================================
// Tek sözleşme, üç katman: ① Zod parçaları (`.strict()` şemaya yayılır; kimlik listesi CSV ya da tekrarlı
// anahtar → `readFilterList`; uuid biçimi 400) · ② Prisma / ham SQL koşul üreticileri (süzgeç yoksa parça
// BOŞ — sorgu bayt bayt eski) · ③ `filterEcho` — cevaba yalnız VERİLEN anahtarlar yazılır (R5b-b `meta.suzgec`
// ile aynı biçim: düz nesne, anahtar = sorgu parametresi adı). Tanınmayan kimlik 404 DEĞİL boş sonuçtur
// (liste semantiği; R5b-b'nin tekil levent 404'ünden farkı belgede). `destination` müşterinin VARSAYILAN
// hedefidir (`Customer.defaultDestination`), sevkin fiili hedefi değil.
// =============================================================================
import { Prisma, ShipmentDestination } from "@prisma/client";
import { z } from "zod";
import { readFilterList } from "../../utils/query-parser";
import { ACTIVE_LINE } from "../helpers/order-line-scope.helper";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIST = 50;
const rawList = z.union([z.string(), z.array(z.string())]).optional().transform((v) => readFilterList(v));
const idList = rawList
  .refine((l) => l.length <= MAX_LIST, { message: `En fazla ${MAX_LIST} kimlik` })
  .refine((l) => l.every((x) => UUID_RE.test(x)), { message: "Geçersiz kimlik (uuid bekleniyor)" });
const codeList = rawList
  .refine((l) => l.length <= MAX_LIST, { message: `En fazla ${MAX_LIST} kod` })
  .refine((l) => l.every((x) => x.length <= 64), { message: "Kod en fazla 64 karakter" });

/** Sipariş kökenli raporlar: müşteri kimliği + müşterinin varsayılan hedefi. */
export const musteriEkseni = { customerId: idList, destination: z.nativeEnum(ShipmentDestination).optional() };
/** Kalem ekseni: kumaş (item) + renk. */
export const kalemEkseni = { itemId: idList, colorId: idList };
export const fasonEkseni = { subcontractorId: idList };
/** Sipariş iptal sebebi (`ORDER_CANCEL` katalog kodu, `Order.cancelReasonCode`). */
export const iptalEkseni = { reasonCode: codeList };

export interface ReportFilterInput {
  customerId?: string[];
  destination?: ShipmentDestination;
  itemId?: string[];
  colorId?: string[];
  subcontractorId?: string[];
  reasonCode?: string[];
}

/** Cevaba yazılan beyan — düz nesne, yalnız verilen anahtarlar (R5b-b `meta.suzgec` biçimi). */
export type SuzgecEcho = Record<string, string | string[] | number>;

/** Verilen süzgeç anahtarlarını (boş liste = verilmedi) düz nesneye çevirir; hiçbiri yoksa `undefined` → cevapta anahtar YOK. */
export function filterEcho(input: Record<string, unknown>, keys: readonly string[]): SuzgecEcho | undefined {
  const out: SuzgecEcho = {};
  for (const k of keys) {
    const v = input[k];
    if (Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.length > 0) out[k] = v as string | string[];
  }
  return Object.keys(out).length ? out : undefined;
}

export const hasAny = (l: string[] | undefined): l is string[] => !!l && l.length > 0;
/** `readIdCondition` ikizi (liste zaten çözülmüş): tek → eşitlik, N → `in`, yok → `undefined` (Prisma anahtarı düşer). */
export const idWhere = (l: string[] | undefined): string | { in: string[] } | undefined => (hasAny(l) ? (l.length === 1 ? l[0] : { in: l }) : undefined);

/** Siparişin MÜŞTERİ tarafı (kimlik + varsayılan hedef) — kalem kökünden `order: {...}` içine de girer. */
export function customerScopeWhere(f: ReportFilterInput): Prisma.OrderWhereInput {
  const w: Prisma.OrderWhereInput = {};
  const c = idWhere(f.customerId);
  if (c !== undefined) w.customerId = c;
  if (f.destination) w.customer = { defaultDestination: f.destination };
  return w;
}

/** Sipariş kökü (`Order`) için Prisma where parçası; kalem süzgeci "en az bir AKTİF kalem eşleşir" (`lines.some`). */
export function orderScopeWhere(f: ReportFilterInput): Prisma.OrderWhereInput {
  const w = customerScopeWhere(f);
  const line = lineScopeWhere(f);
  if (Object.keys(line).length) w.lines = { some: { ...ACTIVE_LINE, ...line } };
  return w;
}

/** Kalem kökü (`OrderLine`) için Prisma where parçası. */
export function lineScopeWhere(f: ReportFilterInput): Prisma.OrderLineWhereInput {
  const w: Prisma.OrderLineWhereInput = {};
  const i = idWhere(f.itemId);
  const c = idWhere(f.colorId);
  if (i !== undefined) w.itemId = i;
  if (c !== undefined) w.colorId = c;
  return w;
}

/** `AND <kolon> IN (...)` — `column` SABİT SQL kimliğidir (kullanıcı girdisi DEĞİL); liste yoksa boş parça. */
export function inSql(column: string, list: string[] | undefined, cast: "uuid" | "text" = "uuid"): Prisma.Sql {
  if (!hasAny(list)) return Prisma.empty;
  const vals = list.map((v) => (cast === "uuid" ? Prisma.sql`${v}::uuid` : Prisma.sql`${v}`));
  return Prisma.sql`AND ${Prisma.raw(column)} IN (${Prisma.join(vals)})`;
}

/** Müşteri KÖKÜ (`customers <alias>`) için ham SQL parçası — kimlik + varsayılan hedef doğrudan satırda. */
export function customerRowSql(f: ReportFilterInput, alias = "c"): Prisma.Sql {
  const parts: Prisma.Sql[] = [inSql(`${alias}.id`, f.customerId)];
  if (f.destination) parts.push(Prisma.sql`AND ${Prisma.raw(alias)}."defaultDestination" = ${f.destination}::"ShipmentDestination"`);
  return Prisma.join(parts, " ");
}

/** Siparişin müşteri tarafı, ham SQL — `customerScopeWhere` ikizi (`orders <alias>`; müşteri tablosu takma adı `cf` sabit). */
export function customerScopeSql(f: ReportFilterInput, orderAlias = "o"): Prisma.Sql {
  const o = Prisma.raw(orderAlias);
  const parts: Prisma.Sql[] = [inSql(`${orderAlias}."customerId"`, f.customerId)];
  if (f.destination) parts.push(Prisma.sql`AND EXISTS (SELECT 1 FROM customers cf WHERE cf.id = ${o}."customerId" AND cf."defaultDestination" = ${f.destination}::"ShipmentDestination")`);
  return Prisma.join(parts, " ");
}

/** Sipariş kökü (`orders o`) için ham SQL parçası — `orderScopeWhere` ikizi (müşteri + "en az bir aktif kalem eşleşir"). */
export function orderScopeSql(f: ReportFilterInput, orderAlias = "o"): Prisma.Sql {
  const o = Prisma.raw(orderAlias);
  const parts: Prisma.Sql[] = [customerScopeSql(f, orderAlias)];
  if (hasAny(f.itemId) || hasAny(f.colorId)) {
    parts.push(Prisma.sql`AND EXISTS (SELECT 1 FROM order_lines lf WHERE lf."orderId" = ${o}.id AND lf."cancelledAt" IS NULL ${inSql('lf."itemId"', f.itemId)} ${inSql('lf."colorId"', f.colorId)})`);
  }
  return Prisma.join(parts, " ");
}

/** Kalem kökü (`order_lines ol`) için ham SQL parçası — `lineScopeWhere` ikizi. */
export function lineScopeSql(f: ReportFilterInput, lineAlias = "ol"): Prisma.Sql {
  return Prisma.join([inSql(`${lineAlias}."itemId"`, f.itemId), inSql(`${lineAlias}."colorId"`, f.colorId)], " ");
}

/** Fason kökü (`subcontractor_dispatches sd JOIN rolls r`) için ham SQL parçası: fasoncu + topun kumaşı/rengi. */
export function subcontractScopeSql(f: ReportFilterInput, dispatchAlias = "sd", rollAlias = "r"): Prisma.Sql {
  return Prisma.join([inSql(`${dispatchAlias}."subcontractorId"`, f.subcontractorId), inSql(`${rollAlias}."itemId"`, f.itemId), inSql(`${rollAlias}."colorId"`, f.colorId)], " ");
}
