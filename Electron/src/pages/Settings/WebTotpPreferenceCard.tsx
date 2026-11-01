// Kullanıcı Tercihleri → "İnternetten giriş" kartı (2026-11-01). Politika USER_CHOICE iken kullanıcı
// KENDİ hesabında web girişi kodunu kapatır (parola + kuruluysa kod) ya da geri açar (serbest).
// Eski backend (404) ya da sistem hesabı → kart çizilmez; REQUIRED'da yalnız saklı tercih varsa görünür.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { authService } from "@/services/authService";
import { apiErrorText } from "@/lib/api-error";

const QUERY_KEY = ["auth-web-totp"];

export function WebTotpPreferenceCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: QUERY_KEY, queryFn: authService.getWebTotp, retry: false });
  const [closing, setClosing] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const mut = useMutation({
    mutationFn: authService.setWebTotp,
    onSuccess: (res) => {
      qc.setQueryData(QUERY_KEY, res);
      setClosing(false);
      setPassword("");
      setCode("");
      toast.success(res.data.optOut ? "Doğrulama kodu internetten girişte artık istenmeyecek." : "Doğrulama kodu yeniden açıldı.");
    },
    onError: (e) => toast.error(apiErrorText(e, "Tercih kaydedilemedi.")),
  });

  const s = q.data?.data;
  if (!s || !s.canChange) return null;
  if (s.policy === "REQUIRED" && !s.optOut) return null;

  const asking = !s.optOut;
  return (
    <Card data-testid="web-totp-tercih-karti">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {s.effective ? <ShieldAlert className="h-4 w-4 text-destructive" /> : <ShieldCheck className="h-4 w-4" />}
          İnternetten giriş
        </CardTitle>
        <CardDescription>
          Web panelinde (tarayıcıdan) girişte doğrulama kodu. Masaüstü ve tablet girişini etkilemez.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {s.policy === "REQUIRED" && (
          <p className="text-xs text-muted-foreground">
            Bu kurulumda doğrulama kodu herkese zorunlu — kayıtlı tercihiniz şu an etkisiz.
          </p>
        )}
        {s.effective && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive" role="alert">
            Hesabınız internetten yalnız parolayla açılabilir.
          </p>
        )}
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>İnternetten girişte doğrulama kodu iste</span>
          <Switch
            checked={asking && !closing}
            disabled={mut.isPending || (asking && s.policy !== "USER_CHOICE")}
            onCheckedChange={(on) => {
              if (on) {
                if (closing) setClosing(false);
                else mut.mutate({ optOut: false });
              } else {
                setClosing(true);
              }
            }}
          />
        </label>
        {closing && (
          <form
            className="space-y-2 rounded-md border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              mut.mutate({ optOut: true, currentPassword: password, ...(s.totpEnabled ? { totpCode: code } : {}) });
            }}
          >
            <p className="text-xs text-muted-foreground">
              Kapatmak için kimliğinizi doğrulayın. Önerilmez: parolanızı ele geçiren biri internetten girebilir.
            </p>
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="Mevcut parola"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {s.totpEnabled && (
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Doğrulama kodu"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="destructive" disabled={mut.isPending || !password || (s.totpEnabled && !code)}>
                Kodu kapat
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setClosing(false)}>
                Vazgeç
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
