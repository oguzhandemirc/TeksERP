// Cari kartı "Bilgiler" gövdesi (yeni + düzenleme). Sıra (2026-11-24): Kimlik → İletişim → Adres ve sevk → Şubeler
// (yalnız yeni kartta) → Finans → Fason (yalnız düzenlemede) → Notlar. Kimlik dışındaki her bölüm × yanındaki
// "Bölümleri göster/gizle" menüsünde; seçim kullanıcı tercihine yazılır (`modalSections["customer.form"]`).
import { Controller, type UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/forms/FormField";
import { FieldGrid, FormCard } from "@/components/forms/WideFormDialog";
import { DocumentProfileSelect } from "@/components/forms/DocumentProfileSelect";
import { SimilarNamesWarning } from "@/components/forms/SimilarNamesWarning";
import { partnerRoleLabels } from "@/lib/partnerRoles";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { SUBCONTRACTOR_NEEDS_SUPPLIER_MESSAGE, type CustomerFormValues } from "./schema";
import { exportCodeVisible } from "./branch-schema";
import { CustomerBranchesDraftField } from "./CustomerBranchesDraftField";
import { CustomerFinanceSection } from "./CustomerFinanceSection";
import { CustomerSubcontractorRole, SUBCONTRACTOR_ROLE_LABEL } from "./CustomerSubcontractorRole";
import type { Customer } from "./types";

interface Props {
  form: UseFormReturn<CustomerFormValues>;
  initial?: Customer | null;
  requiredRole?: "isCustomerRole" | "isSupplierRole";
  finance: { canRead: boolean; canWrite: boolean };
  /** Yeni kartta satır-içi şube taslağı. */
  showBranchDraft: boolean;
}

const TEXTAREA =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function CustomerInfoFields({ form, initial, requiredRole, finance, showBranchDraft }: Props) {
  const isEdit = Boolean(initial);
  return (
    <div className="space-y-4">
      <IdentityCard form={form} initial={initial} requiredRole={requiredRole} />
      <ContactCard form={form} />
      <AddressCard form={form} />
      {!isEdit && showBranchDraft && (
        <FormCard title="Şubeler (sevk noktaları)" sectionId="branches">
          <CustomerBranchesDraftField form={form} />
        </FormCard>
      )}
      {finance.canRead && <CustomerFinanceSection form={form as never} customerId={initial?.id ?? null} canWrite={finance.canWrite} />}
      {/* Fason profili durumu + kategoriler (düzenlemede; rol düğmesi Kimlik › Roller'de). Hepsi Kaydet ile yazılır. */}
      {isEdit && initial && (
        <FormCard title="Fason" sectionId="fason">
          <CustomerSubcontractorRole customer={initial} />
        </FormCard>
      )}
      <FormCard title="Notlar" sectionId="notes" errorFields={["notes"]}>
        <textarea id="notes" aria-label="Notlar" rows={2} className={TEXTAREA} {...form.register("notes")} />
      </FormCard>
    </div>
  );
}

function IdentityCard({ form, initial, requiredRole }: Pick<Props, "form" | "initial" | "requiredRole">) {
  const isEdit = Boolean(initial);
  const err = form.formState.errors;
  // "Fason iş yapar": yeni kartta gövdeye `subcontractorRole` gider (`buildCustomerPayload`); düzenlemede Kaydet
  // kart yazıldıktan sonra profili açar/kapatır (`subcontractorRoleSync`). Profil yazma izni yoksa düzenlemede kilitli.
  const fason = form.watch("isSubcontractorRole");
  const { hasPermission } = useRoleAccess();
  const fasonLocked = isEdit && !hasPermission("subcontractor:write");
  return (
    <FormCard title="Kimlik" sectionId="identity" sectionRequired aside={isEdit && initial?.code ? <span className="text-xs text-muted-foreground">Kod: <span className="font-mono">{initial.code}</span></span> : undefined}>
      <FieldGrid cols={4}>
        <FormField label="Ad" htmlFor="name" error={err.name} required className="md:col-span-2">
          <Input id="name" autoFocus {...form.register("name")} />
          {/* Mükerreri REDDETMEK yerine ÖNLEMEK: canlı veride "Moda Tekstil" ve "MODA TEKSTİL" iki ayrı AKTİF müşteriydi. */}
          <SimilarNamesWarning entity="customers" name={form.watch("name") ?? ""} excludeId={initial?.id} />
        </FormField>
        <FormField label="Vergi No" htmlFor="taxNumber" error={err.taxNumber} info="İsteğe bağlı — 10-15 haneli VKN/TCKN">
          <Input id="taxNumber" inputMode="numeric" maxLength={32} placeholder="örn: 1234567890" {...form.register("taxNumber")} />
        </FormField>
        <FormField label="Durum">
          <div>
            <ToggleChip label="Aktif" {...form.register("isActive")} />
          </div>
        </FormField>
        {/* Rol modeli: tip yerine üç seçim düğmesi, yeni kartta da düzenlemede de burada (B18/2). "Fason iş yapar"
            seçiliyse Tedarikçi otomatik + kilitli (sunucu kuralı: fason profili Tedarikçi rolü ister). */}
        <FormField label="Roller" error={err.isCustomerRole ?? err.isSupplierRole} required hint={fason ? SUBCONTRACTOR_NEEDS_SUPPLIER_MESSAGE : undefined} className="md:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <ToggleChip label={partnerRoleLabels.customer} disabled={requiredRole === "isCustomerRole"} {...form.register("isCustomerRole")} />
            <ToggleChip label={partnerRoleLabels.supplier} disabled={requiredRole === "isSupplierRole" || fason} {...form.register("isSupplierRole")} />
            <ToggleChip
              label={SUBCONTRACTOR_ROLE_LABEL}
              checked={fason}
              disabled={fasonLocked}
              title={fasonLocked ? "Fason profilini değiştirme yetkiniz yok" : undefined}
              onChange={(e) => {
                form.setValue("isSubcontractorRole", e.target.checked, { shouldDirty: true });
                if (e.target.checked) form.setValue("isSupplierRole", true, { shouldDirty: true });
              }}
            />
          </div>
        </FormField>
        <FormField label="Belge Şablon Profili" info="Bu müşteriye basılan irsaliyeler seçili profilin görünümünü kullanır; boş = genel ayar">
          <Controller control={form.control} name="documentProfileId" render={({ field }) => <DocumentProfileSelect value={field.value} onChange={field.onChange} />} />
        </FormField>
        {/* Yalnız yurtdışı yönde görünür; gizlenen dolu değer silinmez (form durumunda kalır). */}
        {exportCodeVisible(form.watch("defaultDestination")) && (
          <FormField label="İhracat Kodu" htmlFor="exportCode" error={err.exportCode} info="Şirket ihracat kodu — sevk belgesine yalnız şube ihracat kodu yoksa basılır">
            <Input id="exportCode" placeholder="Opsiyonel" {...form.register("exportCode")} />
          </FormField>
        )}
      </FieldGrid>
    </FormCard>
  );
}

function ContactCard({ form }: Pick<Props, "form">) {
  const err = form.formState.errors;
  return (
    <FormCard title="İletişim" sectionId="contact" errorFields={["contactName", "contactPhone", "email"]}>
      <FieldGrid cols={4}>
        <FormField label="Yetkili" htmlFor="contactName" error={err.contactName}>
          <Input id="contactName" {...form.register("contactName")} />
        </FormField>
        <FormField label="Telefon" htmlFor="contactPhone" error={err.contactPhone}>
          <Input id="contactPhone" inputMode="tel" maxLength={40} placeholder="0212 555 0000" {...form.register("contactPhone")} />
        </FormField>
        <FormField label="E-posta" htmlFor="email" error={err.email} className="md:col-span-2">
          <Input id="email" inputMode="email" placeholder="ornek@firma.com" {...form.register("email")} />
        </FormField>
      </FieldGrid>
    </FormCard>
  );
}

function AddressCard({ form }: Pick<Props, "form">) {
  const err = form.formState.errors;
  return (
    <FormCard title="Adres ve sevk" sectionId="address" errorFields={["country", "city", "district", "address", "defaultDestination"]}>
      <FieldGrid cols={4}>
        <FormField label="Ülke" htmlFor="country" error={err.country}>
          <Input id="country" placeholder="Türkiye" {...form.register("country")} />
        </FormField>
        <FormField label="Şehir" htmlFor="city" error={err.city}>
          <Input id="city" {...form.register("city")} />
        </FormField>
        <FormField label="İlçe" htmlFor="district" error={err.district}>
          <Input id="district" {...form.register("district")} />
        </FormField>
        {/* Sevk yönü KİLİDİ — sevkiyatta seçilmez, buradan gelir; boşsa ilk sevkte sorulur ve buraya yazılır. */}
        <FormField label="Sevk yönü" error={err.defaultDestination}>
          <Controller
            control={form.control}
            name="defaultDestination"
            render={({ field }) => (
              <Select value={field.value ?? "NONE"} onValueChange={(v) => field.onChange(v === "NONE" ? null : (v as "DOMESTIC" | "EXPORT"))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Seçilmedi (ilk sevkte sorulur)</SelectItem>
                  <SelectItem value="DOMESTIC">Yurtiçi</SelectItem>
                  <SelectItem value="EXPORT">Yurtdışı</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
        <FormField label="Adres" htmlFor="address" error={err.address} className="sm:col-span-2 md:col-span-4">
          <textarea id="address" rows={2} className={TEXTAREA} {...form.register("address")} />
        </FormField>
      </FieldGrid>
    </FormCard>
  );
}
