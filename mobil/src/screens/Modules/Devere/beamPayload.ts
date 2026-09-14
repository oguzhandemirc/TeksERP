// =============================================================================
// LEVENT YÜKÜ — saf (React'sız): backend `createSchema` / `windSchema` ile birebir
// =============================================================================
// Köken XOR istemcide de kurulur (panel `schema.ts` aynası): IN_HOUSE → taraf yok,
// SUBCONTRACT → fasoncu, PURCHASED → tedarikçi XOR fasoncu. IN_HOUSE sarımda makine +
// ≥1 brüt çıkış satırı ZORUNLU; diğer kökenlerde makine ve iplik satırı HİÇ gönderilmez
// (sunucu 400 verir; form hiç kurmaz). Nominal kg ön hesabı sunucu formülünün aynasıdır.
// =============================================================================
import type { PlanWarpBeamRequest, WarpBeamOrigin, WarpBeamStatus, WarpKgSource, WindWarpBeamRequest } from '../../../services/warpBeam.service';

export const ORIGIN_LABEL: Record<WarpBeamOrigin, string> = {
  IN_HOUSE: 'İçeride sarılacak',
  SUBCONTRACT: 'Fasona sardırıldı',
  PURCHASED: 'Hazır alındı',
};
export const KG_SOURCE_LABEL: Record<WarpKgSource, string> = { WEIGHED: 'Tartıldı', THEORETICAL: 'Nominal (hesap)' };
/** Durum rozeti — `Record` tam: backend'e değer gelince derleme kırılır (enum aynası). */
export const STATUS_LABEL: Record<WarpBeamStatus, string> = { PLANNED: 'Planlı', READY: 'Hazır', SHIPPED_OUT: 'Fasonda', CANCELLED: 'İptal' };
/** Tablet eylemleri (sar · sil · iptal) yalnız bu durumlarda; SHIPPED_OUT levent tabletten dokunulmaz (dönüş fason ekranında). */
export function beamActionsEnabled(status: WarpBeamStatus): boolean {
  return status === 'PLANNED' || status === 'READY';
}

export interface PlanForm {
  warpSpecId: string | null;
  plannedLengthM: string;
  originKind: WarpBeamOrigin;
  subcontractorId: string | null;
  supplierId: string | null;
  physicalBeamNo: string;
  notes: string;
}

export const EMPTY_PLAN: PlanForm = { warpSpecId: null, plannedLengthM: '', originKind: 'IN_HOUSE', subcontractorId: null, supplierId: null, physicalBeamNo: '', notes: '' };

export interface YarnLineDraft {
  key: string;
  warehouseId: string | null;
  qtyKg: string;
  reasonCode: string | null;
  /** Faz 2: lot; null = "Lot yok" (operatör AÇIKÇA seçer — sessiz lotsuz yazım olmasın). */
  lotId: string | null;
}

export interface WindForm {
  lengthM: string;
  kgSource: WarpKgSource;
  machineId: string | null;
  issues: YarnLineDraft[];
  returns: YarnLineDraft[];
  breakCount: string;
}

export type Validation = { ok: true } | { ok: false; message: string };

function num(s: string): number | null {
  const n = Number(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function nullable(s: string, max: number): string | null {
  const t = s.trim();
  return t.length > 0 ? t.slice(0, max) : null;
}

export function validatePlan(f: PlanForm): Validation {
  if (!f.warpSpecId) return { ok: false, message: 'Çözgü kartı seçin.' };
  const m = num(f.plannedLengthM);
  if (m == null || m <= 0) return { ok: false, message: 'Planlanan metre 0’dan büyük olmalı.' };
  if (f.originKind === 'IN_HOUSE' && (f.subcontractorId || f.supplierId)) return { ok: false, message: 'İçeride sarımda fasoncu/tedarikçi seçilmez.' };
  if (f.originKind === 'SUBCONTRACT' && (!f.subcontractorId || f.supplierId)) return { ok: false, message: 'Fason sarımda yalnız fasoncu seçilir.' };
  if (f.originKind === 'PURCHASED' && !!f.subcontractorId === !!f.supplierId) return { ok: false, message: 'Hazır alımda tedarikçi YA DA fasoncu — tam biri.' };
  return { ok: true };
}

export function buildPlanPayload(f: PlanForm, clientToken: string): PlanWarpBeamRequest {
  return {
    warpSpecId: f.warpSpecId ?? '',
    plannedLengthM: num(f.plannedLengthM) ?? 0,
    originKind: f.originKind,
    subcontractorId: f.originKind === 'IN_HOUSE' ? null : f.subcontractorId,
    supplierId: f.originKind === 'PURCHASED' ? f.supplierId : null,
    physicalBeamNo: nullable(f.physicalBeamNo, 32),
    notes: nullable(f.notes, 500),
    clientToken,
  };
}

/** Sarım formu başlangıcı: metre plandan, kg kaynağı kökene göre (panel `WindDialog` aynası). */
export function initialWindForm(beam: { plannedLengthM: number; originKind: WarpBeamOrigin }, defaultWarehouseId: string | null): WindForm {
  const inHouse = beam.originKind === 'IN_HOUSE';
  return {
    lengthM: String(beam.plannedLengthM),
    kgSource: inHouse ? 'WEIGHED' : 'THEORETICAL',
    machineId: null,
    issues: inHouse ? [{ key: 'i1', warehouseId: defaultWarehouseId, qtyKg: '', reasonCode: null, lotId: null }] : [],
    returns: [],
    breakCount: '',
  };
}

function validateLines(lines: YarnLineDraft[], label: string, needsReason: boolean): Validation {
  for (const l of lines) {
    if (!l.warehouseId) return { ok: false, message: `${label}: depo seçin.` };
    const q = num(l.qtyKg);
    if (q == null || q <= 0) return { ok: false, message: `${label}: kg 0’dan büyük olmalı.` };
    if (needsReason && !l.reasonCode) return { ok: false, message: `${label}: sebep seçin.` };
  }
  return { ok: true };
}

export function validateWind(f: WindForm, originKind: WarpBeamOrigin, lotRequired = false): Validation {
  const m = num(f.lengthM);
  if (m == null || m <= 0) return { ok: false, message: 'Sarılan metre 0’dan büyük olmalı.' };
  if (originKind !== 'IN_HOUSE') return { ok: true };
  if (!f.machineId) return { ok: false, message: 'Devere makinesi seçin.' };
  if (f.issues.length === 0) return { ok: false, message: 'En az bir brüt iplik çıkışı satırı gerekir.' };
  // `devere.lotRequired` SUNUCUDAN okunur; istemci kapısı yalnız erken uyarı (sunucu 400 zaten verir).
  if (lotRequired && f.issues.some((l) => !l.lotId)) return { ok: false, message: 'Lot zorunlu: her iplik çıkış satırında lot seçin.' };
  const i = validateLines(f.issues, 'İplik çıkışı', false);
  if (!i.ok) return i;
  const r = validateLines(f.returns, 'Dip iadesi', true);
  if (!r.ok) return r;
  const issueKg = f.issues.reduce((s, l) => s + (num(l.qtyKg) ?? 0), 0);
  const returnKg = f.returns.reduce((s, l) => s + (num(l.qtyKg) ?? 0), 0);
  if (returnKg > issueKg) return { ok: false, message: `Dip iadesi (${returnKg} kg) brüt çıkışı (${issueKg} kg) aşamaz.` };
  const bc = f.breakCount.trim() === '' ? null : num(f.breakCount);
  if (bc != null && (bc < 0 || !Number.isInteger(bc))) return { ok: false, message: 'Kopuş adedi tam sayı olmalı.' };
  return { ok: true };
}

export function buildWindPayload(f: WindForm, originKind: WarpBeamOrigin, clientToken: string): WindWarpBeamRequest {
  const inHouse = originKind === 'IN_HOUSE';
  return {
    lengthM: num(f.lengthM) ?? 0,
    kgSource: f.kgSource,
    machineId: inHouse ? f.machineId : null,
    yarnIssues: inHouse ? f.issues.map((l) => ({ warehouseId: l.warehouseId ?? '', qtyKg: num(l.qtyKg) ?? 0, lotId: l.lotId })) : [],
    yarnReturns: inHouse ? f.returns.map((l) => ({ warehouseId: l.warehouseId ?? '', qtyKg: num(l.qtyKg) ?? 0, reasonCode: l.reasonCode ?? '', lotId: l.lotId })) : [],
    breakCount: inHouse && f.breakCount.trim() !== '' ? (num(f.breakCount) ?? null) : null,
    clientToken,
  };
}

/** Nominal kg = tel × denye × metre / 9.000.000 — sunucu formülünün AYNASI (ön hesap; sunucu yeniden hesaplar). */
export function theoreticalKg(endsCount: number, denier: number | null, lengthM: number): number | null {
  if (denier == null || !(lengthM > 0) || !(endsCount > 0)) return null;
  return Math.round(((endsCount * denier * lengthM) / 9_000_000) * 1000) / 1000;
}

export type BeamFailureAction =
  | { kind: 'refresh-list'; message: string }
  | { kind: 'refresh-context'; message: string }
  | { kind: 'refresh-presets'; message: string }
  | { kind: 'module-off'; modul: string; message: string }
  | { kind: 'token-collision'; message: string }
  | { kind: 'plain'; message: string };

interface FailureLike {
  message?: string;
  details?: { code?: string; modul?: string } | null;
}

const REFRESH_LIST = new Set(['WARP_BEAM_STATE', 'WARP_BEAM_NOT_PLANNED', 'WARP_BEAM_NOT_WOUND', 'WARP_BEAM_CANCELLED']);
const REFRESH_CONTEXT = new Set(['WARP_BEAM_MACHINE_NOT_DEVERE', 'WARP_DENIER_MISSING', 'WARP_BEAM_ORIGIN_PARTY']);

/** `details.code` → ekran eylemi. Bilinmeyen kod düz mesaj; kod uydurulmaz. */
export function classifyBeamFailure(error: unknown, fallback: string): BeamFailureAction {
  const e = (error ?? {}) as FailureLike;
  const message = e.message?.trim() || fallback;
  const code = e.details?.code ?? '';
  if (REFRESH_LIST.has(code)) return { kind: 'refresh-list', message };
  if (REFRESH_CONTEXT.has(code)) return { kind: 'refresh-context', message };
  if (code === 'REASON_CODE_INVALID') return { kind: 'refresh-presets', message };
  if (code === 'MODULE_DISABLED') return { kind: 'module-off', modul: e.details?.modul ?? 'devere', message };
  if (code === 'CLIENT_TOKEN_COLLISION') return { kind: 'token-collision', message };
  return { kind: 'plain', message };
}

/** Sarım tarihi fabrika gününde mi (cihaz saati Türkiye'de) — "bugün sarılan" sekmesi. */
export function isSameLocalDay(iso: string, now: Date): boolean {
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}
