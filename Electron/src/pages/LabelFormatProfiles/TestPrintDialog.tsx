import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Send, Printer, Usb } from "lucide-react";
import { usePreferences } from "@/providers/PreferencesProvider";
import { labelFormatProfileService } from "./service";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRINTER_LANGUAGE_LABELS, type PrinterLanguage } from "@/services/featureFlagService";

const LANGS: PrinterLanguage[] = ["PPLA", "PPLB", "ZPL"];

// Etiket türü — o türün gerçek standart şablonuyla + tür-uygun örnek veriyle basılır.
const KINDS = [
  { value: "ROLL_RAW", label: "Ham Top (renksiz)" },
  { value: "ROLL_FINISHED", label: "Bitmiş Top (renkli)" },
  { value: "SWATCH", label: "Kartela" },
] as const;
type Kind = (typeof KINDS)[number]["value"];

interface Props {
  /** Test edilecek (kayıtlı) profil id'si — null = kapalı. */
  profileId: string | null;
  profileName?: string;
  onOpenChange: (open: boolean) => void;
}

/**
 * Test Baskısı — profil geometrisinde SEÇİLEN TÜRÜN (Ham/Bitmiş/Kartela) gerçek
 * standart etiketini önizler + yerel (Bu PC) veya ağ (IP) yazıcıya bastırır. Örnek
 * veriyle çalışır; gerçek top gerekmez. Kayıtlı profili test eder (önce kaydet).
 */
export function TestPrintDialog({ profileId, profileName, onOpenChange }: Props) {
  const open = Boolean(profileId);
  const { prefs } = usePreferences();
  const lpCfg = prefs.labelPrinter;
  const printerApi = typeof window !== "undefined" ? window.api?.printer : undefined;
  const localReady = Boolean(lpCfg?.enabled && lpCfg?.path && printerApi);

  const [kind, setKind] = useState<Kind>("ROLL_RAW");
  const [mode, setMode] = useState<"local" | "ip">("local");
  const [printerIp, setPrinterIp] = useState("");
  const [lang, setLang] = useState<PrinterLanguage>("PPLB");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const htmlQ = useQuery({
    queryKey: ["format-profile-sample", profileId, kind],
    queryFn: () => labelFormatProfileService.sampleHtml(profileId!, kind),
    enabled: open,
    staleTime: 0,
  });

  // Ortak gönderim: seçilen türün örnek native'ini çek + yazıcıya (yerel/ağ) gönder.
  const doSend = async (transport: "cups" | "serial" | "tcp", target: string, baudRate?: number) => {
    if (!printerApi || !profileId || !target) return;
    setSending(true);
    setResult(null);
    try {
      const native = await labelFormatProfileService.sampleNative(profileId, lang, kind);
      const res = await printerApi.send({ transport, target, baudRate, content: native });
      setResult(
        res.ok
          ? { ok: true, text: `Gönderildi → ${target} (${res.bytes} bayt)` }
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
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Test Baskısı{profileName ? ` — ${profileName}` : ""}</DialogTitle>
          <DialogDescription>
            Seçtiğin türün (Ham/Bitmiş/Kartela) gerçek standart etiketi, bu profilin
            boyutunda. Önce önizle, sonra istersen yazıcıya bas.
          </DialogDescription>
        </DialogHeader>

        <div className="w-56">
          <label className="text-xs text-muted-foreground">Etiket türü</label>
          <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {htmlQ.isLoading ? (
          <Skeleton className="h-[420px] w-full" />
        ) : htmlQ.isError ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-destructive">
            Örnek etiket alınamadı: {(htmlQ.error as Error).message}
          </div>
        ) : (
          <iframe
            title="Örnek etiket"
            srcDoc={htmlQ.data ?? ""}
            sandbox="allow-same-origin allow-modals"
            className="h-[420px] w-full rounded border bg-white"
          />
        )}

        <div className="space-y-3 rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">Test baskısı gönder</div>
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

          <div className="w-44">
            <label className="text-xs text-muted-foreground">Dil</label>
            <Select value={lang} onValueChange={(v) => setLang(v as PrinterLanguage)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {PRINTER_LANGUAGE_LABELS[l]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {mode === "local" ? (
            <div className="space-y-2">
              {localReady ? (
                <>
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
                </>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  Bu PC'de yazıcı ayarlı değil. Genel Ayarlar → Etiket Yazıcısı'ndan aç + kuyruğu/portu seç.
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[12rem] flex-1">
                <label className="text-xs text-muted-foreground" htmlFor="test-printer-ip">
                  Yazıcı IP (ağ / 9100)
                </label>
                <Input
                  id="test-printer-ip"
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
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
