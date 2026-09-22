// =============================================================================
// SEVK YÖNÜ ÇÖZÜMÜ — "bu sevkiyat yurtiçi mi yurtdışı mı" sorusunun TEK cevabı
// =============================================================================
// Yön sevkiyatta SEÇİLMEZ, sevk adresinin (şube ya da cari) niteliğinden KİLİTLİ
// gelir (kullanıcı kararı 2026-09-23). Zincir: sevkiyatın `branchId`si var ve
// şubenin yönü dolu → şube · değilse carinin yönü · değilse `null` (= ilk sevk,
// operatöre sorulur). Panel, tablet ve backend bu cevabı BURADAN alır.
// `customers.branchesEnabled` bayrağı OKUNMAZ: bayrak kapalıyken istemci şube
// göndermez ve zincir kendiliğinden cariye düşer; şube taşıyan bir sevkiyatta ise
// veri "o şubeye" dediği için şubenin yönü uygulanır.
// =============================================================================
import type { Prisma, PrismaClient, ShipmentDestination } from "@prisma/client";
import { AppError } from "../../utils/app-error";

type Db = PrismaClient | Prisma.TransactionClient;

/** Kilitli yönün kaynağı; `null` = zincir boş (ilk sevk). */
export type ShipmentDestinationSource = "BRANCH" | "CUSTOMER";

export interface ResolvedShipmentDestination {
  destination: ShipmentDestination | null;
  source: ShipmentDestinationSource | null;
}

/** Saf zincir — DB'siz; `resolveShipmentDestination` bunu çağırır, kopyası yazılmaz. */
export function pickShipmentDestination(input: {
  branchDestination: ShipmentDestination | null | undefined;
  customerDestination: ShipmentDestination | null | undefined;
}): ResolvedShipmentDestination {
  if (input.branchDestination) return { destination: input.branchDestination, source: "BRANCH" };
  if (input.customerDestination) return { destination: input.customerDestination, source: "CUSTOMER" };
  return { destination: null, source: null };
}

/**
 * Sevkiyatın kilitli yönünü çözer. Cari yoksa 404; `branchId` verilmiş ama o
 * cariye ait değilse 400 (fail-closed — başka carinin şubesinin yönü uygulanmaz).
 * Pasif şube de yönünü taşır: sevkiyat o şubeye gidiyorsa niteliği değişmez.
 */
export async function resolveShipmentDestination(
  db: Db,
  input: { customerId: string; branchId?: string | null },
): Promise<ResolvedShipmentDestination> {
  const customer = await db.customer.findUnique({
    where: { id: input.customerId },
    select: { defaultDestination: true },
  });
  if (!customer) throw AppError.notFound("Müşteri bulunamadı");
  let branchDestination: ShipmentDestination | null = null;
  if (input.branchId) {
    const branch = await db.customerBranch.findFirst({
      where: { id: input.branchId, customerId: input.customerId },
      select: { defaultDestination: true },
    });
    if (!branch) throw AppError.badRequest("Şube bu müşteriye ait değil");
    branchDestination = branch.defaultDestination;
  }
  return pickShipmentDestination({ branchDestination, customerDestination: customer.defaultDestination });
}
