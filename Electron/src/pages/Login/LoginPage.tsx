import { useState } from "react";
import { toast } from "sonner";
import { Moon, Settings, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { SurumRozeti } from "@/components/SurumRozeti";
import { ApiEndpointDialog } from "@/components/settings/ApiEndpointDialog";
import { connectToDiscoveredServer } from "@/lib/server-identity";
import { useLoginFlow, type LoginFormValues } from "./useLoginFlow";
import { LoginForm } from "./LoginForm";
import { TotpStep } from "./TotpStep";
import { TotpEnrollmentNotice } from "./TotpEnrollmentNotice";
import { ServerNotFoundPanel } from "./ServerNotFoundPanel";
import { ServerIdentityMismatchDialog } from "@/components/settings/ServerIdentityMismatchDialog";
import { useServerReachability } from "@/hooks/useServerReachability";
import type { DiscoveredServer } from "@shared/ipc-contract";
import { IS_ELECTRON } from "@/lib/runtime-env";
import type { ExistingSessionInfo } from "@/types/auth";
import { LoginHero } from "./LoginHero";

/** 409 SESSION_EXISTS onay diyaloğu için, mevcut oturumu okunur cümleye çevir. */
function describeExistingSession(info: ExistingSessionInfo): string {
  // ⚠️ ÜÇ DEĞERLİ: `web` eklendiğinde (2026-09-01) iki dallı ifade onu sessizce
  // "mobil cihaz" diye gösteriyordu — bu repoda beş kez yaşanan "unutulmuş enum
  // değeri" sınıfı. Kayıt (Record) biçimi, dördüncü değer eklenirse TS'in
  // eksikliği DERLEMEDE söylemesini sağlar.
  const WHERE: Record<ExistingSessionInfo["deviceType"], string> = {
    electron: "başka bir bilgisayarda",
    web: "bir tarayıcıda",
    mobile: "bir mobil cihazda",
  };
  const where = WHERE[info.deviceType] ?? "başka bir cihazda";
  const when = info.createdAt
    ? ` (${new Date(info.createdAt).toLocaleString("tr-TR")}'de açıldı)`
    : "";
  return (
    `Bu hesap ${where} zaten açık${when}. Yine de giriş yapmak istiyor musunuz? ` +
    `İki oturum da açık kalacak.`
  );
}

export function LoginPage() {
  const {
    form,
    submitting,
    conflict,
    setConflict,
    totp,
    setTotp,
    enrollmentNeeded,
    setEnrollmentNeeded,
    performLogin,
  } = useLoginFlow();
  const [apiDialogOpen, setApiDialogOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const reach = useServerReachability();
  const [mismatch, setMismatch] = useState<DiscoveredServer | null>(null);

  const onSubmit = (values: LoginFormValues) => performLogin(values, false);

  return (
    <div className="app-viewport flex w-screen overflow-hidden">
      <LoginHero />

      <div className="relative flex w-full items-center justify-center bg-background p-10 md:w-[460px] md:shrink-0">
        <div className="absolute right-5 top-5 flex items-center gap-2">
          {IS_ELECTRON && (
            <button
              type="button"
              onClick={() => setApiDialogOpen(true)}
              aria-label="Sunucu adresi ayarları"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition hover:text-foreground"
            >
              <Settings className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Tema değiştir"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition hover:text-foreground"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>

        {IS_ELECTRON && <ApiEndpointDialog open={apiDialogOpen} onOpenChange={setApiDialogOpen} />}

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
              // Kimliği sabitlemek YETMEZ — adresi de uygula, yoksa recheck eski
              // (ölü) adresi prob eder ve aynı "ulaşılamadı" ekranı geri gelir.
              await connectToDiscoveredServer(c, { trustIdentity: true });
              setMismatch(null);
              toast.success("Sunucuya bağlanıldı.", { description: c.baseUrl });
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
        ) : enrollmentNeeded ? (
          <TotpEnrollmentNotice
            onBack={() => {
              setEnrollmentNeeded(false);
              form.resetField("password");
            }}
          />
        ) : totp ? (
          <TotpStep
            submitting={submitting}
            invalid={totp.invalid}
            onSubmit={(code) => void performLogin(totp.values, false, code)}
            onCancel={() => {
              setTotp(null);
              // Şifreyi TEMİZLE: kullanıcı geri döndüyse ya yanlış hesapla
              // giriyordu ya vazgeçti; dolu bir şifre alanı bırakmak, ortak
              // kullanılan bir makinede sonraki kişiye açık kapı olurdu.
              form.resetField("password");
            }}
          />
        ) : (
        <LoginForm form={form} submitting={submitting} onSubmit={onSubmit} />
        )}
      </div>
      <SurumRozeti />
    </div>
  );
}
