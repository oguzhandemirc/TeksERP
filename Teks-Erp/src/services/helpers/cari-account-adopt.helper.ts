// =============================================================================
// ESKİ FASON BACAĞI HESABINI KARTA ÇEVİRME (K3a) — yalnız `ensureCariAccountTx` çağırır
// =============================================================================
// Ayrı dosya: audit taşıyan dosya `finance.helper`ın bakiye yazımlarını (`CariBalance`, audit muaf) "audit yazıyor"
// sınıfına sokardı (`test_audit_muafiyeti` dosya ölçeğinde sınıflar).
// =============================================================================
import { CariKind, type Prisma } from "@prisma/client";
import { AuditService } from "../audit.service";

/**
 * Kartın TEK hesabı eski fason bacağındaysa (geçiş artığı) yazım anında kartın hesabına ÇEVRİLİR — rol modeli
 * göçüyle aynı TEK UPDATE (`customerId` + `subcontractorId: null` + `kind`; iki CHECK ara adımı reddeder).
 * Kartın kendi (pasif) hesabı varsa çevrilmez (`customerId @unique`); hesap, hareketler ve bakiye aynı kalır.
 */
export async function adoptLegacyLegAccountTx(tx: Prisma.TransactionClient, accountId: string, subcontractorId: string | null, customerId: string): Promise<void> {
  const own = await tx.cariAccount.findFirst({ where: { customerId }, select: { id: true } });
  if (own) return;
  const moved = await tx.cariAccount.updateMany({
    where: { id: accountId, customerId: null },
    data: { customerId, subcontractorId: null, kind: CariKind.CUSTOMER },
  });
  // Ayak izi best-effort (tx sonucu beklenmez — audit karar kaynağı değil).
  if (moved.count === 1) void AuditService.log({ userId: undefined, action: "UPDATE", tableName: "CARI_ACCOUNT", recordId: accountId, newData: { customerId, subcontractorId: null, kind: "CUSTOMER", eskiSubcontractorId: subcontractorId, kaynak: "kart-hesabina-cevirme" } });
}
