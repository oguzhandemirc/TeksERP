// Çözgü Hesabı — saf sunum katmanı: form durumu → istek gövdesi, sunucu sayısı → Türkçe metin.
// Hesap YOK (kural: istemci hesap yapmaz); yalnız girdi doğrulama ve biçim.
import { formatQty } from "@/lib/format";
import type { WarpPlanBody, WarpPlanMode, WarpPlanYarnInfo, WarpWasteSource } from "./types";

export interface WarpPlanState {
  mode: WarpPlanMode;
  warpSpecId: string | null;
  subcontractorId: string | null;
  beamCount: string;
  beamLengthM: string;
  /** Boş = ayardaki sabit fire (`devere.warpFixedWasteM`, varsayılan 0). */
  fixedWasteM: string;
}

export const emptyWarpPlanState: WarpPlanState = {
  mode: "FROM_BEAMS",
  warpSpecId: null,
  subcontractorId: null,
  beamCount: "1",
  beamLengthM: "1000",
  fixedWasteM: "",
};

/** Kullanıcının yazdığı sayı: virgül ondalık kabul; boş/geçersiz → null. */
export function parseInput(v: string): number | null {
  const t = v.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Geçerli girdiyle istek gövdesi; eksik/geçersiz alan varsa null (istek atılmaz, alan uyarısı gösterilir). */
export function buildWarpPlanBody(s: WarpPlanState): WarpPlanBody | null {
  if (!s.warpSpecId) return null;
  const body: WarpPlanBody = { mode: s.mode, warpSpecId: s.warpSpecId };
  if (s.subcontractorId) body.subcontractorId = s.subcontractorId;
  const fixed = parseInput(s.fixedWasteM);
  if (s.fixedWasteM.trim() !== "") {
    if (fixed === null || fixed < 0 || fixed > 1000) return null;
    body.fixedWasteM = fixed;
  }
  const len = parseInput(s.beamLengthM);
  if (s.mode === "FROM_BEAMS") {
    const cnt = parseInput(s.beamCount);
    if (cnt === null || !Number.isInteger(cnt) || cnt <= 0 || len === null || len <= 0) return null;
    body.beamCount = cnt;
    body.beamLengthM = len;
  } else if (s.beamLengthM.trim() !== "") {
    if (len === null || len <= 0) return null;
    body.beamLengthM = len;
  }
  return body;
}

/** Talimattaki harf: 0 → A, 1 → B … */
export function yarnLetter(i: number): string {
  return String.fromCharCode(65 + (i % 26));
}

export const fmtKg = (v: number | null | undefined): string => formatQty(v, 3, 3);
export const fmtM = (v: number | null | undefined): string => formatQty(v, 1, 0);

/** Stok hücresi: null = bilinmiyor (iplik modülü kapalı ya da devereci seçilmedi), 0 DEĞİL. */
export function stockText(v: number | null | undefined, unknownLabel = "bilinmiyor"): string {
  return v === null || v === undefined ? unknownLabel : fmtKg(v);
}

/** Fireli sütunun bilgi imi: "sabit 20 m · kart %3 · PES-150 %2". */
export function wasteSourceText(sources: ReadonlyArray<WarpWasteSource>, yarns: ReadonlyArray<WarpPlanYarnInfo>): string {
  const code = (id: string) => yarns.find((y) => y.yarnItemId === id)?.code ?? "iplik";
  return sources
    .map((s) => (s.kind === "SABIT_M" ? `sabit ${fmtM(s.value)} m` : s.kind === "KART_PCT" ? `kart %${formatQty(s.value, 2)}` : `${code(s.yarnItemId)} %${formatQty(s.value, 2)}`))
    .join(" · ");
}
