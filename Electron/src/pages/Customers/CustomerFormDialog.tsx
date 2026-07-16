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
import { FormField } from "@/components/forms/FormField";
import { EnumSelect } from "@/components/forms/EnumSelect";
import { companyTypeLabels, type CompanyType } from "@/types/enums";
import { customerFormDefaults, customerFormSchema, type CustomerFormValues } from "./schema";
import { CustomerBranchesDraftField } from "./CustomerBranchesDraftField";
import { CustomerBranchesPanel } from "./CustomerBranchesPanel";
import { CustomerItemAliasesPanel } from "./CustomerItemAliasesPanel";
import { CustomerColorAliasesPanel } from "./CustomerColorAliasesPanel";
import { CustomerTemplateRoutesPanel } from "./CustomerTemplateRoutesPanel";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import type { Customer } from "./types";

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
}

export function CustomerFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
  isSubmitting,
  showBranchDraft = true,
}: Props) {
  const isEdit = Boolean(initial);
  const defaults: CustomerFormValues = initial
    ? {
        name: initial.name,
        taxNumber: initial.taxNumber ?? "",
        type: initial.type,
        isActive: initial.isActive,
        branches: [],
      }
    : customerFormDefaults;

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
        </FormField>
        <FormField label="Tip" error={form.formState.errors.type} required>
          <Controller
            control={form.control}
            name="type"
            render={({ field }) => (
              <EnumSelect<CompanyType>
                value={field.value}
                onChange={field.onChange}
                labels={companyTypeLabels}
              />
            )}
          />
        </FormField>
      </div>
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
            <DialogTitle>{isEdit ? "Müşteriyi Düzenle" : "Yeni Müşteri"}</DialogTitle>
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
                <TabsTrigger value="branches">Şubeler</TabsTrigger>
                <TabsTrigger value="item-aliases">Müşterideki Ürün Adları</TabsTrigger>
                <TabsTrigger value="color-aliases">Müşterideki Renk Adları</TabsTrigger>
                <TabsTrigger value="label-templates">Etiket Şablonları</TabsTrigger>
              </TabsList>

              <TabsContent value="info">
                <form onSubmit={submit} className="space-y-3">
                  {infoFields}
                  {footer}
                </form>
              </TabsContent>

              <TabsContent value="branches">
                {initial && <CustomerBranchesPanel customerId={initial.id} />}
              </TabsContent>

              <TabsContent value="item-aliases">
                {initial && <CustomerItemAliasesPanel customerId={initial.id} />}
              </TabsContent>

              <TabsContent value="color-aliases">
                {initial && <CustomerColorAliasesPanel customerId={initial.id} />}
              </TabsContent>

              <TabsContent value="label-templates">
                {initial && <CustomerTemplateRoutesPanel customerId={initial.id} />}
              </TabsContent>
            </Tabs>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
                {infoFields}
                {showBranchDraft && (
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
