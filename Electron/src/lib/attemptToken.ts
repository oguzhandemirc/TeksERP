// =============================================================================
// DENEME TOKEN'I — `clientToken` mantıksal deneme başına BİR KEZ (kk1.md İstemci token'ı)
// =============================================================================
// Token yalnız sonucu BELİRSİZ bırakan hatada (ağ · zaman aşımı · 5xx) yapışır: sunucu ilk denemeyi yazmış
// olabilir ve aynı token ikinci kaydı önler. Kesin 4xx'te hiçbir şey yazılmamıştır; başarıda deneme bitmiştir —
// ikisinde de sonraki gönderim yeni token alır. Her tıklamada token üretmek korumayı boşa düşürür.
// Bekçi: `Teks-Erp/scripts/test_istemci_token_uretimi.ts`.
// =============================================================================
import { useRef } from "react";

/**
 * Bu hata SONUCU BELİRSİZ mi bıraktı? Yapışkanlığın tek meşru sebebi budur.
 * ⚠️ Panelin hata nesnesi axios'tan gelir: durum kodu `response.status`tedir (mobil ikizinden ayrıldığı tek yer).
 * İkisi de okunur — biri eksikse "durum yok" sayılır ve BELİRSİZ tarafa düşer (fazladan korumak güvenli yöndür).
 */
export function isAmbiguousFailure(error: unknown): boolean {
  const e = error as { status?: number; response?: { status?: number } } | null | undefined;
  const status = e?.response?.status ?? e?.status;
  return status === undefined || status >= 500;
}

/** Deneme düştükten sonra hangi token'la devam edilir: belirsiz hatada aynı, kesin 4xx'te yeni. */
export function tokenAfterFailure(token: string, error: unknown, gen: () => string = () => crypto.randomUUID()): string {
  return isAmbiguousFailure(error) ? token : gen();
}

export interface AttemptToken {
  /** Bu denemenin token'ı — ilk çağrıda doğar, deneme bitene kadar aynı kalır. */
  token(): string;
  /** Aynı denemenin alt kaydının token'ı (ör. mal kabul satırı): anahtar başına bir kez doğar, denemeyle yenilenir. */
  keyed(key: string): string;
  /** Deneme düştü: belirsiz hatada token yapışır, kesin 4xx'te düşer. */
  onFailure(error: unknown): void;
  /** Deneme başarılı: sonraki gönderim yeni deneme. */
  onSuccess(): void;
  /** Form yeniden açıldı / seçim sıfırlandı: yeni deneme. */
  renew(): void;
}

/** Saf durum makinesi (React'siz; test ve hook aynı kodu koşar). */
export function createAttemptToken(gen: () => string = () => crypto.randomUUID()): AttemptToken {
  let main: string | null = null;
  const sub = new Map<string, string>();
  const renew = () => {
    main = null;
    sub.clear();
  };
  return {
    token: () => (main ??= gen()),
    keyed: (key) => {
      let t = sub.get(key);
      if (t === undefined) sub.set(key, (t = gen()));
      return t;
    },
    onFailure: (error) => {
      if (!isAmbiguousFailure(error)) renew();
    },
    onSuccess: renew,
    renew,
  };
}

/** Mantıksal deneme başına token (tek kaynak). `mutationFn` içinde `attempt.token()` okunur, ÜRETİLMEZ. */
export function useAttemptToken(): AttemptToken {
  const ref = useRef<AttemptToken | null>(null);
  return (ref.current ??= createAttemptToken());
}
