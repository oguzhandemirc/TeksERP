// =============================================================================
// SEMANTİK KATMAN — eşzamanlı koşu sınırı (R1-SEMCEK; plan §3.4)
// =============================================================================
// Backend TEK process'tir: ağır rapor sorguları havuzu ve olay döngüsünü tüketip sahadaki
// tablet/terminal isteklerini bekletmesin diye kullanıcı başına 2, kurulum başına 4 koşu.
// Bekletme kuyruğu YOK — fazlası hemen 429 `RAPOR_SIRADA` (istemci "birazdan tekrar dene" der).
// =============================================================================
export const PER_USER_LIMIT = 2;
export const TOTAL_LIMIT = 4;

export class ReportSemaphore {
  private total = 0;
  private readonly perUser = new Map<string, number>();

  constructor(
    private readonly userLimit: number = PER_USER_LIMIT,
    private readonly totalLimit: number = TOTAL_LIMIT,
  ) {}

  /** Yer varsa ayırır ve TEK kullanımlık bırakma işlevi döner; yoksa `null`. */
  tryAcquire(userId: string): (() => void) | null {
    const mine = this.perUser.get(userId) ?? 0;
    if (mine >= this.userLimit || this.total >= this.totalLimit) return null;
    this.perUser.set(userId, mine + 1);
    this.total++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total--;
      const n = (this.perUser.get(userId) ?? 1) - 1;
      if (n <= 0) this.perUser.delete(userId);
      else this.perUser.set(userId, n);
    };
  }

  inUse(): { total: number; users: number } {
    return { total: this.total, users: this.perUser.size };
  }
}

export const reportSemaphore = new ReportSemaphore();
