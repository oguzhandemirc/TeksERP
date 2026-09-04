import { useState } from "react";
import { Send, Printer, Usb } from "lucide-react";
import { useMachineConfig } from "@/hooks/useMachineConfig";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CopiesInput } from "./CopiesInput";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Kaydedilmemiş güncel tasarımın native çıktısını üretir — önizlemeyle AYNI
   *  kaynak ("gördüğün = basılan"). Kanvas editörü canvasPreview'i bağlar.
   *  `peripheralId` verilirse dil/medya O CİHAZDAN çözülür (yerel yazıcı = PPLB vs.);
   *  yoksa varsayılan (cihazsız → RASTER_HTML). `copies` verilirse baskı o kadar
   *  çoğaltılır (backend copies desteği). */
  fetchNative: (opts?: { peripheralId?: string; copies?: number }) => Promise<{
    mode: "svg" | "html" | "text";
    language: string;
    native: string;
    /** Raster modda: zarf baytlarının base64'ü (binary-safe gönderim). */
    nativeB64?: string;
  }>;
}

/**
 * Şablon Test Baskısı — düzenlenen (KAYDEDİLMEMİŞ) tasarımı örnek veriyle,
 * aktif yazıcı dilinde yazıcıya bastırır (Bu PC / Ağ IP). Gerçek top gerekmez.
 */
export function TemplateTestPrintDialog({ open, onOpenChange, fetchNative }: Props) {
  const { config } = useMachineConfig();
  const lpCfg = config.labelPrinter;
  const printerApi = typeof window !== "undefined" ? window.api?.printer : undefined;
  const localReady = Boolean(lpCfg?.enabled && lpCfg?.path && printerApi);

  const [mode, setMode] = useState<"local" | "ip">("local");
  const [printerIp, setPrinterIp] = useState("");
  const [copies, setCopies] = useState(1);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const doSend = async (transport: "cups" | "serial" | "tcp" | "winspool", target: string, baudRate?: number) => {
    if (!printerApi || !target) return;
    setSending(true);
    setResult(null);
    try {
      // Kaydedilmemiş güncel tasarımın native'i (önizlemeyle aynı kaynak). Yerel
      // hedefte dil/medya seçili Cihaz Kaydı yazıcısından çözülür → gerçek dilde basar.
      // copies yalnız >1 ise gönderilir — backend "verilmedi = 1" kabul eder.
      const p = await fetchNative({
        peripheralId: lpCfg?.peripheralId,
        copies: copies > 1 ? copies : undefined,
      });
      // Raster modda mode "html" gelir ama nativeB64 zarfı taşır → o dal aşağıda basar.
      if (p.mode === "html" && !p.nativeB64) {
        setResult({
          ok: false,
          text: lpCfg?.peripheralId
            ? `Aktif dil (${p.language}) HTML — seçili Cihaz Kaydı yazıcısının dili native değil (Tanımlar → Donanım'dan PPLA/PPLB/ZPL seçin).`
            : `Aktif dil (${p.language}) HTML — Genel Ayarlar → Bu Bilgisayar → Yazıcı → "Cihaz Kaydı yazıcısı" seçilmemiş; native baskı için seçin.`,
        });
        return;
      }
      // Raster modda base64 zarf baytları (binary-safe); komut modunda ham native metin.
      const res = p.nativeB64
        ? await printerApi.send({ transport, target, baudRate, contentB64: p.nativeB64 })
        : await printerApi.send({ transport, target, baudRate, content: p.native });
      setResult(
        res.ok
          ? { ok: true, text: `Gönderildi → ${target} (${res.bytes} bayt, ${p.language}, ${copies} kopya)` }
          : { ok: false, text: res.available ? (res.error ?? "bilinmeyen hata") : "Yazıcı sürücüsü/hedef hazır değil." },
      );
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setResult(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Test Baskısı</DialogTitle>
          <DialogDescription>
            Kaydedilmemiş tasarımı örnek veriyle basar (önizlemenin aynısı).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-md border p-3">
          <CopiesInput id="tpl-test-copies" value={copies} onChange={setCopies} disabled={sending} />
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">Hedef</div>
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant={mode === "local" ? "default" : "outline"}
                className="h-7 gap-1 text-xs"
                onClick={() => setMode("local")}
              >
                <Usb className="h-3.5 w-3.5" /> Bu PC
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "ip" ? "default" : "outline"}
                className="h-7 gap-1 text-xs"
                onClick={() => setMode("ip")}
              >
                <Send className="h-3.5 w-3.5" /> Ağ (IP)
              </Button>
            </div>
          </div>

          {mode === "local" ? (
            localReady ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Yazıcı: <span className="font-mono">{lpCfg?.path}</span>
                </p>
                <Button
                  type="button"
                  disabled={sending}
                  onClick={() => void doSend(lpCfg?.transport ?? "serial", lpCfg!.path!, lpCfg?.baudRate)}
                  className="gap-1"
                >
                  <Printer className="h-3.5 w-3.5" /> {sending ? "Gönderiliyor…" : "Bu PC'deki yazıcıya bas"}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                Bu PC'de yazıcı seçili değil — Genel Ayarlar → Etiket Yazıcısı.
              </p>
            )
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[10rem] flex-1">
                <label className="text-xs text-muted-foreground" htmlFor="tpl-test-ip">
                  Yazıcı IP (ağ / 9100)
                </label>
                <Input
                  id="tpl-test-ip"
                  value={printerIp}
                  onChange={(e) => setPrinterIp(e.target.value)}
                  placeholder="192.168.1.50"
                  className="font-mono"
                />
              </div>
              <Button
                type="button"
                disabled={!printerIp.trim() || sending || !printerApi}
                onClick={() => void doSend("tcp", printerIp.trim())}
                className="gap-1"
              >
                <Send className="h-3.5 w-3.5" /> {sending ? "Gönderiliyor…" : "Gönder"}
              </Button>
            </div>
          )}

          {result && (
            <div
              className={`rounded-md border px-3 py-2 text-xs ${
                result.ok
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : "border-amber-300 bg-amber-50 text-amber-800"
              }`}
            >
              {result.ok ? `✓ ${result.text}` : `Gönderilemedi: ${result.text}`}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
