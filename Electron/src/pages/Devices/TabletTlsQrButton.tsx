import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { QrCode } from "lucide-react";
import { formatFingerprintGroups, parseTlsQr } from "@shared/lan-tls";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getActiveApiBaseUrl } from "@/lib/api-config";
import { tabletTlsQr } from "@/lib/lan-tls-ui";

/**
 * Tablete şifreli bağlantı kodu (docs/design/LAN-TLS.md §4c). Yalnız bu panel şifreli ve sabitliyken
 * görünür: QR'ın güveni panelin kendi sabitinden gelir, keşiften değil.
 */
export function TabletTlsQrButton() {
  const api = typeof window !== "undefined" ? window.api?.discovery : undefined;
  const [payload, setPayload] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!api?.tlsPins) return;
    let alive = true;
    void api
      .tlsPins()
      .then((pins) => alive && setPayload(tabletTlsQr(pins, getActiveApiBaseUrl())))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api]);

  if (!payload) return null;
  const parsed = parseTlsQr(payload);

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <QrCode className="mr-2 h-4 w-4" />
        Tablet için şifreli bağlantı
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Tablet için şifreli bağlantı</DialogTitle>
            <DialogDescription>
              Tablette Ayarlar → API Sunucusu → “Şifreli bağlantı QR'ı okut” ile bu kodu okutun (tablet bu sunucuya bağlıyken). Tablet sunucuyu bu
              sertifika koduyla tanır; kod başka bir sunucunun koduyla değiştirilemez.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="rounded-md bg-white p-3">
              <QRCodeSVG value={payload} size={200} level="M" data-testid="tablet-tls-qr" />
            </div>
            {parsed && (
              <p className="text-center font-mono text-xs tracking-wide">
                {formatFingerprintGroups(parsed.advert.fingerprint)}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
