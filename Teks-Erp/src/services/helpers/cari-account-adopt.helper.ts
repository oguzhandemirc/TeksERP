// =============================================================================
// ESKİ FASON BACAĞI HESABINI KARTA ÇEVİRME (K3a) — yalnız `ensureCariAccountTx` çağırır
// =============================================================================
// Ayrı dosya: audit taşıyan dosya `finance.helper`ın bakiye yazımlarını (`CariBalance`, audit muaf) "audit yazıyor"
// sınıfına sokardı (`test_audit_muafiyeti` dosya ölçeğinde sınıflar).
// =============================================================================
import { CariKind, type Prisma } from "@prisma/client";
import { AuditService } from "../audit.service";

/** Tx içinde yapılan çevirmenin izi — ayak izi COMMIT SONRASI `logLegacyLegAdoption` ile yazılır (ES-11). */
export interface AdoptedLegacyLeg {
  accountId: string;
  customerId: string;
  subcontractorId: string | null;
}

/**
 * Kartın TEK hesabı eski fason bacağındaysa (geçiş artığı) yazım anında kartın hesabına ÇEVRİLİR — rol modeli
 * göçüyle aynı TEK UPDATE (`customerId` + `subcontractorId: null` + `kind`; iki CHECK ara adımı reddeder).
 * Kartın kendi hesabı varsa çağrılmaz (çözücü onu önce seçer); hesap, hareketler ve bakiye aynı kalır.
 */
export async function adoptLegacyLegAccountTx(tx: Prisma.TransactionClient, accountId: string, subcontractorId: string | null, customerId: string): Promise<AdoptedLegacyLeg | null> {
  const moved = await tx.cariAccount.updateMany({
    where: { id: accountId, customerId: null },
    data: { customerId, subcontractorId: null, kind: CariKind.CUSTOMER },
  });
  return moved.count === 1 ? { accountId, customerId, subcontractorId } : null;
}

/** Çevirmenin ayak izi — tx DIŞINDA, commit'ten sonra, aktörüyle (geri alınan tx hayalet satır bırakmasın). */
export function logLegacyLegAdoption(adopted: AdoptedLegacyLeg | null | undefined, userId?: string): void {
  if (!adopted) return;
  void AuditService.log({ userId, action: "UPDATE", tableName: "CARI_ACCOUNT", recordId: adopted.accountId, newData: { customerId: adopted.customerId, subcontractorId: null, kind: "CUSTOMER", eskiSubcontractorId: adopted.subcontractorId, kaynak: "kart-hesabina-cevirme" } });
}
