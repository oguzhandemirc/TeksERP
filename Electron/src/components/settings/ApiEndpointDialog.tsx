import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CheckCircle2, History, Loader2, Radar, RotateCcw, X, XCircle } from "lucide-react";
import { useServerDiscovery } from "@/hooks/useServerDiscovery";
import { ServerDiscoveryPanel } from "./ServerDiscoveryPanel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_API_BASE_URL,
  applyApiBaseUrl,
  clearStoredApiBaseUrl,
  getActiveApiBaseUrl,
  getRecentApiBaseUrls,
  joinApiBaseUrl,
  normalizeApiBaseUrl,
  pushRecentApiBaseUrl,
  removeRecentApiBaseUrl,
  setStoredApiBaseUrl,
  splitApiBaseUrl,
  type ApiBaseUrlParts,
} from "@/lib/api-config";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; message: string }
  | { status: "fail"; message: string };

/**
 * Backend (API) adresini düzenleme dialog'u. Login ekranında ve uygulama içi
 * ayarlarda paylaşılır. Adres yerel saklanır (`@/lib/api-config`), kaydedince
 * anında geçerli olur — uygulamayı yeniden başlatmak gerekmez.
 *
 * Protokol / IP / port ayrı input'larda girilir (elle URL yazmaktan kolay);
 * son kullanılan adresler hızlı-seçim için listelenir.
 */
export function ApiEndpointDialog({ open, onOpenChange }: Props) {
  const discovery = useServerDiscovery();
  const [parts, setParts] = useState<ApiBaseUrlParts>({ protocol: "http", host: "", port: "" });
  const [recent, setRecent] = useState<string[]>([]);
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [saving, setSaving] = useState(false);

  // Açılışta o an aktif adresi parçala + son kullanılanları yükle.
  useEffect(() => {
    if (open) {
      setParts(splitApiBaseUrl(getActiveApiBaseUrl()));
      setTest({ status: "idle" });
      void getRecentApiBaseUrls().then(setRecent);
    }
  }, [open]);

  const composed = joinApiBaseUrl(parts);
  const isDefault =
    !!composed && normalizeApiBaseUrl(composed) === normalizeApiBaseUrl(DEFAULT_API_BASE_URL);

  const setPart = (patch: Partial<ApiBaseUrlParts>) => {
    setParts((p) => ({ ...p, ...patch }));
    setTest({ status: "idle" });
  };

  /**
   * IP/host alanına yazım. Hostname/IP'de ':' veya '/' olmaz — varsa kullanıcı
   * tam ya da parçalı bir adres yapıştırmış demektir ("http://192.168.1.50:4000"
   * kopyala-yapıştır en yaygın giriş yolu). Bu durumda parçalara dağıt ki eski
   * tek-alanlı diyalogun "URL yapıştır" jesti korunsun (aksi halde çift protokol/
   * çift port oluşurdu). Protokolü yalnız yapıştırmada varsa değiştir; port
   * yapıştırmadan aynen alınır (yoksa boşalır — kullanıcı açıkça portsuz girdi).
   */
  const onHostChange = (raw: string) => {
    if (/[:/]/.test(raw)) {
      const p = splitApiBaseUrl(raw);
      const hasProtocol = /:\/\//.test(raw);
      setParts((prev) => ({
        protocol: hasProtocol ? p.protocol : prev.protocol,
        host: p.host,
        port: p.port,
      }));
      setTest({ status: "idle" });
      return;
    }
    setPart({ host: raw });
  };

  const pickRecent = (url: string) => {
    setParts(splitApiBaseUrl(url));
    setTest({ status: "idle" });
  };

  const dropRecent = async (url: string) => {
    setRecent(await removeRecentApiBaseUrl(url));
  };

  const handleTest = async () => {
    const target = composed;
    if (!target) {
      setTest({ status: "fail", message: "IP / sunucu adresi boş olamaz." });
      return;
    }
    setTest({ status: "testing" });
    try {
      const res = await axios.get<{ status?: string }>(`${target}/health`, { timeout: 5_000 });
      if (res.data?.status === "UP") {
        setTest({ status: "ok", message: "Bağlantı başarılı — sunucu çalışıyor." });
      } else {
        setTest({ status: "fail", message: "Yanıt alındı ama sunucu beklenen formatta değil." });
      }
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
    const target = composed;
    if (!target) {
      setTest({ status: "fail", message: "IP / sunucu adresi boş olamaz." });
      return;
    }
    setSaving(true);
    try {
      await setStoredApiBaseUrl(target);
      applyApiBaseUrl(target);
      await pushRecentApiBaseUrl(target);
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
      setParts(splitApiBaseUrl(DEFAULT_API_BASE_URL));
      setTest({ status: "idle" });
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
          {/* Protokol / IP / Port — ayrı input'lar */}
          <div className="grid grid-cols-[7rem_1fr_5.5rem] gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="api-protocol">Protokol</Label>
              <Select
                value={parts.protocol}
                onValueChange={(v) => setPart({ protocol: v as "http" | "https" })}
              >
                <SelectTrigger id="api-protocol">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">http</SelectItem>
                  <SelectItem value="https">https</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="api-host">IP / Sunucu adresi</Label>
              <Input
                id="api-host"
                value={parts.host}
                onChange={(e) => onHostChange(e.target.value)}
                placeholder="192.168.1.50"
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="api-port">Port</Label>
              <Input
                id="api-port"
                value={parts.port}
                onChange={(e) => setPart({ port: e.target.value.replace(/[^0-9]/g, "") })}
                placeholder="4000"
                inputMode="numeric"
                autoComplete="off"
                className="font-mono"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {composed ? (
              <>
                Adres: <span className="font-mono text-foreground">{composed}</span>
                {isDefault && " (varsayılan)"}
              </>
            ) : (
              <>
                Varsayılan:{" "}
                <span className="font-mono">{normalizeApiBaseUrl(DEFAULT_API_BASE_URL)}</span>
              </>
            )}
          </p>

          {/* Ağda bulunanlar — "Son kullanılanlar"ın ÜSTÜNDE: keşfedilen canlı
              sunucu, geçmişte yazılmış bir adresten daha güncel bir bilgidir. */}
          {(discovery.state?.candidates.length ?? 0) > 0 && (
            <ServerDiscoveryPanel
              state={discovery.state}
              onPick={(c) => {
                setParts(splitApiBaseUrl(c.baseUrl));
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

          {/* Son kullanılan adresler — hızlı seçim */}
          {recent.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <History className="h-3.5 w-3.5" />
                Son kullanılanlar
              </div>
              <div className="flex flex-col gap-1">
                {recent.map((url) => {
                  const active = normalizeApiBaseUrl(composed) === normalizeApiBaseUrl(url);
                  return (
                    <div
                      key={url}
                      className={`flex items-center gap-1 rounded-md border pl-2 pr-1 text-xs ${
                        active ? "border-primary/50 bg-primary/5" : "border-border"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => pickRecent(url)}
                        className="flex-1 truncate py-1.5 text-left font-mono hover:text-foreground"
                        title={`Seç: ${url}`}
                      >
                        {url}
                      </button>
                      <button
                        type="button"
                        onClick={() => void dropRecent(url)}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                        aria-label="Listeden çıkar"
                        title="Listeden çıkar"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {test.status === "ok" && (
            <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {test.message}
            </p>
          )}
          {test.status === "fail" && (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <XCircle className="h-4 w-4 shrink-0" />
              {test.message}
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
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleTest()}
              disabled={test.status === "testing" || saving}
            >
              {test.status === "testing" ? (
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
