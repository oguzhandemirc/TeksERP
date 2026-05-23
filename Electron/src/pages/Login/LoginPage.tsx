import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { authService } from "@/services/authService";
import { tokenStore } from "@/lib/secure-token";
import { decodeJwt } from "@/lib/jwt";
import { useAuthStore } from "@/store/auth";
import { canEnterApp } from "@/types/auth";
import { LoginHero } from "./LoginHero";
import logoUrl from "@/assets/teks-logo.png";

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
  const { theme, setTheme } = useTheme();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "" },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const res = await authService.login(values);
      await tokenStore.set(res.data.token);
      const decoded = decodeJwt(res.data.token) ?? res.data.user;
      if (!canEnterApp(decoded.permissions)) {
        await tokenStore.clear();
        toast.error("Bu uygulamayı kullanma yetkin yok. Yöneticine başvur.");
        return;
      }
      setUser(decoded);
      const dest = (location.state as { from?: { pathname?: string } })?.from?.pathname ?? "/";
      navigate(dest, { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden app-drag">
      <LoginHero />

      <div className="relative flex w-full items-center justify-center bg-background p-10 app-no-drag md:w-[460px] md:shrink-0">
        <button
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Tema değiştir"
          className="absolute right-5 top-5 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition hover:text-foreground"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <div className="w-full max-w-sm space-y-8">
          <div className="flex flex-col items-center space-y-4 text-center">
            <div className="relative">
              <div className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-blue-500/20 via-indigo-500/15 to-teal-500/20 blur-2xl" />
              <img src={logoUrl} alt="TeksERP" className="h-24 w-24 object-contain" />
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
