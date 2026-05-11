import { useEffect } from "react";
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

  useEffect(() => {
    if (open) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Müşteriyi Düzenle" : "Yeni Müşteri"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Müşteri bilgileri ve sevk noktası (şube) tanımları."
              : "Önce müşteri kaydedildikten sonra şube ekleyebilirsiniz."}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="info">
          <TabsList>
            <TabsTrigger value="info">Bilgiler</TabsTrigger>
            <TabsTrigger value="branches" disabled={!isEdit || !initial}>
              Şubeler
            </TabsTrigger>
          </TabsList>

          <TabsContent value="info">
            <form
              onSubmit={form.handleSubmit(async (v) => {
                await onSubmit(v);
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
              <FormField label="Vergi No" htmlFor="taxNumber" error={form.formState.errors.taxNumber}>
                <Input id="taxNumber" {...form.register("taxNumber")} />
              </FormField>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...form.register("isActive")} /> Aktif
              </label>

              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
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
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
