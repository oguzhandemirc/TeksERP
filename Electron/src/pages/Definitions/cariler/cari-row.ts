// Cariler — satır modeli (iki kaynak: müşteri kartı + BAĞSIZ eski fason profili) ve seçili kayıt anahtarı.
import type { IconTileTone } from "@/components/ui/icon-tile";
import type { PartnerRoleFlags, PartnerRoleKey } from "@/lib/partnerRoles";
import type { Customer } from "@/pages/Customers/types";
import type { Subcontractor } from "@/pages/Subcontractors/types";

interface RowBase {
  id: string;
  code: string;
  name: string;
  taxNumber: string | null;
  phone: string | null;
  city: string | null;
  isActive: boolean;
  roles: PartnerRoleFlags;
}
export type CariRowItem =
  | (RowBase & { kind: "CUSTOMER"; record: Customer })
  | (RowBase & { kind: "SUBCONTRACTOR"; record: Subcontractor });

/** Rol rozet tonu — rol başına sabit (rozet metni `partnerRoleLabels`tan). */
export const ROLE_TONE: Record<PartnerRoleKey, IconTileTone> = { customer: "blue", supplier: "amber", subcontractor: "teal" };
export const ROLE_KEYS: readonly PartnerRoleKey[] = ["customer", "supplier", "subcontractor"];
export const roleOn = (r: PartnerRoleFlags, k: PartnerRoleKey) =>
  k === "customer" ? r.isCustomerRole : k === "supplier" ? r.isSupplierRole : r.isSubcontractorRole;

export function customerRow(c: Customer): CariRowItem {
  return {
    kind: "CUSTOMER",
    id: c.id,
    code: c.code,
    name: c.name,
    taxNumber: c.taxNumber ?? null,
    // Kartın telefonu `contactPhone`; eski alan adı `phone` gelirse o da okunur.
    phone: c.contactPhone ?? (c as { phone?: string | null }).phone ?? null,
    city: c.city ?? null,
    isActive: c.isActive,
    roles: { isCustomerRole: c.isCustomerRole, isSupplierRole: c.isSupplierRole, isSubcontractorRole: c.isSubcontractorRole },
    record: c,
  };
}

export function subcontractorRow(s: Subcontractor): CariRowItem {
  return {
    kind: "SUBCONTRACTOR",
    id: s.id,
    code: s.code,
    name: s.name,
    taxNumber: s.taxNumber ?? null,
    phone: s.phone ?? null,
    city: null,
    isActive: s.isActive,
    roles: { isCustomerRole: false, isSupplierRole: false, isSubcontractorRole: true },
    record: s,
  };
}

/** URL'deki seçili kayıt: `kayit=<C|S>:<id>` — iki kaynağın id'leri ayrı uzaylardır. */
export const SELECTED_PARAM = "kayit";
export const rowKey = (r: Pick<CariRowItem, "kind" | "id">) => `${r.kind === "CUSTOMER" ? "C" : "S"}:${r.id}`;
export function parseRowKey(v: string | null): { kind: CariRowItem["kind"]; id: string } | null {
  const m = v?.match(/^([CS]):([0-9a-fA-F-]{8,})$/);
  if (!m) return null;
  return { kind: m[1] === "C" ? "CUSTOMER" : "SUBCONTRACTOR", id: m[2]! };
}

/** Kayıt sayfası yolu — yalnız müşteri kartının tam sayfası var (bağsız eski fason profili kartsızdır). */
export const CARI_LIST_PATH = "/definitions/cariler";
export const cariRecordPath = (customerId: string) => `${CARI_LIST_PATH}/${customerId}`;
