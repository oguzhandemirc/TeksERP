// DAKİKALIK BÜTÇE — süreç içi sabit pencere sayacı (satıcı iç API sorgusu gibi pahalı dış çağrılar için).
// Her tüketici KENDİ örneğini tutar: eşitleme ile push köprüsü aynı bütçeyi paylaşırsa biri ötekini aç bırakır.
export class MinuteBudget {
  private window = 0;
  private used = 0;
  private warned = false;

  constructor(
    private readonly perMinute: () => number,
    private readonly onExhausted: (perMinute: number) => void,
  ) {}

  /** true = bu dakika bir birim alındı; false = bütçe doldu (dakikada bir kez `onExhausted`). */
  take(nowMs: number): boolean {
    const window = Math.floor(nowMs / 60_000);
    if (window !== this.window) {
      this.window = window;
      this.used = 0;
      this.warned = false;
    }
    const limit = this.perMinute();
    if (this.used >= limit) {
      if (!this.warned) this.onExhausted(limit);
      this.warned = true;
      return false;
    }
    this.used += 1;
    return true;
  }
}
