import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/forms/FormField";
import { adminUserService } from "@/services/adminUserService";
import { CredentialApprovalRequest } from "./CredentialApprovalRequest";
import { newPasswordSchema, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

interface Props {
  userId: string;
  username: string;
}

const schema = z
  .object({
    password: newPasswordSchema,
    confirm: z.string().min(1, "Yeni şifreyi tekrar girin"),
  })
  .refine((d) => d.password === d.confirm, {
    path: ["confirm"],
    message: "Şifreler eşleşmiyor",
  });

type FormValues = z.infer<typeof schema>;

export function ResetPasswordTab({ userId, username }: Props) {
  const [done, setDone] = useState(false);
  // Varsayılan işaretli = eski davranış (geçici parola). Kaldırılırsa yazılan parola kalıcıdır.
  const [requireChange, setRequireChange] = useState(true);
  const [doneRequireChange, setDoneRequireChange] = useState(true);
  const form = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any) as unknown as Resolver<FormValues>,
    defaultValues: { password: "", confirm: "" },
  });

  const password = form.watch("password");
  useEffect(() => {
    // Başarı sonrası form.reset parolayı boşaltır; bant yalnız yeni yazımda kalkar.
    if (done && password) setDone(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  const mutation = useMutation({
    mutationFn: (v: { password: string; requireChange: boolean }) =>
      adminUserService.resetPassword(userId, v.password, v.requireChange),
    onSuccess: (_data, v) => {
      toast.success("Şifre güncellendi.");
      setDoneRequireChange(v.requireChange);
      setDone(true);
      form.reset({ password: "", confirm: "" });
    },
  });

  return (
    <form
      onSubmit={form.handleSubmit((v) => mutation.mutate({ password: v.password, requireChange }))}
      className="space-y-4"
    >
      <CredentialApprovalRequest error={mutation.error} userId={userId} kind="PASSWORD" />
      <ResetPasswordIntro username={username} />

      <FormField label="Yeni Şifre" htmlFor="password" error={form.formState.errors.password} required>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          autoFocus
          {...form.register("password")}
        />
      </FormField>

      <FormField label="Yeni Şifre (tekrar)" htmlFor="confirm" error={form.formState.errors.confirm} required>
        <Input id="confirm" type="password" autoComplete="new-password" {...form.register("confirm")} />
      </FormField>

      <RequireChangeField checked={requireChange} onChange={setRequireChange} />

      {done && <ResetDoneBanner requireChange={doneRequireChange} />}

      <div className="flex items-center justify-between border-t pt-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" /> Bu işlem audit log'a düşer.
        </div>
        <Button type="submit" size="sm" disabled={mutation.isPending}>
          {mutation.isPending ? "Sıfırlanıyor..." : "Şifreyi Sıfırla"}
        </Button>
      </div>
    </form>
  );
}

function ResetPasswordIntro({ username }: { username: string }) {
  return (
    <div className="flex gap-3 rounded-md border bg-card p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
        <KeyRound className="h-4 w-4" />
      </div>
      <div className="text-sm">
        <p className="font-medium">
          <span className="font-mono">{username}</span> için yeni şifre
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Eski şifre sorulmaz; yeni şifre en az {PASSWORD_MIN_LENGTH} karakter olmalı. Şifreyi kullanıcıya
          güvenli bir kanaldan ilet.
        </p>
      </div>
    </div>
  );
}

function RequireChangeField({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id="requireChange"
        checked={checked}
        onCheckedChange={(x) => onChange(x === true)}
        className="mt-0.5"
      />
      <label htmlFor="requireChange" className="cursor-pointer text-sm">
        Kullanıcı ilk girişte kendi parolasını belirlesin
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {checked
            ? "Yazdığınız parola geçicidir: kullanıcı ilk girişte (panel ya da tablet) kendi parolasını belirlemeden devam edemez."
            : "İşaretsiz: yazdığınız parola kalıcı olur; kullanıcı bu parolayla doğrudan girer, yeni parola istenmez."}
        </span>
      </label>
    </div>
  );
}

function ResetDoneBanner({ requireChange }: { requireChange: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 p-2 text-xs text-success">
      <CheckCircle2 className="h-3.5 w-3.5" />
      {requireChange
        ? "Şifre sıfırlandı. Kullanıcı geçici şifreyle girip kendi şifresini belirleyecek."
        : "Şifre sıfırlandı. Kullanıcı bu şifreyle doğrudan girecek."}
    </div>
  );
}
