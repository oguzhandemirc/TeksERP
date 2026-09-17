// =============================================================================
// TARAF → KART ÇÖZÜCÜ — iş ortağı kimliğinin TEK ADRESİ karttır (rol modeli faz 2, A + E)
// =============================================================================
// Fason bacağı (`subcontractorId`) yazımda profilin bağlı kartına ÇÖZÜLÜR: cari hesap (`ensureCariAccountTx`),
// alış siparişi / mal kabul (`resolveSupplierParty`) ve hazır alınan levent (`createWarpBeam` PURCHASED) hepsi
// buradan geçer — aynı firmanın ikinci adresi yeniden doğmaz. Bağsız profil (göç koşulmamış kurulum) olduğu gibi
// kalır: varsayılan = bugünkü davranış. Okuma/liste/belge iki bacağı da kabul etmeye devam eder (eski kayıtlar).
// XOR kararı ÇAĞIRANDA (ikisi birden gelirse dokunulmaz); şema ve CHECK'ler dokunulmaz.
// =============================================================================
import type { Prisma } from "@prisma/client";
import type prisma from "../../lib/prisma";

export interface CardParty {
  customerId: string | null;
  subcontractorId: string | null;
}

export async function resolvePartyToCardTx(
  db: Prisma.TransactionClient | typeof prisma,
  party: { customerId?: string | null; subcontractorId?: string | null },
): Promise<CardParty> {
  const customerId = party.customerId ?? null;
  const subcontractorId = party.subcontractorId ?? null;
  if (customerId || !subcontractorId) return { customerId, subcontractorId };
  const profile = await db.subcontractor.findUnique({ where: { id: subcontractorId }, select: { customerId: true } });
  if (profile?.customerId) return { customerId: profile.customerId, subcontractorId: null };
  return { customerId, subcontractorId };
}
