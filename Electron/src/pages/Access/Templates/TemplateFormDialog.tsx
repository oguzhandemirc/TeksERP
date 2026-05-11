import { useEffect, useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FormField } from "@/components/forms/FormField";
import { PermissionGrid } from "@/components/admin/PermissionGrid";
import { permissionCatalogService } from "@/services/permissionCatalogService";
import type { PermissionTemplate } from "@/services/permissionTemplateService";

const schema = z.object({
  name: z.string().min(1, "Ad gerekli").max(120),
  description: z.string().max(300).optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: PermissionTemplate | null;
  onSubmit: (values: { name: string; description?: string | null; permissionIds: string[] }) => Promise<void>;
  isSubmitting?: boolean;
}

export function TemplateFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  const isEdit = Boolean(initial);

  const form = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any) as never,
    defaultValues: { name: initial?.name ?? "", description: initial?.description ?? "" },
  });

  const [permissionIds, setPermissionIds] = useState<string[]>(
    initial?.permissions.map((p) => p.permissionId) ?? [],
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      form.reset({ name: initial?.name ?? "", description: initial?.description ?? "" });
      setPermissionIds(initial?.permissions.map((p) => p.permissionId) ?? []);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  const catalog = useQuery({
    queryKey: ["permission-catalog"],
    queryFn: permissionCatalogService.list,
    staleTime: 5 * 60 * 1000,
  });

  const handleSubmit = form.handleSubmit(async (values) => {
    if (permissionIds.length === 0) {
      setError("Şablon en az bir yetki içermeli.");
      return;
    }
    setError(null);
    await onSubmit({
      name: values.name,
      description: values.description || null,
      permissionIds,
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Şablonu Düzenle" : "Yeni Yetki Şablonu"}</DialogTitle>
          <DialogDescription>
            Sık kullanılan yetki kümesini bir kere tanımla, kullanıcılara tek tıkla uygula.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Şablon Adı" htmlFor="name" error={form.formState.errors.name} required>
              <Input id="name" autoFocus {...form.register("name")} />
            </FormField>
            <FormField label="Açıklama" htmlFor="description" error={form.formState.errors.description}>
              <Input id="description" {...form.register("description")} />
            </FormField>
          </div>

          <div className="h-[420px]">
            {catalog.isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <PermissionGrid
                permissions={catalog.data?.data ?? []}
                value={permissionIds}
                onChange={setPermissionIds}
              />
            )}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
