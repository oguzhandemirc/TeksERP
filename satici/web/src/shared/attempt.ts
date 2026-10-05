// İŞLEM KİMLİĞİ (clientToken) — MANTIKSAL DENEME başına bir kez üretilir. Kimlik yalnız sonucu
// belirsiz bırakan hatada yapışır (aynı deneme yinelenirse sunucu kaydı yanıttan döner, eylem ikinci
// kez koşmaz); başarı ya da kesin 4xx kimliği bırakır — sonraki gönderim YENİ bir denemedir.
import { useCallback, useRef, useState } from "react";
import { isAmbiguousError } from "./api";

/** UUID v4 — `crypto.randomUUID` yalnız güvenli bağlamda var; düz HTTP'de açılan geliştirme/kurulum sayfaları güvenli bağlam değildir. */
export function newClientToken(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type AttemptOutcome = "success" | "definitive" | "ambiguous";

export class AttemptToken {
  private token: string | null = null;

  constructor(private readonly generate: () => string = newClientToken) {}

  current(): string {
    this.token ??= this.generate();
    return this.token;
  }

  settle(outcome: AttemptOutcome): void {
    if (outcome !== "ambiguous") this.token = null;
  }
}

export type WriteResult<R> = { readonly ok: true; readonly data: R } | { readonly ok: false };

export interface WriteState<R> {
  readonly pending: boolean;
  readonly error: unknown;
  /** Gövdeye işlem kimliği eklenip gönderilir; hata `error`da kalır ve `{ ok: false }` döner. */
  readonly run: (body: Record<string, unknown>) => Promise<WriteResult<R>>;
  readonly clearError: () => void;
}

/** Bir yazma eylemi (form ya da onay penceresi) — kimliği bileşenin ömrü boyunca tutar. */
export function useWrite<R>(send: (body: Record<string, unknown> & { clientToken: string }) => Promise<R>): WriteState<R> {
  const attempt = useRef(new AttemptToken());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const sendRef = useRef(send);
  sendRef.current = send;

  const run = useCallback(async (body: Record<string, unknown>): Promise<WriteResult<R>> => {
    setPending(true);
    setError(null);
    try {
      const result = await sendRef.current({ ...body, clientToken: attempt.current.current() });
      attempt.current.settle("success");
      return { ok: true, data: result };
    } catch (err) {
      attempt.current.settle(isAmbiguousError(err) ? "ambiguous" : "definitive");
      setError(err);
      return { ok: false };
    } finally {
      setPending(false);
    }
  }, []);

  return { pending, error, run, clearError: useCallback(() => setError(null), []) };
}
