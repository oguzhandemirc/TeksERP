// Cari kilidinin buluta giden türetilmiş görünümü (D4-I6, `cari-hesap.kilit`). Kapsam, sebep KODU ve
// tarihler gider; serbest `reasonText` / `releaseReason` ve koyan/açan kullanıcı kimliği SEÇİLMEZ —
// select açık listedir, metin kolonları sorguya hiç girmez (bekçi `test_bulut_cari_kilit`).
import prisma from "../lib/prisma";
import { holdScopes, type CariHoldScope } from "../services/helpers/cari-hold.helper";

/** Tel kapsam değeri (Türkçe kod) — fabrika kapsamının bire bir karşılığı. */
const WIRE_SCOPE: Record<CariHoldScope, string> = { INTAKE: "KABUL", SHIPMENT: "SEVK", INVOICE: "FATURA" };

export interface CariLockWire {
  durum: "AKTIF" | "ACILDI";
  kilitId: string;
  kapsam: string[];
  sebepKodu: string;
  baslangic: string;
  acilis: string | null;
}

const HOLD_WIRE_SELECT = {
  id: true,
  cariId: true,
  blocksIntake: true,
  blocksShipment: true,
  blocksInvoice: true,
  reasonCode: true,
  createdAt: true,
  releasedAt: true,
} as const;

/**
 * Hesap başına kilit görünümü: AKTİF kilit (kısmi unique → en çok bir) varsa o; yoksa en son AÇILAN
 * kilit (patron "kilit açıldı" bildirimini bundan doğurur); hiç kilit yoksa null.
 */
export async function cariLockByCari(cariIds: readonly string[]): Promise<Map<string, CariLockWire | null>> {
  const out = new Map<string, CariLockWire | null>(cariIds.map((id) => [id, null]));
  if (cariIds.length === 0) return out;
  const holds = await prisma.cariHold.findMany({
    where: { cariId: { in: [...cariIds] } },
    select: HOLD_WIRE_SELECT,
    orderBy: [{ cariId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  for (const h of holds) {
    const current = out.get(h.cariId) ?? null;
    if (current?.durum === "AKTIF") continue;
    const candidate: CariLockWire = {
      durum: h.releasedAt === null ? "AKTIF" : "ACILDI",
      kilitId: h.id,
      kapsam: holdScopes(h).map((s) => WIRE_SCOPE[s]),
      sebepKodu: h.reasonCode,
      baslangic: h.createdAt.toISOString(),
      acilis: h.releasedAt?.toISOString() ?? null,
    };
    // Aktif her zaman kazanır; açılmışlar arasında en geç açılan (eşitlikte sıradaki son kayıt).
    if (candidate.durum === "AKTIF" || current === null || (current.acilis ?? "") <= (candidate.acilis ?? "")) out.set(h.cariId, candidate);
  }
  return out;
}
