import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { licenseService } from "@/services/licenseService";
import { copyText } from "@/lib/clipboard";
import type { AcceptanceGate } from "@/lib/license/acceptance";
import { offlineRequestQrValues } from "@/lib/license/offline-qr";
import type { LicenseDetail, LicenseOfflineRequest } from "@/types/license";
import { InfoRow, LicenseCard, when } from "./LicenseParts";
import { useLicenseAction } from "./hooks";

/**
 * TAM ÇEVRİMDIŞI yol: sunucu da bu bilgisayar da internete çıkamıyorsa istek QR ile telefona
 * taşınır; telefonun gösterdiği yanıt tablette QR'la okutulur ya da metni buraya yapıştırılır.
 * Büyük istek sıralı QR parçalarına bölünür (`offlineRequestQrValues`). İstek 10 dk geçerlidir.
 * Etkinleştirme isteği sözleşme kabulünü zarfın içinde taşır (Ek-7): kabul yoksa istek oluşturulmaz.
 */
export function LicenseOfflineCard({ d, gate }: { d: LicenseDetail; gate: AcceptanceGate }) {
  const [req, setReq] = useState<LicenseOfflineRequest | null>(null);
  const [kod, setKod] = useState("");
  const [yanit, setYanit] = useState("");
  const { busy, run } = useLicenseAction();
  const amac = d.kurulum.etkin ? "yokla" : "etkinlestir";
  const create = () =>
    run("istek", async () => {
      setReq(await licenseService.offlineRequest(amac, amac === "etkinlestir" ? kod.trim() : undefined));
      return null;
    });
  const submit = () =>
    run("yanit", async () => {
      await licenseService.offlineResponse(yanit.trim());
      setYanit("");
      setReq(null);
      return "Yanıt kabul edildi.";
    });
  const copyValue = req?.qrAdresi ?? req?.zarf ?? "";
  const qrValues = req ? offlineRequestQrValues(req.qrAdresi) : null;
  return (
    <LicenseCard title="Çevrimdışı (QR)">
      <div className="flex flex-wrap gap-2">
        {amac === "etkinlestir" && (
          <Input value={kod} onChange={(e) => setKod(e.target.value)} placeholder="Etkinleştirme kodu (TKS-XXXX-XXXX-XXXX-XXXX)" maxLength={32} className="max-w-xs font-mono uppercase" />
        )}
        <Button variant="outline" disabled={busy !== null || (amac === "etkinlestir" && (!kod.trim() || !gate.ready))} onClick={() => void create()}>
          {amac === "etkinlestir" ? "Etkinleştirme isteği oluştur" : "Yenileme isteği oluştur"}
        </Button>
      </div>
      {amac === "etkinlestir" && !gate.ready && gate.reason && <p className="text-xs text-amber-700 dark:text-amber-400">{gate.reason}</p>}
      {req && (
        <div className="flex flex-wrap items-start gap-4 rounded-md border p-3">
          {qrValues && <RequestQrSequence key={req.zarf} values={qrValues} />}
          <div className="min-w-0 flex-1 space-y-1 text-xs">
            <InfoRow label="Geçerlilik">{when(req.gecerlilikSonu)} saatine kadar</InfoRow>
            <p className="text-muted-foreground">
              {!qrValues
                ? "İstek QR koduna sığmıyor; metni kopyalayıp telefona gönderin ve tarayıcıda açın."
                : qrValues.length > 1
                  ? "QR'ları telefonla SIRAYLA okutun; son parçada telefon yanıtı QR olarak gösterir. Yanıtı tabletten (Ayarlar → Lisans) okutun ya da metnini aşağıya yapıştırın."
                  : "Telefonla okutun; açılan sayfa yanıtı QR olarak gösterir. Yanıtı tabletten (Ayarlar → Lisans) okutun ya da metnini aşağıya yapıştırın."}
            </p>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void copyText(copyValue)}>
              İstek metnini kopyala
            </Button>
          </div>
        </div>
      )}
      <Textarea
        value={yanit}
        onChange={(e) => setYanit(e.target.value)}
        placeholder="Lisans sunucusunun yanıt metni"
        rows={3}
        className="font-mono text-xs"
        aria-label="Yanıt metni"
      />
      <div className="flex justify-end">
        <Button disabled={busy !== null || !yanit.trim()} onClick={() => void submit()}>
          Yanıtı yükle
        </Button>
      </div>
    </LicenseCard>
  );
}

/** Çok parçalı istek: parçalar sırayla — telefon her QR'da sayfayı açar, parçaları kendisi biriktirir. */
function RequestQrSequence({ values }: { values: string[] }) {
  const [i, setI] = useState(0);
  const step = (d: number) => setI((cur) => (cur + d + values.length) % values.length);
  return (
    <div className="flex flex-col items-center gap-1.5" data-testid="lisans-istek-qr">
      <div className="rounded bg-white p-2">
        <QRCodeSVG value={values[i] ?? ""} size={220} level="L" />
      </div>
      {values.length > 1 && (
        <div className="flex items-center gap-2 text-xs">
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => step(-1)} aria-label="Önceki QR">
            ‹
          </Button>
          <span className="font-medium tabular-nums" data-testid="lisans-istek-qr-sira">
            QR {i + 1} / {values.length}
          </span>
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => step(1)} aria-label="Sonraki QR">
            ›
          </Button>
        </div>
      )}
    </div>
  );
}
