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
  // Yeni kullanıcıya üretim istasyon izinlerini (KK1/KK2/Tambur) otomatik ver.
  grantOperatorDefaults: z.boolean(),
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
    ? { username: initial.username, fullName: initial.fullName, password: "", isActive: initial.isActive, grantOperatorDefaults: false }
    : { username: "", fullName: "", password: "", isActive: true, grantOperatorDefaults: true };

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
          {!isEdit && (
            <label className="flex items-start gap-2 rounded-md border bg-muted/20 p-2.5 text-sm">
              <input type="checkbox" className="mt-0.5" {...form.register("grantOperatorDefaults")} />
              <span>
                Üretim operatörü yetkilerini ver{" "}
                <span className="text-muted-foreground">(KK1 · Kurşun/KK2 · Tambur)</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Sahada tabletle bu üç istasyon arasında çalışabilir. Yalnız web/yönetim
                  kullanıcısı açıyorsanız işareti kaldırın (yetkileri sonra tek tek atarsınız).
                </span>
              </span>
            </label>
          )}
        </>
      )}
    </EntityFormDialog>
  );
}
