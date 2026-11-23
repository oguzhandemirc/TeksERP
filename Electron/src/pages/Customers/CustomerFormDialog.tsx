import { useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FormProvider, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { TabbedDialogBody, TabbedDialogContent, TabbedDialogFooter, TabbedDialogHeader } from "@/components/ui/tabbed-dialog";
import { Button } from "@/components/ui/button";
import { ModalSectionsScope } from "@/components/forms/modal-sections/ModalSections";
import { useCustomerBranchesEnabled } from "@/hooks/usePricingEnabled";
import { customerFormDefaults, customerFormSchema, type CustomerFormValues } from "./schema";
import { useCustomerFinanceAccess } from "./CustomerFinanceSection";
import { financeFormDefaults, financeValuesAfterSave } from "./customerFinance";
import { CustomerInfoFields } from "./CustomerInfoFields";
import { CustomerEditTabs } from "./CustomerEditTabs";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import type { Customer } from "./types";

import { RecordInfoButton } from "@/components/RecordInfoButton";
import { CustomerQuotesButton } from "@/pages/Cost/Quotes/CustomerQuotesButton";
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
  /** Yeni kartta işaretli gelen ve KİLİTLİ rol — hızlı ekleme yolları (tedarikçi kipi: Tedarikçi, müşteri kipi:
   *  Müşteri): kart o listeye girsin diye kutu işaretli ve değiştirilemez; diğer kutu serbest. */
  requiredRole?: "isCustomerRole" | "isSupplierRole";
}

function formDefaults(initial: Customer | null | undefined, requiredRole: Props["requiredRole"]): CustomerFormValues {
  if (!initial) {
    // Hızlı ekleme: yalnız istenen rol işaretli gelir (varsayılan "yalnız Müşteri" değil).
    return { ...customerFormDefaults, ...(requiredRole ? { isCustomerRole: requiredRole === "isCustomerRole", isSupplierRole: requiredRole === "isSupplierRole" } : {}) };
  }
  return {
    ...financeFormDefaults,
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
    isCustomerRole: initial.isCustomerRole,
    isSupplierRole: initial.isSupplierRole,
    isSubcontractorRole: initial.isSubcontractorRole,
    isActive: initial.isActive,
    branches: [],
  };
}

function CustomerFormHeader({ initial }: { initial?: Customer | null }) {
  return (
    <TabbedDialogHeader className="pr-20">
      <div className="flex items-center gap-1.5">
        <DialogTitle>{initial ? "Cari Kartını Düzenle" : "Yeni Cari"}</DialogTitle>
        {/* ⓘ — kim oluşturdu / en son kim değiştirdi (2026-08-19). Kaynak: kaydın KENDİ künye kolonları (Plan A);
            audit 6 ayda arşivlenir, künye kaybolmamalı. */}
        {initial && <RecordInfoButton table="CUSTOMER" id={initial.id} createdAt={initial.createdAt} updatedAt={initial.updatedAt} />}
        {initial && <CustomerQuotesButton customerId={initial.id} isCustomerRole={initial.isCustomerRole} />}
      </div>
      <DialogDescription>
        {initial
          ? "Müşteri bilgileri ve sevk noktası (şube) tanımları."
          : "Müşteri bilgilerini ve (opsiyonel) sevk noktalarını girin — hepsi tek seferde kaydedilir."}
      </DialogDescription>
    </TabbedDialogHeader>
  );
}

export function CustomerFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting, showBranchDraft = true, requiredRole }: Props) {
  const isEdit = Boolean(initial);
  const branchesEnabled = useCustomerBranchesEnabled();
  // Z-B: Finans bölümü yalnız finance:read + modül açıkken; yazma yetkisi yoksa salt-okunur (gövdeye alt nesne konmaz).
  const financeAccess = useCustomerFinanceAccess();
  const defaults = formDefaults(initial, requiredRole);
  const form = useForm<CustomerFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(customerFormSchema as any) as unknown as Resolver<CustomerFormValues>,
    defaultValues: defaults,
  });

  const qc = useQueryClient();
  const formId = useId();
  const [confirmClose, setConfirmClose] = useState(false);
  const [activeTab, setActiveTab] = useState("info");

  useEffect(() => {
    if (open) {
      form.reset(defaults);
      setActiveTab("info");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  // Kirli-form guard: kapatma isteği (X / Esc / dış tıklama / İptal — hepsi onOpenChange'den geçer) yalnızca formda
  // kaydedilmemiş değişiklik varsa onay ister. Düzenlemede alt paneller kendi içlerinde anında sunucuya yazar.
  const requestClose = (next: boolean) => {
    if (!next && form.formState.isDirty) {
      setConfirmClose(true);
      return;
    }
    onOpenChange(next);
  };

  // Geçersizse Bilgiler sekmesine dön: Kaydet her sekmeden basılabilir, hata gizli panelde kalmasın.
  const submit = form.handleSubmit(async (v) => {
    await onSubmit(v);
    // Başarılı kayıt sonrası formu "temiz" say (guard yanlış tetiklenmesin); tetik tohumu kaydedilen değere eşitlenir.
    form.reset(financeValuesAfterSave(v));
    // Kart terimleri `by-customer` önbelleğinden tohumlanır; yeniden açılışta eski terim/tetik görünmesin.
    void qc.invalidateQueries({ queryKey: ["finance", "cari"] });
    void qc.invalidateQueries({ queryKey: ["finance", "cari-by-customer"] });
  }, () => setActiveTab("info"));

  const infoForm = (
    <form id={formId} onSubmit={submit}>
      <CustomerInfoFields form={form} initial={initial} requiredRole={requiredRole} finance={financeAccess} showBranchDraft={showBranchDraft && branchesEnabled} />
    </form>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={requestClose}>
        {/* Sabit boyutlu geniş modal: sekme değişince yükseklik zıplamaz, alt düğmeler hep görünür. */}
        <TabbedDialogContent className="w-[calc(100%-2rem)] max-w-[88rem]" data-form-size="wide">
          <FormProvider {...form}>
          <ModalSectionsScope modalId="customer.form">
          <CustomerFormHeader initial={initial} />

          {isEdit && initial ? (
            <CustomerEditTabs customer={initial} activeTab={activeTab} onTabChange={setActiveTab} infoPanel={infoForm} destination={form.watch("defaultDestination")} />
          ) : (
            <TabbedDialogBody className="border-t border-border/70 bg-muted/40 py-5">{infoForm}</TabbedDialogBody>
          )}

          <TabbedDialogFooter>
            {isEdit && activeTab !== "info" && (
              <span className="mr-auto hidden text-xs text-muted-foreground sm:block">Bu sekmedeki değişiklikler anında kaydedilir; Kaydet, Bilgiler'i kaydeder.</span>
            )}
            <Button type="button" variant="outline" onClick={() => requestClose(false)}>İptal</Button>
            <Button type="submit" form={formId} disabled={isSubmitting}>
              {isSubmitting ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </TabbedDialogFooter>
          </ModalSectionsScope>
          </FormProvider>
        </TabbedDialogContent>
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
