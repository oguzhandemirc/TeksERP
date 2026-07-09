import { useEffect, useState } from "react";
import { Loader2, Usb, CheckCircle2, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMachineConfig } from "@/hooks/useMachineConfig";
import type { ScannerDeviceConfig } from "@/lib/machine-config";
import { FlagToggle } from "./SettingRow";
import type {
  ScannerDeviceInfo,
  ScannerStatus,
  ScannerTransport,
  ScanTerminatorPref,
} from "@shared/ipc-contract";

const TRANSPORT_LABELS: Record<ScannerTransport, string> = {
  serial: "Seri / COM (RS-232, USB-CDC, BT-SPP)",
  hid: "Raw HID (USB)",
  mock: "Sahte cihaz (test)",
};

const FRAME_LABELS: Record<ScanTerminatorPref, string> = {
  lf: "LF (\\n)",
  cr: "CR (\\r)",
  crlf: "CRLF (\\r\\n)",
  none: "Yok",
};

/**
 * Faz-2 — seri/HID barkod tabancası ayarı (bu bilgisayara özel YEREL tercih).
 * Yalnız klavye-wedge YAPAMAYAN cihazlar için; açma/kapama tercihle (AppShell'deki
 * useDeviceScanner) yapılır, burası yalnız tercihi düzenler + cihaz listeler +
 * durum gösterir + sahte kodla boru hattını test eder. window.api yoksa (web/test)
 * görünmez.
 */
export function ScannerDeviceSettings() {
  const { config, setConfig } = useMachineConfig();
  const sc = config.scanner ?? {};
  const dev = sc.device ?? {};
  const setDevice = (patch: Partial<ScannerDeviceConfig>) =>
    setConfig({ scanner: { ...sc, device: { ...dev, ...patch } } });

  const scanner = typeof window !== "undefined" ? window.api?.scanner : undefined;
  const [devices, setDevices] = useState<ScannerDeviceInfo[]>([]);
  const [listErr, setListErr] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [status, setStatus] = useState<ScannerStatus | null>(null);
  const [scanning, setScanning] = useState(false);

  const transport = (dev.transport ?? "serial") as ScannerTransport;
  const frame = (dev.frameTerminator ?? "lf") as ScanTerminatorPref;

  useEffect(() => {
    if (!scanner) return;
    void scanner.status().then(setStatus);
    return scanner.onStatus(setStatus);
  }, [scanner]);

  if (!scanner) {
    return (
      <p className="text-xs text-muted-foreground">
        Cihaz okuyucu yalnız masaüstü uygulamasında kullanılabilir.
      </p>
    );
  }

  const scan = async () => {
    setScanning(true);
    setListErr(null);
    const r = await scanner.list(transport);
    setDevices(r.devices);
    setAvailable(r.available);
    setListErr(r.error);
    setScanning(false);
  };

  return (
    <div className="space-y-4">
      <FlagToggle
        title="Seri/HID cihaz okuyucu (Faz-2)"
        desc={
          <>
            Yalnız <strong>klavye-wedge yapamayan</strong>, seri-COM / Bluetooth-SPP / raw-HID
            moduna kilitli tabancalar için. Çoğu tabanca klavye modunda çalışır ve bu ayara gerek
            duymaz. Açıkken kod okutulduğunda doğrudan "her yerde okut" paneli açılır.
          </>
        }
        checked={dev.enabled ?? false}
        onChange={(v) => setDevice({ enabled: v })}
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs">
          <span className="block text-muted-foreground">Bağlantı tipi</span>
          <Select value={transport} onValueChange={(v) => setDevice({ transport: v as ScannerTransport })}>
            <SelectTrigger className="mt-1 w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(TRANSPORT_LABELS) as ScannerTransport[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {TRANSPORT_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        {transport === "serial" && (
          <label className="text-xs">
            <span className="block text-muted-foreground">Baud</span>
            <Input
              type="number"
              className="mt-1 w-28"
              value={dev.baudRate ?? 9600}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n > 0) setDevice({ baudRate: n });
              }}
            />
          </label>
        )}

        <label className="text-xs">
          <span className="block text-muted-foreground">Çerçeve sonu</span>
          <Select value={frame} onValueChange={(v) => setDevice({ frameTerminator: v as ScanTerminatorPref })}>
            <SelectTrigger className="mt-1 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(FRAME_LABELS) as ScanTerminatorPref[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {FRAME_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      {transport !== "mock" && (
        <div className="space-y-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void scan()} disabled={scanning}>
            {scanning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Usb className="mr-1 h-4 w-4" />}
            Cihazları Tara
          </Button>
          {available === false && (
            <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Sürücü modülü bu derlemede hazır değil. Etkinleştirmek için bir kez{" "}
              <code>npm run electron:rebuild</code> çalıştırın. {listErr ? `(${listErr})` : ""}
            </p>
          )}
          {available && devices.length > 0 && (
            <label className="block text-xs">
              <span className="block text-muted-foreground">Cihaz</span>
              <Select
                value={dev.path ?? ""}
                onValueChange={(p) => {
                  const d = devices.find((x) => x.path === p);
                  setDevice({ path: p, vendorId: d?.vendorId, productId: d?.productId });
                }}
              >
                <SelectTrigger className="mt-1 w-full max-w-md">
                  <SelectValue placeholder="Cihaz seçin…" />
                </SelectTrigger>
                <SelectContent>
                  {devices.map((d) => (
                    <SelectItem key={d.path} value={d.path}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
          {available && devices.length === 0 && !scanning && (
            <p className="text-xs text-muted-foreground">Cihaz bulunamadı.</p>
          )}
        </div>
      )}

      {/* Durum + boru hattı testi */}
      <div className="flex items-center justify-between rounded-md border px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5">
          {status?.connected ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-500" />
              Bağlı ({status.transport} · {status.path})
            </>
          ) : (
            <span className="text-muted-foreground">
              Bağlı değil{status?.error ? ` — ${status.error}` : ""}
            </span>
          )}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => scanner.mockEmit("TEKS-20260615-AB12CD34")}
        >
          Test kodu gönder
        </Button>
      </div>
    </div>
  );
}
