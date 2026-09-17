// =============================================================================
// İŞ ORTAĞI ROLLERİ — `Customer.type`in TEK YAZARI (SAP BP sadeleştirilmiş, kullanıcı kararı 2026-09-17)
// =============================================================================
// Kart tek, roller ÜÇ BAYRAK (`isCustomerRole` · `isSupplierRole` · `isSubcontractorRole`). `type`
// (CUSTOMER/SUPPLIER/BOTH) geriye dönük okuyucular için KALIR ama TÜRETİLMİŞTİR: yalnız buradan
// yazılır. Eski istemci gövdede `type` gönderirse rollere ÇEVRİLİR (`rolesFromType`) — sözleşme kırılmaz.
// Kural: fason satıcıdır — ticari yönü olmayan ama fason rolü olan kart SUPPLIER türetir.
// Fason rolü bayrağının yazıcısı BURADA DEĞİL: `SubcontractorManagementService.syncSubcontractorRoleTx`
// (profil servisi — audit'i o eylemde; helper'a konsaydı audit'siz yazıcı dosya doğardı).
// =============================================================================
import type { CompanyType } from "@prisma/client";
import { AppError } from "../../utils/app-error";

export interface PartnerRoles {
  isCustomerRole: boolean;
  isSupplierRole: boolean;
  isSubcontractorRole: boolean;
}

export const PARTNER_ROLE_KEYS = ["isCustomerRole", "isSupplierRole", "isSubcontractorRole"] as const;
export type PartnerRoleKey = (typeof PARTNER_ROLE_KEYS)[number];

/** `filter[role]` değerleri → bayrak (CSV: `customer,supplier` = OR). */
export const ROLE_FILTER_TO_FLAG: Record<string, PartnerRoleKey> = {
  customer: "isCustomerRole",
  supplier: "isSupplierRole",
  subcontractor: "isSubcontractorRole",
};

export const NO_ROLE_MESSAGE = "Kartın en az bir rolü olmalı: Müşteri, Tedarikçi ya da Fason.";

/** Rol bayraklarından türetilmiş ticari tip. Ticari yön yok + fason → SUPPLIER; hiç rol yok → CUSTOMER (şema varsayılanı). */
export function resolveCompanyType(roles: PartnerRoles): CompanyType {
  if (roles.isCustomerRole && roles.isSupplierRole) return "BOTH";
  if (roles.isSupplierRole) return "SUPPLIER";
  if (roles.isCustomerRole) return "CUSTOMER";
  return roles.isSubcontractorRole ? "SUPPLIER" : "CUSTOMER";
}

/** Eski gövde (`type`) → ticari roller; fason rolü tipten türemez (profil bağı yazar). */
export function rolesFromType(type: unknown): Pick<PartnerRoles, "isCustomerRole" | "isSupplierRole"> {
  if (type === "BOTH") return { isCustomerRole: true, isSupplierRole: true };
  if (type === "SUPPLIER") return { isCustomerRole: false, isSupplierRole: true };
  if (type === "CUSTOMER") return { isCustomerRole: true, isSupplierRole: false };
  throw AppError.badRequest(`Geçersiz cari tipi: ${String(type)} (CUSTOMER, SUPPLIER veya BOTH).`);
}

export function hasAnyRole(roles: PartnerRoles): boolean {
  return roles.isCustomerRole || roles.isSupplierRole || roles.isSubcontractorRole;
}

/** Gövdeden YAZILABİLEN roller: yalnız ticari ikili. Fason rolü profil bağından TÜRETİLİR (`syncSubcontractorRoleTx`). */
const BODY_ROLE_KEYS = ["isCustomerRole", "isSupplierRole"] as const;

/** Gövdedeki ticari rol anahtarlarını okur (yalnız gerçek boolean; başka her şey 400). */
export function readRoleFlags(data: Record<string, unknown>): Partial<Pick<PartnerRoles, "isCustomerRole" | "isSupplierRole">> {
  const out: Partial<Pick<PartnerRoles, "isCustomerRole" | "isSupplierRole">> = {};
  for (const key of BODY_ROLE_KEYS) {
    if (!(key in data) || data[key] === undefined) continue;
    if (typeof data[key] !== "boolean") throw AppError.badRequest(`${key} doğru/yanlış olmalı.`);
    out[key] = data[key] as boolean;
  }
  return out;
}

/**
 * Yazma gövdesini rol modeline indirger — TEK NOKTA (create + update):
 *   • gövdede ticari rol bayrağı varsa onlar (verilmeyen bayrak `current`tan, create'te false);
 *   • yoksa ve `type` varsa eski istemci: tipten ticari roller;
 *   • ikisi de yoksa `current` (create'te şema varsayılanı: yalnız Müşteri — bugünkü davranış).
 * Fason rolü gövdeden YAZILAMAZ (düşürülür): tek yazarı fason profili bağı. Sonuç: bayraklar + türetilmiş
 * `type` gövdeye yazılır; istemcinin `type`i ASLA doğrudan DB'ye gitmez.
 */
export function applyPartnerRoles(
  data: Record<string, unknown>,
  current: PartnerRoles | null,
): PartnerRoles {
  const base: PartnerRoles = current ?? { isCustomerRole: true, isSupplierRole: false, isSubcontractorRole: false };
  const flags = readRoleFlags(data);
  const hasFlagInput = Object.keys(flags).length > 0;
  const legacyType = data.type;
  let roles: PartnerRoles;
  if (hasFlagInput) {
    // Create'te verilmeyen ticari bayrak false (istemci kümeyi beyan eder); update'te mevcut değer kalır.
    const fill = current ?? { isCustomerRole: false, isSupplierRole: false, isSubcontractorRole: false };
    roles = { ...fill, ...flags, isSubcontractorRole: current?.isSubcontractorRole ?? false };
  } else if (legacyType !== undefined && legacyType !== null) {
    roles = { ...base, ...rolesFromType(legacyType) };
  } else {
    roles = base;
  }
  if (!hasAnyRole(roles)) throw AppError.badRequest(NO_ROLE_MESSAGE);
  data.isCustomerRole = roles.isCustomerRole;
  data.isSupplierRole = roles.isSupplierRole;
  data.isSubcontractorRole = roles.isSubcontractorRole;
  data.type = resolveCompanyType(roles);
  return roles;
}
