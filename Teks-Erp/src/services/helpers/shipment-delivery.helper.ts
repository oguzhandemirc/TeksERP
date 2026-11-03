// =============================================================================
// SEVKİYAT TESLİM YERİ (K18, 2026-11-03) — "mal kime değil NEREYE gidiyor"
// =============================================================================
// Fason fabrikada mal bazen sahibine değil boyahaneye gider (fabrika cevabı 24-C).
// Sevkiyatın carisi (`customerId`) malın SAHİBİ kalır — sahiplik kapısı
// (`assertOwnerMatchesTx`) teslim yerine BAKMAZ. Teslim yeri yalnız belgeye basılan
// adrestir: cari bağı + serbest adres; doğrulama ve snapshot biçimi TEK yerde.
// =============================================================================
import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../utils/app-error";

type Db = PrismaClient | Prisma.TransactionClient;

export interface DeliveryToInput {
  deliveryCustomerId?: string | null;
  deliveryAddress?: string | null;
}

export interface DeliveryToValue {
  deliveryCustomerId: string | null;
  deliveryAddress: string | null;
}

/** Belge snapshot'ına DOĞARKEN donan teslim yeri bloğu (`header.deliveryTo`). */
export interface DeliveryToSnapshot {
  name: string;
  address: string | null;
}

export const DELIVERY_ADDRESS_MAX = 500;

/** Kart adresi tek satır — boş parçalar atlanır; hiçbiri yoksa null. */
export function formatCustomerAddress(c: {
  address?: string | null;
  district?: string | null;
  city?: string | null;
  country?: string | null;
}): string | null {
  const parts = [c.address, c.district, c.city, c.country].map((x) => x?.trim()).filter((x): x is string => !!x);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Teslim yeri girdisini doğrular ve yazılacak değeri döner — oluşturma (çuval + hızlı
 * sevk) ve PLANNED düzenleme bu TEK doğrulayıcıdan geçer. Cari yoksa ikisi de null.
 */
export async function resolveDeliveryToTx(db: Db, ownerCustomerId: string, input: DeliveryToInput): Promise<DeliveryToValue> {
  const id = input.deliveryCustomerId ?? null;
  const address = input.deliveryAddress?.trim() || null;
  if (!id) {
    if (address) {
      throw AppError.badRequest("Teslim adresi için teslim yeri carisi seçilmeli.", { code: "DELIVERY_ADDRESS_WITHOUT_CUSTOMER" });
    }
    return { deliveryCustomerId: null, deliveryAddress: null };
  }
  if (address && address.length > DELIVERY_ADDRESS_MAX) {
    throw AppError.badRequest(`Teslim adresi en fazla ${DELIVERY_ADDRESS_MAX} karakter olabilir.`, { code: "DELIVERY_ADDRESS_TOO_LONG" });
  }
  if (id === ownerCustomerId) {
    throw AppError.badRequest("Teslim yeri sevkiyatın kendi carisi olamaz — başka adrese teslim için başka bir cari seçin.", {
      code: "DELIVERY_SAME_AS_OWNER",
    });
  }
  const c = await db.customer.findUnique({ where: { id }, select: { isActive: true, name: true } });
  if (!c) throw AppError.badRequest("Teslim yeri carisi bulunamadı.", { code: "DELIVERY_CUSTOMER_NOT_FOUND" });
  if (!c.isActive) {
    throw AppError.badRequest(`Teslim yeri carisi pasif: ${c.name}`, { code: "DELIVERY_CUSTOMER_INACTIVE" });
  }
  return { deliveryCustomerId: id, deliveryAddress: address };
}

/** Snapshot bloğu — teslim carisi yoksa null (anahtar snapshot'a HİÇ yazılmaz). */
export function deliveryToSnapshot(sh: {
  deliveryAddress: string | null;
  deliveryCustomer: { name: string; address: string | null; district: string | null; city: string | null; country: string | null } | null;
}): DeliveryToSnapshot | null {
  if (!sh.deliveryCustomer) return null;
  return { name: sh.deliveryCustomer.name, address: sh.deliveryAddress?.trim() || formatCustomerAddress(sh.deliveryCustomer) };
}

/** Snapshot `select` parçası — belge toplayıcıları aynı alanları okusun. */
export const DELIVERY_TO_SELECT = {
  deliveryAddress: true,
  deliveryCustomer: { select: { name: true, address: true, district: true, city: true, country: true } },
} as const;
