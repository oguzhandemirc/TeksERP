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

/** Sevk ekranının okuduğu kilit — yön + kaynak + gösterilecek ihracat kodu + hızlı sevk engeli. */
export interface ShipmentDestinationLock extends ResolvedShipmentDestination {
  exportCode: string | null;
  /** Doluysa Hızlı Sevk bu sevk adresinde yapılamaz; metin sunucunun 400'üyle aynı. */
  quickShipBlockedReason: string | null;
}

/**
 * Sevk belgesindeki TEK "İhracat Kodu" satırının değeri: şube ihracat kodu önce,
 * boşsa carinin ihracat kodu. Belge render'ı ve sevk ekranı AYNI yardımcıyı çağırır.
 */
export function pickExportCode(codes: { branchCode?: string | null; customerExportCode?: string | null }): string | null {
  return codes.branchCode ?? codes.customerExportCode ?? null;
}

/** Ekranda gösterilecek ihracat kodu — yalnız yurtdışı sevkte; yurtiçinde kod gösterilmez. */
export function exportCodeForDestination(
  destination: ShipmentDestination | null,
  codes: { branchCode?: string | null; customerExportCode?: string | null },
): string | null {
  return destination === "EXPORT" ? pickExportCode(codes) : null;
}

/** Hızlı Sevkin ihracat reddi — sunucu 400'ü ve ekrandaki pasif düğme gerekçesi bu metni kullanır. */
export function quickShipExportMessage(source: ShipmentDestinationSource | null): string {
  const kim = source === "BRANCH" ? "Bu şube" : source === "CUSTOMER" ? "Bu cari" : null;
  return (kim ? `${kim} ihracat olarak kilitli; h` : "H") +
    "ızlı sevk ihracatta yapılamaz (çuvallar tartılmalı). Çuval açıp tartarak sevk edin.";
}

/**
 * Gövdeden gelen yön girdisi (şube formu, satır-içi şube): alan yok → undefined
 * (dokunma) · null/"" → null (yön yok) · DOMESTIC|EXPORT → değer · başka her şey 400.
 */
export function parseDestinationInput(raw: unknown, label: string): ShipmentDestination | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (raw === "DOMESTIC" || raw === "EXPORT") return raw;
  throw AppError.badRequest(`${label}: Yurtiçi (DOMESTIC) ya da Yurtdışı (EXPORT) olmalı`);
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

/** Sevk ekranı ucu: zincir `resolveShipmentDestination`dan, kod `exportCodeForDestination`dan. */
export async function readShipmentDestinationLock(
  db: Db,
  input: { customerId: string; branchId?: string | null },
): Promise<ShipmentDestinationLock> {
  const kilit = await resolveShipmentDestination(db, input);
  const customer = await db.customer.findUnique({ where: { id: input.customerId }, select: { exportCode: true } });
  const branch = input.branchId
    ? await db.customerBranch.findUnique({ where: { id: input.branchId }, select: { code: true } })
    : null;
  return {
    ...kilit,
    exportCode: exportCodeForDestination(kilit.destination, { branchCode: branch?.code, customerExportCode: customer?.exportCode }),
    quickShipBlockedReason: kilit.destination === "EXPORT" ? quickShipExportMessage(kilit.source) : null,
  };
}
