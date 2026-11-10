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

import type { LabelPayload } from "../../types/label.types";
import { formatNumber, formatDate } from "./label-html.shared";
import {
  FIELD_DATE_KEYS, FIELD_MEASURE_DIM, formatFieldMeasure, formatMeasure, isDefaultUnitSettings, readFieldFormat,
  type LabelUnitSettings, type MeasureDim,
} from "../../config/label-units";
import { factoryDateTr } from "../../constants/time";

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

/** Ölçü alanı — şablonun birim sistemiyle (yoksa `num` ile bayt-aynı bugünkü biçim). */
function measure(
  v: number | string | null | undefined,
  dim: MeasureDim,
  units: LabelUnitSettings | null | undefined,
  role: FieldRole = "row",
): FieldValue {
  if (isDefaultUnitSettings(units)) return num(v, dim, role);
  if (v == null || v === "") return { value: "", present: false, role };
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return num(v, dim, role);
  return { value: formatMeasure(n, dim, units), present: true, role };
}

// OPT-IN düz metin satırları — kaynağı olmayan topta boş → satır basılmaz: açık hata notu (KQ-D8) ·
// müşteri belgesindeki kumaş/renk/top no (E3, H9) · müşteri barkodu (D4-F3) · emanet alıcısı (2026-11-10).
const OPT_IN_TEXT_KEYS = ["openDefects", "deliveryNoteItemText", "deliveryNoteColorText", "deliveryNoteRollNo", "customerCode", "consigneeName"] as const;
type OptInTextKey = (typeof OPT_IN_TEXT_KEYS)[number];
const isOptInTextKey = (key: string): key is OptInTextKey => (OPT_IN_TEXT_KEYS as readonly string[]).includes(key);

/**
 * payload + field key → görüntü değeri/rol. Bilinmeyen key → present:false (atlanır).
 * Roller: barcode/qrCode=scan; itemName + metraj=headline; gerisi=row.
 */
export function fieldDisplayValue(payload: LabelPayload, key: string): FieldValue {
  const ov = payload.displayOverrides;
  if (ov && Object.prototype.hasOwnProperty.call(ov, key)) return overriddenValue(payload, key, ov[key] ?? "");
  return sourceFieldValue(payload, key);
}

/**
 * Kanvas `field` elemanının değeri — eleman `fmt` taşıyorsa ona göre biçimlenir (dönüşüm, sabit hane,
 * sıfır dolgu, birim metni, saatsiz tarih); `fmt`siz eleman `fieldDisplayValue` ile bayt-aynı. Varlık
 * (present) ve rol hep kaynaktan: değersiz alan biçimle de ATLANIR. HTML + native + raster bunu çağırır.
 */
export function fieldElementValue(payload: LabelPayload, el: { bind: string; fmt?: unknown }): FieldValue {
  const base = fieldDisplayValue(payload, el.bind);
  const fmt = el.fmt === undefined ? null : readFieldFormat(el.fmt, el.bind);
  if (!fmt || !base.present) return base;
  const dim = FIELD_MEASURE_DIM[el.bind];
  if (dim) {
    const ov = payload.displayOverrides;
    const raw = ov && Object.prototype.hasOwnProperty.call(ov, el.bind)
      ? Number((ov[el.bind] ?? "").trim().replace(",", "."))
      : Number((payload as unknown as Record<string, unknown>)[el.bind]);
    // Elle yazılmış sayı olmayan ezme yazıldığı gibi kalır.
    if (!Number.isFinite(raw)) return base;
    return { ...base, value: formatFieldMeasure(raw, dim, fmt, payload.unitSettings?.decimalSep ?? ",") };
  }
  if (fmt.date && FIELD_DATE_KEYS.has(el.bind)) {
    const iso = el.bind === "printedAt" ? payload.printedAt : payload.woundAt;
    const d = new Date(iso ?? "");
    if (Number.isNaN(d.getTime())) return base;
    const day = factoryDateTr(d);
    return { ...base, value: fmt.date === "D.MM.YYYY" ? day.replace(/^0/, "") : day };
  }
  return base;
}

// Ölçü ezmesi sayıysa şablonun birimiyle biçimlenir ("22,5" → "22,5 m"); değilse yazıldığı gibi basılır.
const MEASURE_DIM: Record<string, MeasureDim> = { widthCm: "cm", lengthMeters: "m", weightKg: "kg" };

/** Elle yazılmış alan: rol kaynaktan korunur, "" → present:false (alan boş basılır). */
function overriddenValue(payload: LabelPayload, key: string, raw: string): FieldValue {
  const role = sourceFieldValue(payload, key).role;
  const v = raw.trim();
  const dim = MEASURE_DIM[key];
  if (dim && v !== "") {
    const n = Number(v.replace(",", "."));
    if (Number.isFinite(n)) return measure(n, dim, payload.unitSettings, role);
  }
  return str(v, role);
}

function sourceFieldValue(payload: LabelPayload, key: string): FieldValue {
  if (isOptInTextKey(key)) return str(payload[key]);
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
    // KAT — katalog kodu ("6-KAT" / "TUP"). Kat girilmemiş topta present:false →
    // eleman şablonda dursa bile baskıda atlanır (sackNote emsali).
    case "foldType":
      return str(payload.foldType);
    // Müşterinin etikete istediği parti — boşsa present:false (eleman atlanır).
    case "labelBatchNo":
      return str(payload.labelBatchNo);
    // Müşteri partisi zinciri: etikete yazılan (tamburda girilen) > gelen belgenin partisi; ikisi de yoksa atlanır.
    case "customerBatchNo":
      return str((payload.labelBatchNo ?? "").trim() || payload.deliveryNoteBatchNo);
    case "widthCm":
      return measure(payload.widthCm, "cm", payload.unitSettings);
    case "lengthMeters":
      return measure(payload.lengthMeters, "m", payload.unitSettings, "headline");
    case "lengthCm":
      return measure(payload.lengthCm, "cm", payload.unitSettings);
    case "weightKg":
      return measure(payload.weightKg, "kg", payload.unitSettings);

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
    // Sevk partisi: numara başlık sınıfı (sahada uzaktan okunur), parti adı satır.
    case "packageNo":
      return payload.packageNo == null
        ? NONE
        : { value: formatNumber(payload.packageNo), present: true, role: "headline" };
    case "packingGroupName":
      return str(payload.packingGroupName);

    case "printedAt":
      return { value: formatDate(payload.printedAt), present: !!payload.printedAt, role: "row" };

    default:
      return loomFieldValue(payload, key);
  }
}

/**
 * Barkod/QR elemanının basacağı kod — HTML + PPLA/PPLB/ZPL + raster TEK kaynak (D4-F3).
 * source yok/ROLL → iç barkod (bugünkü); CUSTOMER_CODE → aktif müşteri kodu (yoksa "" → eleman atlanır;
 * eksik-kod kararı basımdan önce `label.customerCodeMissing` kapısında verilir).
 */
export function scanElementValue(payload: LabelPayload, el: { source?: string }): string {
  return fieldDisplayValue(payload, el.source === "CUSTOMER_CODE" ? "customerCode" : "barcode").value;
}

/** Tezgah (MACHINE) ve levent (WARP_BEAM) bağlam alanları; bilinmeyen key → NONE. */
function loomFieldValue(payload: LabelPayload, key: string): FieldValue {
  switch (key) {
    // ── MACHINE (tezgah) — kod etiketin kimliği → headline (sahada uzaktan okunur) ──
    case "machineCode":
      return str(payload.machineCode, "headline");
    case "machineName":
      return str(payload.machineName);
    case "stationName":
      return str(payload.stationName);

    // ── WARP_BEAM (levent) — levent no kimlik → headline; sarılmamışta metre/kg boş ──
    case "beamNo":
      return str(payload.beamNo, "headline");
    case "physicalBeamNo":
      return str(payload.physicalBeamNo);
    case "warpSpecCode":
      return str(payload.warpSpecCode);
    case "warpSpecName":
      return str(payload.warpSpecName);
    case "plannedLengthM":
      return num(payload.plannedLengthM, "m");
    case "woundLengthM":
      return num(payload.woundLengthM, "m");
    case "woundKg":
      return num(payload.woundKg, "kg");
    case "weavingOrderNumber":
      return str(payload.weavingOrderNumber);
    case "woundAt":
      return payload.woundAt
        ? { value: formatDate(payload.woundAt), present: true, role: "row" }
        : NONE;

    default:
      return NONE;
  }
}
