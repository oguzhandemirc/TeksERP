import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dices, KeySquare, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { adminUserService } from "@/services/adminUserService";

interface Props {
  userId: string;
  username: string;
}

/**
 * Hızlı PIN — SALT-PIN girişi için. Kullanıcı seçme yok, PIN tek başına kimliği
 * belirler → sistem genelinde BENZERSİZ olmalı. MEVCUT PIN her zaman görünür
 * (yalnız yönetici görür); yenileme/kaldırma TEYİT ister. Elle atanabilir
 * (başkasında varsa 409) veya çakışmayan rastgele üretilir.
 */
export function QuickPinTab({ userId, username }: Props) {
  const qc = useQueryClient();
  const [manualPin, setManualPin] = useState("");
  const [confirm, setConfirm] = useState<null | { kind: "random" | "manual" | "clear" }>(null);

  const credQ = useQuery({
    queryKey: ["admin-user-credentials", userId],
    queryFn: () => adminUserService.getCredentials(userId),
  });
  const currentPin = credQ.data?.data.quickPin ?? null;

  const mutation = useMutation({
    mutationFn: (input: { pin?: string; clear?: boolean }) =>
      adminUserService.setQuickPin(userId, input),
    onSuccess: (_res, vars) => {
      setConfirm(null);
      setManualPin("");
      toast.success(
        vars.clear
          ? "Hızlı PIN kaldırıldı — bu kullanıcı salt-PIN ile giremez"
          : "Hızlı PIN güncellendi",
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
            girer — bu yüzden <b>kişiye özel ve benzersizdir</b> (aynı PIN iki kullanıcıya
            verilemez). Şifreden ayrıdır.
          </p>
        </div>
      </div>

      {/* Mevcut PIN — her zaman görünür (yalnız yönetici görür). */}
      <div className="rounded-md border bg-muted/20 p-4 text-center">
        <div className="text-xs text-muted-foreground">Mevcut hızlı PIN</div>
        {currentPin ? (
          <div className="mt-1 font-mono text-3xl font-bold tracking-[0.3em]">{currentPin}</div>
        ) : (
          <div className="mt-1 text-sm italic text-muted-foreground">Tanımlı değil</div>
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
        {currentPin && (
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
        title={
          confirm?.kind === "clear"
            ? "Hızlı PIN'i kaldır"
            : currentPin
              ? "Hızlı PIN'i değiştir"
              : "Hızlı PIN ata"
        }
        description={
          confirm?.kind === "clear"
            ? "Bu kullanıcının hızlı PIN'i kaldırılacak — salt-PIN ile giremez (şifre/kart etkilenmez). Devam edilsin mi?"
            : currentPin
              ? `Mevcut PIN (${currentPin}) yerine yenisi atanacak — eski PIN ANINDA geçersiz olur. Devam edilsin mi?`
              : "Bu kullanıcıya yeni bir hızlı PIN atanacak. Devam edilsin mi?"
        }
        confirmLabel={confirm?.kind === "clear" ? "Kaldır" : "Onayla"}
        destructive={confirm?.kind === "clear"}
        isPending={mutation.isPending}
        onConfirm={runConfirmed}
      />
    </div>
  );
}
