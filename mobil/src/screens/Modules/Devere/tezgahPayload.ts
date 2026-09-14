// =============================================================================
// TEZGAH BAĞI YÜKLERİ — saf (React'sız): backend mount/dismount/consume/exhaust şemalarıyla birebir
// =============================================================================
// Tak (devere ekranı): makine + yuva zorunlu; yöntem `mountTrackingRequired` açıkken zorunlu ve
// başlangıç saati "şimdi" (tablet canlı kaydeder — saat elle girilmez). Sök/Tüket/Bitir (tezgah
// ekranı): metre metin taşır ("" → null), uç sayı bekler; tüketim kalanı AŞAMAZ (sunucu 409 verir,
// form önden kilitler). Her kural burada, ekran yalnız çizer (MOBIL.md saf mantık kalıbı).
// =============================================================================
import type { ConsumeWarpBeamRequest, DismountWarpBeamRequest, ExhaustWarpBeamRequest, MountWarpBeamRequest, WarpBeamMountMethod, WarpLengthSource } from '../../../services/warpBeam.service';

export const MOUNT_METHOD_LABEL: Record<WarpBeamMountMethod, string> = { TYING_IN: 'Düğüm', DRAWING_IN: 'Tahar', HARNESS_CHANGE: 'Takım değişimi' };
export const LENGTH_SOURCE_LABEL: Record<WarpLengthSource, string> = { LOOM_COUNTER: 'Tezgah sayacı', DIAMETER: 'Çap ölçümü', WEIGHED: 'Tartı', ESTIMATED: 'Tahmin' };

/** "" · geçersiz → null; virgül ondalık kabul. */
export function parseM(v: string): number | null {
  const t = v.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export interface MountForm {
  machineId: string | null;
  position: string;
  mountMethod: WarpBeamMountMethod | null;
  machineCounter: string;
}
export const EMPTY_MOUNT: MountForm = { machineId: null, position: '1', mountMethod: null, machineCounter: '' };

/** Tak doğrulaması — hata metni ya da null (geçer). `slots` seçilen makinenin yuva sayısı. */
export function validateMount(f: MountForm, slots: number | null, methodRequired: boolean): string | null {
  if (!f.machineId) return 'Tezgah seçin';
  if (slots != null && slots <= 0) return 'Bu makinenin levent yuvası yok (cağlıklı) — makine kartından yuva sayısı verilmeli';
  const pos = Number(f.position);
  if (!Number.isInteger(pos) || pos < 1 || (slots != null && pos > slots)) return `Yuva 1..${slots ?? '?'} olmalı`;
  if (methodRequired && !f.mountMethod) return 'Bağlama yöntemi zorunlu (ayar açık)';
  return null;
}

export function buildMountPayload(f: MountForm, methodRequired: boolean, token: string, now: Date = new Date()): MountWarpBeamRequest {
  return {
    machineId: f.machineId ?? '',
    position: Number(f.position),
    mountMethod: f.mountMethod,
    // Zorunlu ayarda başlangıç "şimdi" — tablet bağlama anında kaydeder; ayar kapalıysa saat gönderilmez.
    setupStartedAt: methodRequired ? now.toISOString() : null,
    machineCounter: parseM(f.machineCounter),
    clientToken: token,
  };
}

export function mountFingerprint(p: { beamId: string; machineId: string; position: number }): string {
  return ['mount', p.beamId, p.machineId, String(p.position)].join('|');
}

export interface DismountForm {
  remainingM: string;
  lengthSource: WarpLengthSource;
  machineCounter: string;
}
export const EMPTY_DISMOUNT: DismountForm = { remainingM: '', lengthSource: 'LOOM_COUNTER', machineCounter: '' };

export function validateDismount(f: DismountForm): string | null {
  const m = parseM(f.remainingM);
  if (f.remainingM.trim() && (m == null || m < 0)) return 'Ölçülen kalan geçersiz';
  return null;
}
export function buildDismountPayload(f: DismountForm): DismountWarpBeamRequest {
  const m = parseM(f.remainingM);
  return { remainingM: m, lengthSource: m == null ? null : f.lengthSource, machineCounter: parseM(f.machineCounter) };
}

export interface ConsumeForm {
  lengthM: string;
  lengthSource: WarpLengthSource;
  machineCounter: string;
}
export const EMPTY_CONSUME: ConsumeForm = { lengthM: '', lengthSource: 'LOOM_COUNTER', machineCounter: '' };

export function validateConsume(f: ConsumeForm, remainingM: number): string | null {
  const m = parseM(f.lengthM);
  if (m == null || m <= 0) return 'Tüketilen metre 0’dan büyük olmalı';
  if (m > remainingM) return `Kalanı (${remainingM} m) aşıyor — önce kalanı düzelttirin (panel)`;
  return null;
}
export function buildConsumePayload(f: ConsumeForm, token: string): ConsumeWarpBeamRequest {
  return { lengthM: parseM(f.lengthM) ?? 0, lengthSource: f.lengthSource, machineCounter: parseM(f.machineCounter), clientToken: token };
}
export function consumeFingerprint(p: { beamId: string; lengthM: number }): string {
  return ['consume', p.beamId, String(p.lengthM)].join('|');
}

export interface ExhaustForm {
  residualM: string;
  lengthSource: WarpLengthSource;
}
export const EMPTY_EXHAUST: ExhaustForm = { residualM: '', lengthSource: 'DIAMETER' };

export function validateExhaust(f: ExhaustForm): string | null {
  const m = parseM(f.residualM);
  if (f.residualM.trim() && (m == null || m < 0)) return 'Artık geçersiz';
  return null;
}
/** Artık boş → sunucu 0 sayar (ESTIMATED); dolu → ölçülen artık + kaynak. Tartı yolu tablette YOK (panel). */
export function buildExhaustPayload(f: ExhaustForm): ExhaustWarpBeamRequest {
  const m = parseM(f.residualM);
  return { residualM: m, lengthSource: m == null ? null : f.lengthSource };
}
