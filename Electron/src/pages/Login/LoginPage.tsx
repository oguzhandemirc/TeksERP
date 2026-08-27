import { useState } from "react";
import axios from "axios";
import { useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Moon, Settings, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { ApiEndpointDialog } from "@/components/settings/ApiEndpointDialog";
import { authService } from "@/services/authService";
import { tokenStore } from "@/lib/secure-token";
import { decodeJwt } from "@/lib/jwt";
import { readSessionConflict } from "@/lib/session-auth";
import { pinServerIdentityAfterLogin } from "@/lib/server-identity";
import { LoginForm } from "./LoginForm";
import { ServerNotFoundPanel } from "./ServerNotFoundPanel";
import { ServerIdentityMismatchDialog } from "@/components/settings/ServerIdentityMismatchDialog";
import { useServerReachability } from "@/hooks/useServerReachability";
import type { DiscoveredServer } from "@shared/ipc-contract";
import { useAuthStore } from "@/store/auth";
import { canEnterApp, type ExistingSessionInfo } from "@/types/auth";
import { LoginHero } from "./LoginHero";

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
      // Kimlik sabitleme: insan bu sunucuya GİRDİ, yani "bu benim sunucum" dedi.
      // Bundan sonraki keşiflerde kimlik tutmazsa kullanıcıya sorulur.
      void pinServerIdentityAfterLogin();
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
      // 401 ve login-403 interceptor'da toast'landı; kalanları burada göster.
      if (status !== 401 && status !== 403) {
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

  const reach = useServerReachability();
  const [mismatch, setMismatch] = useState<DiscoveredServer | null>(null);

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

        <ServerIdentityMismatchDialog
          open={mismatch !== null}
          candidate={mismatch}
          onCancel={() => setMismatch(null)}
          onTrust={(c) => {
            void (async () => {
              await window.api?.discovery?.pin(c.identity?.installationId ?? null);
              setMismatch(null);
              await reach.recheck();
            })();
          }}
        />

        {/* Sunucuya ulaşılamıyorsa giriş formu YERİNE sebebi ve çözümü göster —
            boş bir form kullanıcıyı adını yanlış yazmakla suçlar. */}
        {reach.status === "unreachable" ? (
          <ServerNotFoundPanel
            onResolved={() => void reach.recheck()}
            onOpenAddressDialog={() => setApiDialogOpen(true)}
            onMismatch={setMismatch}
          />
        ) : (
        <LoginForm form={form} submitting={submitting} onSubmit={onSubmit} />
        )}
      </div>
    </div>
  );
}
