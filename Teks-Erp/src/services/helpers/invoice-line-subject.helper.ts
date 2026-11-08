// =============================================================================
// FATURA SATIRI KONUSU — `lineType` + iki FK (ürün ↔ hizmet kartı ayrımı, D1a/D1c)
// =============================================================================
// Sözleşme (D1c): yeni istemci `lineType` (PRODUCT/SERVICE/TEXT) + konuya göre `itemId` ya da `serviceItemId`
// gönderir. Eski gövde (`lineType` yok, `itemId=<hizmet kartı id>`) burada SERVICE'e normalize edilir — eski panel
// taslak düzenlerken bağ kopmaz (plan §5 uyumluluk yolu; MV-05 koşulu gelince eski kol kalkar). Şekil kuralı TEK
// yerde (`invoiceLineShapeError`): route zod'u ve servis içi çağıranlar aynı soruyu buradan sorar. DB CHECK
// (`invoice_lines` lineType↔FK) son seddir.
// =============================================================================
import { InvoiceLineType, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { assertServiceItemUsableTx } from "./item-usage.helper";

type Db = Prisma.TransactionClient | typeof prisma;

export interface InvoiceLineSubject {
  lineType: InvoiceLineType;
  itemId: string | null;
  serviceItemId: string | null;
}

/** Satır girdisinin konu alanları (gövdeden ya da sunucu içi kurucudan). */
export interface InvoiceLineSubjectInput {
  lineType?: InvoiceLineType | null;
  itemId?: string | null;
  serviceItemId?: string | null;
}

/**
 * Saf şekil kuralı (DB'siz). `null` = geçerli. SERVICE satırında `itemId` yalnız `serviceItemId`'nin eski-istemci
 * AYNASI olabilir (yanıtlar eski panel için `itemId`'yi hizmet id'siyle doldurur; yankılanan gövde reddedilmez).
 */
export function invoiceLineShapeError(l: InvoiceLineSubjectInput): string | null {
  const item = l.itemId ?? null;
  const service = l.serviceItemId ?? null;
  switch (l.lineType ?? null) {
    case InvoiceLineType.PRODUCT:
      if (!item) return "Ürün satırında ürün kartı (itemId) gerekli.";
      if (service) return "Ürün satırı hizmet kartı (serviceItemId) taşıyamaz.";
      return null;
    case InvoiceLineType.SERVICE:
      if (!service) return "Hizmet satırında hizmet kartı (serviceItemId) gerekli.";
      if (item && item !== service) return "Hizmet satırı ürün kartı (itemId) taşıyamaz.";
      return null;
    case InvoiceLineType.TEXT:
      if (item || service) return "Açıklama satırı ürün ya da hizmet kartı taşıyamaz.";
      return null;
    default:
      if (item && service && item !== service) return "Satır hem ürün hem hizmet kartı taşıyamaz — satır tipini (lineType) belirtin.";
      return null;
  }
}

/**
 * Satırları kanonik konuya indirger (tek sorgu: hizmet kartı kümesi). Açık `lineType` doğrulanır; yoksa eski kural:
 * `serviceItemId` → SERVICE, `itemId` hizmet kartıysa SERVICE, değilse PRODUCT, boşsa TEXT. Fail-closed: ürün satırına
 * hizmet id'si ya da bilinmeyen hizmet id'si 400 (FK hatasına bırakılmaz).
 */
export async function normalizeInvoiceLines<T extends InvoiceLineSubjectInput>(
  db: Db,
  lines: ReadonlyArray<T>,
): Promise<Array<Omit<T, keyof InvoiceLineSubject> & InvoiceLineSubject>> {
  lines.forEach((l, i) => {
    const err = invoiceLineShapeError(l);
    if (err) throw AppError.badRequest(`Satır ${i + 1}: ${err}`, { code: "INVOICE_LINE_SHAPE_INVALID", lineNo: i + 1 });
  });
  const ids = [...new Set(lines.flatMap((l) => [l.itemId, l.serviceItemId]).filter((v): v is string => !!v))];
  const services = ids.length
    ? new Set((await db.serviceItem.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((s) => s.id))
    : new Set<string>();
  return lines.map((l, i) => {
    const subject = classify(l, services);
    if (subject.lineType === InvoiceLineType.SERVICE && !services.has(subject.serviceItemId!)) {
      throw AppError.badRequest(`Satır ${i + 1}: hizmet kartı bulunamadı.`, { code: "INVOICE_LINE_SERVICE_NOT_FOUND", lineNo: i + 1 });
    }
    if (subject.lineType === InvoiceLineType.PRODUCT && services.has(subject.itemId!)) {
      throw AppError.badRequest(`Satır ${i + 1}: seçilen kart bir hizmet kartı — satır tipini Hizmet seçin.`, { code: "INVOICE_LINE_SUBJECT_MISMATCH", lineNo: i + 1 });
    }
    return { ...l, ...subject };
  });
}

function classify(l: InvoiceLineSubjectInput, services: ReadonlySet<string>): InvoiceLineSubject {
  const item = l.itemId ?? null;
  const service = l.serviceItemId ?? null;
  switch (l.lineType ?? null) {
    case InvoiceLineType.PRODUCT: return { lineType: InvoiceLineType.PRODUCT, itemId: item, serviceItemId: null };
    case InvoiceLineType.SERVICE: return { lineType: InvoiceLineType.SERVICE, itemId: null, serviceItemId: service };
    case InvoiceLineType.TEXT: return { lineType: InvoiceLineType.TEXT, itemId: null, serviceItemId: null };
    default:
      // Eski gövde: konu kimliği `itemId`'de (UUID uzayı ortak; taşınan hizmet kartı eski id'sini korur).
      if (service) return { lineType: InvoiceLineType.SERVICE, itemId: null, serviceItemId: service };
      if (!item) return { lineType: InvoiceLineType.TEXT, itemId: null, serviceItemId: null };
      if (services.has(item)) return { lineType: InvoiceLineType.SERVICE, itemId: null, serviceItemId: item };
      return { lineType: InvoiceLineType.PRODUCT, itemId: item, serviceItemId: null };
  }
}

/** Normalize edilmiş satırın yazım alanları (`normalizeInvoiceLines` çıktısı; lineType yoksa programcı hatası). */
export function lineSubjectData(l: InvoiceLineSubjectInput): InvoiceLineSubject {
  if (!l.lineType) throw new Error("Fatura satırı normalize edilmeden yazılamaz (lineType yok).");
  return { lineType: l.lineType, itemId: l.itemId ?? null, serviceItemId: l.serviceItemId ?? null };
}

/**
 * Hizmet satırı yazan tx'te kart kilidi (D1b canlı referansı `DRAFT_INVOICE_LINE`): id artan sırayla 8030 SHARED →
 * `service_items` FOR SHARE. Eşzamanlı "Pasif'e geç" bu tx bitene dek bekler ve yeni satırı sayar; Pasif kart 409.
 * Sınıf EXISTING_GOODS: yapılmış iş faturalanır — "Tükenene kadar" kartta serbest. Advisory sırası: 8023 → 8030.
 */
export async function lockInvoiceServiceItemsTx(tx: Prisma.TransactionClient, lines: ReadonlyArray<InvoiceLineSubjectInput>): Promise<void> {
  const ids = [...new Set(lines.map((l) => l.serviceItemId).filter((v): v is string => !!v))].sort();
  for (const id of ids) await assertServiceItemUsableTx(tx, id, "EXISTING_GOODS");
}

/**
 * Yanıt sınırı (eski istemci): SERVICE satırının `itemId`'si hizmet id'siyle doldurulur — eski panel satırı
 * `itemId` ile geri yollar ve normalize SERVICE'e çevirir. Yeni istemci `lineType` + `serviceItemId` okur.
 */
export function withLegacyServiceItemMirror<T extends { itemId?: string | null; lineType?: InvoiceLineType | null; serviceItemId?: string | null }>(line: T): T {
  if (line.lineType !== InvoiceLineType.SERVICE || !line.serviceItemId) return line;
  return { ...line, itemId: line.serviceItemId };
}
