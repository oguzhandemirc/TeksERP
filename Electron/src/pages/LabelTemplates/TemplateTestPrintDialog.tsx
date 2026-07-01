import { useState } from "react";
import { Send, Printer, Usb } from "lucide-react";
import { usePreferences } from "@/providers/PreferencesProvider";
import { labelTemplateService, type LabelKind, type TemplateField } from "@/services/labelTemplateService";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: LabelKind;
  fields: TemplateField[];
  lineStepMm: number | null;
  qrScale: number | null;
  lengthBanner: boolean;
}

/**
 * Şablon Test Baskısı — düzenlenen (KAYDEDİLMEMİŞ) alan+yerleşimi örnek veriyle,
 * aktif yazıcı dilinde yazıcıya bastırır (Bu PC / Ağ IP). Native, canlı önizlemenin
 * kaynağıyla AYNI (fieldsPreview.native) → "gördüğün = basılan". Gerçek top gerekmez.
 */
export function TemplateTestPrintDialog({
  open,
  onOpenChange,
  kind,
  fields,
  lineStepMm,
  qrScale,
  lengthBanner,
}: Props) {
  const { prefs } = usePreferences();
  const lpCfg = prefs.labelPrinter;
  const printerApi = typeof window !== "undefined" ? window.api?.printer : undefined;
  const localReady = Boolean(lpCfg?.enabled && lpCfg?.path && printerApi);

  const [mode, setMode] = useState<"local" | "ip">("local");
  const [printerIp, setPrinterIp] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const doSend = async (transport: "cups" | "serial" | "tcp", target: string, baudRate?: number) => {
    if (!printerApi || !target) return;
    setSending(true);
    setResult(null);
    try {
      // Kaydedilmemiş güncel alan+yerleşimin native'i (önizlemeyle aynı kaynak).
      const p = await labelTemplateService.fieldsPreview(kind, fields, { lineStepMm, qrScale, lengthBanner });
      if (p.mode === "html") {
        setResult({ ok: false, text: `Aktif dil (${p.language}) HTML — etiket yazıcısına ham gönderilemez.` });
        return;
      }
      const res = await printerApi.send({ transport, target, baudRate, content: p.native });
      setResult(
        res.ok
          ? { ok: true, text: `Gönderildi → ${target} (${res.bytes} bayt, ${p.language})` }
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
            Şu anki (kaydedilmemiş) tasarım, örnek veriyle, aktif yazıcı dilinde basılır —
            soldaki önizlemenin aynısı. Gerçek top gerekmez.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-md border p-3">
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
                  Yerel yazıcı: <span className="font-mono">{lpCfg?.path}</span> (
                  {lpCfg?.transport ?? "serial"}). Genel Ayarlar → Etiket Yazıcısı'ndan değişir.
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
                Bu PC'de yazıcı ayarlı değil. Genel Ayarlar → Etiket Yazıcısı'ndan aç + kuyruğu/portu seç.
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
          <p className="text-[10px] text-muted-foreground">
            "Bu PC" = yerel yazıcıya doğrudan (USB/CUPS/seri). "Ağ (IP)" = ağ yazıcısına (RAW 9100).
            Değişiklikleri kaydetmeden de test edebilirsin.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
