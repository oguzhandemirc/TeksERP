import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, KeyRound, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { backupPasswordErrorCode, backupPasswordHeaders, backupPasswordMessage } from "@/lib/backup-password";
import { adminUserService, type ShortCredentialStatus } from "@/services/adminUserService";
import { BulkPinResetPanel } from "./BulkPinResetPanel";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SHORT_CREDENTIAL_STATUS_KEY = ["short-credential-status"];

/**
 * Kısa kimlikler (hızlı PIN + QR kart) — durum, anahtarın yedekten geri konması ve toplu PIN
 * sıfırlama. Düz değer yalnız toplu sıfırlamanın cevabında döner ve yalnız o ekranda basılır.
 */
export function ShortCredentialsDialog({ open, onOpenChange }: Props) {
  const [resetKey, setResetKey] = useState(0);
  const statusQ = useQuery({
    queryKey: SHORT_CREDENTIAL_STATUS_KEY,
    queryFn: () => adminUserService.shortCredentialStatus(),
    enabled: open,
  });
  const st = statusQ.data?.data;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setResetKey((k) => k + 1);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" /> Kısa Kimlikler (Hızlı PIN · Personel Kartı)
          </DialogTitle>
          <DialogDescription>
            PIN ve kart kodları sunucuda geri çevrilemez şekilde saklanır. Bu ekran durumu gösterir;
            yedek başka sunucudan geri yüklendiyse anahtarı geri koyar ya da PIN'leri topluca yeniler.
          </DialogDescription>
        </DialogHeader>
        {statusQ.isLoading || !st ? <Skeleton className="h-32 w-full" /> : <StatusPanel st={st} />}
        <BulkPinResetPanel key={resetKey} enabled={open} />
      </DialogContent>
    </Dialog>
  );
}

function StatusPanel({ st }: { st: ShortCredentialStatus }) {
  const plain = st.pin.legacyPlain + st.card.legacyPlain;
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <div className="flex items-center gap-2">
        {st.key.ok ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}
        {st.key.ok ? "Anahtar hazır" : `Anahtar kullanılamıyor: ${st.key.detail ?? ""}`}
      </div>
      <div>
        Özetli: <b>{st.pin.digest}</b> PIN · <b>{st.card.digest}</b> kart
        {st.card.legacyFormat > 0 && <> · yeniden basılması önerilen eski kart: <b>{st.card.legacyFormat}</b></>}
      </div>
      <div className={plain > 0 ? "text-amber-700 dark:text-amber-400" : ""}>
        Düz metin kalan: <b>{st.pin.legacyPlain}</b> PIN · <b>{st.card.legacyPlain}</b> kart
        {plain > 0 && " — kullanıcının ilk girişinde otomatik çevrilir; kalanları sunucu aracı (kisa-kimlik donustur) kapatır."}
      </div>
      {st.escrow.backupCrypto !== "acik" && (
        <div className="text-amber-700 dark:text-amber-400">
          Yedek şifrelemesi açık değil — anahtar yedeğe girmiyor; yeni sunucuya geri yüklemede PIN/kartlar yeniden verilmeli.
        </div>
      )}
      {st.foreignKids.length > 0 && <KeyRestorePanel pin={st.pin.foreign} card={st.card.foreign} />}
    </div>
  );
}

function KeyRestorePanel({ pin, card }: { pin: number; card: number }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const restoreMut = useMutation({
    mutationFn: () => adminUserService.restoreShortCredentialKey(backupPasswordHeaders(password)),
    onSuccess: (res) => {
      setPassword("");
      const d = res.data;
      if (d.restored.length > 0) toast.success(`${d.restored.length} anahtar yedekten geri kondu — PIN/kartlar yeniden çalışıyor.`);
      else if (d.needed.length === 0) toast.info("Geri konacak anahtar yok — bütün PIN/kartlar bu sunucuda doğrulanıyor.");
      if (d.failed.length > 0) toast.error("Bazı anahtarlar bu yedek anahtarıyla açılamadı — kâğıt müşteri anahtarı gerekebilir.");
      if (d.notEscrowed.length > 0) toast.warning("Bazı anahtarların yedeği yok — o kullanıcılara toplu PIN sıfırlama gerekir.");
      void qc.invalidateQueries({ queryKey: SHORT_CREDENTIAL_STATUS_KEY });
      void qc.invalidateQueries({ queryKey: ["short-credential-bulk-preview"] });
    },
    onError: (e) => {
      const code = backupPasswordErrorCode(e);
      // eslint-disable-next-line yerel/mutation-onerror-toast -- istek `suppressErrorToast` taşır; yedek parolası kodu burada okunur
      toast.error(backupPasswordMessage(e, code === "BACKUP_PASSWORD_INVALID" ? "Yedek parolası hatalı." : "Anahtar geri konamadı."));
    },
  });
  return (
    <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-2">
      <div className="font-medium text-destructive">
        {pin} PIN ve {card} kart bu sunucuda doğrulanamıyor (yedek başka sunucudan).
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="mb-1 block">Yedek parolası</span>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-8 w-56" autoComplete="off" />
        </label>
        <Button size="sm" disabled={!password || restoreMut.isPending} onClick={() => restoreMut.mutate()}>
          Anahtarı yedekten geri koy
        </Button>
      </div>
    </div>
  );
}
