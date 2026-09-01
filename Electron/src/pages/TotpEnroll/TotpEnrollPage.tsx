import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, ShieldAlert, ShieldPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { totpEnrollService } from "@/services/totpEnrollService";
import { RecoveryCodesPanel } from "./RecoveryCodesPanel";

/**
 * İKİ ADIMLI DOĞRULAMA KURULUM SAYFASI — oturum GEREKTİRMEZ.
 *
 * Bu sayfayı açan kişi tanımı gereği henüz GİREMEYEN kişidir (uzaktan giriş
 * TOTP olmadan reddediliyor, TOTP de burada kuruluyor). Koruma kimlik değil,
 * URL'deki tek kullanımlık token'dır — yalnız `admin:users` taşıyan biri
 * üretebilir ve 15 dakika yaşar.
 *
 * ⚠️ SIR EKRANDA GÖSTERİLİR ama bu kaçınılmaz: QR'ın kendisi sırdır. Riski
 * daraltan şey pencerenin kısalığı ve tek kullanımlık olmasıdır.
 */
export function TotpEnrollPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [code, setCode] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const infoQ = useQuery({
    queryKey: ["totp-enroll", token],
    queryFn: () => totpEnrollService.read(token),
    enabled: token.length > 0,
    retry: false,
  });

  const consumeMut = useMutation({
    mutationFn: () => totpEnrollService.consume(token, code.trim()),
  });

  // ── Kurulum bitti → kurtarma kodları ────────────────────────────────────
  if (consumeMut.isSuccess) {
    return (
      <Shell>
        <RecoveryCodesPanel
          username={consumeMut.data.data.username}
          codes={consumeMut.data.data.recoveryCodes}
          acknowledged={acknowledged}
          onAcknowledgedChange={setAcknowledged}
          onDone={() => navigate("/login", { replace: true })}
        />
      </Shell>
    );
  }

  // ── Token yok / geçersiz / süresi dolmuş ────────────────────────────────
  // ⚠️ TEK MESAJ: "süresi doldu" ile "hiç yoktu" ayrımı, token tahmin eden
  // birine geri bildirim verirdi. Kullanıcı için de fark yok — ikisinde de
  // yapılacak şey aynı: yöneticiden yeni bağlantı istemek.
  if (!token || infoQ.isError) {
    return (
      <Shell>
        <div className="w-full max-w-sm space-y-5 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[20px] bg-amber-500/10">
            <ShieldAlert className="h-8 w-8 text-amber-500" />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Bağlantı geçersiz</h2>
          <p className="text-sm text-muted-foreground">
            Kurulum bağlantısı kullanılmış ya da süresi dolmuş olabilir. Sistem
            yöneticinden yeni bir bağlantı iste.
          </p>
          <Button variant="outline" className="w-full" onClick={() => navigate("/login")}>
            Giriş ekranına dön
          </Button>
        </div>
      </Shell>
    );
  }

  if (infoQ.isLoading || !infoQ.data) {
    return (
      <Shell>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Shell>
    );
  }

  const info = infoQ.data.data;
  const trimmed = code.trim();

  return (
    <Shell>
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center space-y-3 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-muted">
            <ShieldPlus className="h-8 w-8" />
          </div>
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight">İki adımlı doğrulama</h2>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{info.username}</span> hesabı için
              kurulum
            </p>
          </div>
        </div>

        <ol className="space-y-3 text-sm">
          <li className="flex gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
              1
            </span>
            <span className="text-muted-foreground">
              Telefonuna bir doğrulama uygulaması kur (Google Authenticator, Microsoft
              Authenticator ya da benzeri).
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
              2
            </span>
            <span className="text-muted-foreground">Aşağıdaki kareyi uygulamayla okut.</span>
          </li>
        </ol>

        <div className="flex flex-col items-center gap-3">
          <div className="rounded-lg bg-white p-4">
            <QRCodeSVG value={info.otpauthUri} size={180} />
          </div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Kareyi okutamıyorum</summary>
            <p className="mt-2">
              Uygulamaya elle şu anahtarı gir:
              <br />
              <code className="mt-1 inline-block rounded bg-muted px-2 py-1 font-mono tracking-wider">
                {info.secret}
              </code>
            </p>
          </details>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed) consumeMut.mutate();
          }}
          className="space-y-3"
        >
          <p className="text-sm">
            <span className="flex items-center gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                3
              </span>
              Uygulamada görünen 6 haneli kodu gir:
            </span>
          </p>
          <Input
            autoFocus
            type="text"
            inputMode="numeric"
            placeholder="123456"
            aria-label="Doğrulama kodu"
            aria-invalid={consumeMut.isError}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={`text-center text-2xl tracking-[0.4em] ${
              consumeMut.isError ? "border-destructive" : ""
            }`}
          />
          {consumeMut.isError && (
            <p className="text-center text-sm text-destructive">
              Kod doğrulanamadı. Uygulamadaki güncel kodu gir (kodlar 30 saniyede bir
              değişir).
            </p>
          )}
          <Button type="submit" className="w-full" disabled={consumeMut.isPending || !trimmed}>
            {consumeMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Kurulumu tamamla
          </Button>
        </form>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-6">
      {children}
    </div>
  );
}
