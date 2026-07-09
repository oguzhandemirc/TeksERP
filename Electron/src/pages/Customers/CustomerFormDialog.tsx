import { useEffect, useRef, useState } from "react";
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
}

export function CustomerFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  const isEdit = Boolean(initial);
  const defaults: CustomerFormValues = initial
    ? {
        name: initial.name,
        taxNumber: initial.taxNumber ?? "",
        type: initial.type,
        isActive: initial.isActive,
      }
    : customerFormDefaults;

  const form = useForm<CustomerFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(customerFormSchema as any) as unknown as Resolver<CustomerFormValues>,
    defaultValues: defaults,
  });

  const [confirmClose, setConfirmClose] = useState(false);
  const [activeTab, setActiveTab] = useState("info");
  // Kaydet-ve-devam et: create→edit geçişini (id: null → dolu, dialog açıkken)
  // yakalamak için önceki (open, id) tutulur.
  const prevRef = useRef<{ open: boolean; id: string | null }>({ open: false, id: null });

  useEffect(() => {
    if (open) form.reset(defaults);

    const prev = prevRef.current;
    const currentId = initial?.id ?? null;
    if (open && !prev.open) {
      // Taze açılış (yeni müşteri VEYA mevcut müşteriyi düzenleme) → "Bilgiler".
      setActiveTab("info");
    } else if (open && prev.open && prev.id === null && currentId !== null) {
      // İlk kayıttan sonra düzenlemeye geçildi → kilidi açılan sekmeleri görünür
      // kılmak için doğrudan "Şubeler"e atla.
      setActiveTab("branches");
    }
    prevRef.current = { open, id: currentId };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  // Kirli-form guard: kapatma isteği (X / Esc / dış tıklama / İptal — hepsi
  // onOpenChange'den geçer) yalnızca "Bilgiler" formunda kaydedilmemiş değişiklik
  // varsa onay ister. Alt paneller (şube/alias) kendi içlerinde anında sunucuya
  // yazar; kapanışta risk sadece bu formda yazılmış-ama-kaydedilmemiş alanlardır.
  const requestClose = (next: boolean) => {
    if (!next && form.formState.isDirty) {
      setConfirmClose(true);
      return;
    }
    onOpenChange(next);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Müşteriyi Düzenle" : "Yeni Müşteri"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Müşteri bilgileri ve sevk noktası (şube) tanımları."
              : "Önce müşteri kaydedildikten sonra şube ekleyebilirsiniz."}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="info">Bilgiler</TabsTrigger>
            <TabsTrigger value="branches" disabled={!isEdit || !initial}>
              Şubeler
            </TabsTrigger>
            <TabsTrigger value="item-aliases" disabled={!isEdit || !initial}>
              Müşterideki Ürün Adları
            </TabsTrigger>
            <TabsTrigger value="color-aliases" disabled={!isEdit || !initial}>
              Müşterideki Renk Adları
            </TabsTrigger>
            <TabsTrigger value="label-templates" disabled={!isEdit || !initial}>
              Etiket Şablonları
            </TabsTrigger>
          </TabsList>

          <TabsContent value="info">
            <form
              onSubmit={form.handleSubmit(async (v) => {
                await onSubmit(v);
                // Başarılı kayıt sonrası formu "temiz" say: hem guard yanlış
                // tetiklenmesin, hem kaydet-ve-devam et modunda isDirty sıfırlansın.
                form.reset(v);
              })}
              className="space-y-3"
            >
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

              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => requestClose(false)}>
                  İptal
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Kaydediliyor..." : "Kaydet"}
                </Button>
              </DialogFooter>
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
