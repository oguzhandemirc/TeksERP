// =============================================================================
// KAYIT TAKİBİ — oluşturan otomatik takipçi (plan §5.3) + kişisel takip/bırak
// =============================================================================
// Doğuş noktaları (sipariş · iş emri · dokuma işi) AYNI tx'te `followAsCreatorTx` çağırır: satır
// `ON CONFLICT DO NOTHING` ile yazılır — elle BIRAKTI ezilmez, doğuşun dönüşü ve davranışı değişmez.
// Kullanıcı yoksa (sistem/iş yolu) yazılmaz; FK patlamasın diye `EXISTS` süzgeci tx'i düşürmez.
// =============================================================================
import { Prisma } from "@prisma/client";

/** Takip hedefi — tam olarak bir FK (`record_follows_one_target_ck`). */
export type FollowTarget = { orderId: string } | { workOrderId: string } | { weavingOrderId: string };

type FollowColumn = "orderId" | "workOrderId" | "weavingOrderId";

export function followTargetOf(t: FollowTarget): { column: FollowColumn; id: string } {
  if ("orderId" in t) return { column: "orderId", id: t.orderId };
  if ("workOrderId" in t) return { column: "workOrderId", id: t.workOrderId };
  return { column: "weavingOrderId", id: t.weavingOrderId };
}

/** Oluşturanı kaydın takipçisi yapar; var olan satır (TAKIP ya da BIRAKTI) DOKUNULMAZ. */
export async function followAsCreatorTx(
  tx: Prisma.TransactionClient,
  userId: string | null | undefined,
  target: FollowTarget,
): Promise<void> {
  if (!userId) return;
  const { column, id } = followTargetOf(target);
  const col = Prisma.raw(`"${column}"`);
  await tx.$executeRaw`
    INSERT INTO record_follows (id, "userId", ${col}, state, reason, "createdAt", "updatedAt")
    SELECT gen_random_uuid(), ${userId}::uuid, ${id}::uuid, 'TAKIP', 'OLUSTURAN', now(), now() -- tz-ok: record_follows zaman kolonları timestamptz, çıplak now() mutlak anı yazar
    WHERE EXISTS (SELECT 1 FROM users WHERE id = ${userId}::uuid)
    ON CONFLICT ("userId", ${col}) WHERE ${col} IS NOT NULL DO NOTHING`;
}
