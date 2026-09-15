// =============================================================================
// TEDARİKÇİ LİSTE MODALI — saf katman: iki bacak → tek tablo satırı, rol → SUNUCU parametresi (istek #5 rev.)
// =============================================================================
// Kullanıcı testi (revizyon): ① kutuya tıklayınca doğrudan modal; ② TAM liste — bütün cariler (müşteri-only
// dahil; Rol kolonu ayırt eder), sunucudan sayfa sayfa; ③ rol TEK açılır seçim (Tümü · Müşteri · Tedarikçi ·
// Alıcı + Satıcı · Fason), çip yok; ④ ilk yazımdaki çipler "düzgün çalışmıyordu" — ÖLÇÜLDÜ: rol süzgeci
// İSTEMCİDEYDİ ve 100'lük sunucu sayfasının üstünde koşuyordu: ada göre sıralı ilk sayfada bir rolden 3-5
// kayıt varsa çip o 3-5'i gösteriyor, gerisi "yok" görünüyordu (istemcide süzmek ilk sayfayı süzer —
// `SupplierSelect` başlığındaki kural bu bileşende ihlal edilmişti). Çare: rol SUNUCUYA — cari bacağı
// `filter[type]`, fason bacağı ayrı uç (rol Fason ⇒ yalnız o sorgu; Tümü ⇒ iki sorgu, cariler önce).
// =============================================================================
import type { Customer } from "@/pages/Customers/types";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import type { SupplierParty, SupplierPartyKind } from "./supplierParty";

/** Satırın rolü — cari tipi ya da fason. */
export type SupplierRole = "CUSTOMER" | "SUPPLIER" | "BOTH" | "SUBCONTRACTOR";
/** Açılır seçim değeri — "ALL" = Tümü. */
export type SupplierRoleFilter = "ALL" | SupplierRole;

export const SUPPLIER_ROLE_LABEL: Record<SupplierRole, string> = {
  CUSTOMER: "Müşteri",
  SUPPLIER: "Tedarikçi",
  BOTH: "Alıcı + Satıcı",
  SUBCONTRACTOR: "Fason",
};
export const SUPPLIER_ROLE_FILTER_OPTIONS: readonly { value: SupplierRoleFilter; label: string }[] = [
  { value: "ALL", label: "Tümü" },
  { value: "CUSTOMER", label: SUPPLIER_ROLE_LABEL.CUSTOMER },
  { value: "SUPPLIER", label: SUPPLIER_ROLE_LABEL.SUPPLIER },
  { value: "BOTH", label: SUPPLIER_ROLE_LABEL.BOTH },
  { value: "SUBCONTRACTOR", label: SUPPLIER_ROLE_LABEL.SUBCONTRACTOR },
];

export interface SupplierPickerRow extends SupplierParty {
  /** `kind:id` — tablo satır anahtarı (iki tabloda aynı id çakışmasın). */
  key: string;
  code: string | null;
  name: string;
  role: SupplierRole;
  taxNumber: string | null;
  phone: string | null;
  isActive: boolean;
}

/** Rol seçiminin SUNUCU tarafı: hangi bacak sorulur, cari bacağına hangi `filter[type]` gider. */
export interface SupplierRoleQuery {
  customers: boolean;
  subcontractors: boolean;
  /** `filter[type]` — ALL'da yok (bütün tipler), Fason'da cari sorgusu zaten kapalı. */
  customerType?: "CUSTOMER" | "SUPPLIER" | "BOTH";
}

export function supplierRoleQuery(role: SupplierRoleFilter): SupplierRoleQuery {
  if (role === "ALL") return { customers: true, subcontractors: true };
  if (role === "SUBCONTRACTOR") return { customers: false, subcontractors: true };
  return { customers: true, subcontractors: false, customerType: role };
}

function row(kind: SupplierPartyKind, r: { id: string; code?: string | null; name: string; taxNumber?: string | null; isActive?: boolean }, role: SupplierRole, phone: string | null): SupplierPickerRow {
  return { kind, id: r.id, key: `${kind}:${r.id}`, code: r.code ?? null, name: r.name, role, taxNumber: r.taxNumber ?? null, phone, isActive: r.isActive !== false };
}

/** İki bacağı tek listeye açar — SIRALAMA SUNUCUNUN (sayfa sınırı korunur): cariler önce, fason sonra. */
export function toSupplierPickerRows(customers: readonly Customer[] | undefined, subcontractors: readonly Subcontractor[] | undefined): SupplierPickerRow[] {
  return [
    ...(customers ?? []).map((c) => row("CUSTOMER", c, c.type, c.contactPhone ?? null)),
    ...(subcontractors ?? []).map((s) => row("SUBCONTRACTOR", s, "SUBCONTRACTOR", s.phone ?? null)),
  ];
}
