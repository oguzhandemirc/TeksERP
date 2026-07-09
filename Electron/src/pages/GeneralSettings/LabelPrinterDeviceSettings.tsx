import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Usb, AlertTriangle, Printer } from "lucide-react";
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
import type { LabelPrinterConfig } from "@/lib/machine-config";
import { loadAllForPicker } from "@/lib/picker-loader";
import { peripheralService } from "@/pages/PeripheralDevices/service";
import { FlagToggle } from "./SettingRow";
import type { ScannerDeviceInfo } from "@shared/ipc-contract";

/**
 * Etiket yazıcısı (Argox seri/COM) — bu bilgisayara özel YEREL tercih. Açık + port
 * seçiliyse etiket baskısı OS yazdırma diyaloğu yerine doğrudan seri/COM porta ham
 * PPLA gönderir → "her seferinde yazdırma ekranı çıkması" sorunu kalkar. BT modülü
 * eşleşince yazıcı Windows'ta sanal COM portu olur (USB kablo da COM); ikisi de burada
 * seçilir. Seri sürücü (serialport) tarayıcı ile aynı; bir kez `electron:rebuild` ister.
 * window.api yoksa (web/test) görünmez.
 */
export function LabelPrinterDeviceSettings() {
  const { config, setConfig } = useMachineConfig();
  const cfg = config.labelPrinter ?? {};
  const setCfg = (patch: Partial<LabelPrinterConfig>) =>
    setConfig({ labelPrinter: { ...cfg, ...patch } });
  const transport = cfg.transport ?? "serial";

  const printer = typeof window !== "undefined" ? window.api?.printer : undefined;
  const [devices, setDevices] = useState<ScannerDeviceInfo[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  // Cihaz Kaydı'ndaki etiket yazıcıları — dil/profil/şablon yönlendirmesi için.
  const peripheralsQuery = useQuery({
    queryKey: ["peripherals", "label-printer-picker"],
    queryFn: () =>
      loadAllForPicker(peripheralService, {
        filters: { kind: "LABEL_PRINTER", isActive: "true" },
      }),
  });
  const labelPrinters = peripheralsQuery.data?.data ?? [];

  if (!printer) {
    return (
      <p className="text-xs text-muted-foreground">
        Etiket yazıcısı yalnız masaüstü uygulamasında ayarlanabilir.
      </p>
    );
  }

  const scan = async () => {
    setScanning(true);
    setListErr(null);
    const r = transport === "cups" ? await printer.listCups() : await printer.listSerial();
    setDevices(r.devices);
    setAvailable(r.available);
    setListErr(r.error);
    setScanning(false);
  };

  const test = async () => {
    if (!cfg.path) return;
    setTesting(true);
    setTestMsg(null);
    // Zararsız test: CR yaz — port açılır + yazılır (etiket harcamaz). Argox yanıt vermez.
    const res = await printer.send({
      transport,
      target: cfg.path,
      baudRate: cfg.baudRate,
      content: "\r",
    });
    setTestMsg(
      res.ok
        ? { ok: true, text: `Bağlantı tamam — port açıldı, ${res.bytes} bayt yazıldı.` }
        : {
            ok: false,
            text: res.available
              ? `Hata: ${res.error ?? "bilinmeyen"}`
              : "Seri sürücü bu derlemede hazır değil — bir kez npm run electron:rebuild.",
          },
    );
    setTesting(false);
  };

  return (
    <div className="space-y-4">
      <FlagToggle
        title="Diyalogsuz doğrudan baskı"
        desc="Açıkken top/yeniden-etiket baskısı OS yazdırma diyaloğu yerine yazıcıya doğrudan native komut (PPLA/PPLB/ZPL) gönderir. Dil aşağıda seçilen Cihaz Kaydı yazıcısından çözülür — cihaz seçilmeden native baskı yapılmaz. Kapalıyken eski davranış (yazdırma ekranı) sürer."
        checked={cfg.enabled ?? false}
        onChange={(v) => setCfg({ enabled: v })}
      />

      <label className="block text-xs">
        <span className="block text-muted-foreground">Bağlantı türü</span>
        <Select
          value={transport}
          onValueChange={(t) => { setCfg({ transport: t as "serial" | "cups", path: undefined }); setDevices([]); setAvailable(null); }}
        >
          <SelectTrigger className="mt-1 w-full max-w-md">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="serial">Seri / COM (fabrika · Windows sanal COM / USB-CDC)</SelectItem>
            <SelectItem value="cups">macOS / Linux — CUPS kuyruğu (USB yazıcı)</SelectItem>
          </SelectContent>
        </Select>
      </label>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void scan()} disabled={scanning}>
            {scanning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Usb className="mr-1 h-4 w-4" />}
            {transport === "cups" ? "Kuyrukları Tara" : "Portları Tara"}
          </Button>
        </div>
        {transport === "serial" && (
          <label className="text-xs">
            <span className="block text-muted-foreground">Baud</span>
            <Input
              type="number"
              className="mt-1 w-28"
              value={cfg.baudRate ?? 9600}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n > 0) setCfg({ baudRate: n });
              }}
            />
          </label>
        )}
      </div>

      {available === false && (
        <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {transport === "cups"
            ? "CUPS bulunamadı (lp/lpstat yok). Bu seçenek yalnız macOS/Linux içindir."
            : <>Seri sürücü bu derlemede hazır değil. Bir kez <code>npm run electron:rebuild</code> çalıştırın.</>}
          {listErr ? ` (${listErr})` : ""}
        </p>
      )}
      {available && devices.length > 0 && (
        <label className="block text-xs">
          <span className="block text-muted-foreground">
            {transport === "cups" ? "CUPS kuyruğu" : "Yazıcı portu (COM)"}
          </span>
          <Select value={cfg.path ?? ""} onValueChange={(p) => setCfg({ path: p })}>
            <SelectTrigger className="mt-1 w-full max-w-md">
              <SelectValue placeholder="Port seçin…" />
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
        <p className="text-xs text-muted-foreground">Port bulunamadı.</p>
      )}

      {/* Cihaz Kaydı yönlendirmesi — dil/şablon global ayar yerine seçili cihazdan
          çözülür (backend ?peripheralId=). Böylece bu bilgisayar farklı dilde basarken
          (ör. Bixolon=ZPL) global "Etiket yazıcı dili" ve diğer istasyonlar bozulmaz. */}
      <label className="block text-xs">
        <span className="block text-muted-foreground">
          Cihaz Kaydı yazıcısı (dil / şablon yönlendirme)
        </span>
        <Select
          value={cfg.peripheralId ?? "none"}
          onValueChange={(v) => setCfg({ peripheralId: v === "none" ? undefined : v })}
        >
          <SelectTrigger className="mt-1 w-full max-w-md">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Yok — genel &quot;Etiket yazıcı dili&quot; kullanılır</SelectItem>
            {labelPrinters.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name} — {p.languageOverride ?? "dil: genel"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="mt-0.5 block text-muted-foreground">
          Etiket dili ve şablonu bu cihazın kaydından (Tanımlar → Donanım) çözülür.
          Diyalogsuz baskı için seçim ZORUNLU — seçilmezse istek HTML döner ve
          native baskı net hatayla durur.
        </span>
      </label>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void test()}
          disabled={!cfg.path || testing}
        >
          {testing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Printer className="mr-1 h-4 w-4" />}
          Bağlantıyı Test Et
        </Button>
        {testMsg && (
          <span className={`text-xs ${testMsg.ok ? "text-emerald-600 dark:text-emerald-500" : "text-destructive"}`}>
            {testMsg.text}
          </span>
        )}
      </div>
    </div>
  );
}
