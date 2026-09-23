// =============================================================================
// TeksERP — Raporlarda SÜZGEÇ EKSENLERİ (raporlar fazı R5b-c): müşteri · hedef · kalem · fasoncu · sebep
// =============================================================================
// Tek sözleşme, üç katman: ① Zod parçaları (`.strict()` şemaya yayılır; kimlik listesi CSV ya da tekrarlı
// anahtar → `readFilterList`; uuid biçimi 400) · ② Prisma / ham SQL koşul üreticileri (süzgeç yoksa parça
// BOŞ — sorgu bayt bayt eski) · ③ `filterEcho` — cevaba yalnız VERİLEN anahtarlar yazılır (R5b-b `suzgec`
// ile aynı biçim ve AYNI ADRES: cevap kökü, düz nesne, anahtar = sorgu parametresi adı). Tanınmayan kimlik 404 DEĞİL
// boş sonuçtur (liste semantiği, her eksende — levent dahil). `destination` iki kaynaktan okunur
// (`_destination.ts`): sipariş kökünde siparişin ŞUBE → CARİ zinciri (bugünkü kart), müşteri kökünde
// carinin yönü; sevk raporları sevkiyatın donmuş yönünü okur.
// =============================================================================
import { Prisma, ShipmentDestination } from "@prisma/client";
import { z } from "zod";
import { readFilterList } from "../../utils/query-parser";
import { ACTIVE_LINE } from "../helpers/order-line-scope.helper";
import { orderDestinationSql, orderDestinationWhere } from "./_destination";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIST = 50;
const rawList = z.union([z.string(), z.array(z.string())]).optional().transform((v) => readFilterList(v));
const idList = rawList
  .refine((l) => l.length <= MAX_LIST, { message: `En fazla ${MAX_LIST} kimlik` })
  .refine((l) => l.every((x) => UUID_RE.test(x)), { message: "Geçersiz kimlik (uuid bekleniyor)" });
const codeList = rawList
  .refine((l) => l.length <= MAX_LIST, { message: `En fazla ${MAX_LIST} kod` })
  .refine((l) => l.every((x) => x.length <= 64), { message: "Kod en fazla 64 karakter" });

/** Sipariş kökenli raporlar: müşteri kimliği + yön (siparişin şube → cari zinciri, `_destination.ts`). */
export const musteriEkseni = { customerId: idList, destination: z.nativeEnum(ShipmentDestination).optional() };
/** Kalem ekseni: kumaş (item) + renk. */
export const kalemEkseni = { itemId: idList, colorId: idList };
export const fasonEkseni = { subcontractorId: idList };
/**
 * FİNANS ekseni: cari hesap kimliği. ⚠️ `musteriEkseni` DEĞİL — o `Customer`ı
 * sorar, bu `CariAccount`u (ayrı varlık: fasoncunun da carisi vardır, müşterinin
 * carisi olmayabilir). İkisini tek eksene indirmek "hangi müşteri" ile "hangi
 * cari" sorularını karıştırırdı.
 *
 * ⚠️ LİSTE (çoklu seçim) — ama `finance/statement` bilinçli olarak TEKİL kalır:
 * ekstre TEK cari içindir ve yürüyen bakiye iki cariyle TANIMSIZdır.
 */
export const cariEkseni = { cariId: idList };
/** Sipariş iptal sebebi (`ORDER_CANCEL` katalog kodu, `Order.cancelReasonCode`). */
export const iptalEkseni = { reasonCode: codeList };

export interface ReportFilterInput {
  cariId?: string[];
  customerId?: string[];
  destination?: ShipmentDestination;
  itemId?: string[];
  colorId?: string[];
  subcontractorId?: string[];
  reasonCode?: string[];
}

/** Cevaba yazılan beyan — düz nesne, yalnız verilen anahtarlar (R5b-b `suzgec` biçimi). */
export type SuzgecEcho = Record<string, string | string[] | number>;

/** Verilen süzgeç anahtarlarını (boş liste = verilmedi) düz nesneye çevirir; hiçbiri yoksa `undefined` → cevapta anahtar YOK. */
export function filterEcho(input: Record<string, unknown>, keys: readonly string[], dusenSatir?: number): SuzgecEcho | undefined {
  const out: SuzgecEcho = {};
  for (const k of keys) {
    const v = input[k];
    if (Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.length > 0) out[k] = v as string | string[];
  }
  if (!Object.keys(out).length) return undefined;
  // R5b-c4: süzgeç kesti mi — dokuma/finans ile aynı anahtar; süzgeçsizde yankı yok, sayı da yok.
  return dusenSatir === undefined ? out : { ...out, dusenSatir };
}

export const hasAny = (l: string[] | undefined): l is string[] => !!l && l.length > 0;
/** `readIdCondition` ikizi (liste zaten çözülmüş): tek → eşitlik, N → `in`, yok → `undefined` (Prisma anahtarı düşer). */
export const idWhere = (l: string[] | undefined): string | { in: string[] } | undefined => (hasAny(l) ? (l.length === 1 ? l[0] : { in: l }) : undefined);

/** Siparişin MÜŞTERİ tarafı (kimlik + yön zinciri) — kalem kökünden `order: {...}` içine de girer. */
export function customerScopeWhere(f: ReportFilterInput): Prisma.OrderWhereInput {
  const w: Prisma.OrderWhereInput = {};
  const c = idWhere(f.customerId);
  if (c !== undefined) w.customerId = c;
  if (f.destination) Object.assign(w, orderDestinationWhere(f.destination));
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

/** Müşteri KÖKÜ (`customers <alias>`) için ham SQL parçası — kimlik + CARİNİN yönü (müşteri satırında şube yok). */
export function customerRowSql(f: ReportFilterInput, alias = "c"): Prisma.Sql {
  const parts: Prisma.Sql[] = [inSql(`${alias}.id`, f.customerId)];
  if (f.destination) parts.push(Prisma.sql`AND ${Prisma.raw(alias)}."defaultDestination" = ${f.destination}::"ShipmentDestination"`);
  return Prisma.join(parts, " ");
}

/** Siparişin müşteri tarafı, ham SQL — `customerScopeWhere` ikizi (`orders <alias>`; yön zinciri `orderDestinationSql`). */
export function customerScopeSql(f: ReportFilterInput, orderAlias = "o"): Prisma.Sql {
  const parts: Prisma.Sql[] = [inSql(`${orderAlias}."customerId"`, f.customerId)];
  if (f.destination) parts.push(orderDestinationSql(f.destination, orderAlias));
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
