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
