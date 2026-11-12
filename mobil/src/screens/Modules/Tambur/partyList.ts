// Geniş ana kesim "Parti listesi" (2026-11-10, kullanıcı onaylı) — saf kararlar: seçili iş emrinin toplarından parti
// kartları ve parti/top geçişinde çalışma taslağının oturum içi belleği (ayrılınan topun SON hali geri dönünce gelir).

export interface PartyRollInput {
  rollId: string;
  batchId: string | null;
  batchNumber: string | null;
  branchOrdinal: number | null;
  currentQty: number;
}

export interface PartyCard {
  key: string;
  label: string;
  meters: number;
  /** Dokununca seçilecek top: partide seçili top varsa o, yoksa partinin ilk topu. */
  rollId: string;
  selected: boolean;
}

/** Topları partiye göre gruplar (sıra: ilk görülme). Partisiz toplar tek "Partisiz" kartında. */
export function partyCards(rolls: readonly PartyRollInput[], selectedRollId: string | null | undefined): PartyCard[] {
  const map = new Map<string, PartyCard>();
  for (const r of rolls) {
    const key = r.batchId ?? 'none';
    const isSel = r.rollId === selectedRollId;
    const c = map.get(key);
    if (c) {
      c.meters += r.currentQty;
      if (isSel) {
        c.rollId = r.rollId;
        c.selected = true;
      }
    } else {
      const label = r.batchNumber ?? (r.batchId ? `Parti ${r.branchOrdinal ?? ''}`.trim() : 'Partisiz');
      map.set(key, { key, label, meters: r.currentQty, rollId: r.rollId, selected: isSel });
    }
  }
  return [...map.values()];
}

/** Kart yalnız birden çok parti varken çizilir; ≤1 partide "Çıkan etiketler" yukarı uzar. */
export function showPartyList(cards: readonly PartyCard[]): boolean {
  return cards.length > 1;
}

/** İş emri sekmeleri (iş değiştirme) yalnız birden çok açık işte; tekte detay/yenile/kapat "Diğer"de. */
export function showJobTabs(openJobCount: number): boolean {
  return openJobCount > 1;
}

/**
 * Top değişiminde taslak belleği: ayrılınan topun güncel taslağı saklanır, varılan topun saklı taslağı döner
 * (yoksa null → çağıran bugünkü varsayılanla başlar). Aynı anahtar = geçiş yok → null (bugünkü sıfırlama).
 */
export function switchDraft<T>(mem: Map<string, T>, prevKey: string | null, nextKey: string | null, current: T): T | null {
  if (prevKey === nextKey) return null;
  if (prevKey) mem.set(prevKey, current);
  return nextKey ? (mem.get(nextKey) ?? null) : null;
}

export function draftKey(cardId: string | null | undefined, rollId: string | null | undefined): string | null {
  return cardId && rollId ? `${cardId}:${rollId}` : null;
}
