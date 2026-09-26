// =============================================================================
// DENEME TOKEN'I — `clientToken` mantıksal deneme başına BİR KEZ (kk1.md İstemci token'ı) · panel ikizi
// =============================================================================
// Panelin `Electron/src/lib/attemptToken.ts` makinesinin tablet ikizi (istemciler kod paylaşmaz; `matchesPermission`
// emsali). Gövde BİREBİR aynıdır ve `Teks-Erp/scripts/test_istemci_token_uretimi.ts` iki dosyayı AST'le karşılaştırır.
// Belirsiz hata ölçütü tabletin tek kaynağından (`entryAttempt.isAmbiguousFailure`, hata biçimi `.status`).
// =============================================================================
import { useRef } from 'react';
import { generateClientUuid } from './barcode';
import { isAmbiguousFailure } from './entryAttempt';

export interface AttemptToken {
  /** Bu denemenin token'ı — ilk çağrıda doğar, deneme bitene kadar aynı kalır. */
  token(): string;
  /** Aynı denemenin alt kaydının token'ı: anahtar başına bir kez doğar, denemeyle yenilenir. */
  keyed(key: string): string;
  /** Deneme düştü: belirsiz hatada token yapışır, kesin 4xx'te düşer. */
  onFailure(error: unknown): void;
  /** Deneme başarılı: sonraki gönderim yeni deneme. */
  onSuccess(): void;
  /** Form yeniden açıldı / seçim sıfırlandı: yeni deneme. */
  renew(): void;
}

/** Saf durum makinesi (React'siz; test ve hook aynı kodu koşar). */
export function createAttemptToken(gen: () => string = generateClientUuid): AttemptToken {
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

/** Mantıksal deneme başına token (tek kaynak). Gönderimde `attempt.token()` okunur, ÜRETİLMEZ. */
export function useAttemptToken(): AttemptToken {
  const ref = useRef<AttemptToken | null>(null);
  return (ref.current ??= createAttemptToken());
}
