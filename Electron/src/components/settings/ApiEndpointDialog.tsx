import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Radar, RotateCcw, XCircle } from "lucide-react";
import { useServerDiscovery } from "@/hooks/useServerDiscovery";
import { ServerDiscoveryPanel } from "./ServerDiscoveryPanel";
import { LanTlsSection } from "./LanTlsSection";
import { RecentAddressList } from "./RecentAddressList";
import { ServerAddressFields, ServerModeSwitch } from "./ServerAddressFields";
import { useServerAddressForm } from "./useServerAddressForm";
import { addressRefusal, httpSwitchBlock, type HttpSwitchBlock } from "@/lib/lan-tls-ui";
import { serverModeFor } from "@/lib/server-mode";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_API_BASE_URL,
  applyApiBaseUrl,
  clearStoredApiBaseUrl,
  getActiveApiBaseUrl,
  getRecentApiBaseUrls,
  normalizeApiBaseUrl,
  pushRecentApiBaseUrl,
  removeRecentApiBaseUrl,
  setStoredApiBaseUrl,
} from "@/lib/api-config";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Backend (API) adresini düzenleme dialog'u. Login ekranında ve uygulama içi
 * ayarlarda paylaşılır. Adres yerel saklanır (`@/lib/api-config`), kaydedince
 * anında geçerli olur — uygulamayı yeniden başlatmak gerekmez; giriş ekranı yeni
 * adresi kendiliğinden yeniden yoklar (`onApiBaseUrlApplied`).
 *
 * Üstte "Fabrika içi / Bulut" seçimi: Fabrika içi şifreli LAN (4443 + doğrulama
 * kodu), Bulut https + kilitli boş port (443), şifreli bağlantı bölümü yok.
 */
export function ApiEndpointDialog({ open, onOpenChange }: Props) {
  const discovery = useServerDiscovery();
  const f = useServerAddressForm(open);
  const { composed, mode, setTest } = f;
  const [saving, setSaving] = useState(false);
  // Sabitli sunucuya şifresiz adresle geçiş engellenir; bölüm o sabiti "kaldır"a açar.
  const [tlsBlock, setTlsBlock] = useState<HttpSwitchBlock | null>(null);
  const isDefault =
    !!composed && normalizeApiBaseUrl(composed) === normalizeApiBaseUrl(DEFAULT_API_BASE_URL);
  const fabrika = mode === "fabrika";

  /** Kayıt ya da deneme öncesi: mod + yalnız-şifreli kuralı (`panelTransportFor`). */
  const refuse = async (): Promise<string | null> => {
    if (!composed) return "IP / sunucu adresi boş olamaz.";
    return addressRefusal(window.api?.discovery, composed, mode);
  };

  const handleTest = async () => {
    const refusal = await refuse();
    if (refusal) {
      setTest({ status: "fail", message: refusal });
      return;
    }
    setTest({ status: "testing" });
    try {
      const res = await axios.get<{ status?: string }>(`${composed}/health`, { timeout: 5_000 });
      setTest(
        res.data?.status === "UP"
          ? { status: "ok", message: "Bağlantı başarılı — sunucu çalışıyor." }
          : { status: "fail", message: "Yanıt alındı ama sunucu beklenen formatta değil." },
      );
    } catch (err) {
      const reason = axios.isAxiosError(err)
        ? err.code === "ECONNABORTED"
          ? "Zaman aşımı — sunucu yanıt vermedi."
          : "Sunucuya ulaşılamadı. Adresi ve ağı kontrol edin."
        : "Bağlantı denenirken hata oluştu.";
      setTest({ status: "fail", message: reason });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const refusal = await refuse();
      if (refusal) {
        setTest({ status: "fail", message: refusal });
        if (composed) toast.error("Bu adres kaydedilmedi.", { description: refusal });
        return;
      }
      const block = await httpSwitchBlock(window.api?.discovery, composed, getActiveApiBaseUrl());
      setTlsBlock(block);
      if (block) {
        setTest({ status: "fail", message: block.reason });
        toast.error("Şifresiz adrese geçilemez.", { description: block.reason });
        return;
      }
      await setStoredApiBaseUrl(composed);
      applyApiBaseUrl(composed);
      await pushRecentApiBaseUrl(composed);
      toast.success("Sunucu adresi kaydedildi.");
      onOpenChange(false);
    } catch {
      toast.error("Adres kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await clearStoredApiBaseUrl();
      applyApiBaseUrl(DEFAULT_API_BASE_URL);
      f.load(DEFAULT_API_BASE_URL);
      toast.success("Varsayılan adrese dönüldü.");
    } catch {
      toast.error("Sıfırlanamadı.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* ⚠️ GENİŞLİK ALT SIRAYA GÖRE: burada DÖRT aksiyon var (Varsayılana dön ·
          Ağda Bul · Bağlantıyı Test Et · Kaydet) ve etiketleri çalışırken UZUYOR
          ("Aranıyor…", "Test ediliyor…"). `max-w-lg` (512px) içine sığmıyordu →
          modal yatay kayıyordu (saha bildirimi 2026-08-27). */}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Sunucu Adresi</DialogTitle>
          <DialogDescription>
            Uygulamanın bağlanacağı backend (API) adresi. Sunucu taşındıysa burada güncelleyin —
            değişiklik bu bilgisayara özeldir ve kaydedince anında geçerli olur.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <ServerModeSwitch mode={mode} onChange={f.changeMode} />
          <ServerAddressFields
            mode={mode}
            parts={f.parts}
            composed={composed}
            isDefault={isDefault}
            httpOk={f.httpOk}
            portLocked={f.portLocked}
            onUnlockPort={f.unlockPort}
            onProtocolChange={f.setProtocol}
            onHostChange={f.changeHost}
            onPortChange={f.setPort}
          />

          {/* Bulut'ta şifreli LAN bölümü ve ağ keşfi yok: internet adresi kodsuz doğrulanır. */}
          {fabrika && (
            <LanTlsSection
              url={composed}
              recent={f.recent}
              blocked={tlsBlock && tlsBlock.url === composed ? tlsBlock : null}
              onAddressChanged={(url) => {
                f.load(url);
                void getRecentApiBaseUrls().then(f.setRecent);
              }}
            />
          )}

          {/* Ağda bulunanlar — "Son kullanılanlar"ın ÜSTÜNDE: keşfedilen canlı
              sunucu, geçmişte yazılmış bir adresten daha güncel bir bilgidir. */}
          {fabrika && (discovery.state?.candidates.length ?? 0) > 0 && (
            <ServerDiscoveryPanel
              state={discovery.state}
              onPick={(c) => {
                f.load(c.baseUrl);
                // Aday zaten doğrulanmıştı — tekrar test ettirmeye gerek yok.
                setTest({
                  status: "ok",
                  message: c.identity
                    ? `Bağlantı başarılı — ${c.identity.companyName || c.identity.serverName} (v${c.identity.version})`
                    : "Bağlantı başarılı (sunucu kimlik bilgisi vermiyor — eski sürüm olabilir)",
                });
              }}
            />
          )}

          <RecentAddressList
            urls={f.recent.filter((u) => serverModeFor(f.pins, u) === mode)}
            current={composed}
            onPick={(url) => f.load(url)}
            onDrop={(url) => void removeRecentApiBaseUrl(url).then(f.setRecent)}
          />

          {f.test.status === "ok" && (
            <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {f.test.message}
            </p>
          )}
          {f.test.status === "fail" && (
            <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
              <XCircle className="h-4 w-4 shrink-0" />
              {f.test.message}
            </p>
          )}
        </div>

        {/* `flex-wrap`: dar pencerede/uzun etiketlerde alt sıra KAYMAK yerine
            alta sarar. Genişlik tek başına yeterli değil — buton metinleri
            duruma göre değiştiği için sabit bir genişlik her hali kapsayamaz. */}
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => void handleReset()}
            disabled={saving || isDefault}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Varsayılana dön
          </Button>
          <div className="flex gap-2">
            {fabrika && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void discovery.start(12000)}
              disabled={discovery.state?.status === "running" || saving}
              title="Ağdaki TeksERP sunucularını ara"
            >
              {discovery.state?.status === "running" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Aranıyor...
                </>
              ) : (
                <>
                  <Radar className="mr-2 h-4 w-4" />
                  Ağda Bul
                </>
              )}
            </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleTest()}
              disabled={f.test.status === "testing" || saving}
            >
              {f.test.status === "testing" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Test ediliyor...
                </>
              ) : (
                "Bağlantıyı Test Et"
              )}
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={saving}>
              {saving ? "..." : "Kaydet"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
