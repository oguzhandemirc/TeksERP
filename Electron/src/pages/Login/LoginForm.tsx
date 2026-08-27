import type { UseFormReturn } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import logoUrl from "@/assets/teks-logo-fullsize.png";

/**
 * Giriş formu — `LoginPage`'ten AYRILDI (sayfa 200 satır kuralını aşıyordu).
 * Saf sunum: kendi state'i yok, gönderim ve hata yönetimi çağıranda kalır.
 */
export interface LoginFormValues {
  username: string;
  password: string;
}

export interface LoginFormProps {
  form: UseFormReturn<LoginFormValues>;
  submitting: boolean;
  onSubmit: (values: LoginFormValues) => void;
}

export function LoginForm({ form, submitting, onSubmit }: LoginFormProps) {
  return (
    <div className="w-full max-w-sm space-y-8">
      <div className="flex flex-col items-center space-y-4 text-center">
        <div className="relative">
          <div className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-blue-500/20 via-indigo-500/15 to-teal-500/20 blur-2xl" />
          <img
            src={logoUrl}
            alt="TeksERP"
            className="h-24 w-24 rounded-[22px] object-cover shadow-lg ring-1 ring-white/10"
          />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-3xl font-semibold tracking-tight">TeksERP</h2>
          <p className="text-sm text-muted-foreground">
            Devam etmek için giriş yap.
          </p>
        </div>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          label="Kullanıcı adı"
          htmlFor="username"
          error={form.formState.errors.username}
          required
        >
          <Input
            id="username"
            autoFocus
            autoComplete="username"
            placeholder="ör. admin"
            {...form.register("username")}
          />
        </FormField>
        <FormField
          label="Şifre"
          htmlFor="password"
          error={form.formState.errors.password}
          required
        >
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            {...form.register("password")}
          />
        </FormField>
        <Button type="submit" className="h-11 w-full" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Giriş yapılıyor...
            </>
          ) : (
            "Giriş Yap"
          )}
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        Hesap erişimi için yöneticinizle iletişime geçin.
      </p>
    </div>
  );
}
