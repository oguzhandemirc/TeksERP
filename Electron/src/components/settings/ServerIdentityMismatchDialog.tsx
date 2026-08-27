import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { DiscoveredServer } from "@shared/ipc-contract";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * "Bu sunucu, daha önce bağlandığınız sunucu değil" onayı.
 *
 * ⚠️ YALNIZ GERÇEK UYUŞMAZLIKTA açılır (`matchesPinned === "mismatch"`).
 * Kimliğin BİLİNMEMESİ (eski backend, boot'ta DB'si hazır olmayan sunucu, henüz
 * sabitlenmemiş cihaz) uyuşmazlık DEĞİLDİR ve bu diyaloğu açmaz — yanlış-pozitif
 * veren bir güvenlik sorusu ezberden geçilir ve gerçek uyuşmazlıkta da işe yaramaz.
 *
 * Üç tasarım kararı bilinçli:
 *  • Dışarı tıklamayla KAPANMAZ (yanlışlıkla geçilmesin).
 *  • Varsayılan ve odaklı buton "Bağlanma".
 *  • "Güven ve bağlan" 3 saniye pasif — kas hafızasıyla tıklanmasın diye
 *    konulmuş bilinçli bir kasis.
 */
export interface ServerIdentityMismatchDialogProps {
  open: boolean;
  candidate: DiscoveredServer | null;
  /** Daha önce bağlanılan sunucunun bilinen adı/firması (varsa). */
  pinnedLabel?: string | null;
  pinnedAt?: string | null;
  onCancel: () => void;
  onTrust: (candidate: DiscoveredServer) => void;
}

const ARM_DELAY_MS = 3000;

export function ServerIdentityMismatchDialog({
  open,
  candidate,
  pinnedLabel,
  pinnedAt,
  onCancel,
  onTrust,
}: ServerIdentityMismatchDialogProps) {
  const [armed, setArmed] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (!open) {
      setArmed(false);
      setShowDetails(false);
      return;
    }
    const t = setTimeout(() => setArmed(true), ARM_DELAY_MS);
    return () => clearTimeout(t);
  }, [open]);

  if (!candidate) return null;
  const found = candidate.identity;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent
        className="sm:max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Bu sunucu, daha önce bağlandığınız sunucu değil
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 pt-2 text-sm text-foreground">
              {pinnedLabel && (
                <p>
                  Bu bilgisayar en son <strong>{pinnedLabel}</strong> sunucusuna bağlanmıştı
                  {pinnedAt ? ` (${pinnedAt} tarihinde eşleştirildi)` : ""}.
                </p>
              )}
              <p>
                Şu anda <strong>{candidate.host}:{candidate.port}</strong> adresindeki sunucu
                kendini{" "}
                <strong>
                  {found?.companyName || "bilinmeyen firma"}
                  {found?.serverName ? ` · ${found.serverName}` : ""}
                </strong>{" "}
                olarak tanıtıyor ve <strong>farklı bir kurulum</strong> olduğunu bildiriyor.
              </p>
              <p>
                Bu beklenen bir durumsa (sunucu yeniden kuruldu, veritabanı sıfırdan oluşturuldu
                ya da başka bir fabrikaya bağlanıyorsunuz) devam edebilirsiniz. Beklenmiyorsa{" "}
                <strong>bağlanmayın</strong> ve yöneticinize haber verin — yanlış sunucuya girilen
                üretim kayıtları geri alınamaz.
              </p>
              {showDetails && (
                <div className="rounded-md bg-muted p-3 font-mono text-xs">
                  <div>yeni kimlik: {found?.installationId?.slice(0, 8) ?? "—"}…</div>
                  <div>yeni sürüm: {found?.version || "—"}</div>
                  <div>adres: {candidate.baseUrl}</div>
                </div>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? "Ayrıntıları gizle" : "Ayrıntıları göster"}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="destructive" disabled={!armed}
              onClick={() => onTrust(candidate)}>
              {armed ? "Bu sunucuya güven ve bağlan" : "Bu sunucuya güven ve bağlan (…)"}
            </Button>
            {/* Varsayılan ve odaklı buton — güvenli olan. */}
            <Button type="button" autoFocus onClick={onCancel}>
              Bağlanma
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
