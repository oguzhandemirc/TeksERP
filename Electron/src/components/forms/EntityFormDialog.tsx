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
import { useDirtyTab } from "@/components/layout/tabs/dirty-tabs";

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
  /** "wide": sekmeyi kaplayan geniş yüzey — sabit başlık + kendi kaydırıcılı gövde + sabit alt çubuk. */
  size?: "default" | "wide";
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

  const wide = size === "wide";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={wide ? "flex h-[92vh] w-[calc(100%-2rem)] max-w-[88rem] flex-col gap-0 overflow-hidden p-0" : "max-w-xl"}
        data-form-size={size}
      >
        <DialogHeader className={cn(wide && "shrink-0 border-b border-border/70 px-6 pb-3 pt-4")}>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <FormProvider {...form}>
          <form
            data-dirty-managed=""
            onSubmit={form.handleSubmit(onSubmit)}
            className={wide ? "flex min-h-0 flex-1 flex-col" : "space-y-3"}
          >
            {wide ? (
              <div className="min-h-0 flex-1 overflow-y-auto bg-muted/40 px-6 py-4">
                {children(form)}
                <FormErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />
              </div>
            ) : (
              <>
                {children(form)}
                <FormErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />
              </>
            )}
            <DialogFooter className={cn("pt-2", wide && "shrink-0 border-t border-border/70 bg-card px-6 py-3")}>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                İptal
              </Button>
              <Button type="submit" disabled={isSubmitting} className={cn(wide && "min-w-32")}>
                {isSubmitting ? "Kaydediliyor..." : submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
