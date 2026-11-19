import { useEffect, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useForm,
  FormProvider,
  type DefaultValues,
  type FieldValues,
  type Resolver,
  type SubmitHandler,
  type UseFormReturn,
} from "react-hook-form";
import type { ZodType } from "zod";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FormErrorSummary } from "./FormErrorSummary";
import { WideFormDialog } from "./WideFormDialog";
import { useDirtyTab } from "@/components/layout/tabs/dirty-tabs";
import { MaybeSections } from "./modal-sections/ModalSections";

interface Props<TValues extends FieldValues> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  schema: ZodType<TValues>;
  defaultValues: DefaultValues<TValues>;
  onSubmit: SubmitHandler<TValues>;
  isSubmitting?: boolean;
  submitLabel?: string;
  /** "wide": geniş form iskeleti (`WideFormDialog`) — sabit başlık + kendi kaydırıcılı gövde + sabit alt çubuk.
   *  "medium": az alanlı form; kısa alanlar ızgarada yan yana sığsın diye orta genişlik. */
  size?: "default" | "medium" | "wide";
  /** Bölüm görünürlüğü tercih anahtarı; `sectionId`li kartlar × yanındaki menüde aç/kapa listelenir. */
  sectionsKey?: string;
  children: (form: UseFormReturn<TValues>) => ReactNode;
}

export function EntityFormDialog<TValues extends FieldValues>({
  open,
  onOpenChange,
  title,
  description,
  schema,
  defaultValues,
  onSubmit,
  isSubmitting,
  submitLabel = "Kaydet",
  size = "default",
  sectionsKey,
  children,
}: Props<TValues>) {
  const form = useForm<TValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any) as unknown as Resolver<TValues>,
    defaultValues,
  });

  // Kirli sekme kaydı: react-hook-form'un kendi ölçüsü (değer eskiye dönerse temiz); DOM yazım algısı bu formu saymaz.
  useDirtyTab(open && form.formState.isDirty);

  useEffect(() => {
    if (open) form.reset(defaultValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const buttons = (wide: boolean) => (
    <>
      <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
        İptal
      </Button>
      <Button type="submit" disabled={isSubmitting} className={cn(wide && "min-w-32")}>
        {isSubmitting ? "Kaydediliyor..." : submitLabel}
      </Button>
    </>
  );
  const summary = <FormErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />;

  if (size === "wide") {
    return (
      <FormProvider {...form}>
        <WideFormDialog open={open} onOpenChange={onOpenChange} title={title} description={description} footer={buttons(true)} onSubmit={form.handleSubmit(onSubmit)} dirtyManaged sectionsKey={sectionsKey}>
          {children(form)}
          {summary}
        </WideFormDialog>
      </FormProvider>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={size === "medium" ? "w-[calc(100%-2rem)] max-w-3xl" : "max-w-xl"}>
        <MaybeSections sectionsKey={sectionsKey}>
          <DialogHeader className={cn(sectionsKey && "pr-16")}>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <FormProvider {...form}>
            <form data-dirty-managed="" onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              {children(form)}
              {summary}
              <DialogFooter className="pt-2">{buttons(false)}</DialogFooter>
            </form>
          </FormProvider>
        </MaybeSections>
      </DialogContent>
    </Dialog>
  );
}
