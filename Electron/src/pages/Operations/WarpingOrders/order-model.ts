// Fason devere siparişi — saf sunum katmanı: form durumu → istek gövdesi, sunucu sayısı → metin.
// Hesap YOK (plan kg'ı sunucuda `computeWarpingPlan`); burada yalnız girdi doğrulama ve biçim.
import { formatQty } from "@/lib/format";
import { factoryDayKey, factoryDayStartIso, factoryDayDiff } from "@/lib/factory-time";
import type { SpecRef, WarpingFeeUnit, WarpingOrder, WarpingOrderBody, WarpingOrderStatus } from "./types";

export interface BeamLineDraft {
  beamCount: string;
  beamLengthM: string;
}

export interface WarpingOrderFormState {
  warpSpecId: string | null;
  subcontractorId: string | null;
  beamLines: BeamLineDraft[];
  /** "Levent adedi belli değil": yalnız toplam metre girilir, adet kabulde çıkar. */
  beamCountOpen: boolean;
  openTargetLengthM: string;
  extraWarpSpecIds: string[];
  salesOrders: Array<{ id: string; label: string }>;
  feeUnit: WarpingFeeUnit;
  feeUnitPrice: string;
  feeCurrency: string;
  /** Fabrika günü `YYYY-MM-DD`; boş = termin yok. */
  expectedReturnDay: string;
  /** Boş = ayar (`devere.warpFixedWasteM`). */
  fixedWasteM: string;
  /** Boş = ayar (yeni) / denetim yok (düzenleme). */
  wasteTolerancePct: string;
  notes: string;
}

export const MAX_BEAM_LINES = 20;
export const MAX_EXTRA_SPECS = 5;

/** Müşteri belgesindeki pratik: ücret metre başına, USD (kullanıcı kuralı 2026-11-17). */
export function emptyOrderForm(seed?: Partial<WarpingOrderFormState>): WarpingOrderFormState {
  return {
    warpSpecId: null,
    subcontractorId: null,
    beamLines: [{ beamCount: "1", beamLengthM: "" }],
    beamCountOpen: false,
    openTargetLengthM: "",
    extraWarpSpecIds: [],
    salesOrders: [],
    feeUnit: "METRE",
    feeUnitPrice: "",
    feeCurrency: "USD",
    expectedReturnDay: "",
    fixedWasteM: "",
    wasteTolerancePct: "",
    notes: "",
    ...seed,
  };
}

/** Kayıtlı siparişten düzenleme formu. */
export function formFromOrder(o: WarpingOrder): WarpingOrderFormState {
  return {
    warpSpecId: o.warpSpec.id,
    subcontractorId: o.subcontractor.id,
    beamLines: isBeamCountOpen(o) ? [{ beamCount: "1", beamLengthM: "" }] : o.beamLines.map((l) => ({ beamCount: String(l.beamCount), beamLengthM: trimNum(l.beamLengthM) })),
    beamCountOpen: isBeamCountOpen(o),
    openTargetLengthM: isBeamCountOpen(o) ? trimNum(o.targetLengthM) : "",
    extraWarpSpecIds: o.extraSpecs.map((x) => x.id),
    salesOrders: o.salesOrders.map((s) => ({ id: s.id, label: `${s.orderNumber} — ${s.customerName}` })),
    feeUnit: o.fee.unit,
    feeUnitPrice: o.fee.unitPrice === null ? "" : trimNum(o.fee.unitPrice),
    feeCurrency: o.fee.currency ?? "USD",
    expectedReturnDay: o.expectedReturnAt ? factoryDayKey(o.expectedReturnAt) : "",
    fixedWasteM: trimNum(o.fixedWasteM),
    wasteTolerancePct: o.wasteTolerancePct === null ? "" : trimNum(o.wasteTolerancePct),
    notes: o.notes ?? "",
  };
}

/** "1000.000" → "1000"; "12.500" → "12.5". */
export function trimNum(v: string): string {
  return v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v;
}

/** Kullanıcının yazdığı sayı: virgül ondalık kabul; boş/geçersiz → null. */
export function parseNum(v: string): number | null {
  const t = v.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Levent satırları geçerliyse gövde dizisi, değilse null (önizleme istenmez, alan uyarısı görünür). */
export function beamLinesBody(lines: BeamLineDraft[]): Array<{ beamCount: number; beamLengthM: number }> | null {
  if (lines.length === 0 || lines.length > MAX_BEAM_LINES) return null;
  const out: Array<{ beamCount: number; beamLengthM: number }> = [];
  for (const l of lines) {
    const c = parseNum(l.beamCount);
    const m = parseNum(l.beamLengthM);
    if (c === null || !Number.isInteger(c) || c <= 0 || m === null || m <= 0) return null;
    out.push({ beamCount: c, beamLengthM: m });
  }
  return out;
}

/** Açık adet toplam metresi: geçerliyse sayı, değilse null. */
export function openTargetBody(v: string): number | null {
  const m = parseNum(v);
  return m !== null && m > 0 && m <= 10_000_000 ? m : null;
}

/** Hedef gövdesi: açık adet → `{ openTargetLengthM }`, değilse `{ beamLines }`; geçersizse null. */
export function targetBody(s: WarpingOrderFormState): { beamLines: Array<{ beamCount: number; beamLengthM: number }> } | { openTargetLengthM: number } | null {
  if (s.beamCountOpen) {
    const m = openTargetBody(s.openTargetLengthM);
    return m === null ? null : { openTargetLengthM: m };
  }
  const beamLines = beamLinesBody(s.beamLines);
  return beamLines ? { beamLines } : null;
}

/** Önizleme gövdesi (kart + hedef + ek grup + sabit fire); eksikse null. */
export function previewBody(s: WarpingOrderFormState) {
  const target = targetBody(s);
  if (!s.warpSpecId || !target) return null;
  const fixed = parseNum(s.fixedWasteM);
  if (s.fixedWasteM.trim() !== "" && (fixed === null || fixed < 0 || fixed > 1000)) return null;
  return {
    warpSpecId: s.warpSpecId,
    ...target,
    ...(s.extraWarpSpecIds.length > 0 ? { extraWarpSpecIds: s.extraWarpSpecIds } : {}),
    ...(fixed !== null ? { fixedWasteM: fixed } : {}),
  };
}

export type BodyResult = { ok: true; body: WarpingOrderBody } | { ok: false; error: string };

/**
 * Kaydet gövdesi. `mode`: yeni (boş fire/tolerans = ayar, anahtar gönderilmez) · plan düzenleme (OPEN) ·
 * yalnız meta (IN_PROGRESS — plan sunucuda donuk; plan anahtarı GÖNDERİLMEZ).
 */
export function buildOrderBody(s: WarpingOrderFormState, mode: "create" | "edit-plan" | "edit-meta"): BodyResult {
  const body: WarpingOrderBody = {};
  if (mode === "create") {
    if (!s.warpSpecId) return { ok: false, error: "Çözgü kartı seçin." };
    if (!s.subcontractorId) return { ok: false, error: "Devereci seçin." };
    body.warpSpecId = s.warpSpecId;
    body.subcontractorId = s.subcontractorId;
  }
  if (mode !== "edit-meta") {
    const target = targetBody(s);
    if (!target) {
      return { ok: false, error: s.beamCountOpen ? "Toplam metre sıfırdan büyük olmalı." : "Her levent satırında adet (tam sayı) ve boy (m) sıfırdan büyük olmalı." };
    }
    Object.assign(body, target);
    body.extraWarpSpecIds = s.extraWarpSpecIds;
    const fixed = parseNum(s.fixedWasteM);
    if (s.fixedWasteM.trim() !== "") {
      if (fixed === null || fixed < 0 || fixed > 1000) return { ok: false, error: "Sabit fire 0–1000 m arasında olmalı." };
      body.fixedWasteM = fixed;
    }
  }
  const tol = parseNum(s.wasteTolerancePct);
  if (s.wasteTolerancePct.trim() !== "") {
    if (tol === null || tol < 0 || tol > 99) return { ok: false, error: "Fire toleransı %0–99 arasında olmalı." };
    body.wasteTolerancePct = tol;
  } else if (mode !== "create") {
    body.wasteTolerancePct = null;
  }
  const price = parseNum(s.feeUnitPrice);
  if (s.feeUnitPrice.trim() !== "" && (price === null || price < 0)) return { ok: false, error: "Devere ücreti sıfır ya da pozitif sayı olmalı." };
  body.feeUnit = s.feeUnit;
  body.feeUnitPrice = price;
  body.feeCurrency = price === null ? null : s.feeCurrency;
  body.salesOrderIds = s.salesOrders.map((x) => x.id);
  body.expectedReturnAt = s.expectedReturnDay ? factoryDayStartIso(s.expectedReturnDay) : null;
  const notes = s.notes.trim();
  if (notes.length > 500) return { ok: false, error: "Not en çok 500 karakter." };
  body.notes = notes === "" ? null : notes;
  return { ok: true, body };
}

/** Plan alanları düzenlenebilir mi: yalnız OPEN (sevksiz). IN_PROGRESS'te meta serbest; kapalı/iptal salt-okunur. */
export function editModeOf(status: WarpingOrderStatus): "edit-plan" | "edit-meta" | null {
  if (status === "OPEN") return "edit-plan";
  if (status === "IN_PROGRESS") return "edit-meta";
  return null;
}

export const fmtKg = (v: number | string | null | undefined): string => formatQty(v, 3, 3);
export const fmtM = (v: number | string | null | undefined): string => formatQty(v, 1, 0);

/** Levent adedi açık mı — yeni backend `beamCountOpen`, eski backend hep doluydu (`beamCount` null değil). */
export function isBeamCountOpen(o: { beamCount: number | null; beamCountOpen?: boolean }): boolean {
  return o.beamCountOpen === true || o.beamCount === null;
}

/** Plan metni: satırlı "2 × 1.000 m + 1 × 800 m"; açık adet "toplam 1.500 m". */
export function planText(o: { beamCount: number | null; beamCountOpen?: boolean; beamLines: ReadonlyArray<{ beamCount: number; beamLengthM: string }>; targetLengthM: string }): string {
  return isBeamCountOpen(o) ? `toplam ${fmtM(o.targetLengthM)} m` : beamLinesText(o.beamLines);
}

/** Liste/detay hedef metni: "3 levent · 1.500 m" ya da "1.500 m (adet devereciye bırakıldı)". */
export function targetText(o: { beamCount: number | null; beamCountOpen?: boolean; targetLengthM: string }): string {
  return isBeamCountOpen(o) ? `${fmtM(o.targetLengthM)} m (adet devereciye bırakıldı)` : `${o.beamCount} levent · ${fmtM(o.targetLengthM)} m`;
}

/** "3 × 1.200 m" ya da çok satırlıysa "2 × 1.000 m + 1 × 800 m". */
export function beamLinesText(lines: ReadonlyArray<{ beamCount: number; beamLengthM: string }>): string {
  return lines.map((l) => `${l.beamCount} × ${fmtM(l.beamLengthM)} m`).join(" + ");
}

/** Termin metni + gecikme: açık/sevkte siparişte geçmiş termin "N gün gecikti". */
export function dueText(expectedReturnAt: string | null, status: WarpingOrderStatus, now: Date = new Date()): { text: string; late: boolean } {
  if (!expectedReturnAt) return { text: "—", late: false };
  const day = factoryDayKey(expectedReturnAt);
  const [y, m, d] = day.split("-");
  const text = `${d}.${m}.${y}`;
  if (status !== "OPEN" && status !== "IN_PROGRESS") return { text, late: false };
  const diff = factoryDayDiff(now, expectedReturnAt);
  return diff > 0 ? { text: `${text} · ${diff} gün gecikti`, late: true } : { text, late: false };
}

/** Tel × metre fiyatı 8 ondalık taşır (A1 genişletmesi) → gösterim 8'e kadar, sondaki sıfırlar atılır. */
export function feeText(fee: WarpingOrder["fee"]): string {
  const unit = fee.unit === "METRE" ? "m" : fee.unit === "KG" ? "kg" : "tel×m";
  return fee.unitPrice === null ? `Ücret girilmedi (${unit} başına)` : `${formatQty(fee.unitPrice, 8)} ${fee.currency ?? ""} / ${unit}`;
}

/** Ek tel grubu seçenek belleği: önizleme seçili kartları önerilerden düşer, 400 dönen önizleme hiç veri getirmez —
 * seçenekler bellekte birikir ki işaretli kutu listeden kaybolmasın, işaret kaldırılabilsin. Kart değişince sıfırlanır. */
export interface ExtraOptionMemo {
  warpSpecId: string;
  options: SpecRef[];
}

export function rememberExtraOptions(
  prev: ExtraOptionMemo | null,
  warpSpecId: string | null,
  preview: { warpSpec: { id: string }; suggestedExtraSpecs: SpecRef[]; extras: SpecRef[] } | undefined,
): ExtraOptionMemo | null {
  if (!warpSpecId) return null;
  const base = prev && prev.warpSpecId === warpSpecId ? prev : { warpSpecId, options: [] };
  const incoming = preview && preview.warpSpec.id === warpSpecId ? [...preview.suggestedExtraSpecs, ...preview.extras] : [];
  const added = incoming.filter((x, i) => !base.options.some((y) => y.id === x.id) && incoming.findIndex((y) => y.id === x.id) === i);
  if (added.length === 0) return base;
  return { warpSpecId, options: [...base.options, ...added] };
}
