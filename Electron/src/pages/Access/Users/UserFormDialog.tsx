import { z } from "zod";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import type { AdminUserListItem } from "@/services/adminUserService";

export const userFormSchema = z.object({
  // Yalnız İngilizce harf/rakam/nokta/alt-çizgi/tire — Türkçe karakter ve BOŞLUK yok.
  username: z
    .string()
    .trim()
    .min(3, "En az 3 karakter")
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, "Yalnız İngilizce harf, rakam, . _ - (boşluk/Türkçe karakter yok)"),
  fullName: z.string().min(1, "Ad-soyad gerekli").max(120),
  password: z.string().min(6, "En az 6 karakter").optional().or(z.literal("")),
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
    ? { username: initial.username, fullName: initial.fullName, password: "", grantOperatorDefaults: false }
    : { username: "", fullName: "", password: "", grantOperatorDefaults: true };

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
          <FormField
            label="Kullanıcı Adı"
            htmlFor="username"
            error={form.formState.errors.username}
            hint="Yalnız İngilizce harf, rakam ve . _ - — boşluk ve Türkçe karakter olamaz."
            required
          >
            <Input
              id="username"
              autoFocus
              disabled={isEdit}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              {...form.register("username", {
                // Yazarken anında filtrele: geçersiz karakterler (boşluk/Türkçe/vb.) hiç girilmesin.
                onChange: (e) => {
                  const cleaned = e.target.value.replace(/[^a-zA-Z0-9._-]/g, "");
                  if (cleaned !== e.target.value) {
                    e.target.value = cleaned;
                    form.setValue("username", cleaned, { shouldValidate: true });
                  }
                },
              })}
            />
          </FormField>
          <FormField label="Ad Soyad" htmlFor="fullName" error={form.formState.errors.fullName} required>
            <Input id="fullName" {...form.register("fullName")} />
          </FormField>
          {!isEdit && (
            <FormField label="Şifre" htmlFor="password" error={form.formState.errors.password} required>
              <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
            </FormField>
          )}
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
