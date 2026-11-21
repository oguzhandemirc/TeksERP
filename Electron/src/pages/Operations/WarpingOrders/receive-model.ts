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
}

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

const isBlank = (r: ReceiveBeamDraft) => !r.physicalBeamNo.trim() && !r.lengthM.trim() && !r.grossKg.trim() && !r.tareKg.trim() && !r.reworkOfBeamId;

function optKg(text: string, row: number, label: string): number | null | string {
  if (text.trim() === "") return null;
  const n = parseNum(text);
  if (n === null || n < 0) return `${row}. satır: ${label} geçerli bir sayı olmalı.`;
  return Math.round(n * 1000) / 1000;
}

function buildBeam(r: ReceiveBeamDraft, row: number): WarpingReceiveBeamBody | string {
  const len = parseNum(r.lengthM);
  if (len === null || len <= 0) return `${row}. satır: metre girin.`;
  const gross = optKg(r.grossKg, row, "brüt kg");
  if (typeof gross === "string") return gross;
  const tare = optKg(r.tareKg, row, "dara kg");
  if (typeof tare === "string") return tare;
  if (tare !== null && gross === null) return `${row}. satır: dara yazıldıysa brüt kg da yazılmalı.`;
  if (tare !== null && gross !== null && tare >= gross) return `${row}. satır: dara brütten küçük olmalı.`;
  const no = r.physicalBeamNo.trim();
  const base = { lengthM: Math.round(len * 1000) / 1000, physicalBeamNo: no || null, grossKg: gross, tareKg: tare };
  // Alan yalnız seçiliyse gider: yeniden sarımsız kabulün gövdesi C2 öncesiyle bayt-aynı kalır.
  return r.reworkOfBeamId ? { ...base, reworkOfBeamId: r.reworkOfBeamId } : base;
}

/** Tamamen boş satır atlanır; yarım satır hata verir. Hata metni yoksa (hiç satır yok) düğme sessizce kapalı. */
export function buildReceiveBody(drafts: ReceiveBeamDraft[], deliveryNoteNo: string): ReceiveBuild {
  const beams: WarpingReceiveBeamBody[] = [];
  const seen = new Set<string>();
  const reworks = new Set<string>();
  for (const [i, r] of drafts.entries()) {
    if (isBlank(r)) continue;
    const b = buildBeam(r, i + 1);
    if (typeof b === "string") return { ok: false, error: b };
    if (b.physicalBeamNo) {
      if (seen.has(b.physicalBeamNo)) return { ok: false, error: `"${b.physicalBeamNo}" gövde numarası iki kez yazılmış.` };
      seen.add(b.physicalBeamNo);
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
