import { Prisma } from "@prisma/client";

/** Tekillik ihlali (P2002) — adaptör altında da aynı kodla gelir. */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** Serileştirme/kilitlenme (40001/40P01 → P2034): "tekrar deneyin". */
export function isRetryableConflict(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") return true;
  const text = err instanceof Error ? err.message : "";
  return /40P01|40001|deadlock detected|could not serialize/.test(text);
}

/**
 * Tekillik ihlali BU kolondan mı? pg sürücü adaptörü (Prisma 7) `meta.target` vermez; hedef
 * `meta.driverAdapterError.cause` altında (`constraint.fields` · `constraint.index` · iletideki kısıt adı).
 * Hedef okunamazsa `false` (varsayım yok — çağıran ham hatayı yeniden atar).
 */
export function uniqueViolationOn(err: unknown, field: string): boolean {
  if (!isUniqueViolation(err)) return false;
  const meta = ((err as Prisma.PrismaClientKnownRequestError).meta ?? {}) as {
    target?: unknown;
    driverAdapterError?: { cause?: { constraint?: unknown; originalMessage?: unknown } };
  };
  const parts: string[] = [];
  if (Array.isArray(meta.target)) parts.push(...meta.target.map(String));
  else if (typeof meta.target === "string") parts.push(meta.target);
  const cause = meta.driverAdapterError?.cause;
  const c = cause?.constraint as { fields?: unknown; index?: unknown } | string | undefined;
  if (typeof c === "string") parts.push(c);
  else if (c && Array.isArray(c.fields)) parts.push(...c.fields.map((f) => String(f).replace(/"/g, "")));
  else if (c && typeof c.index === "string") parts.push(c.index);
  const named = typeof cause?.originalMessage === "string" ? /constraint "([^"]+)"/.exec(cause.originalMessage) : null;
  if (named) parts.push(named[1]!);
  const f = field.toLowerCase();
  return parts.some((p) => {
    const q = p.toLowerCase();
    return q === f || q.includes(`_${f}_`) || q.endsWith(`_${f}_key`);
  });
}
