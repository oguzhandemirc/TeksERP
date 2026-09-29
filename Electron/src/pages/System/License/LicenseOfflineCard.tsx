import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { licenseService } from "@/services/licenseService";
import { copyText } from "@/lib/clipboard";
import type { LicenseDetail, LicenseOfflineRequest } from "@/types/license";
import { InfoRow, LicenseCard, when } from "./LicenseParts";
import { useLicenseAction } from "./hooks";

/**
 * TAM ÇEVRİMDIŞI yol: sunucu da bu bilgisayar da internete çıkamıyorsa istek
 * QR ile telefona taşınır; telefonun gösterdiği yanıt metni buraya yapıştırılır.
 * İstek 10 dakika geçerlidir (imzalı zaman damgası).
 */
/** QR sürüm 40, düzeltme L — ikili kip kapasitesi ≈ 2953 bayt; sığmayan istek metinle taşınır. */
const QR_MAX_CHARS = 2900;

export function LicenseOfflineCard({ d }: { d: LicenseDetail }) {
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
  const qrValue = req?.qrAdresi ?? req?.zarf ?? "";
  const fits = qrValue.length <= QR_MAX_CHARS;
  return (
    <LicenseCard title="Çevrimdışı (QR)">
      <div className="flex flex-wrap gap-2">
        {amac === "etkinlestir" && (
          <Input value={kod} onChange={(e) => setKod(e.target.value)} placeholder="Etkinleştirme kodu" className="max-w-xs font-mono uppercase" />
        )}
        <Button variant="outline" disabled={busy !== null || (amac === "etkinlestir" && !kod.trim())} onClick={() => void create()}>
          {amac === "etkinlestir" ? "Etkinleştirme isteği oluştur" : "Yenileme isteği oluştur"}
        </Button>
      </div>
      {req && (
        <div className="flex flex-wrap items-start gap-4 rounded-md border p-3">
          {fits && (
            <div className="rounded bg-white p-2">
              <QRCodeSVG value={qrValue} size={180} level="L" />
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-1 text-xs">
            <InfoRow label="Geçerlilik">{when(req.gecerlilikSonu)} saatine kadar</InfoRow>
            <p className="text-muted-foreground">
              {fits
                ? "Telefonla okutun; açılan sayfa yanıt metnini gösterir. O metni aşağıya yapıştırın."
                : "İstek QR koduna sığmıyor; metni kopyalayıp lisans sunucusunun QR sayfasına taşıyın."}
            </p>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void copyText(qrValue)}>
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
