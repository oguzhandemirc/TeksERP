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
  children,
}: Props<TValues>) {
  const form = useForm<TValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any) as unknown as Resolver<TValues>,
    defaultValues,
  });

  useEffect(() => {
    if (open) form.reset(defaultValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <FormProvider {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-3"
          >
            {children(form)}
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                İptal
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Kaydediliyor..." : submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
