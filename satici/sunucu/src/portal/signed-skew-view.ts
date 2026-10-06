// Künye: fabrikanın son yoklamada bildirdiği İMZALI saat sapması (yalnız bilgi; lisans kararına girmez).
import { SIGNED_SKEW_WARN_SECONDS } from "../lisans-protokol";

export interface SignedSkewView {
  readonly sapmaSn: number;
  readonly uyari: boolean;
  readonly esikSn: number;
  readonly an: Date;
}

/** Son yoklama alanı taşımıyorsa null: eski fabrika ya da henüz ölçülmedi (yeniden başlatma sonrası ilk yoklama). */
export function signedSkewFromPoll(poll: { readonly saat: unknown; readonly createdAt: Date } | null): SignedSkewView | null {
  const v = (poll?.saat as { imzaliSapmaSn?: unknown } | null | undefined)?.imzaliSapmaSn;
  if (!poll || typeof v !== "number" || !Number.isInteger(v)) return null;
  return { sapmaSn: v, uyari: Math.abs(v) >= SIGNED_SKEW_WARN_SECONDS, esikSn: SIGNED_SKEW_WARN_SECONDS, an: poll.createdAt };
}
