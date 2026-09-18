// =============================================================================
// MAL KABUL SATIRLARI ÖN-UÇUŞ — DOĞRULAMA SINIFI hata TEK SATIR YAZILMADAN reddedilir (kullanıcı bulgusu C8, 2026-09-17)
// =============================================================================
// Bulgu: `devere.lotRequired` açıkken lotsuz iplik satırı sunucuda `failed[]`e düşüyor, fiş BAŞLIĞI doğuyor, panel
// "1 satır atlandı" deyip modalı kapatıyordu → içi boş fiş. İki hata sınıfı ayrılır: ① DOĞRULAMA (lot zorunlu · bobin
// adedi · ürün yok/pasif/yanlış tür · miktar) — girdiden bilinir, satır döngüsünden ÖNCE hepsi toplanır, ilk ihlal
// listesiyle 400 `RECEIPT_LINES_INVALID` `details.lines[{lineNo, code, message}]`, fiş başlığı AÇILMAZ; ② KOŞU ANI
// (yarış/409, kilit, mükerrer barkod) — satır-satır tx ve `failed[]` kalır. Tek okuma: kalem bilgisi tek sorgu,
// `readDevereLotRequired` bir kez.
// =============================================================================
// GENİŞLEME (2026-09-18, 9b ölçümü): satır döngüsünde hâlâ `failed[]`e düşen BEŞ deterministik sınıf daha buraya
// alındı — kumaş satırında renk yok/pasif · renk ürüne izinli değil · özellik yok/pasif/izinli değil · fiyat zorunlu
// bayrağı açıkken çözülemeyen fiyat · siparişten fazla (satırlar arası TOPLAM). Fiyat zinciri ve sipariş bağlamı
// ÇAĞIRANDAN gelir (`PreflightContext`): guard kendi zincirini kurmaz, servisle aynı `priceFor`/ordered-received'i okur.
// Mesaj metinleri TEK yerde (bu dosya) — döngüdeki koşu-anı guard'ları da aynı kurucuları kullanır.
// =============================================================================
import { ItemType, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { normalizeLotNo } from "./yarn-lot.helper";
import { readDevereLotRequired } from "../system-setting.service";

export interface PreflightLine {
  itemId: string;
  initialQty: number;
  lotNo?: string | null;
  bobbinCount?: number | null;
  colorId?: string | null;
  propertyIds?: string[];
  unitPrice?: number | null;
}

/** Siparişten fazla kabul için sipariş bağlamının ön-uçuşa gereken kesiti (servisin `PurchaseOrderReceiptContext`i). */
export interface OverReceiptView {
  orderNo: string;
  ordered: Map<string, Prisma.Decimal>;
  received: Map<string, Prisma.Decimal>;
}

/** Çağıranın kurduğu bağlam — bayrak kapalıysa alan verilmez ve o sınıf ölçülmez (bugünkü davranış). */
export interface PreflightContext {
  /** `goodsReceipt.requirePriceEnabled` açık mı; açıksa `priceFor` servisin zinciridir (kopya değil). */
  requirePrice?: boolean;
  priceFor?: (line: PreflightLine) => Prisma.Decimal.Value | null;
  /** `purchase.blockOverReceiptEnabled` açık ve fiş siparişe bağlıysa bağlam; yoksa null/verilmez. */
  overReceipt?: OverReceiptView | null;
  currency?: string;
}

export type ReceiptLineIssueCode =
  | "ITEM_NOT_FOUND"
  | "ITEM_INACTIVE"
  | "ITEM_TYPE_NOT_ALLOWED"
  | "QTY_INVALID"
  | "YARN_LOT_REQUIRED"
  | "BOBBIN_INVALID"
  | "COLOR_NOT_FOUND"
  | "COLOR_NOT_ALLOWED"
  | "PROPERTY_INVALID"
  | "PRICE_REQUIRED"
  | "OVER_RECEIPT";

export const qtyText = (v: Prisma.Decimal, unit: string): string => `${v.toString()} ${unit}`;

/** Fiyat zorunlu bayrağı açıkken çözülemeyen fiyat — ön-uçuş ve döngü guard'ı AYNI metni basar. */
export function priceRequiredMessage(itemName: string, currency: string): string {
  return (
    `"${itemName}": birim fiyat çözülemedi — satırda fiyat yok ve kalem kartında ${currency} alış fiyatı tanımlı değil. ` +
    `"Mal kabul satırında birim fiyat zorunlu" ayarı açık — satıra fiyatı girin, kalemin ${currency} alış fiyatını ` +
    `Tanımlar > Kalem Fiyatları'ndan tanımlayın ya da Ayarlar > Depo & Satın Alma'dan ayarı kapatın.`
  );
}

/** Siparişten fazla — ön-uçuş ve döngü guard'ı AYNI metni basar. */
export function overReceiptMessage(p: { orderNo: string; itemName: string; ordered: Prisma.Decimal; already: Prisma.Decimal; qty: Prisma.Decimal; unit: string }): string {
  const after = p.already.plus(p.qty);
  const tail =
    `"Siparişten fazla mal kabulünü engelle" ayarı açık — fazlayı kaydetmek için siparişe bağlı OLMAYAN ` +
    `ayrı bir mal kabul fişi açın, siparişi düzeltin ya da Ayarlar > Depo & Satın Alma'dan ayarı kapatın.`;
  if (p.ordered.isZero()) {
    return `"${p.itemName}" ${p.orderNo} siparişinde YOK (ısmarlanan 0), bu satırla ${qtyText(p.qty, p.unit)} girilecek. Yanlış sipariş seçilmiş olabilir. ${tail}`;
  }
  return (
    `"${p.itemName}": ${p.orderNo} siparişinde ${qtyText(p.ordered, p.unit)} ısmarlandı, ${qtyText(p.already, p.unit)} gelmiş; ` +
    `bu satırla ${qtyText(after, p.unit)} olur (${qtyText(after.minus(p.ordered), p.unit)} fazla). ${tail}`
  );
}

export interface ReceiptLineIssue {
  /** 1 tabanlı satır sırası — panel satırla eşler. */
  lineNo: number;
  code: ReceiptLineIssueCode;
  message: string;
}

export const YARN_LOT_REQUIRED_MESSAGE = `İplik satırında lot numarası zorunlu (ayar: "Devere — lot zorunlu"). İrsaliyedeki lot numarasını olduğu gibi yazın.`;

/** Doğrulama sınıfı ihlalleri toplar (boş dizi = geçti). Sıra: satır sırası. */
export async function collectReceiptLineIssues(lines: PreflightLine[], ctx: PreflightContext = {}): Promise<ReceiptLineIssue[]> {
  if (lines.length === 0) return [];
  const ids = [...new Set(lines.map((l) => l.itemId))];
  const rows = await prisma.item.findMany({ where: { id: { in: ids } }, select: { id: true, itemType: true, isActive: true, name: true, unit: true } });
  const info = new Map(rows.map((r) => [r.id, r]));
  const hasYarn = lines.some((l) => info.get(l.itemId)?.itemType === ItemType.YARN);
  const lotRequired = hasYarn ? await readDevereLotRequired() : false;
  const catalog = await loadFabricCatalog(lines, info);
  // OVER_RECEIPT: bu istekteki ÖNCEKİ satırların toplamı — hepsi ya da hiçbiri yazıldığı için hepsi sayılır.
  const running = new Map<string, Prisma.Decimal>();
  const issues: ReceiptLineIssue[] = [];
  lines.forEach((l, i) => {
    const lineNo = i + 1;
    const it = info.get(l.itemId);
    if (!it) return issues.push({ lineNo, code: "ITEM_NOT_FOUND", message: "Ürün bulunamadı." });
    if (!it.isActive) return issues.push({ lineNo, code: "ITEM_INACTIVE", message: `"${it.name}" pasif (silinmiş) — fişe alınamaz.` });
    if (it.itemType === ItemType.CONSUMABLE) return issues.push({ lineNo, code: "ITEM_TYPE_NOT_ALLOWED", message: `"${it.name}" sarf malzeme — mal kabul fişi yalnız kumaş ve iplik alır.` });
    if (!(Number(l.initialQty) > 0)) return issues.push({ lineNo, code: "QTY_INVALID", message: "Miktar sıfırdan büyük olmalı." });
    if (it.itemType === ItemType.YARN) {
      if (lotRequired && !normalizeLotNo(l.lotNo)) return issues.push({ lineNo, code: "YARN_LOT_REQUIRED", message: YARN_LOT_REQUIRED_MESSAGE });
      if (l.bobbinCount != null && (!Number.isInteger(l.bobbinCount) || l.bobbinCount <= 0)) return issues.push({ lineNo, code: "BOBBIN_INVALID", message: "Bobin adedi pozitif tam sayı olmalı." });
    }
    if (it.itemType === ItemType.FABRIC) {
      const fab = fabricLineIssue(l, it.name, catalog);
      if (fab) return issues.push({ lineNo, ...fab });
    }
    if (ctx.requirePrice && ctx.priceFor && ctx.priceFor(l) == null) {
      return issues.push({ lineNo, code: "PRICE_REQUIRED", message: priceRequiredMessage(it.name, ctx.currency ?? "TRY") });
    }
    if (ctx.overReceipt) {
      const qty = new Prisma.Decimal(l.initialQty);
      const ordered = ctx.overReceipt.ordered.get(l.itemId) ?? new Prisma.Decimal(0);
      const already = (ctx.overReceipt.received.get(l.itemId) ?? new Prisma.Decimal(0)).plus(running.get(l.itemId) ?? new Prisma.Decimal(0));
      if (already.plus(qty).gt(ordered)) {
        return issues.push({ lineNo, code: "OVER_RECEIPT", message: overReceiptMessage({ orderNo: ctx.overReceipt.orderNo, itemName: it.name, ordered, already, qty, unit: unitLabel(it.unit) }) });
      }
      running.set(l.itemId, (running.get(l.itemId) ?? new Prisma.Decimal(0)).plus(qty));
    }
    return undefined;
  });
  return issues;
}

interface FabricCatalog {
  colors: Map<string, { name: string; isActive: boolean }>;
  allowedColors: Map<string, Set<string>>;
  properties: Map<string, { isActive: boolean }>;
  allowedProperties: Map<string, Set<string>>;
}

/** Kumaş satırlarının renk/özellik kataloğu — tek turda okunur (satır başına sorgu yok). */
async function loadFabricCatalog(lines: PreflightLine[], info: Map<string, { itemType: ItemType }>): Promise<FabricCatalog> {
  const fabricLines = lines.filter((l) => info.get(l.itemId)?.itemType === ItemType.FABRIC);
  const itemIds = [...new Set(fabricLines.map((l) => l.itemId))];
  const colorIds = [...new Set(fabricLines.map((l) => l.colorId).filter((c): c is string => !!c))];
  const propIds = [...new Set(fabricLines.flatMap((l) => l.propertyIds ?? []))];
  const [colors, allowedColors, props, allowedProps] = await Promise.all([
    colorIds.length ? prisma.color.findMany({ where: { id: { in: colorIds } }, select: { id: true, name: true, isActive: true } }) : [],
    itemIds.length && colorIds.length ? prisma.itemAllowedColor.findMany({ where: { itemId: { in: itemIds } }, select: { itemId: true, colorId: true } }) : [],
    propIds.length ? prisma.fabricProperty.findMany({ where: { id: { in: propIds } }, select: { id: true, isActive: true } }) : [],
    itemIds.length && propIds.length ? prisma.itemAllowedProperty.findMany({ where: { itemId: { in: itemIds } }, select: { itemId: true, propertyId: true } }) : [],
  ]);
  const group = <T extends { itemId: string }>(rows: T[], pick: (r: T) => string): Map<string, Set<string>> => {
    const m = new Map<string, Set<string>>();
    for (const r of rows) {
      const set = m.get(r.itemId) ?? new Set<string>();
      set.add(pick(r));
      m.set(r.itemId, set);
    }
    return m;
  };
  return {
    colors: new Map(colors.map((c) => [c.id, { name: c.name, isActive: c.isActive }])),
    allowedColors: group(allowedColors, (r) => r.colorId),
    properties: new Map(props.map((p) => [p.id, { isActive: p.isActive }])),
    allowedProperties: group(allowedProps, (r) => r.propertyId),
  };
}

/** Kumaş satırı: renk var/aktif · ürüne izinli (liste boş = serbest) · özellikler var/aktif · izinli — `inventory.createInitialEntry` kurallarının ön-uçuş aynası. */
function fabricLineIssue(l: PreflightLine, itemName: string, cat: FabricCatalog): Omit<ReceiptLineIssue, "lineNo"> | null {
  if (l.colorId) {
    const c = cat.colors.get(l.colorId);
    if (!c || !c.isActive) return { code: "COLOR_NOT_FOUND", message: "Renk bulunamadı veya pasif." };
    const allowed = cat.allowedColors.get(l.itemId);
    if (allowed && allowed.size > 0 && !allowed.has(l.colorId)) return { code: "COLOR_NOT_ALLOWED", message: `"${c.name}" rengi "${itemName}" için izinli renk listesinde değil.` };
  }
  const props = [...new Set(l.propertyIds ?? [])];
  if (props.length > 0) {
    if (props.some((p) => !cat.properties.get(p)?.isActive)) return { code: "PROPERTY_INVALID", message: "Bazı özellikler bulunamadı veya pasif." };
    const allowed = cat.allowedProperties.get(l.itemId);
    if (allowed && allowed.size > 0 && props.some((p) => !allowed.has(p))) return { code: "PROPERTY_INVALID", message: `Seçilen özelliklerden bazıları "${itemName}" için izinli özellik listesinde değil.` };
  }
  return null;
}

/** Birim etiketi — kalem kartının birim kodu metne (siparişten fazla mesajı). */
function unitLabel(unit: string): string {
  return unit === "MT" ? "m" : unit === "KG" ? "kg" : unit === "ADET" ? "adet" : unit;
}

/** İhlal varsa 400 `RECEIPT_LINES_INVALID` — fiş başlığı açılmadan. */
export async function assertReceiptLinesValid(lines: PreflightLine[], ctx: PreflightContext = {}): Promise<void> {
  const issues = await collectReceiptLineIssues(lines, ctx);
  if (issues.length === 0) return;
  const first = issues[0]!;
  throw AppError.badRequest(`${issues.length} satır kaydedilemez — ${first.lineNo}. satır: ${first.message}`, { code: "RECEIPT_LINES_INVALID", lines: issues });
}
