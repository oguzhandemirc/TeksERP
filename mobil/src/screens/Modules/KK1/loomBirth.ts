// =============================================================================
// KK1 — TOP KK1'DE DOĞAR (saf kural, S3a): tezgah etiketi okut → metre → KAYDET
// =============================================================================
// `dokuma.rollBirth` KK1_* iken eski "Bu top dokuma mı?" sorusu YERİNE tezgah etiketi
// okutulur (`machineCode`); sunucu açık koşumu çözer, indirmeyi topla aynı tx'te yazar.
// Ön-dolgu (kumaş/iş) ÖNERİdir, kilitlemez (D17). Etiket yoksa ve mod KK1_LABEL_OR_ORDER
// ise "Çalışan iş seç" (A yolu, `weavingOrderId`). Hiçbiri yoksa payload BOŞ: top bugünkü
// gibi dışarıdan doğar. TABLET_DOFF iken bu modül hiç çizilmez (ekran bayt bayt bugünkü).
// =============================================================================
import type { DokumaRollBirth } from '../../../services/featureFlag.service';
import type { Kk1Context } from '../../../types/models';

export type LoomVerify = 'ok' | 'pending' | 'unverified';

export interface LoomOrderPick {
  id: string;
  weavingOrderNumber: string;
  itemName: string | null;
}

export interface LoomBirthState {
  /** Okutulan tezgah etiketi; null = okutulmadı. */
  machineCode: string | null;
  /** Çok hatlı tezgahta seçilen hat; null → sunucu 1. hattı varsayar. */
  lineNo: number | null;
  /** `kk1-context` cevabı; null = bekleniyor ya da çevrimdışı ("bağlanınca doğrulanır"). */
  context: Kk1Context | null;
  verify: LoomVerify;
  /** Levent beyanı: varsayılan YENİ (alan gönderilmez, sunucu takılı leventi alır); eski → `warpBeamId`. */
  beamChoice: 'new' | 'old';
  /** `WARP_BEAM_NOT_RECENT` sonrası çipler kaldırılır (beyan geçersizleşti). */
  beamChipsDismissed: boolean;
  /** A yolu: seçilen çalışan iş (etiketle birlikte OLAMAZ — sunucu XOR). */
  order: LoomOrderPick | null;
  /** Son kaydedilen tezgah — "Aynı tezgah" tek dokunuş çipi. */
  lastMachineCode: string | null;
}

export const EMPTY_LOOM_BIRTH: LoomBirthState = {
  machineCode: null,
  lineNo: null,
  context: null,
  verify: 'ok',
  beamChoice: 'new',
  beamChipsDismissed: false,
  order: null,
  lastMachineCode: null,
};

export function isKk1BirthMode(mode: DokumaRollBirth): boolean {
  return mode === 'KK1_LABEL_OR_ORDER' || mode === 'KK1_LABEL_ONLY';
}

/** Okutma bandı yalnız KK1_* ∧ dokuma açık ∧ yarı mamul DIŞINDA çizilir. */
export function isLoomBirthVisible(dokumaEnabled: boolean, rollBirth: DokumaRollBirth, semiMode: boolean): boolean {
  return dokumaEnabled && isKk1BirthMode(rollBirth) && !semiMode;
}

/** "Çalışan iş seç" (A yolu) yalnız KK1_LABEL_OR_ORDER'da; KK1_LABEL_ONLY sunucuda da 400. */
export function orderPickAllowed(rollBirth: DokumaRollBirth): boolean {
  return rollBirth === 'KK1_LABEL_OR_ORDER';
}

export interface BeamQuestion {
  old: { id: string; beamNo: string };
  newBeamNo: string | null;
}

/** Son 12 sa levent değiştiyse iki çip: "Eski levent" (sökülen) / "Yeni levent" (varsayılan). */
export function beamQuestion(ctx: Kk1Context | null): BeamQuestion | null {
  const change = ctx?.beams.recentChange;
  if (!change?.dismounted) return null;
  return { old: change.dismounted, newBeamNo: change.mounted?.beamNo ?? null };
}

export type LoomBirthPayload =
  | { machineCode: string; productionLineNo?: number; warpBeamId?: string }
  | { weavingOrderId: string }
  | Record<string, never>;

/** Gövde parçası: görünmüyorsa BOŞ (bugünkü payload); etiket > iş; hiçbiri yoksa boş (dışarıdan top). */
export function loomBirthPayload(state: LoomBirthState, rollBirth: DokumaRollBirth, visible: boolean): LoomBirthPayload {
  if (!visible) return {};
  if (state.machineCode) {
    const q = state.beamChipsDismissed ? null : beamQuestion(state.context);
    return {
      machineCode: state.machineCode,
      ...(state.lineNo != null ? { productionLineNo: state.lineNo } : {}),
      ...(q && state.beamChoice === 'old' ? { warpBeamId: q.old.id } : {}),
    };
  }
  if (state.order && orderPickAllowed(rollBirth)) return { weavingOrderId: state.order.id };
  return {};
}

/** Parmak izi parçası: iki top yalnız tezgahta/işte ayrılıyorsa ikincisi uçuşta YUTULMASIN (renk emsali). */
export function loomBirthFingerprint(p: LoomBirthPayload): string | null {
  if ('machineCode' in p) return `m:${p.machineCode}:${p.productionLineNo ?? 1}:${p.warpBeamId ?? '-'}`;
  if ('weavingOrderId' in p) return `o:${p.weavingOrderId}`;
  return null;
}

export type LoomFailureKind = 'no-open-run' | 'mode-changed' | 'not-loom' | 'beam-not-recent' | 'order-closed' | 'plain';

/** `details.code` → ekran eylemi. Tanınmayan kod `plain` (genel hata yolu). */
export function classifyLoomBirthFailure(code: unknown): LoomFailureKind {
  switch (code) {
    case 'MACHINE_NO_OPEN_RUN':
    case 'WEAVING_ORDER_NO_OPEN_RUN':
      return 'no-open-run';
    case 'ROLL_BIRTH_MODE':
    case 'MODULE_DISABLED':
      return 'mode-changed';
    case 'MACHINE_NOT_LOOM':
    case 'MACHINE_NOT_FOUND':
    case 'PRODUCTION_LINE_OUT_OF_RANGE':
      return 'not-loom';
    case 'WARP_BEAM_NOT_RECENT':
      return 'beam-not-recent';
    case 'WEAVING_ORDER_NOT_OPEN':
    case 'WEAVING_ORDER_NOT_FOUND':
    case 'WEAVING_ORDER_SUBCONTRACTED':
      return 'order-closed';
    default:
      return 'plain';
  }
}

/** Operatör metni: NE OLDU + NE YAPMALI. Sunucu mesajı varsa ikinci satırda aynen. */
export function loomFailureText(kind: LoomFailureKind, where: string | null): { title: string; hint: string } {
  const at = where ?? 'Tezgah';
  switch (kind) {
    case 'no-open-run':
      return { title: `${at}'de açık iş yok`, hint: 'Panelden İş ver, sonra etiketi yeniden okutun.' };
    case 'mode-changed':
      return { title: 'Ayar değişti', hint: 'Top doğuş ayarı değişti — ekran yenilendi, tekrar deneyin.' };
    case 'not-loom':
      return { title: 'Bu etiket bir tezgahın değil', hint: 'Tezgahın üstündeki etiketi okutun.' };
    case 'beam-not-recent':
      return { title: 'Levent beyanı kabul edilmedi', hint: 'Levent sorusu kaldırıldı — KAYDET ile yeniden gönderin.' };
    case 'order-closed':
      return { title: 'İş kapalı ya da fasonda', hint: 'Listeden başka çalışan iş seçin.' };
    default:
      return { title: 'Kayıt başarısız', hint: '' };
  }
}

/** Okutma sonucu forma: kabul → durum; 4xx → ret (durum değişmez); ağ/5xx → "bağlanınca doğrulanır" kabul. */
export function applyScanResult(
  state: LoomBirthState,
  code: string,
  result: { ok: true; context: Kk1Context } | { ok: false; ambiguous: boolean },
  lineNo: number | null = null
): { outcome: 'accept' | 'reject'; state: LoomBirthState } {
  if (!result.ok && !result.ambiguous) return { outcome: 'reject', state };
  const base: LoomBirthState = { ...EMPTY_LOOM_BIRTH, lastMachineCode: state.lastMachineCode, machineCode: code, lineNo };
  if (!result.ok) return { outcome: 'accept', state: { ...base, verify: 'unverified' } };
  const multi = result.context.machine.productionLineCount > 1;
  return {
    outcome: 'accept',
    state: { ...base, context: result.context, verify: 'ok', lineNo: multi ? result.context.run.productionLineNo : null },
  };
}

/** Kayıttan sonra şerit temizlenir; bir sonraki top yeniden okutulur ("Aynı tezgah" çipi kalır). */
export function afterSave(state: LoomBirthState): LoomBirthState {
  return { ...EMPTY_LOOM_BIRTH, lastMachineCode: state.machineCode ?? state.lastMachineCode };
}

/** A yolu seçimi etiketi siler (XOR). */
export function selectOrder(state: LoomBirthState, order: LoomOrderPick): LoomBirthState {
  return { ...EMPTY_LOOM_BIRTH, lastMachineCode: state.lastMachineCode, order };
}

/** Bağlam şeridi: tezgah · iş no · kumaş · levent kalan. */
export function contextLine(state: LoomBirthState): string | null {
  if (state.order) return `${state.order.weavingOrderNumber}${state.order.itemName ? ` · ${state.order.itemName}` : ''}`;
  if (!state.machineCode) return null;
  const ctx = state.context;
  if (!ctx) return `${state.machineCode} · ${state.verify === 'pending' ? 'okunuyor…' : 'bağlanınca doğrulanır'}`;
  const parts = [ctx.machine.code];
  if (ctx.machine.productionLineCount > 1) parts.push(`hat ${state.lineNo ?? ctx.run.productionLineNo}`);
  if (ctx.run.weavingOrder) parts.push(ctx.run.weavingOrder.weavingOrderNumber);
  if (ctx.run.item) parts.push(ctx.run.item.name);
  if (ctx.run.color) parts.push(ctx.run.color.name);
  const beam = ctx.beams.mounted[0];
  if (beam) parts.push(`${beam.beamNo} kalan ${Math.round(Number(beam.remainingM))} m`);
  return parts.join(' · ');
}
