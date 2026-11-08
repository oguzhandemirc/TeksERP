// =============================================================================
// ADIM HAREKETİ KİLİDİ — hizmet bağı insert'inin F9 kapısı (genel fason F9)
// =============================================================================
// `service-billing.helper` `insertServiceLinksTx`ten çağrılır (satır sınırı için ayrı dosya; tek çağıran).
// =============================================================================
import type { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";

type StepGuardLink = { rollId: string | null; workOrderStepId: string | null; stepMovementGuard?: boolean };

/**
 * F9 (F3 açığı): iç adım işinin kanıtı kapanmış AKTİF harekettir. Bağ yazılmadan önce hareket FOR SHARE kilitlenir;
 * geri alma (`revokeRollMovements` / `reopenClosedMovementsTx`) satırı güncelleyip bağı SONRA sorar → iki sıra da
 * serileşir: önce geri alan kazanırsa burada 409, önce fatura kazanırsa geri almada 409 SERVICE_ALREADY_BILLED.
 */
export async function lockStepMovementsTx(tx: Prisma.TransactionClient, links: StepGuardLink[]): Promise<void> {
  const guarded = links.filter((l) => l.stepMovementGuard && l.rollId !== null && l.workOrderStepId !== null);
  if (guarded.length === 0) return;
  const rollIds = [...new Set(guarded.map((l) => l.rollId))];
  const stepIds = [...new Set(guarded.map((l) => l.workOrderStepId!))];
  const rows = await tx.$queryRaw<Array<{ rollId: string; workOrderStepId: string }>>`
    SELECT "rollId", "workOrderStepId" FROM roll_movements
    WHERE "rollId" = ANY(${rollIds}::uuid[]) AND "workOrderStepId" = ANY(${stepIds}::uuid[])
      AND "revokedAt" IS NULL AND "exitedAt" IS NOT NULL
    ORDER BY id FOR SHARE`;
  const live = new Set(rows.map((r) => `${r.rollId}:${r.workOrderStepId}`));
  if (guarded.some((l) => !live.has(`${l.rollId}:${l.workOrderStepId}`))) {
    throw AppError.conflict("Adım hareketi taslak hazırlanırken geri alındı — taslağı yeniden oluşturun", { code: "SERVICE_READING_CHANGED" });
  }
}
