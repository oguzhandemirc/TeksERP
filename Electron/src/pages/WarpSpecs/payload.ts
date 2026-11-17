// Çözgü kartı formu ↔ API gövdesi. Fason devere D3: iplik satırları `yarns` ile REPLACE edilir; kolonlar
// (yarnItemId/endsCount) sunucuda satırlardan türer — form onları GÖNDERMEZ (gönderse de yok sayılır).
import { decimalToFormText } from "@/lib/decimal-form-text";
import { warpSpecFormDefaults, type WarpSpecFormValues } from "./schema";
import type { WarpSpec } from "./types";

/** Form METİN taşır (boş bırakılabilsin diye), backend SAYI bekler. Boş dize `null`a döner — "0" ile "girilmedi" aynı şey değildir. */
const sayi = (v: string | undefined): number | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : Number(t);
};
const metin = (v: string | undefined): string | null => (v ?? "").trim() || null;

export type WarpSpecPayload = Omit<Partial<WarpSpec>, "yarns"> & { yarns: Array<{ yarnItemId: string; endsCount: number }> };

export function buildPayload(v: WarpSpecFormValues): WarpSpecPayload {
  return {
    code: v.code.trim(),
    name: v.name.trim(),
    yarns: v.yarns.map((r) => ({ yarnItemId: r.yarnItemId, endsCount: Number(r.endsCount) })),
    sequenceNote: metin(v.sequenceNote),
    selvedgeEnds: sayi(v.selvedgeEnds),
    // Decimal kolonlar: backend `Prisma.Decimal` bekler, string kabul eder.
    reedNo: metin(v.reedNo),
    endsPerDent: sayi(v.endsPerDent),
    reedWidthCm: metin(v.reedWidthCm),
    takeUpPct: metin(v.takeUpPct),
    wastePct: metin(v.wastePct),
    notes: metin(v.notes),
    isActive: v.isActive,
  };
}

/** Kayıttaki satırlar; satırsız (eski) kartta kolonlardan tek satır. */
function rowsOf(initial: WarpSpec): WarpSpecFormValues["yarns"] {
  const rows = [...(initial.yarns ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  if (rows.length > 0) return rows.map((r) => ({ yarnItemId: r.yarnItemId, endsCount: decimalToFormText(r.endsCount) }));
  return [{ yarnItemId: initial.yarnItemId ?? "", endsCount: decimalToFormText(initial.endsCount) }];
}

export function buildDefaults(initial?: WarpSpec | null): WarpSpecFormValues {
  if (!initial) return warpSpecFormDefaults;
  return {
    code: initial.code,
    name: initial.name,
    yarns: rowsOf(initial),
    sequenceNote: initial.sequenceNote ?? "",
    // API Decimal/Int alanlarını SAYI döndürür; form metin taşır (sunum provası: düzenle→Kaydet sessiz kalıyordu).
    selvedgeEnds: decimalToFormText(initial.selvedgeEnds),
    reedNo: decimalToFormText(initial.reedNo),
    endsPerDent: decimalToFormText(initial.endsPerDent),
    reedWidthCm: decimalToFormText(initial.reedWidthCm),
    takeUpPct: decimalToFormText(initial.takeUpPct),
    wastePct: decimalToFormText(initial.wastePct),
    notes: initial.notes ?? "",
    isActive: initial.isActive,
  };
}

/** "Kopyala": aynı reçeteyle YENİ kart taslağı — kod boş (tekil), ad "… KOPYA", hep aktif. */
export function copyDraft(row: WarpSpec): WarpSpecFormValues {
  const d = buildDefaults(row);
  return { ...d, code: "", name: `${row.name} KOPYA`.slice(0, 100), isActive: true };
}
