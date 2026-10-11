// =============================================================================
// TEZGAH ALARMI — çalınmış sinyal anahtarları (süreç belleği; saf)
// =============================================================================
// Bildirici ve Tezgah şeridi AYNI kümeyi paylaşır: aynı anahtar cihazda bir kez çalar (iki yüzey
// aynı alarmı iki kez çaldırmaz). Sınırlı boy — en eski anahtarlar düşer.
// =============================================================================
const MAX = 500;
const keys = new Set<string>();

export const alarmSeen = {
  has: (key: string): boolean => keys.has(key),
  add(key: string): void {
    keys.add(key);
    if (keys.size > MAX) {
      const first = keys.values().next().value;
      if (first !== undefined) keys.delete(first);
    }
  },
  /** Oturum değişimi / test. */
  clear: (): void => keys.clear(),
};
