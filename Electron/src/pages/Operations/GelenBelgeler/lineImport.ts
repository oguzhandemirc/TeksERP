// Excel satır ayrıştırma (saf). Kolon ADI bağlayıcıdır, sıra değil. Kumaş/renk METİN olarak taşınır —
// katalog eşlemesi sunucunun öneri motorunda (`/eslestirme`) tek kaynaktan yapılır, burada kopyalanmaz.
import { parseTrNumber } from "./review-queue";
import type { LineInput } from "./types";

export const LINE_IMPORT_HEADERS = ["Blok", "Top No", "Metre", "Kilo", "En (cm)", "Kumaş", "Renk"] as const;
export const MAX_IMPORT_LINES = 500;

export interface LineImportError {
  row: number;
  message: string;
}

const text = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const numOf = (v: unknown): number | null => (typeof v === "number" ? (v > 0 ? v : null) : v == null ? null : parseTrNumber(String(v)));

export function parseLineRows(rows: ReadonlyArray<Record<string, unknown>>): { lines: LineInput[]; errors: LineImportError[] } {
  const lines: LineInput[] = [];
  const errors: LineImportError[] = [];
  rows.forEach((r, i) => {
    const row = i + 2;
    if (Object.values(r).every((v) => v === null || v === undefined || String(v).trim() === "")) return;
    const meters = numOf(r["Metre"]);
    if (meters === null) return void errors.push({ row, message: "Metre boş ya da geçersiz" });
    const kgRaw = r["Kilo"];
    const kg = numOf(kgRaw);
    if (kgRaw != null && String(kgRaw).trim() !== "" && kg === null) return void errors.push({ row, message: "Kilo geçersiz" });
    const block = r["Blok"] == null || String(r["Blok"]).trim() === "" ? 1 : Math.trunc(Number(r["Blok"]));
    if (!(block >= 1 && block <= 99)) return void errors.push({ row, message: "Blok 1–99 olmalı" });
    lines.push({
      blockNo: block,
      senderRollNo: text(r["Top No"], 64),
      meters,
      weightKg: kg,
      widthCm: numOf(r["En (cm)"]),
      itemText: text(r["Kumaş"], 160),
      colorText: text(r["Renk"], 120),
    });
  });
  if (lines.length > MAX_IMPORT_LINES) {
    errors.push({ row: 0, message: `Tek seferde en çok ${MAX_IMPORT_LINES} satır; ilk ${MAX_IMPORT_LINES} alındı` });
    lines.length = MAX_IMPORT_LINES;
  }
  return { lines, errors };
}
