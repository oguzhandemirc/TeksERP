import type { UseFormReturn } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { upperTr } from "@/lib/tr-case";
import type { RememberedLogin } from "@/lib/remembered-login";
import type { LoginFormValues } from "./LoginForm";

/** Görünen addan (yoksa kullanıcı adından) baş harfler — Topbar'daki kuralla aynı bölme. */
function initialsOf(account: RememberedLogin): string {
  const name = account.displayName || account.username;
  const parts = name.split(/[.\s_-]+/).filter(Boolean);
  if (parts.length >= 2) return upperTr((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? ""));
  return upperTr(name.slice(0, 2));
}

export interface RememberedLoginFormProps {
  account: RememberedLogin;
  form: UseFormReturn<LoginFormValues>;
  submitting: boolean;
  onSubmit: (values: LoginFormValues) => void;
  onSwitchAccount: () => void;
  onForget: () => void;
}

/**
 * Hatırlanan hesap görünümü — yalnız parola sorulur. Kullanıcı adı formda (`setValue`)
 * durur; gizli alan yalnız parola yöneticileri içindir. Saf sunum, gönderim çağıranda.
 */
export function RememberedLoginForm({ account, form, submitting, onSubmit, onSwitchAccount, onForget }: RememberedLoginFormProps) {
  const title = account.displayName || account.username;
  return (
    <div className="w-full max-w-sm space-y-8" data-testid="remembered-login">
      <div className="flex flex-col items-center space-y-4 text-center">
        <span
          aria-hidden="true"
          className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-2xl font-semibold text-primary-foreground shadow-lg"
        >
          {initialsOf(account)}
        </span>
        <div className="min-w-0 max-w-full space-y-1">
          <h2 className="truncate text-2xl font-semibold tracking-tight">{title}</h2>
          <p className="truncate text-sm text-muted-foreground">{account.username}</p>
        </div>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <input type="text" name="username" autoComplete="username" value={account.username} readOnly hidden />
        <FormField label="Şifre" htmlFor="password" error={form.formState.errors.password} required>
          <Input
            id="password"
            type="password"
            autoFocus
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

      <div className="flex flex-col items-center gap-2 text-sm">
        <Button type="button" variant="link" className="h-auto p-0" onClick={onSwitchAccount} disabled={submitting}>
          Başka hesapla giriş yap
        </Button>
        <button
          type="button"
          onClick={onForget}
          disabled={submitting}
          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
        >
          Bu hesabı unut
        </button>
      </div>
    </div>
  );
}
