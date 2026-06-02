import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CheckCircle2, Loader2, RotateCcw, XCircle } from "lucide-react";
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
  DEFAULT_API_BASE_URL,
  applyApiBaseUrl,
  clearStoredApiBaseUrl,
  getActiveApiBaseUrl,
  normalizeApiBaseUrl,
  setStoredApiBaseUrl,
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
 */
export function ApiEndpointDialog({ open, onOpenChange }: Props) {
  const [value, setValue] = useState("");
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [saving, setSaving] = useState(false);

  // Açılışta o an aktif adresi forma yükle.
  useEffect(() => {
    if (open) {
      setValue(getActiveApiBaseUrl());
      setTest({ status: "idle" });
    }
  }, [open]);

  const isDefault = normalizeApiBaseUrl(value) === normalizeApiBaseUrl(DEFAULT_API_BASE_URL);

  const handleTest = async () => {
    const target = normalizeApiBaseUrl(value);
    if (!target) {
      setTest({ status: "fail", message: "Adres boş olamaz." });
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
    const target = normalizeApiBaseUrl(value);
    if (!target) {
      setTest({ status: "fail", message: "Adres boş olamaz." });
      return;
    }
    setSaving(true);
    try {
      await setStoredApiBaseUrl(target);
      applyApiBaseUrl(target);
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
      setValue(DEFAULT_API_BASE_URL);
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
      {/* Login ekranı tüm pencereyi `app-drag` yapıyor; portal'lanan dialog o
          OS-seviyesi sürükleme dikdörtgenine düştüğü için tıklamalar yutuluyor.
          `app-no-drag` ile dialog içini yeniden etkileşimli yapıyoruz. */}
      <DialogContent className="max-w-lg app-no-drag">
        <DialogHeader>
          <DialogTitle>Sunucu Adresi</DialogTitle>
          <DialogDescription>
            Uygulamanın bağlanacağı backend (API) adresi. Sunucu taşındıysa burada güncelleyin —
            değişiklik bu bilgisayara özeldir ve kaydedince anında geçerli olur.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="api-base-url">API adresi</Label>
            <Input
              id="api-base-url"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setTest({ status: "idle" });
              }}
              placeholder="http://192.168.1.50:4000"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              Varsayılan: <span className="font-mono">{normalizeApiBaseUrl(DEFAULT_API_BASE_URL)}</span>
              {isDefault && " (şu an aktif)"}
            </p>
          </div>

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

        <DialogFooter className="gap-2 sm:justify-between">
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
