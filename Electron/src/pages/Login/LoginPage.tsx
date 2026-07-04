import { useState } from "react";
import axios from "axios";
import { useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Moon, Settings, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { ApiEndpointDialog } from "@/components/settings/ApiEndpointDialog";
import { authService } from "@/services/authService";
import { tokenStore } from "@/lib/secure-token";
import { decodeJwt } from "@/lib/jwt";
import { readSessionConflict } from "@/lib/session-auth";
import { useAuthStore } from "@/store/auth";
import { canEnterApp, type ExistingSessionInfo } from "@/types/auth";
import { LoginHero } from "./LoginHero";
import logoUrl from "@/assets/teks-logo-fullsize.png";

/** 409 SESSION_EXISTS onay diyaloğu için, mevcut oturumu okunur cümleye çevir. */
function describeExistingSession(info: ExistingSessionInfo): string {
  const where = info.deviceType === "electron" ? "başka bir bilgisayarda" : "bir mobil cihazda";
  const when = info.createdAt
    ? ` (${new Date(info.createdAt).toLocaleString("tr-TR")}'de açıldı)`
    : "";
  return (
    `Bu hesap ${where} zaten açık${when}. Yine de giriş yapmak istiyor musunuz? ` +
    `İki oturum da açık kalacak.`
  );
}

const schema = z.object({
  username: z.string().min(1, "Kullanıcı adı gerekli"),
  password: z.string().min(1, "Şifre gerekli"),
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setUser = useAuthStore((s) => s.setUser);
  const [submitting, setSubmitting] = useState(false);
  const [apiDialogOpen, setApiDialogOpen] = useState(false);
  // 409 SESSION_EXISTS ('notify' politikası) — onay bekleyen çakışma bilgisi.
  const [conflict, setConflict] = useState<{ values: FormValues; existing: ExistingSessionInfo } | null>(null);
  const { theme, setTheme } = useTheme();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "" },
  });

  /**
   * Girişi dener. `confirmKick=true` → 'notify' politikasında kullanıcı "iki
   * oturum da açık kalsın" onayı verince tekrar çağrılır. Hata UX'ini bu fonksiyon
   * yönetir (`suppressErrorToast`): 401 (yanlış şifre) interceptor'ın özel dalında
   * zaten toast'lanır; 409 SESSION_EXISTS onay diyaloğunu açar; diğerleri burada.
   */
  const performLogin = async (values: FormValues, confirmKick: boolean) => {
    setSubmitting(true);
    try {
      const res = await authService.login(
        { ...values, confirmKick: confirmKick || undefined },
        { suppressErrorToast: true },
      );
      await tokenStore.set(res.data.token);
      const decoded = decodeJwt(res.data.token) ?? res.data.user;
      if (!canEnterApp(decoded.permissions)) {
        await tokenStore.clear();
        toast.error("Bu uygulamayı kullanma yetkin yok. Yöneticine başvur.");
        return;
      }
      setConflict(null);
      setUser(decoded);
      const dest = (location.state as { from?: { pathname?: string } })?.from?.pathname ?? "/";
      navigate(dest, { replace: true });
    } catch (err) {
      const existing = readSessionConflict(err);
      if (existing) {
        // 'notify': aynı hesap başka yerde açık — kullanıcıya sor, onaylarsa
        // confirmKick=true ile tekrar dene (iki oturum da açık kalır).
        setConflict({ values, existing });
        return;
      }
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      // 401 interceptor'da toast'landı; kalanları burada göster.
      if (status !== 401) {
        const message = axios.isAxiosError(err)
          ? ((err.response?.data as { message?: string } | undefined)?.message ??
            (err.response ? "Giriş yapılamadı." : "Sunucuya ulaşılamıyor."))
          : "Giriş yapılamadı.";
        toast.error(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = (values: FormValues) => performLogin(values, false);

  return (
    <div className="flex h-screen w-screen overflow-hidden app-drag">
      <LoginHero />

      <div className="relative flex w-full items-center justify-center bg-background p-10 app-no-drag md:w-[460px] md:shrink-0">
        <div className="absolute right-5 top-5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setApiDialogOpen(true)}
            aria-label="Sunucu adresi ayarları"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Tema değiştir"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition hover:text-foreground"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>

        <ApiEndpointDialog open={apiDialogOpen} onOpenChange={setApiDialogOpen} />

        <ConfirmDialog
          open={conflict !== null}
          onOpenChange={(o) => {
            if (!o) setConflict(null);
          }}
          title="Hesap başka yerde açık"
          description={conflict ? describeExistingSession(conflict.existing) : undefined}
          confirmLabel="Yine de giriş yap"
          cancelLabel="Vazgeç"
          isPending={submitting}
          onConfirm={() => {
            if (conflict) void performLogin(conflict.values, true);
          }}
        />

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
      </div>
    </div>
  );
}
