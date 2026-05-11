import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { adminUserService } from "@/services/adminUserService";

interface Props {
  userId: string;
  username: string;
}

const schema = z
  .object({
    password: z.string().min(6, "En az 6 karakter"),
    confirm: z.string().min(6, "En az 6 karakter"),
  })
  .refine((d) => d.password === d.confirm, {
    path: ["confirm"],
    message: "Şifreler eşleşmiyor",
  });

type FormValues = z.infer<typeof schema>;

export function ResetPasswordTab({ userId, username }: Props) {
  const [done, setDone] = useState(false);
  const form = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any) as unknown as Resolver<FormValues>,
    defaultValues: { password: "", confirm: "" },
  });

  const password = form.watch("password");
  useEffect(() => {
    if (done) setDone(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  const mutation = useMutation({
    mutationFn: (newPassword: string) => adminUserService.resetPassword(userId, newPassword),
    onSuccess: () => {
      toast.success("Şifre güncellendi.");
      setDone(true);
      form.reset({ password: "", confirm: "" });
    },
  });

  return (
    <form
      onSubmit={form.handleSubmit((v) => mutation.mutate(v.password))}
      className="space-y-4"
    >
      <div className="flex gap-3 rounded-md border bg-card p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <KeyRound className="h-4 w-4" />
        </div>
        <div className="text-sm">
          <p className="font-medium">
            <span className="font-mono">{username}</span> için yeni şifre
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Eski şifre sorulmaz. Kullanıcıya yeni şifreyi güvenli bir kanaldan ileteceğini unutma.
          </p>
        </div>
      </div>

      <FormField label="Yeni Şifre" htmlFor="password" error={form.formState.errors.password} required>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          autoFocus
          {...form.register("password")}
        />
      </FormField>

      <FormField
        label="Yeni Şifre (tekrar)"
        htmlFor="confirm"
        error={form.formState.errors.confirm}
        required
      >
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          {...form.register("confirm")}
        />
      </FormField>

      {done && (
        <div className="flex items-center gap-2 rounded-md border border-green-500/40 bg-green-500/10 p-2 text-xs text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Şifre başarıyla güncellendi. Kullanıcı yeni şifreyle giriş yapabilir.
        </div>
      )}

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
