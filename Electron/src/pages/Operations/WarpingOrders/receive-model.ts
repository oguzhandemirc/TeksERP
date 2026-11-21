// Levent kabulü — saf yardımcılar (D7a). Panel hesap YAPMAZ: satır taslağı → istek gövdesi, satır içi girdi
// doğrulaması ve biçim. Tüketim, dağıtım, tartı farkı ve mutabakat sayıları sunucudan gelir.
import { fmtKg, parseNum } from "./order-model";
import type { BeamLine } from "./types";
import type { WarpingReceiveBeamBody, WarpingReceiveFields, WarpingReceivePreview } from "./receive-types";

export const MAX_RECEIVE_BEAMS = 50;

export interface ReceiveBeamDraft {
  physicalBeamNo: string;
  lengthM: string;
  grossKg: string;
  tareKg: string;
  /** C2: yeniden sarılan reddedilen sarımın kimliği ("" = yeniden sarım değil). */
  reworkOfBeamId: string;
  /** E2 (B3 alanları): okutulan kayıtlı gövde ya da yerinde tanımlanan yeni gövde; yoksa `physicalBeamNo` metni. */
  body?: ReceiveBodyDraft | null;
}

/** Okutulan gövde: kayıtlıysa kimliği, tanımsızsa no + sahip (Bizim / bu devereci). */
export type ReceiveBodyDraft =
  | { kind: "existing"; id: string; bodyNo: string; hint: string }
  | { kind: "new"; bodyNo: string; ownerKind: "OURS" | "WARPER"; subcontractorId: string | null };

export type ReceiveWeighing = "OFF" | "OPTIONAL" | "REQUIRED";

export const emptyBeamDraft = (lengthM = ""): ReceiveBeamDraft => ({ physicalBeamNo: "", lengthM, grossKg: "", tareKg: "", reworkOfBeamId: "" });

/** "Plandaki gibi doldur": sipariş satırlarındaki adet × boy kadar satır (gövde no boş). */
export function draftsFromPlan(lines: ReadonlyArray<BeamLine>): ReceiveBeamDraft[] {
  const out: ReceiveBeamDraft[] = [];
  for (const l of lines) for (let i = 0; i < l.beamCount && out.length < MAX_RECEIVE_BEAMS; i++) out.push(emptyBeamDraft(trimLen(l.beamLengthM)));
  return out.length > 0 ? out : [emptyBeamDraft()];
}

/** Sunucunun `500.000` metnini girdi biçimine çevirir (`500`, `512,5`). */
function trimLen(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? String(n).replace(".", ",") : "";
}

export type ReceiveBuild = { ok: true; body: WarpingReceiveFields; totalM: number } | { ok: false; error: string | null };

export const isBlankDraft = (r: ReceiveBeamDraft) => !r.physicalBeamNo.trim() && !r.lengthM.trim() && !r.grossKg.trim() && !r.tareKg.trim() && !r.reworkOfBeamId && !r.body;

function optKg(text: string, row: number, label: string): number | null | string {
  if (text.trim() === "") return null;
  const n = parseNum(text);
  if (n === null || n < 0) return `${row}. satır: ${label} geçerli bir sayı olmalı.`;
  return Math.round(n * 1000) / 1000;
}

function bodyFields(b: ReceiveBodyDraft | null | undefined): Pick<WarpingReceiveBeamBody, "beamBodyId" | "newBody"> {
  if (!b) return {};
  if (b.kind === "existing") return { beamBodyId: b.id };
  const owner = b.ownerKind === "WARPER" ? { kind: "WARPER" as const, subcontractorId: b.subcontractorId } : { kind: "OURS" as const };
  return { newBody: { bodyNo: b.bodyNo.trim() || null, owner } };
}

function buildBeam(r: ReceiveBeamDraft, row: number, weighing: ReceiveWeighing): WarpingReceiveBeamBody | string {
  const len = parseNum(r.lengthM);
  if (len === null || len <= 0) return `${row}. satır: metre girin.`;
  // Tartı kapalıyken sütun çizilmez; eski taslakta kalan değer gönderilmez (sunucu 400 verirdi).
  const gross = weighing === "OFF" ? null : optKg(r.grossKg, row, "brüt kg");
  if (typeof gross === "string") return gross;
  const tare = weighing === "OFF" ? null : optKg(r.tareKg, row, "dara kg");
  if (typeof tare === "string") return tare;
  if (weighing === "REQUIRED" && gross === null) return `${row}. satır: brüt kg yazın (bu kurulumda dönüş tartısı zorunlu).`;
  if (tare !== null && gross === null) return `${row}. satır: dara yazıldıysa brüt kg da yazılmalı.`;
  if (tare !== null && gross !== null && tare >= gross) return `${row}. satır: dara brütten küçük olmalı.`;
  // Gövdeli satırda gövde no sunucuda gövdeden kopyalanır; metin no gönderilmez.
  const no = r.body ? "" : r.physicalBeamNo.trim();
  const base = { lengthM: Math.round(len * 1000) / 1000, physicalBeamNo: no || null, grossKg: gross, tareKg: tare, ...bodyFields(r.body) };
  // Alan yalnız seçiliyse gider: yeniden sarımsız kabulün gövdesi C2 öncesiyle bayt-aynı kalır.
  return r.reworkOfBeamId ? { ...base, reworkOfBeamId: r.reworkOfBeamId } : base;
}

const bodyKey = (b: WarpingReceiveBeamBody): string | null =>
  b.beamBodyId ? `id:${b.beamBodyId}` : b.newBody?.bodyNo ? `no:${b.newBody.bodyNo}` : b.physicalBeamNo ? `no:${b.physicalBeamNo}` : null;
const bodyLabel = (b: WarpingReceiveBeamBody, drafts: ReceiveBeamDraft[], i: number) => drafts[i]?.body?.bodyNo ?? b.newBody?.bodyNo ?? b.physicalBeamNo ?? "";

/** Belge düzeyinde (siparişler arası) gövde tekrarı denetimi için dışarı açık anahtar. */
export const receiveBodyKey = bodyKey;

/** Tamamen boş satır atlanır; yarım satır hata verir. Hata metni yoksa (hiç satır yok) düğme sessizce kapalı. */
export function buildReceiveBody(drafts: ReceiveBeamDraft[], deliveryNoteNo: string, weighing: ReceiveWeighing = "OPTIONAL"): ReceiveBuild {
  const beams: WarpingReceiveBeamBody[] = [];
  const seen = new Set<string>();
  const reworks = new Set<string>();
  for (const [i, r] of drafts.entries()) {
    if (isBlankDraft(r)) continue;
    const b = buildBeam(r, i + 1, weighing);
    if (typeof b === "string") return { ok: false, error: b };
    const key = bodyKey(b);
    if (key) {
      if (seen.has(key)) return { ok: false, error: `"${bodyLabel(b, drafts, i)}" gövde numarası iki kez yazılmış.` };
      seen.add(key);
    }
    if (b.reworkOfBeamId) {
      if (reworks.has(b.reworkOfBeamId)) return { ok: false, error: `${i + 1}. satır: aynı reddedilen sarım iki satıra bağlanmış.` };
      reworks.add(b.reworkOfBeamId);
    }
    beams.push(b);
  }
  if (beams.length === 0) return { ok: false, error: null };
  if (beams.length > MAX_RECEIVE_BEAMS) return { ok: false, error: `Bir kabulde en çok ${MAX_RECEIVE_BEAMS} levent olabilir.` };
  return { ok: true, body: { deliveryNoteNo: deliveryNoteNo.trim() || null, beams }, totalM: beams.reduce((s, b) => s + b.lengthM, 0) };
}

/** Önizleme özeti iplik başına: bu kabulde sarılan · devirden düşen · sonrası dağıtılamayan (sunucu satırlarının toplamı, biçim). */
export interface ReceiveYarnRow { yarnItemId: string; code: string; name: string; woundKg: number; carryOverKg: number; unallocatedAfterKg: string }

export function receiveYarnRows(p: WarpingReceivePreview): ReceiveYarnRow[] {
  return p.before.yarns.map((y) => ({
    yarnItemId: y.yarnItemId, code: y.code, name: y.name,
    woundKg: p.beams.reduce((s, b) => s + Number(b.yarns.find((x) => x.yarnItemId === y.yarnItemId)?.kg ?? 0), 0),
    carryOverKg: p.allocations.filter((a) => a.yarnItemId === y.yarnItemId && a.carryOver).reduce((s, a) => s + Number(a.kg), 0),
    unallocatedAfterKg: p.after.yarns.find((a) => a.yarnItemId === y.yarnItemId)?.unallocatedKg ?? "0",
  }));
}

/** İşaretli fark metni: `+1,250` / `−0,500` / `0`. */
export function signedKg(v: string | number | null | undefined, fmt: (n: number) => string = fmtKg): string {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  return `${n > 0 ? "+" : "−"}${fmt(Math.abs(n))}`;
}
