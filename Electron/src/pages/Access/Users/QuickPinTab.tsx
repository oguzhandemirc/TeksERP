import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Dices, KeySquare, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { useEnabledLoginMethods } from "@/hooks/usePricingEnabled";
import { formatFactory } from "@/lib/factory-time";
import { adminUserService } from "@/services/adminUserService";
import { MethodDisabledNotice } from "./MethodDisabledNotice";

interface Props {
  userId: string;
  username: string;
}

/**
 * Hızlı PIN — SALT-PIN girişi için (PIN tek başına kimliği belirler → sistem genelinde benzersiz).
 * Sunucu PIN'i geri çevrilemez ÖZET olarak saklar: yeni PIN yalnız verildiği an (ve kısa basım
 * penceresinde) gösterilir; sonradan okunamaz, yalnız yenilenir.
 */
export function QuickPinTab({ userId, username }: Props) {
  const qc = useQueryClient();
  const methodEnabled = useEnabledLoginMethods().includes("pin");
  const [manualPin, setManualPin] = useState("");
  const [issuedPin, setIssuedPin] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "random" | "manual" | "clear" }>(null);

  const credQ = useQuery({
    queryKey: ["admin-user-credentials", userId],
    queryFn: () => adminUserService.getCredentials(userId),
  });
  const cred = credQ.data?.data;
  const pinSet = cred?.quickPinSet ?? false;
  // Basım penceresindeki değer (yeni verilmiş) ya da bu oturumda az önce verilen.
  const visiblePin = issuedPin ?? (cred?.quickPinRevealed ? cred.quickPin : null);

  const mutation = useMutation({
    mutationFn: (input: { pin?: string; clear?: boolean }) => adminUserService.setQuickPin(userId, input),
    onSuccess: (res, vars) => {
      setConfirm(null);
      setManualPin("");
      setIssuedPin(vars.clear ? null : res.data.pin);
      toast.success(
        vars.clear
          ? "Hızlı PIN kaldırıldı — bu kullanıcı salt-PIN ile giremez"
          : "Hızlı PIN verildi — şimdi not edin, sonradan gösterilmez",
      );
      void qc.invalidateQueries({ queryKey: ["admin-user-credentials", userId] });
    },
  });

  if (credQ.isLoading) return <Skeleton className="h-56 w-full" />;

  const manualValid = /^\d{6}$/.test(manualPin);

  const runConfirmed = () => {
    if (!confirm) return;
    if (confirm.kind === "random") mutation.mutate({});
    else if (confirm.kind === "manual") mutation.mutate({ pin: manualPin });
    else mutation.mutate({ clear: true });
  };

  return (
    <div className="space-y-4">
      {!methodEnabled && <MethodDisabledNotice label="Hızlı PIN" />}
      <div className="flex gap-3 rounded-md border bg-card p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <KeySquare className="h-4 w-4" />
        </div>
        <div className="text-sm">
          <p className="font-medium">
            <span className="font-mono">{username}</span> için hızlı PIN
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            "Hızlı PIN" giriş yöntemi etkinken operatör kullanıcı seçmeden yalnız bu PIN'le
            girer — bu yüzden <b>kişiye özel ve benzersizdir</b>. PIN sunucuda geri çevrilemez
            şekilde saklanır: <b>yalnız verildiği an gösterilir</b>; unutulursa yenisi verilir.
          </p>
        </div>
      </div>

      <div className="rounded-md border bg-muted/20 p-4 text-center">
        {visiblePin ? (
          <>
            <div className="text-xs text-muted-foreground">Yeni hızlı PIN — operatöre şimdi iletin</div>
            <div className="mt-1 font-mono text-3xl font-bold tracking-[0.3em]">{visiblePin}</div>
            <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
              Bu ekran kapandıktan kısa süre sonra PIN bir daha gösterilmez.
            </div>
          </>
        ) : pinSet ? (
          <>
            <div className="flex items-center justify-center gap-1.5 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-emerald-600" /> Hızlı PIN tanımlı (gizli)
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {cred?.quickPinSetAt ? `Son değişiklik: ${formatFactory(cred.quickPinSetAt, "dd.MM.yyyy HH:mm")}` : "Önceki sürümden aktarıldı"}
              {cred?.quickPinStorage === "DUZ" && " · güncellemede ilk girişte özete çevrilir"}
            </div>
          </>
        ) : (
          <div className="text-sm italic text-muted-foreground">Tanımlı değil</div>
        )}
        {cred && !cred.quickPinKeyOk && (
          <div className="mt-2 flex items-center justify-center gap-1.5 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            Bu PIN bu sunucuda doğrulanamıyor (yedek başka sunucudan) — yenileyin ya da anahtarı geri yükleyin.
          </div>
        )}
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
          onClick={() => setConfirm({ kind: "manual" })}
        >
          Ata
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => setConfirm({ kind: "random" })}
        >
          <Dices className="h-3.5 w-3.5" /> Rastgele Üret
        </Button>
        {pinSet && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={mutation.isPending}
            onClick={() => setConfirm({ kind: "clear" })}
          >
            <Trash2 className="h-3.5 w-3.5" /> Kaldır
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirm != null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.kind === "clear" ? "Hızlı PIN'i kaldır" : pinSet ? "Hızlı PIN'i değiştir" : "Hızlı PIN ata"}
        description={
          confirm?.kind === "clear"
            ? "Bu kullanıcının hızlı PIN'i kaldırılacak — salt-PIN ile giremez (şifre/kart etkilenmez). Devam edilsin mi?"
            : pinSet
              ? "Mevcut PIN yerine yenisi atanacak — eski PIN ANINDA geçersiz olur. Yeni PIN yalnız şimdi gösterilecek. Devam edilsin mi?"
              : "Bu kullanıcıya yeni bir hızlı PIN atanacak; yalnız şimdi gösterilecek. Devam edilsin mi?"
        }
        confirmLabel={confirm?.kind === "clear" ? "Kaldır" : "Onayla"}
        destructive={confirm?.kind === "clear"}
        isPending={mutation.isPending}
        onConfirm={runConfirmed}
      />
    </div>
  );
}
