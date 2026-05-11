import { z } from "zod";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import type { AdminUserListItem } from "@/services/adminUserService";

export const userFormSchema = z.object({
  username: z.string().min(3, "En az 3 karakter").max(40),
  fullName: z.string().min(1, "Ad-soyad gerekli").max(120),
  password: z.string().min(6, "En az 6 karakter").optional().or(z.literal("")),
  isActive: z.boolean(),
});

export type UserFormValues = z.infer<typeof userFormSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: AdminUserListItem | null;
  onSubmit: (values: UserFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function UserFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  const isEdit = Boolean(initial);
  const defaults: UserFormValues = initial
    ? { username: initial.username, fullName: initial.fullName, password: "", isActive: initial.isActive }
    : { username: "", fullName: "", password: "", isActive: true };

  return (
    <EntityFormDialog<UserFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Kullanıcıyı Düzenle" : "Yeni Kullanıcı"}
      schema={userFormSchema}
      defaultValues={defaults}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <>
          <FormField label="Kullanıcı Adı" htmlFor="username" error={form.formState.errors.username} required>
            <Input id="username" autoFocus disabled={isEdit} {...form.register("username")} />
          </FormField>
          <FormField label="Ad Soyad" htmlFor="fullName" error={form.formState.errors.fullName} required>
            <Input id="fullName" {...form.register("fullName")} />
          </FormField>
          {!isEdit && (
            <FormField label="Şifre" htmlFor="password" error={form.formState.errors.password} required>
              <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
            </FormField>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("isActive")} /> Aktif
          </label>
        </>
      )}
    </EntityFormDialog>
  );
}
