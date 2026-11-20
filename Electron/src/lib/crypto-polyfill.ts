// `crypto.randomUUID` yalnız GÜVENLİ bağlamda (HTTPS, localhost, Electron) vardır; panel düz HTTP ile LAN/önizleme
// adresinden açılınca tanımsızdır ve her `clientToken` üretimi mutationFn içinde sessizce patlar (kayıt düğmesi
// hiçbir şey yapmaz, hata da çıkmaz — 2026-11-20 devere E2E). `getRandomValues` her bağlamda var: eksikse v4 UUID
// onunla tamamlanır. `main.tsx`in İLK importu olmalı (`crypto-polyfill.test.ts`).

export function uuidV4FromRandom(getRandomValues: (a: Uint8Array) => Uint8Array): string {
  const b = getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Eksikse `crypto.randomUUID`i tamamlar; var olanı ezmez. Tamamlandıysa true. */
export function installRandomUuidPolyfill(c: Crypto | undefined = globalThis.crypto): boolean {
  if (!c || typeof c.randomUUID === "function" || typeof c.getRandomValues !== "function") return false;
  const gen = () => uuidV4FromRandom((a) => c.getRandomValues(a));
  Object.defineProperty(c, "randomUUID", { value: gen as Crypto["randomUUID"], configurable: true, writable: true });
  return true;
}

installRandomUuidPolyfill();
