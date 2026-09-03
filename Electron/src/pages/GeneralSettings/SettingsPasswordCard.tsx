import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/store/auth";
import { FEATURE_FLAGS_QUERY_KEY } from "@/hooks/usePricingEnabled";
import {
  settingsPasswordAdminService,
  SETTINGS_PASSWORD_MIN_LENGTH,
  SETTINGS_PASSWORD_MAX_LENGTH,
  SETTINGS_PASSWORD_CHARSET,
} from "@/services/systemSettingService";

/**
 * AYAR ŞİFRESİ — SATICI (SÜPERADMİN) KARTI.
 *
 * Tasarım §7.2: şifreyi süperadmin üretir/değiştirir/iptal eder; fabrika
 * yöneticisi onu yalnız GİRER. Kart bu yüzden yalnız `isSystemAccount`
 * hesabında çizilir — backend uçları zaten başka kimlikte **404** döner
 * (403 ucun varlığını doğrulardı), yani düğmeyi göstermek işe yaramayan bir
 * yüzey vaat etmek olurdu.
 *
 * ⚠️ SUPAP YOK (Modüller toggle'larının aksine): sistem hesabı doğmamış bir
 * kurulumda özellik ERİŞİLEMEZDİR ve bu bilinçlidir — orada kapı da uyur,
 * yani kilitlenme riski yoktur. Fabrikaya "kendi ayar şifresini kur" demek,
 * korumanın kimden korunduğunu tersine çevirirdi.
 */
export function SettingsPasswordCard() {
  const isSystemAccount = useAuthStore((s) => s.isSystemAccount);
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  /** "Kaldır" iki adımlı — kapıyı tek tıkla uyutmak kaza olurdu. */
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const statusQ = useQuery({
    queryKey: ["settings-password-status"],
    queryFn: settingsPasswordAdminService.status,
    enabled: isSystemAccount,
  });
  const configured = statusQ.data?.data?.configured ?? false;

  const afterChange = () => {
    setPassword("");
    setRepeat("");
    setConfirmRevoke(false);
    void qc.invalidateQueries({ queryKey: ["settings-password-status"] });
    // Kilit ikonunu besleyen alan bu yükte gelir — bayat kalmasın.
    void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
  };

  const saveMut = useMutation({
    mutationFn: () => settingsPasswordAdminService.set(password),
    onSuccess: (res) => {
      toast.success(res.data?.rotated ? "Ayar şifresi değiştirildi." : "Ayar şifresi tanımlandı.");
      afterChange();
    },
  });

  const revokeMut = useMutation({
    mutationFn: () => settingsPasswordAdminService.revoke(),
    onSuccess: () => {
      toast.success("Ayar şifresi kaldırıldı — kayıtlarda artık sorulmaz.");
      afterChange();
    },
  });

  if (!isSystemAccount) return null;

  const busy = saveMut.isPending || revokeMut.isPending;
  const tooShort = password.length > 0 && password.length < SETTINGS_PASSWORD_MIN_LENGTH;
  const tooLong = password.length > SETTINGS_PASSWORD_MAX_LENGTH;
  // ⚠️ ANLIK UYARI, KAYITTA SÜRPRİZ DEĞİL: sunucu bu şifreyi zaten 400 ile
  // reddediyor; kart uyarmasaydı süperadmin sebebini ("neden geçersiz?")
  // yalnız hata mesajından öğrenirdi. Daha kötüsü, denetim ÖNCE yoktu: şifre
  // KABUL EDİLİYOR ama hiçbir istemci başlıkla taşıyamıyordu.
  const badCharset = password.length > 0 && !SETTINGS_PASSWORD_CHARSET.test(password);
  const mismatch = repeat.length > 0 && repeat !== password;
  const canSave =
    password.length >= SETTINGS_PASSWORD_MIN_LENGTH &&
    password.length <= SETTINGS_PASSWORD_MAX_LENGTH &&
    SETTINGS_PASSWORD_CHARSET.test(password) &&
    repeat === password &&
    !busy;

  return (
    <section className="mt-8 rounded-md border p-4">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Ayar şifresi</h3>
        <span className="ml-auto text-xs text-muted-foreground">
          {configured ? "Tanımlı" : "Tanımlı değil"}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Tanımlıyken bayrak/ayar kaydeden herkese (satıcı hesabı hariç) her
        kayıtta bu şifre sorulur — açık kalmış bir yönetici oturumundan ayar
        değiştirilmesin diye. Kaldırılırsa kapı uyur, hiçbir istek şifre
        istemez. ⚠️ Unutulursa fabrikanın kendi sıfırlama yolu YOKTUR; yalnız
        buradan yenilenir. Şifre {SETTINGS_PASSWORD_MIN_LENGTH}–
        {SETTINGS_PASSWORD_MAX_LENGTH} karakter, boşluksuz ve Türkçe karaktersiz
        olmalıdır.
      </p>

      <div className="mt-4 grid gap-3 sm:max-w-sm">
        <div className="space-y-1.5">
          <Label htmlFor="sp-new">{configured ? "Yeni şifre" : "Şifre"}</Label>
          <Input
            id="sp-new"
            type="password"
            autoComplete="new-password"
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
          />
          {tooShort && (
            <p className="text-xs text-destructive">
              En az {SETTINGS_PASSWORD_MIN_LENGTH} karakter olmalı.
            </p>
          )}
          {tooLong && (
            <p className="text-xs text-destructive">
              En fazla {SETTINGS_PASSWORD_MAX_LENGTH} karakter olabilir (şifreleme sınırı).
            </p>
          )}
          {badCharset && (
            <p className="text-xs text-destructive">
              Türkçe karakter (ş, ğ, ü, ö, ç, ı) ve boşluk kullanılamaz — şifre
              istekle birlikte başlıkta taşındığı için yalnız boşluksuz İngiliz
              alfabesi, rakam ve noktalama kabul edilir.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sp-repeat">Tekrar</Label>
          <Input
            id="sp-repeat"
            type="password"
            autoComplete="new-password"
            value={repeat}
            disabled={busy}
            onChange={(e) => setRepeat(e.target.value)}
          />
          {mismatch && <p className="text-xs text-destructive">Şifreler aynı değil.</p>}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" disabled={!canSave} onClick={() => saveMut.mutate()}>
          {configured ? "Değiştir" : "Tanımla"}
        </Button>
        {configured &&
          (confirmRevoke ? (
            <>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => revokeMut.mutate()}
              >
                Evet, kaldır — kapı uyusun
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setConfirmRevoke(false)}
              >
                Vazgeç
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={busy}
              onClick={() => setConfirmRevoke(true)}
            >
              Kaldır
            </Button>
          ))}
      </div>
    </section>
  );
}
