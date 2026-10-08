import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { QrCode } from "lucide-react";
import { formatFingerprintGroups, parseTlsQr } from "@shared/lan-tls";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getActiveApiBaseUrl } from "@/lib/api-config";
import { tabletQrHosts, tabletTlsQr } from "@/lib/lan-tls-ui";

/**
 * Tablete şifreli bağlantı kodu (docs/design/LAN-TLS.md §4c). Yalnız bu panel şifreli ve sabitliyken
 * görünür: QR'ın güveni panelin kendi sabitinden gelir, keşiften değil. Varsayılan QR sunucu adresini de taşır
 * (v2: tablet ağı aramadan bağlanır); adres alanını bilmeyen eski tablet için adressiz QR (v1) ayrıca gösterilir.
 */
export function TabletTlsQrButton() {
  const api = typeof window !== "undefined" ? window.api?.discovery : undefined;
  const [codes, setCodes] = useState<{ main: string; legacy: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [legacy, setLegacy] = useState(false);

  useEffect(() => {
    if (!api?.tlsPins) return;
    let alive = true;
    void (async () => {
      const pins = await api.tlsPins();
      const active = getActiveApiBaseUrl();
      const local = api.lanHosts ? await api.lanHosts().catch(() => [] as string[]) : [];
      const main = tabletTlsQr(pins, active, tabletQrHosts(active, local));
      const old = tabletTlsQr(pins, active);
      if (alive && main && old) setCodes({ main, legacy: old });
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api]);

  if (!codes) return null;
  const payload = legacy ? codes.legacy : codes.main;
  const parsed = parseTlsQr(payload);
  const hasLegacy = codes.legacy !== codes.main;

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <QrCode className="mr-2 h-4 w-4" />
        Tablet için şifreli bağlantı
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setLegacy(false);
        }}
      >
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
            {parsed && parsed.hosts.length > 0 && (
              <p className="text-center text-xs text-muted-foreground" data-testid="tablet-tls-qr-hosts">
                Sunucu adresi: {parsed.hosts.join(", ")}
              </p>
            )}
            {hasLegacy && (
              <Button type="button" variant="link" size="sm" onClick={() => setLegacy((v) => !v)}>
                {legacy ? "Adresli koda dön" : "Tablet bu kodu tanımıyorsa (eski sürüm) adressiz kodu göster"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
