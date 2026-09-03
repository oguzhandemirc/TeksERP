import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  registerSettingsPasswordAsker,
  type SettingsPasswordAsker,
} from "@/lib/settings-password";

/**
 * AYAR ŞİFRESİ SORUSU — App düzeyinde TEK mount (`App.tsx`).
 *
 * `withSettingsPassword` bir 403 `SETTINGS_PASSWORD_REQUIRED`/`_INVALID`
 * gördüğünde bu diyaloğu açar ve girilen şifreyle isteği tekrarlar. Emsal:
 * `ApiEndpointDialog` (tek bileşen, birden çok yerden açılır) — fark, bunun
 * çağıranı bir KULLANICI JESTİ değil bir SUNUCU YANITI olması, o yüzden
 * açılışı bir prop değil kayıtlı bir "sorucu" tetikler.
 *
 * ⚠️ ŞİFRE STATE'TEN ÇIKMAZ: kapanışta temizlenir, hiçbir store'a/diske
 * yazılmaz ve oturumda HATIRLANMAZ (tasarım §7.2: "her değişiklikte sorar").
 */
export function SettingsPasswordDialog() {
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [value, setValue] = useState("");
  /** Bekleyen isteğin cevap kanalı — cevaplanmadan kapanış = iptal. */
  const resolveRef = useRef<((password: string | null) => void) | null>(null);

  const ask = useCallback<SettingsPasswordAsker>(({ invalid: wasInvalid }) => {
    return new Promise<string | null>((resolve) => {
      // Uçuşta başka bir soru varsa onu İPTAL et (iki diyalog üst üste binmesin;
      // cevapsız bırakmak çağıranı sonsuza dek asılı bırakırdı).
      resolveRef.current?.(null);
      resolveRef.current = resolve;
      setInvalid(wasInvalid);
      setValue("");
      setOpen(true);
    });
  }, []);

  useEffect(() => {
    registerSettingsPasswordAsker(ask);
    return () => registerSettingsPasswordAsker(null);
  }, [ask]);

  const answer = (password: string | null) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setOpen(false);
    setValue("");
    resolve?.(password);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Dışarı tıklama / ESC de İPTALDİR — bekleyen istek asılı kalmaz.
        if (!next) answer(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Ayar şifresi
          </DialogTitle>
          <DialogDescription>
            Bu değişiklik için ayar şifresi gerekli. Şifreyi sistem yöneticiniz
            (yazılım firması) belirler; her kayıtta yeniden sorulur.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.length > 0) answer(value);
          }}
        >
          <Label htmlFor="settings-password">Şifre</Label>
          <Input
            id="settings-password"
            type="password"
            autoFocus
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          {invalid && (
            <p className="text-xs font-medium text-destructive">
              Ayar şifresi hatalı. Tekrar deneyin.
            </p>
          )}
          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={() => answer(null)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={value.length === 0}>
              Onayla
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
