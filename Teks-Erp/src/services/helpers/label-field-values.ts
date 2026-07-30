// =============================================================================
// Etiket alan değer haritası — TEK KAYNAK (HTML + native PPLA/PPLB/ZPL paylaşır)
// =============================================================================
// `label-fields.ts` FIELD_CATALOG'daki her field key'i için payload'dan görünür
// METİN değerini + var/yok durumunu + yerleşim ROL'ünü döner. Hem HTML hem native
// renderer'lar bunu tüketince "aynı şablon → her dilde aynı içerik" garanti olur.
//
// `value` ham (sanitize/escape EDİLMEMİŞ) döner — her renderer kendi sanitize'ını
// uygular (HTML escapeHtml, native cleanCtl/asciiFold). Sayı/tarih formatı HTML ile
// birebir aynı olsun diye label-html.shared formatNumber/formatDate'i kullanır.
// =============================================================================

import type { LabelPayload } from "../label.service";
import { formatNumber, formatDate } from "./label-html.shared";

/** Alanın etiketteki yerleşim rolü. scan = barkod/QR (sabit sol kolon, metin değil);
 *  headline = büyük vurgulu (ürün adı / metraj); row = normal "Etiket: değer" satırı. */
export type FieldRole = "scan" | "headline" | "row";

export interface FieldValue {
  /** Ham görüntü değeri (formatlanmış ama sanitize edilmemiş). */
  value: string;
  /** Değer anlamlı mı (boş/null değilse true) — bugünkü presence-check korunur. */
  present: boolean;
  role: FieldRole;
}

const NONE: FieldValue = { value: "", present: false, role: "row" };

function str(v: string | null | undefined, role: FieldRole = "row"): FieldValue {
  const s = (v ?? "").toString().trim();
  return { value: s, present: s.length > 0, role };
}

function num(
  v: number | string | null | undefined,
  unit: string,
  role: FieldRole = "row",
): FieldValue {
  if (v == null || v === "") return { value: "", present: false, role };
  return { value: `${formatNumber(v)} ${unit}`.trim(), present: true, role };
}

/**
 * payload + field key → görüntü değeri/rol. Bilinmeyen key → present:false (atlanır).
 * Roller: barcode/qrCode=scan; itemName + metraj=headline; gerisi=row.
 */
export function fieldDisplayValue(payload: LabelPayload, key: string): FieldValue {
  switch (key) {
    case "barcode":
    case "qrCode":
      return { value: payload.barcode ?? "", present: !!payload.barcode, role: "scan" };

    case "itemName":
      return str(payload.itemName, "headline");
    case "itemNameDefault":
      return str(payload.itemNameDefault);
    case "itemCode":
      return str(payload.itemCode);

    case "colorName":
      return str(payload.colorName);
    case "colorNameDefault":
      return str(payload.colorNameDefault);
    case "colorCode":
      return str(payload.colorCode);

    case "qualityGrade":
      return str(payload.qualityGrade);
    case "widthCm":
      return num(payload.widthCm, "cm");
    case "lengthMeters":
      return num(payload.lengthMeters, "m", "headline");
    case "lengthCm":
      return num(payload.lengthCm, "cm");
    case "weightKg":
      return num(payload.weightKg, "kg");

    case "customerName":
      return str(payload.customerName);
    case "orderNumber":
      return str(payload.orderNumber);
    case "batchNumber":
      return str(payload.batchNumber);
    case "workOrderNumber":
      return str(payload.workOrderNumber);
    case "cardNumber":
      return str(payload.cardNumber);
    case "parentRollBarcode":
      return str(payload.parentRollBarcode);

    // Kartelalık damgası — yalnız top işaretliyse anlamlı (headline vurgu).
    case "kartelaMark":
      return { value: "KARTELALIK", present: payload.markedForKartela === true, role: "headline" };

    // ── SACK (çuval) alanları — roll/swatch payload'unda undefined → present:false ──
    // sackNo: barkodun okunur karşılığı, etiketin kimliği → headline.
    case "sackNo":
      return str(payload.sackNo, "headline");
    // Top adedi çuval etiketinin en çok bakılan sayısı → headline. Birimsiz ("12").
    case "rollCount":
      return payload.rollCount == null
        ? NONE
        : { value: formatNumber(payload.rollCount), present: true, role: "headline" };
    case "branchName":
      return str(payload.branchName);
    // Çuval yorumu: normal satır. Boşsa present:false → eleman baskıda ATLANIR
    // (şablonda alan dursa bile yorumsuz çuvalda yer kaplamaz).
    case "sackNote":
      return str(payload.sackNote);

    case "printedAt":
      return { value: formatDate(payload.printedAt), present: !!payload.printedAt, role: "row" };

    default:
      return NONE;
  }
}
