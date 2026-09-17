import { useEffect, useState } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/forms/FormField";
import { EnumSelect } from "@/components/forms/EnumSelect";
import { companyTypeLabels, type CompanyType } from "@/types/enums";
import { useCustomerBranchesEnabled } from "@/hooks/usePricingEnabled";
import { customerFormDefaults, customerFormSchema, type CustomerFormValues } from "./schema";
import { CustomerBranchesDraftField } from "./CustomerBranchesDraftField";
import { CustomerBranchesPanel } from "./CustomerBranchesPanel";
import { CustomerItemAliasesPanel } from "./CustomerItemAliasesPanel";
import { CustomerColorAliasesPanel } from "./CustomerColorAliasesPanel";
import { CustomerTemplateRoutesPanel } from "./CustomerTemplateRoutesPanel";
import { CustomerStandaloneLabelsPanel } from "./CustomerStandaloneLabelsPanel";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { DocumentProfileSelect } from "@/components/forms/DocumentProfileSelect";
import type { Customer } from "./types";

import { RecordInfoButton } from "@/components/RecordInfoButton";
import { SimilarNamesWarning } from "@/components/forms/SimilarNamesWarning";
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Customer | null;
  onSubmit: (values: CustomerFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
  /** Oluşturma formunda satır-içi şube editörünü göster (varsayılan true). Sipariş
   * içi "hızlı müşteri ekle" gibi dar akışlar false geçip formu sade tutar —
   * o çağıranların onSubmit'i şubeleri iletmez, gösterilmeleri veri kaybı olurdu. */
  showBranchDraft?: boolean;
  /** Yeni kartta tip varsayılanı — tedarikçi seçicisinden açılınca SUPPLIER (alan görünür kalır,
   *  kullanıcı değiştirebilir). Verilmezse katalog varsayılanı (CUSTOMER). */
  defaultType?: CustomerFormValues["type"];
  /** Tip seçenekleri daraltması — tedarikçi seçicisinden açılınca yalnız SUPPLIER · BOTH (müşteri-only kart
   *  tedarikçi listesine girmez; kullanıcı kararı 2026-09-17). Verilmezse üç tip. */
  typeOptions?: readonly CompanyType[];
}

export function CustomerFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
  isSubmitting,
  showBranchDraft = true,
  defaultType,
  typeOptions,
}: Props) {
  const isEdit = Boolean(initial);
  // customers.branchesEnabled kapalıyken şube yüzeyleri (sekme + taslak) gizlenir;
  // mevcut şube verisi korunur, yalnız UI'dan kalkar.
  const branchesEnabled = useCustomerBranchesEnabled();
  const defaults: CustomerFormValues = initial
    ? {
        name: initial.name,
        taxNumber: initial.taxNumber ?? "",
        exportCode: initial.exportCode ?? "",
        address: initial.address ?? "",
        city: initial.city ?? "",
        district: initial.district ?? "",
        country: initial.country ?? "",
        defaultDestination: initial.defaultDestination ?? null,
        contactName: initial.contactName ?? "",
        contactPhone: initial.contactPhone ?? "",
        email: initial.email ?? "",
        notes: initial.notes ?? "",
        documentProfileId: initial.documentProfileId ?? null,
        type: initial.type,
        isActive: initial.isActive,
        branches: [],
      }
    : { ...customerFormDefaults, ...(defaultType ? { type: defaultType } : {}) };

  const form = useForm<CustomerFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(customerFormSchema as any) as unknown as Resolver<CustomerFormValues>,
    defaultValues: defaults,
  });

  const [confirmClose, setConfirmClose] = useState(false);
  const [activeTab, setActiveTab] = useState("info");

  useEffect(() => {
    if (open) {
      form.reset(defaults);
      setActiveTab("info");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  // Kirli-form guard: kapatma isteği (X / Esc / dış tıklama / İptal — hepsi
  // onOpenChange'den geçer) yalnızca formda kaydedilmemiş değişiklik varsa onay
  // ister. Düzenlemede alt paneller (şube/alias) kendi içlerinde anında sunucuya
  // yazar; oluşturmada şube taslakları da isDirty'ye dahildir (field array).
  const requestClose = (next: boolean) => {
    if (!next && form.formState.isDirty) {
      setConfirmClose(true);
      return;
    }
    onOpenChange(next);
  };

  const submit = form.handleSubmit(async (v) => {
    await onSubmit(v);
    // Başarılı kayıt sonrası formu "temiz" say (guard yanlış tetiklenmesin).
    form.reset(v);
  });

  const infoFields = (
    <>
      {isEdit && initial?.code && (
        <div className="text-xs text-muted-foreground">
          Kod: <span className="font-mono">{initial.code}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Ad" htmlFor="name" error={form.formState.errors.name} required>
          <Input id="name" autoFocus {...form.register("name")} />
          {/* Mükerreri REDDETMEK yerine ÖNLEMEK: canlı veride "Moda Tekstil" ve
              "MODA TEKSTİL" iki ayrı AKTİF müşteri olarak duruyordu. */}
          <SimilarNamesWarning
            entity="customers"
            name={form.watch("name") ?? ""}
            excludeId={initial?.id}
          />
        </FormField>
        <FormField label="Tip" error={form.formState.errors.type} required>
          <Controller
            control={form.control}
            name="type"
            render={({ field }) => (
              <EnumSelect<CompanyType>
                value={field.value}
                onChange={field.onChange}
                labels={pickTypeLabels(typeOptions)}
              />
            )}
          />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField
          label="Vergi No"
          htmlFor="taxNumber"
          error={form.formState.errors.taxNumber}
          hint="İsteğe bağlı — 10-15 haneli VKN/TCKN"
        >
          <Input
            id="taxNumber"
            inputMode="numeric"
            maxLength={32}
            placeholder="örn: 1234567890"
            {...form.register("taxNumber")}
          />
        </FormField>
        <FormField
          label="İhracat Kodu"
          htmlFor="exportCode"
          error={form.formState.errors.exportCode}
          hint="Şirket ihracat kodu — sevk belgesine yalnız şube ihracat kodu yoksa basılır"
        >
          <Input id="exportCode" placeholder="Opsiyonel" {...form.register("exportCode")} />
        </FormField>
      </div>

      <FormField label="Adres" htmlFor="address" error={form.formState.errors.address}>
        <textarea
          id="address"
          rows={2}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          {...form.register("address")}
        />
      </FormField>

      <div className="grid grid-cols-3 gap-3">
        <FormField label="Ülke" htmlFor="country" error={form.formState.errors.country}>
          <Input id="country" placeholder="Türkiye" {...form.register("country")} />
        </FormField>
        {/* Sevk hedefi VARSAYILANI — sevkiyat formu buradan başlar; operatör değiştirir (kilit değil). */}
        <FormField label="Sevk varsayılanı" error={form.formState.errors.defaultDestination}>
          <Controller
            control={form.control}
            name="defaultDestination"
            render={({ field }) => (
              <Select
                value={field.value ?? "NONE"}
                onValueChange={(v) => field.onChange(v === "NONE" ? null : (v as "DOMESTIC" | "EXPORT"))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Yok (her sevkte seçilir)</SelectItem>
                  <SelectItem value="DOMESTIC">Yurtiçi</SelectItem>
                  <SelectItem value="EXPORT">Yurtdışı</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
        <FormField label="Şehir" htmlFor="city" error={form.formState.errors.city}>
          <Input id="city" {...form.register("city")} />
        </FormField>
        <FormField label="İlçe" htmlFor="district" error={form.formState.errors.district}>
          <Input id="district" {...form.register("district")} />
        </FormField>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <FormField label="Yetkili" htmlFor="contactName" error={form.formState.errors.contactName}>
          <Input id="contactName" {...form.register("contactName")} />
        </FormField>
        <FormField label="Telefon" htmlFor="contactPhone" error={form.formState.errors.contactPhone}>
          <Input
            id="contactPhone"
            inputMode="tel"
            maxLength={40}
            placeholder="0212 555 0000"
            {...form.register("contactPhone")}
          />
        </FormField>
        <FormField label="E-posta" htmlFor="email" error={form.formState.errors.email}>
          <Input id="email" inputMode="email" placeholder="ornek@firma.com" {...form.register("email")} />
        </FormField>
      </div>

      <FormField label="Notlar" htmlFor="notes" error={form.formState.errors.notes}>
        <textarea
          id="notes"
          rows={2}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          {...form.register("notes")}
        />
      </FormField>

      <FormField
        label="Belge Şablon Profili"
        hint="Bu müşteriye basılan irsaliyeler seçili profilin görünümünü kullanır; boş = genel ayar"
      >
        <Controller
          control={form.control}
          name="documentProfileId"
          render={({ field }) => (
            <DocumentProfileSelect value={field.value} onChange={field.onChange} />
          )}
        />
      </FormField>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" {...form.register("isActive")} /> Aktif
      </label>
    </>
  );

  const footer = (
    <DialogFooter className="pt-2">
      <Button type="button" variant="outline" onClick={() => requestClose(false)}>
        İptal
      </Button>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Kaydediliyor..." : "Kaydet"}
      </Button>
    </DialogFooter>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={requestClose}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <div className="flex items-center gap-1.5">
            <DialogTitle>{isEdit ? "Müşteriyi Düzenle" : "Yeni Müşteri"}</DialogTitle>
            {/* ⓘ — kim oluşturdu / en son kim değiştirdi (2026-08-19).
                Kaynak: kaydın KENDİ künye kolonları (Plan A). Audit'ten
                okunmuyor — audit 6 ayda arşivlenir, künye kaybolmamalı. */}
            {isEdit && initial && (
              <RecordInfoButton
                table="CUSTOMER"
                id={initial.id}
                createdAt={initial.createdAt}
                updatedAt={initial.updatedAt}
              />
            )}
            </div>
            <DialogDescription>
              {isEdit
                ? "Müşteri bilgileri ve sevk noktası (şube) tanımları."
                : "Müşteri bilgilerini ve (opsiyonel) sevk noktalarını girin — hepsi tek seferde kaydedilir."}
            </DialogDescription>
          </DialogHeader>

          {isEdit ? (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="info">Bilgiler</TabsTrigger>
                {branchesEnabled && <TabsTrigger value="branches">Şubeler</TabsTrigger>}
                <TabsTrigger value="item-aliases">Müşterideki Kumaş Adları</TabsTrigger>
                <TabsTrigger value="color-aliases">Müşterideki Renk Adları</TabsTrigger>
                <TabsTrigger value="label-templates">Etiket Şablonları</TabsTrigger>
              </TabsList>

              <TabsContent value="info">
                <form onSubmit={submit} className="space-y-3">
                  {/* Kart alanlarıyla form uzadı — footer görünür kalsın diye alanlar kayar. */}
                  <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">{infoFields}</div>
                  {footer}
                </form>
              </TabsContent>

              {branchesEnabled && (
                <TabsContent value="branches">
                  {initial && <CustomerBranchesPanel customerId={initial.id} />}
                </TabsContent>
              )}

              <TabsContent value="item-aliases">
                {initial && <CustomerItemAliasesPanel customerId={initial.id} />}
              </TabsContent>

              <TabsContent value="color-aliases">
                {initial && <CustomerColorAliasesPanel customerId={initial.id} />}
              </TabsContent>

              <TabsContent value="label-templates" className="space-y-5">
                {initial && (
                  <>
                    <section className="space-y-2">
                      <h4 className="text-sm font-semibold">Rulo/Kartela şablonları</h4>
                      <CustomerTemplateRoutesPanel customerId={initial.id} />
                    </section>
                    <section className="space-y-2 border-t pt-4">
                      <h4 className="text-sm font-semibold">Serbest etiketler</h4>
                      <CustomerStandaloneLabelsPanel customerId={initial.id} />
                    </section>
                  </>
                )}
              </TabsContent>
            </Tabs>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
                {infoFields}
                {showBranchDraft && branchesEnabled && (
                  <div className="border-t pt-3">
                    <CustomerBranchesDraftField form={form} />
                  </div>
                )}
              </div>
              {footer}
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Kaydedilmemiş değişiklikler"
        description="Bu formda kaydedilmemiş değişiklikler var. Kapatırsanız girdiğiniz bilgiler kaybolur. Kapatmak istediğinize emin misiniz?"
        confirmLabel="Kapat, kaydetme"
        cancelLabel="Vazgeç"
        destructive
        onConfirm={() => {
          setConfirmClose(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}

/** Tip etiketleri — `typeOptions` verilmişse o alt küme (sıra katalog sırası), yoksa hepsi. */
function pickTypeLabels(typeOptions?: readonly CompanyType[]): Record<CompanyType, string> {
  if (!typeOptions) return companyTypeLabels;
  const out: Partial<Record<CompanyType, string>> = {};
  for (const k of Object.keys(companyTypeLabels) as CompanyType[]) if (typeOptions.includes(k)) out[k] = companyTypeLabels[k];
  return out as Record<CompanyType, string>;
}
