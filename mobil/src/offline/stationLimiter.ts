// =============================================================================
// İstasyon kuyruğu eşzamanlılık sınırı (denetim Y4)
// =============================================================================
// TanStack `resumePausedMutations` bekleyen HER kaydı Promise.all ile aynı anda
// sürer: bağlantı dönünce 20 tablet × N kayıt saniyeler içinde yazma kovasını
// aşıyordu. Sınır mutationFn'in TEK DENEMESİNİ sarar (retry beklemesi slot
// tutmaz); FIFO verilir, böylece kuyruk sırası korunur. clientToken vars'tadır,
// idempotency davranışı değişmez.
// =============================================================================

export const STATION_CONCURRENCY = 3;

export function createLimiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const release = () => {
    active -= 1;
    const next = waiting.shift();
    if (next) {
      active += 1;
      next();
    }
  };
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active < max) active += 1;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

/** Bütün istasyon mutationFn'lerinin ortak sırası. */
export const runStationLimited = createLimiter(STATION_CONCURRENCY);
