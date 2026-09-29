import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { licenseService } from "@/services/licenseService";
import type { LicenseProxySettings } from "@/types/license";
import { InfoRow, LicenseCard } from "./LicenseParts";
import { useLicenseAction } from "./hooks";

const SOURCE: Record<LicenseProxySettings["kaynak"], string> = {
  panel: "Panelden ayarlı",
  ortam: "Ortam değişkeninden",
  yok: "Yok (doğrudan)",
};

/**
 * Lisans sunucusuna çıkış için kurumsal proxy. Adres kimlik bilgisi taşıyabilir;
 * backend onu maskeli döndürür ve ayak izine yazmaz. Değişiklik yeniden başlatma istemez.
 */
export function LicenseProxyCard({ proxy, canManage }: { proxy: LicenseProxySettings; canManage: boolean }) {
  const [adres, setAdres] = useState("");
  const [atla, setAtla] = useState(proxy.atla ?? "");
  const { busy, run } = useLicenseAction();
  const save = (a: string | null, b: string | null) =>
    run("proxy", async () => {
      await licenseService.setProxy(a, b);
      setAdres("");
      return a ? "Proxy ayarı kaydedildi." : "Proxy ayarı kaldırıldı.";
    });
  return (
    <LicenseCard title="İnternet çıkışı (proxy)">
      <InfoRow label="Kaynak">{SOURCE[proxy.kaynak]}</InfoRow>
      <InfoRow label="Adres">{proxy.adres ?? "—"}</InfoRow>
      <InfoRow label="Hariç tutulanlar">{proxy.atla ?? "—"}</InfoRow>
      {!proxy.destekleniyor && (
        <p className="text-xs text-warning">Sunucudaki Node sürümü yerleşik proxy desteği taşımıyor.</p>
      )}
      {canManage && (
        <div className="space-y-1.5 border-t pt-2">
          <Input value={adres} onChange={(e) => setAdres(e.target.value)} placeholder="http://kullanici:parola@proxy:8080" aria-label="Proxy adresi" />
          <Input value={atla} onChange={(e) => setAtla(e.target.value)} placeholder="Hariç tutulanlar (virgülle)" aria-label="Proxy hariç tutulanlar" />
          <div className="flex justify-end gap-2">
            {proxy.kaynak === "panel" && (
              <Button variant="ghost" disabled={busy !== null} onClick={() => void save(null, null)}>
                Kaldır
              </Button>
            )}
            <Button disabled={busy !== null || !adres.trim()} onClick={() => void save(adres.trim(), atla.trim() || null)}>
              Kaydet
            </Button>
          </div>
        </div>
      )}
    </LicenseCard>
  );
}
