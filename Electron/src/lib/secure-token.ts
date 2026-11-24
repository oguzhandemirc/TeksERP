import { secureStore } from "@/lib/secure-store";

const TOKEN_KEY = "auth.token";

// Bellek cache'i (Faz 2 — docs/history/SAHA-DAYANIKLILIK-FAZ2.md §E2): her HTTP isteği token'ı
// okuyor; IPC round-trip + safeStorage decrypt istek başına ~0.5-3ms (AV
// taramasında spike) sabit vergiydi. İlk get IPC'den prime eder; set/clear
// cache'i günceller. tokenStore bu anahtarın TEK geçidi (auth.token'a başka
// secureStore erişimi yok) → cache ile disk hep senkron kalır.
let cachedToken: string | null = null;
let primed = false;

export const tokenStore = {
  /** Önbellekteki token, IPC'siz ve eşzamanlı (henüz okunmadıysa null) — yalnız "bellekte token var mı" sorusu için. */
  peek(): string | null {
    return primed ? cachedToken : null;
  },
  async get(): Promise<string | null> {
    if (primed) return cachedToken;
    const value = await secureStore.get(TOKEN_KEY);
    cachedToken = value ?? null;
    primed = true;
    return cachedToken;
  },
  async set(token: string): Promise<void> {
    // Önce disk (yazım hatasında cache eski-doğru değerde kalır), sonra cache.
    await secureStore.set(TOKEN_KEY, token);
    cachedToken = token;
    primed = true;
  },
  async clear(): Promise<void> {
    // Önce cache (silme IPC'si başarısız olsa bile istekler token kullanmayı
    // ANINDA bırakır — güvenli yön), sonra disk.
    cachedToken = null;
    primed = true;
    await secureStore.delete(TOKEN_KEY);
  },
};
