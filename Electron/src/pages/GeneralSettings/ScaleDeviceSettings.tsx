import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Scale as ScaleIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { parseWeight } from "@/lib/weight-codec";
import type { ScannerDeviceInfo } from "@shared/ipc-contract";
import { useDeviceDraft } from "./useDeviceDraft";
import { useRegisterSettingsDirty } from "./settings-dirty";
import { SettingsSaveBar } from "./SettingsSaveBar";

/**
 * Sevkiyat kantarı (seri/COM) — bu bilgisayara özel YEREL tercih. Çalışma oturumu
 * modeliyle PC kantarı backend cihaz kaydından çözülmez: kantar bu PC'ye USB/seri
 * bağlıdır; WeighSackDialog "Tart" buradaki tanımı okur (window.api.scale.read).
 * window.api yoksa (web/test) görünmez. Yol boşsa geçiş döneminde eski for-device
 * fallback'i devrededir (useMachineScale).
 */
export function ScaleDeviceSettings() {
  // Taslak: değişiklikler burada birikir, "Kaydet" ile yerel config'e işlenir.
  // "Deneme Tartısı" TASLAK portu okur → önce dene, sonra kaydet.
  const draft = useDeviceDraft("scaleDevice");
  const cfg = draft.draft;
  const setCfg = draft.patch;
  useRegisterSettingsDirty(draft.dirty);

  const printer = typeof window !== "undefined" ? window.api?.printer : undefined;
  const scaleApi = typeof window !== "undefined" ? window.api?.scale : undefined;
  const [ports, setPorts] = useState<ScannerDeviceInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  if (!scaleApi) {
    return (
      <p className="text-xs text-muted-foreground">
        Kantar yalnız masaüstü uygulamasında ayarlanabilir.
      </p>
    );
  }

  const scan = async () => {
    if (!printer) return;
    setScanning(true);
    setListErr(null);
    const r = await printer.listSerial();
    setPorts(r.devices);
    setListErr(r.available ? r.error : "Seri sürücü bu derlemede hazır değil (electron:rebuild).");
    setScanning(false);
  };

  const test = async () => {
    setTesting(true);
    setTestMsg(null);
    if (cfg.simulate) {
      setTestMsg({ ok: true, text: "Simülasyon açık — Tart her zaman sahte kg üretir." });
      setTesting(false);
      return;
    }
    if (!cfg.path) {
      setTestMsg({ ok: false, text: "Önce COM portunu seçin/girin." });
      setTesting(false);
      return;
    }
    const res = await scaleApi.read({
      path: cfg.path,
      baudRate: cfg.baudRate,
      pollCommand: cfg.pollCommand,
      terminator: cfg.terminator,
      timeoutMs: cfg.timeoutMs,
    });
    if (!res.ok || !res.raw) {
      setTestMsg({
        ok: false,
        text: res.available
          ? `Okunamadı: ${res.error ?? "kantar kapalı/menzil dışı veya komut yanlış"}`
          : "Seri sürücü bu derlemede hazır değil — bir kez npm run electron:rebuild.",
      });
    } else {
      const v = parseWeight(res.raw, {
        decimals: cfg.decimals ?? 2,
        scale: cfg.factor ?? 1,
      });
      setTestMsg(
        v != null && v > 0
          ? { ok: true, text: `Okuma başarılı: ${v} kg (ham: "${res.raw.trim().slice(0, 30)}")` }
          : { ok: false, text: `Ham yanıt çözülemedi: "${res.raw.trim().slice(0, 40)}"` },
      );
    }
    setTesting(false);
  };

  return (
    <div className="space-y-4 border-t pt-4">
      <div>
        <div className="flex items-center gap-2 text-sm font-medium">
          <ScaleIcon className="h-4 w-4" /> Sevkiyat Kantarı (bu bilgisayar)
        </div>
        <p className="text-xs text-muted-foreground">
          Kantar bu PC'ye USB/seri bağlıdır — tanım bu bilgisayara özeldir, sunucu
          cihaz kaydına gitmez. Çuval "Tart" bu portu okur.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="text-xs">
          <span className="mb-1 block font-medium">COM Portu</span>
          <div className="flex gap-1">
            <Input
              value={cfg.path ?? ""}
              onChange={(e) => setCfg({ path: e.target.value })}
              placeholder="COM3"
              className="h-8 font-mono text-xs"
            />
            <Button type="button" size="sm" variant="outline" onClick={() => void scan()} disabled={scanning}>
              {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : "Tara"}
            </Button>
          </div>
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium">Baud</span>
          <Input
            value={cfg.baudRate != null ? String(cfg.baudRate) : ""}
            onChange={(e) => setCfg({ baudRate: e.target.value.trim() ? Number(e.target.value) : undefined })}
            placeholder="9600"
            className="h-8 font-mono text-xs"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium">Sorgu Komutu</span>
          <Input
            value={cfg.pollCommand ?? ""}
            onChange={(e) => setCfg({ pollCommand: e.target.value })}
            placeholder="P (boş = sürekli yayın)"
            className="h-8 font-mono text-xs"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium">Satır Sonu</span>
          <Input
            value={cfg.terminator ?? ""}
            onChange={(e) => setCfg({ terminator: e.target.value })}
            placeholder={"\\r\\n (boş → CR/LF)"}
            className="h-8 font-mono text-xs"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium">Zaman Aşımı (ms)</span>
          <Input
            value={cfg.timeoutMs != null ? String(cfg.timeoutMs) : ""}
            onChange={(e) => setCfg({ timeoutMs: e.target.value.trim() ? Number(e.target.value) : undefined })}
            placeholder="2500"
            className="h-8 font-mono text-xs"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium">Ondalık / Çarpan</span>
          <div className="flex gap-1">
            <Input
              value={cfg.decimals != null ? String(cfg.decimals) : ""}
              onChange={(e) => setCfg({ decimals: e.target.value.trim() ? Number(e.target.value) : undefined })}
              placeholder="2"
              className="h-8 w-14 font-mono text-xs"
            />
            <Input
              value={cfg.factor != null ? String(cfg.factor) : ""}
              onChange={(e) => setCfg({ factor: e.target.value.trim() ? Number(e.target.value) : undefined })}
              placeholder="1"
              className="h-8 flex-1 font-mono text-xs"
            />
          </div>
        </label>
      </div>

      {ports.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {ports.map((p) => (
            <Button
              key={p.path}
              type="button"
              size="sm"
              variant={cfg.path === p.path ? "default" : "outline"}
              className="h-7 font-mono text-[11px]"
              onClick={() => setCfg({ path: p.path })}
            >
              {p.path}
            </Button>
          ))}
        </div>
      )}
      {listErr && <p className="text-xs text-destructive">{listErr}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs">
          <span>Simülasyon (sahte kg — donanımsız test)</span>
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={cfg.simulate ?? false}
            onChange={(e) => setCfg({ simulate: e.target.checked })}
          />
        </label>
        <Button type="button" size="sm" variant="outline" onClick={() => void test()} disabled={testing}>
          {testing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
          Deneme Tartısı
        </Button>
        {testMsg && (
          <span className={`text-xs ${testMsg.ok ? "text-emerald-600" : "text-destructive"}`}>
            {testMsg.text}
          </span>
        )}
      </div>

      <SettingsSaveBar
        dirty={draft.dirty}
        saving={false}
        onSave={() => {
          draft.save();
          toast.success("Kantar ayarı kaydedildi.");
        }}
        onReset={draft.reset}
      />
    </div>
  );
}
