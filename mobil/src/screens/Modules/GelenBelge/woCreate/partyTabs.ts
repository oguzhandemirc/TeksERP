// Çok partili belge sekmeleri (2026-11-09) — saf parçalar: sekme başlığı, parti durumu (⚠ eksik · ✓ tamam · ● bakılmadı)
// ve kayıt kilidi. Kilit YALNIZ ⚠ partiden gelir; hatasız ama açılmamış sekme kilitlemez. Sunucu kapısı yine doğrular.
import type { MultiPartyDraft, PartyOutcome, PartyRow } from './partyDraft';

export type PartyTabStatus = 'error' | 'ok' | 'unseen';
/** Etkin sekme: "Tümü" ya da partinin blok no'su. */
export type PartyTabKey = 'all' | number;

export interface PartyTab {
  blockNo: number;
  title: string;
  status: PartyTabStatus;
  /** Kilitleyen eksikler (⚠ ise dolu). */
  problems: string[];
}

export const STATUS_MARK: Record<PartyTabStatus, string> = { error: '⚠', ok: '✓', unseen: '●' };
export const STATUS_TEXT: Record<PartyTabStatus, string> = { error: 'Eksik', ok: 'Tamam', unseen: 'Bakılmadı' };

/** Sekme başlığı: müşterinin parti no'su, yoksa "Parti N". */
export const partyTabTitle = (r: Pick<PartyRow, 'blockNo' | 'batchNo'>): string => r.batchNo.trim() || `Parti ${r.blockNo}`;

/** Partinin kaydı kilitleyen eksikleri (sunucu kapısının aynası: parti metresi > 0). */
export function partyProblems(r: PartyRow): string[] {
  return r.meters === null || !(r.meters > 0) ? ['Gelen metre eksik'] : [];
}

/** Tek partili belgede sekme çizilmez (bugünkü görünüm). */
export const showPartyTabs = (m: MultiPartyDraft | null | undefined): boolean => (m?.rows.length ?? 0) >= 2;

/**
 * Sekmeler: açılmış parti ✓ (alanları kilitli), eksik ⚠, eksiksiz parti görüldüyse ✓ yoksa ●.
 * `outcome`: kısmi sonuçta parti başına açıldı/açılamadı (açılamayan parti kendiliğinden ⚠ olmaz; yeniden gönderim yolu açık).
 */
export function partyTabs(m: MultiPartyDraft, visited: ReadonlySet<number>, outcome: (blockNo: number) => PartyOutcome = () => null): PartyTab[] {
  return m.rows.map((r) => {
    const opened = outcome(r.blockNo)?.kind === 'OPENED';
    const problems = opened ? [] : partyProblems(r);
    const status: PartyTabStatus = problems.length ? 'error' : opened || visited.has(r.blockNo) ? 'ok' : 'unseen';
    return { blockNo: r.blockNo, title: partyTabTitle(r), status, problems };
  });
}

/** Kaydı kilitleyen partiler (yalnız ⚠); boşsa kilit yok. */
export const partyLock = (tabs: readonly PartyTab[]): PartyTab[] => tabs.filter((t) => t.status === 'error');

/** Kilit cümlesi: hangi parti, neden — "P1 · Gelen metre eksik; Parti 2 · Gelen metre eksik". */
export const partyLockText = (locks: readonly PartyTab[]): string | null =>
  locks.length ? locks.map((t) => `${t.title} · ${t.problems.join(', ')}`).join('; ') : null;
