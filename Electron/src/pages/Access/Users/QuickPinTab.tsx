import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dices, KeySquare, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminUserService } from "@/services/adminUserService";

interface Props {
  userId: string;
  username: string;
}

/**
 * Hızlı PIN — SALT-PIN girişi için ("Hızlı PIN" yöntemi etkinken): kullanıcı
 * seçme yok, PIN tek başına kimliği belirler → sistem genelinde BENZERSİZ olmalı.
 * Elle atanabilir (başkasında varsa net 409) veya çakışmayan rastgele üretilir.
 * PIN yalnız atama anında gösterilir; kaldırmak salt-PIN girişini kapatır
 * (şifre/kart etkilenmez).
 */
export function QuickPinTab({ userId, username }: Props) {
  const [manualPin, setManualPin] = useState("");
  const [lastPin, setLastPin] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (input: { pin?: string; clear?: boolean }) =>
      adminUserService.setQuickPin(userId, input),
    onSuccess: (res, vars) => {
      if (vars.clear) {
        setLastPin(null);
        toast.success("Hızlı PIN kaldırıldı — bu kullanıcı salt-PIN ile giremez");
      } else {
        setLastPin(res.data.pin);
        setManualPin("");
        toast.success("Hızlı PIN atandı — kullanıcıya güvenli şekilde iletin");
      }
    },
  });

  const manualValid = /^\d{6}$/.test(manualPin);

  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-md border bg-card p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <KeySquare className="h-4 w-4" />
        </div>
        <div className="text-sm">
          <p className="font-medium">
            <span className="font-mono">{username}</span> için hızlı PIN
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            "Hızlı PIN" giriş yöntemi etkinken operatör kullanıcı seçmeden yalnız bu
            PIN'le girer — bu yüzden PIN <b>kişiye özel ve benzersizdir</b> (aynı PIN iki
            kullanıcıya verilemez). Şifreden ayrıdır; yalnız atama anında gösterilir.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="mb-1 block font-medium">Elle PIN (6 hane)</span>
          <Input
            value={manualPin}
            onChange={(e) => setManualPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="424242"
            inputMode="numeric"
            className="h-9 w-32 font-mono"
          />
        </label>
        <Button
          type="button"
          size="sm"
          disabled={!manualValid || mutation.isPending}
          onClick={() => mutation.mutate({ pin: manualPin })}
        >
          Ata
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({})}
        >
          <Dices className="h-3.5 w-3.5" /> Rastgele Üret
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ clear: true })}
        >
          <Trash2 className="h-3.5 w-3.5" /> Kaldır
        </Button>
      </div>

      {lastPin && (
        <div className="rounded-md border bg-muted/20 p-4 text-center">
          <div className="text-xs text-muted-foreground">Atanan hızlı PIN — kullanıcıya iletin</div>
          <div className="mt-1 font-mono text-3xl font-bold tracking-[0.3em]">{lastPin}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Bu PIN bir daha gösterilmez; unutulursa yeni PIN atayın (eskisi geçersiz olur).
          </div>
        </div>
      )}
    </div>
  );
}
