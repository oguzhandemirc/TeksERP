// =============================================================================
// Anlık "online" izleme — TAMAMEN BELLEKTE (DB yok, timer yok, ek istek yok)
// =============================================================================
// Her istekte zaten çalışan auth/device middleware'i son-görülme zamanını
// günceller (Map.set — sabit maliyet). /health son WINDOW_MS içinde görülenleri
// sayar ve bu sırada bayatlayan kayıtları temizler (lazy prune → sınırsız
// büyümez). Restart'ta sıfırlanır; "şu an online" anlamı budur, kalıcı oturum
// defteri DEĞİL. JWT stateless olduğu için sunucuda oturum tablosu yok.

const WINDOW_MS = 5 * 60_000; // son 5 dk istek attıysa "online" sayılır

const users = new Map<string, number>();
const devices = new Map<string, number>();

export function touchUser(userId: string | undefined | null): void {
  if (userId) users.set(userId, Date.now());
}

export function touchDevice(deviceId: string | undefined | null): void {
  if (deviceId) devices.set(deviceId, Date.now());
}

/** Taze kayıtları say, bayatlayanı sil (sınırsız büyümeyi önler). */
function countFresh(m: Map<string, number>): number {
  const cutoff = Date.now() - WINDOW_MS;
  let n = 0;
  for (const [k, t] of m) {
    if (t >= cutoff) n++;
    else m.delete(k);
  }
  return n;
}

export function getPresence(): { activeUsers: number; activeDevices: number } {
  return { activeUsers: countFresh(users), activeDevices: countFresh(devices) };
}
