// =============================================================================
// GK-H1b brode adedi — saf yardımcılar (brode ADET/VURUŞ fiyatlaması)
// =============================================================================
// Giriş yalnız adım özeti `pieceInput` (PIECE | STITCH) gelirse çizilir; METER ya da eski
// backend alanı göndermez → giriş yok, çıkış okuma gövdesi bayt-aynı. Adet çıkış okumasına
// (`meterOut.pieceCount`) girer; okuma token kimliğine dahildir (sunucu replay'i karşılaştırır).
// =============================================================================

import type { CompleteQc2Request } from '../../../services/kursunQc.service';
import type { KursunStepSummary } from '../../../types/models';

export type PieceInputMode = 'PIECE' | 'STITCH';

/** Tanınmayan/eksik değer → null (fail-closed: giriş çizilmez, gövde değişmez). */
export function pieceInputOf(summary: Pick<KursunStepSummary, 'pieceInput'> | null | undefined): PieceInputMode | null {
  const v = summary?.pieceInput;
  return v === 'PIECE' || v === 'STITCH' ? v : null;
}

/** Sunucu Zod sınırı (`kursun-qc.controller` pieceCount: tam sayı, 1..10.000.000). */
export const PIECE_COUNT_MAX = 10_000_000;

export type PieceParse = { ok: true; value: number } | { ok: false; message: string };

/** Metin → adet. Boş, kesirli, ≤ 0 ya da sınır üstü → operatöre Türkçe sebep. */
export function parsePieceCount(text: string): PieceParse {
  const t = text.trim();
  if (t === '') return { ok: false, message: 'Brode adedini girin (fatura adetle kesilir)' };
  if (!/^\d+$/.test(t)) return { ok: false, message: 'Adet tam sayı olmalı' };
  const n = Number(t);
  if (n <= 0) return { ok: false, message: "Adet 0'dan büyük olmalı" };
  if (n > PIECE_COUNT_MAX) return { ok: false, message: 'Adet çok büyük' };
  return { ok: true, value: n };
}

/** Çıkış okuması varsa adedi ona ekler; okuma yoksa gövde AYNEN döner (adet okumasız taşınmaz). */
export function withPieceCount(vars: CompleteQc2Request, pieceCount: number): CompleteQc2Request {
  return vars.meterOut ? { ...vars, meterOut: { ...vars.meterOut, pieceCount } } : vars;
}

/** Alan altı açıklaması: vuruş kipinde faturanın adet × desen vuruşu olduğu söylenir. */
export function pieceHint(mode: PieceInputMode): string {
  return mode === 'STITCH' ? 'Zorunlu — fatura adet × desen vuruşu ile kesilir.' : 'Zorunlu — fatura bu adetle kesilir.';
}
