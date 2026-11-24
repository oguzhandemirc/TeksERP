// Cari kartı yazma gövdesi — Cariler ekranının diyaloğu (`CariEditDialogs`) kullanır (eski Müşteriler sayfasından taşındı).
import { financeSubBody, type FinanceSubBody } from "./customerFinance";
import type { Customer } from "./types";
import { toPayload } from "./tamburLabelSettings";
import { branchDraftHasContent, customerCardPayload, type CustomerFormValues } from "./schema";

/** Tek-adım oluşturmada backend'e gönderilen satır-içi şube gövdesi. */
interface BranchCreatePayload {
  name: string;
  city: string | null;
  district: string | null;
  contactName: string | null;
  contactPhone: string | null;
  code: string | null;
  address: string | null;
  notes: string | null;
  defaultDestination: "DOMESTIC" | "EXPORT" | null;
}

/** Şema bölme ölçüsünü zaten doğruladı; yine de bozuksa alanlar gönderilmez (sunucudaki değer korunur). */
function tamburBody(t: CustomerFormValues["tamburLabel"]): Partial<Omit<Customer, "finance">> {
  if (!t) return {};
  const r = toPayload(t);
  return r.ok ? (r.body as Partial<Omit<Customer, "finance">>) : {};
}

type CustomerWritePayload = Partial<Omit<Customer, "finance">> & { branches?: BranchCreatePayload[]; subcontractorRole?: true; finance?: FinanceSubBody };

export const buildCustomerPayload = (v: CustomerFormValues, initial: Customer | null, finance: { canWrite: boolean; enabled: boolean } = { canWrite: false, enabled: false }): CustomerWritePayload => {
  // Şubeler yalnız OLUŞTURMADA gönderilir (müşteri + şubeler tek transaction'da doğar);
  // düzenlemede şubeler ayrı sekmeden yönetilir → payload'a eklenmez. Tamamen boş
  // taslak satırları (yanlışlıkla "Şube ekle") elenir — validasyon içerikli satırda
  // adı zaten zorunlu kıldığı için kalanların hepsinin adı doludur.
  const branchRows = initial ? [] : v.branches.filter(branchDraftHasContent);
  return {
    // Kod backend'de üretilir (MUS+GGAAYY+NNNN); yeni kayıtta gönderilmez, düzenlemede korunur.
    ...(initial ? { code: initial.code } : {}),
    name: v.name,
    taxNumber: v.taxNumber || null,
    ...customerCardPayload(v),
    // Rol modeli: `type` gönderilmez (sunucu türetir). Fason rolü bayrağı gövdede YOK (profil bağı türetir);
    // YENİ kartta "Fason iş yapar" → `subcontractorRole:true` (sunucu kart + profili tek tx'te doğurur).
    isCustomerRole: v.isCustomerRole,
    isSupplierRole: v.isSupplierRole,
    ...(!initial && v.isSubcontractorRole ? { subcontractorRole: true } : {}),
    isActive: v.isActive,
    // Tambur / etiket ayarları (Etiket Şablonları sekmesi) — tek kayıt modelinde aynı Kaydet ile, yalnız düzenlemede.
    ...(initial ? tamburBody(v.tamburLabel) : {}),
    // Z-B: terimler HESAPTA — `finance{…}` alt nesnesi yalnız finance:write + modül açıkken (yoksa alt nesne yok, sunucu 403 vermez).
    ...financeSubBody(v, finance),
    ...(branchRows.length > 0
      ? {
          branches: branchRows.map((b) => ({
            name: b.name.trim(),
            city: b.city?.trim() || null,
            district: b.district?.trim() || null,
            contactName: b.contactName?.trim() || null,
            contactPhone: b.contactPhone?.trim() || null,
            code: b.code?.trim() || null,
            address: b.address?.trim() || null,
            notes: b.notes?.trim() || null,
            defaultDestination: b.defaultDestination ?? null,
          })),
        }
      : {}),
  };
};
