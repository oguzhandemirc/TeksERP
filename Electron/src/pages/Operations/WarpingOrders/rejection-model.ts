// Kusurlu sarım reddi — saf yardımcılar (devere ek C2). Panel hesap YAPMAZ: taslak → istek gövdesi, satır içi
// girdi denetimi, aday listeleri. Dönecek iplik, engeller ve fatura uyarısı sunucu önizlemesinden gelir.
import type { WarpingReceipt } from "./receive-types";
import type { WarpingBeamRejection, WarpingBeamRejectionFields } from "./rejection-types";

/** Sunucu sınırlarının aynası (route Zod: ≤3 foto/istek, foto ≤5 MB; servis ≤50 sarım). Son söz sunucuda. */
export const MAX_REJECT_PHOTOS = 3;
export const MAX_REJECT_PHOTO_BYTES = 5 * 1024 * 1024;
export const REJECT_PHOTO_TYPES = ["image/jpeg", "image/png"] as const;

export interface RejectDraft {
  beamIds: string[];
  reasonCode: string;
  reasonText: string;
  notes: string;
  expectRework: boolean;
  /** "YYYY-MM-DDTHH:mm" fabrika saati; boş = şimdi. */
  rejectedAt: string;
}

export interface RejectBeamOption { id: string; beamNo: string; bodyNo: string | null; lengthM: string | null; deliveryNoteNo: string | null }

/** Reddedilebilir aday: kabulü canlı, depoda HAZIR sarım (engellerin tamamını önizleme söyler). */
export function rejectableBeams(receipts: ReadonlyArray<WarpingReceipt>): RejectBeamOption[] {
  return receipts.flatMap((r) => r.beams.filter((b) => !b.cancelled && b.status === "READY").map((b) => ({ id: b.id, beamNo: b.beamNo, bodyNo: b.physicalBeamNo, lengthM: b.lengthM, deliveryNoteNo: r.deliveryNoteNo })));
}

export interface ReworkCandidate { beamId: string; beamNo: string; docNo: string }

/** Kabulde "yeniden sarılan" olarak bağlanabilecek sarımlar: etkin, "yeniden sarılsın" kipli belgede, henüz yeniden sarımı gelmemiş. */
export function reworkCandidates(docs: ReadonlyArray<WarpingBeamRejection>): ReworkCandidate[] {
  return docs
    .filter((d) => d.status === "ACTIVE" && d.mode === "REWORK")
    .flatMap((d) => d.items.filter((i) => !i.reversed && i.rework === null && i.status === "REJECTED").map((i) => ({ beamId: i.beamId, beamNo: i.beamNo, docNo: d.docNo })));
}

/** beamId → bu sarımı reddeden ETKİN belge (sarım satırındaki "Reddedildi" rozetinin belge no'su). */
export function activeRejectionByBeam(docs: ReadonlyArray<WarpingBeamRejection>): Map<string, WarpingBeamRejection> {
  const out = new Map<string, WarpingBeamRejection>();
  for (const d of docs) if (d.status === "ACTIVE") for (const i of d.items) if (!i.reversed) out.set(i.beamId, d);
  return out;
}

export type RejectBuild = { ok: true; body: WarpingBeamRejectionFields } | { ok: false; error: string | null };

/** `requiresText` seçili sebebin "metin zorunlu" bayrağı; `toIso` fabrika saatini ISO'ya çevirir (null = geçersiz). */
export function buildRejectBody(orderId: string, d: RejectDraft, requiresText: boolean, toIso: (v: string) => string | null): RejectBuild {
  if (d.beamIds.length === 0) return { ok: false, error: "En az bir sarım seçin." };
  if (!d.reasonCode) return { ok: false, error: null };
  const text = d.reasonText.trim();
  if (requiresText && text.length < 3) return { ok: false, error: "Bu sebepte açıklama zorunlu (en az 3 karakter)." };
  let rejectedAt: string | null = null;
  if (d.rejectedAt.trim()) {
    rejectedAt = toIso(d.rejectedAt);
    if (!rejectedAt) return { ok: false, error: "Ret tarihi geçersiz." };
  }
  return {
    ok: true,
    body: { warpingOrderId: orderId, beamIds: [...d.beamIds].sort(), reasonCode: d.reasonCode, reasonText: text || null, notes: d.notes.trim() || null, expectRework: d.expectRework, rejectedAt },
  };
}

/** Seçilen dosyanın panel tarafı ön denetimi (tür + boyut); hata cümlesi ya da null. */
export function photoProblem(f: { name: string; type: string; size: number }): string | null {
  if (!(REJECT_PHOTO_TYPES as readonly string[]).includes(f.type)) return `${f.name}: yalnız JPEG ya da PNG fotoğraf eklenir.`;
  if (f.size > MAX_REJECT_PHOTO_BYTES) return `${f.name}: fotoğraf 5 MB'den büyük.`;
  return null;
}
