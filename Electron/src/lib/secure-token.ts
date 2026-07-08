const TOKEN_KEY = "auth.token";

// Bellek cache'i (Faz 2 — SAHA-DAYANIKLILIK-FAZ2.md §E2): her HTTP isteği token'ı
// okuyor; IPC round-trip + safeStorage decrypt istek başına ~0.5-3ms (AV
// taramasında spike) sabit vergiydi. İlk get IPC'den prime eder; set/clear
// cache'i günceller. tokenStore bu anahtarın TEK geçidi (auth.token'a başka
// secureStore erişimi yok) → cache ile disk hep senkron kalır.
let cachedToken: string | null = null;
let primed = false;

export const tokenStore = {
  async get(): Promise<string | null> {
    if (primed) return cachedToken;
    const value = await window.api.secureStore.get(TOKEN_KEY);
    cachedToken = value ?? null;
    primed = true;
    return cachedToken;
  },
  async set(token: string): Promise<void> {
    // Önce disk (yazım hatasında cache eski-doğru değerde kalır), sonra cache.
    await window.api.secureStore.set(TOKEN_KEY, token);
    cachedToken = token;
    primed = true;
  },
  async clear(): Promise<void> {
    // Önce cache (silme IPC'si başarısız olsa bile istekler token kullanmayı
    // ANINDA bırakır — güvenli yön), sonra disk.
    cachedToken = null;
    primed = true;
    await window.api.secureStore.delete(TOKEN_KEY);
  },
};
