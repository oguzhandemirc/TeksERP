// PDF FİLİGRANI (lisans Faz 2e) — panelin ürettiği her PDF'in meta verisine lisans sahibi +
// lisans numarası yazılır (görünür filigranın belge eşi; kişisel veri yok, yalnız firma/tesis adı).
// Meta renderer'dan `pdf:setLicenseMeta` ile gelir (lisans durum özeti); yoksa yalnız üretici yazılır.
import { PDFDocument } from "pdf-lib";

export interface PdfLicenseMeta {
  /** "<müşteri> · <tesis>" — lisans sahibi. */
  readonly lisansSahibi: string;
  /** TKS-YYYY-NNNN. */
  readonly lisansNo: string;
}

const LICENSE_NO = /^TKS-\d{4}-\d{4,6}$/;
const PRODUCER = "TeksERP";

/** Renderer'dan gelen değeri daraltır: biçimsiz meta YOK sayılır (PDF üretimi düşmez). */
export function sanitizePdfLicenseMeta(raw: unknown): PdfLicenseMeta | null {
  if (typeof raw !== "object" || raw === null) return null;
  const owner: unknown = Reflect.get(raw, "lisansSahibi");
  const no: unknown = Reflect.get(raw, "lisansNo");
  if (typeof owner !== "string" || typeof no !== "string") return null;
  const cleanOwner = Array.from(owner, (c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? " " : c)).join("").trim().slice(0, 200);
  if (cleanOwner.length === 0 || !LICENSE_NO.test(no)) return null;
  return { lisansSahibi: cleanOwner, lisansNo: no };
}

/** printToPDF çıktısına meta verisi yazar; ayrıştırılamayan PDF'i olduğu gibi döndürür. */
export async function applyPdfLicenseMeta(pdf: Uint8Array, meta: PdfLicenseMeta | null): Promise<Uint8Array> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdf, { updateMetadata: false });
  } catch {
    return pdf;
  }
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  if (meta) {
    doc.setAuthor(meta.lisansSahibi);
    doc.setSubject(`Lisans ${meta.lisansNo} · ${meta.lisansSahibi}`);
    doc.setKeywords([`lisans:${meta.lisansNo}`]);
  }
  return doc.save();
}
