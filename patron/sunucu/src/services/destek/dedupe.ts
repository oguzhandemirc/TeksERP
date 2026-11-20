// WEBHOOK OLAY TEKİLLEŞTİRMESİ — bellek içi, süreli küme (göç YOK, kullanıcı kararı 2026-11-15).
// Gerekçe: bulut TEK süreçtir (ikinci Node süreci yasak) ve olayın tek etkisi bir push bildirimidir; talep verisi
// merkezde durur, bulut hiçbir şey yazmaz. Yeniden başlatmada küme boşalır: merkez o pencerede aynı olayı yeniden
// teslim ederse en kötü sonuç İKİNCİ BİR PUSH'tur (veri bozulmaz). Merkez tekrarları ~6 saate yayar (10 deneme); küme
// 24 saat tutar. Tavan 5 000 olay: aşılınca en eski düşer (bellek sınırlı; gerçek trafik günde onlarca olaydır).
export const EVENT_TTL_MS = 24 * 3_600_000;
export const EVENT_CAP = 5_000;

export class EventDedupe {
  private readonly seenAt = new Map<string, number>();

  /** İlk görüşte true (ve kaydeder); süresi içinde tekrar görülürse false. */
  firstSeen(eventId: string, nowMs: number): boolean {
    this.prune(nowMs);
    const at = this.seenAt.get(eventId);
    if (at !== undefined && nowMs - at < EVENT_TTL_MS) return false;
    this.seenAt.set(eventId, nowMs);
    return true;
  }

  get size(): number {
    return this.seenAt.size;
  }

  private prune(nowMs: number): void {
    for (const [id, at] of this.seenAt) {
      // Map ekleme sırasını korur: ilk süresi dolmamış girdide dur (gerisi daha yeni).
      if (nowMs - at < EVENT_TTL_MS && this.seenAt.size < EVENT_CAP) break;
      this.seenAt.delete(id);
    }
  }
}
