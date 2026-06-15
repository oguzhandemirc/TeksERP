// =============================================================================
// Top etiketi — Argox PPLA (Datamax DPL dialect) native komut üreteci
// =============================================================================
// `buildRollLabelHtml`'in native analoğu. Aynı mantıksal alanları (ürün/renk/
// kalite/metraj/en/ağırlık/müşteri/parti + Code128 + QR) PPLA komut string'i
// olarak üretir. Konumlar format profilinden hesaplanır (mm → dot; 203dpi=8dot/mm);
// güvenlik payı (marginMm) iç koordinat başlangıcı olur.
//
// FAZ-1 SINIRI: bu fonksiyon yalnız KOMUT ÜRETİR (saf string — HTML üretmek gibi,
// izinli). Komutların yazıcıya ham-bayt GÖNDERİMİ donanım I/O'dur → `printer-transport`
// içinde SİMÜLE (Faz-2'de gerçek socket/USB). "Yazıcı değişse de kodlar kaybolmasın"
// = bu üreteç versiyonlu kodda, model→dil eşlemesi DB'de.
//
// NOT: Alan/font/barkod tip kodları Argox OS-214 plus PPLA programlama kılavuzuna
// göredir; kesin değerler fiziksel test baskısıyla (Faz-2) ince ayarlanır. Yapı +
// veri tamdır; üretim/önizleme/inceleme bugün çalışır.
// =============================================================================

import type { LabelPayload } from "../label.service";
import type { ResolvedLabelFormat } from "./label-format.resolver";
import { asciiFold } from "./native-label.shared";

const STX = "\x02";
const CR = "\r";

export interface PplaRenderInput {
  payload: LabelPayload;
  format: ResolvedLabelFormat;
  copies: number;
}

function mmToDots(mm: number, dpi: number): number {
  return Math.round((mm * dpi) / 25.4);
}

/** Kontrol karakterini ayıkla + ASCII'ye katla (latin1 kaybı/komut-baytı enjeksiyonu yok). */
function clean(s: string | number | null | undefined): string {
  // eslint-disable-next-line no-control-regex
  return asciiFold(String(s ?? "").replace(/[\x00-\x1f]/g, " ")).trim();
}

function pad4(n: number): string {
  return String(Math.max(0, Math.min(9999, Math.round(n)))).padStart(4, "0");
}

export function buildRollLabelPpla({ payload, format, copies }: PplaRenderInput): string {
  const dpi = format.dpi || 203;
  const marginDots = mmToDots(format.marginMm, dpi);
  const topDots = mmToDots(format.heightMm - format.marginMm, dpi);
  const contentWidthDots = mmToDots(format.widthMm - format.marginMm * 2, dpi);
  const colLeft = marginDots;
  const lines: string[] = [];

  // --- Başlık: birim, etiket boyu, ısı/yoğunluk ---
  lines.push(`${STX}n`); // ölçü birimi = nokta (dot)
  lines.push(`${STX}M${pad4(mmToDots(format.heightMm, dpi))}`); // maksimum etiket boyu
  lines.push(`${STX}L`); // etiket format moduna gir
  lines.push("D11"); // yoğunluk/çözünürlük modülü (203dpi)
  lines.push("H10"); // ısı (heat) — fiziksel test baskısıyla ayarlanır

  // --- Metin alanları ---
  // DPL alan kaydı: <rot><font><wMul><hMul>"000"<RRRR row><CCCC col><veri>
  //   rot=1 (0°), font=3 (standart) / 4 (büyük); satır dot ÜSTTEN, sütun SOLDAN (pay'lı).
  let row = topDots - mmToDots(6, dpi);
  const lineStep = mmToDots(7, dpi);
  const textField = (text: string, font = "3", wMul = "1", hMul = "1"): void => {
    const t = clean(text);
    if (!t) return;
    lines.push(`1${font}${wMul}${hMul}000${pad4(row)}${pad4(colLeft)}${t}`);
    row -= lineStep;
  };

  textField(payload.itemName || "-", "4", "1", "1"); // ürün adı (büyük font)
  if (payload.colorName) textField(`Renk: ${payload.colorName}`);
  textField(`Kalite: ${payload.qualityGrade ?? "-"}`);
  textField(`${clean(payload.lengthMeters)} mt   En: ${payload.widthCm ?? "-"} cm`, "4", "2", "2");
  if (payload.weightKg != null) textField(`Agirlik: ${payload.weightKg} kg`);
  if (payload.customerName) textField(`Musteri: ${payload.customerName}`);
  if (payload.batchNumber) textField(`Parti: ${payload.batchNumber}`);

  // --- Barkod (Code128) + okunabilir metin + QR ---
  if (payload.barcode) {
    const bc = clean(payload.barcode);
    const bcRow = mmToDots(18, dpi);
    const bcHeight = mmToDots(12, dpi);
    // DPL barkod kaydı: <rot>"e"<narrow><wide><HHHH height><RRRR><CCCC><veri> (e=Code128)
    lines.push(`1e22${pad4(bcHeight)}${pad4(bcRow)}${pad4(colLeft)}${bc}`);
    // okunabilir barkod metni (barkodun altı)
    lines.push(`131100${pad4(mmToDots(5, dpi))}${pad4(colLeft)}${bc}`);
    // QR (DPL 2D kaydı: "W1c"<...> — kılavuza göre) — sağ üst köşeye
    const qrCol = colLeft + contentWidthDots - mmToDots(26, dpi);
    lines.push(`1W1c0606${pad4(bcRow)}${pad4(Math.max(colLeft, qrCol))}${bc}`);
  }

  // --- Kopya + bitir/bas ---
  lines.push(`Q${pad4(Math.max(1, Math.min(5, copies || 1)))}`); // kopya adedi (1-5)
  lines.push("E"); // formatı bitir + bas

  return lines.join(CR) + CR;
}
