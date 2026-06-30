import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { labelService, type NativeSendResult } from "@/services/labelService";
import { PRINTER_LANGUAGE_LABELS, type PrinterLanguage } from "@/services/featureFlagService";

// Native gönderim dilleri (HTML hariç — HTML önizleme zaten iframe'de, doğrudan gönderim yok).
const LANGS: PrinterLanguage[] = ["PPLA", "PPLB", "ZPL"];

interface Props {
  /** Test edilecek (kayıtlı) profil id'si — null = kapalı. */
  profileId: string | null;
  profileName?: string;
  onOpenChange: (open: boolean) => void;
}

/**
 * Test Baskısı — profil geometrisinde örnek etiket önizleme (boyut/pay doğrulama)
 * + opsiyonel "gerçek yazıcıya gönder". Doğrudan gönderim Genel Ayarlar'dan kapalıysa
 * simüle eder. Kayıtlı profili test eder (önce düzenlemeyi kaydet).
 */
export function TestPrintDialog({ profileId, profileName, onOpenChange }: Props) {
  const open = Boolean(profileId);
  const { prefs } = usePreferences();
  const lpCfg = prefs.labelPrinter;
  const printerApi = typeof window !== "undefined" ? window.api?.printer : undefined;
  const localReady = Boolean(lpCfg?.enabled && lpCfg?.path && printerApi);

  const [mode, setMode] = useState<"local" | "ip">("local");
  const [printerIp, setPrinterIp] = useState("");
  const [lang, setLang] = useState<PrinterLanguage>("PPLB");
  const [result, setResult] = useState<NativeSendResult | null>(null);
  const [localResult, setLocalResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [localSending, setLocalSending] = useState(false);

  // "Bu PC" testi: örnek native'i çek + yerel yazıcıya (CUPS/seri) doğrudan gönder.
  const localTest = async () => {
    if (!printerApi || !lpCfg?.path || !profileId) return;
    setLocalSending(true);
    setLocalResult(null);
    try {
      const native = await labelFormatProfileService.sampleNative(profileId, lang);
      const res = await printerApi.send({
        transport: lpCfg.transport ?? "serial",
        target: lpCfg.path,
        baudRate: lpCfg.baudRate,
        content: native,
      });
      setLocalResult(
        res.ok
          ? { ok: true, text: `Gönderildi → ${lpCfg.path} (${res.bytes} bayt)` }
          : {
              ok: false,
              text: res.available ? `Hata: ${res.error ?? "bilinmeyen"}` : "Yerel yazıcı sürücüsü hazır değil.",
            },
      );
    } catch (e) {
      setLocalResult({ ok: false, text: (e as Error).message });
    } finally {
      setLocalSending(false);
    }
  };

  const htmlQ = useQuery({
    queryKey: ["format-profile-sample", profileId],
    queryFn: () => labelService.getFormatProfileSampleHtml(profileId!),
    enabled: open,
    staleTime: 0,
  });

  const sendMut = useMutation({
    mutationFn: () =>
      labelService.testNativeSend({ profileId: profileId!, printerIp: printerIp.trim(), language: lang }),
    onSuccess: (res) => {
      setResult(res.data);
      if (res.data.delivered) toast.success("Yazıcıya gönderildi.");
      else if (res.data.simulated) toast.message("Simüle edildi (doğrudan gönderim kapalı).");
      else toast.error(res.data.error ?? "Gönderilemedi.");
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setResult(null);
          setLocalResult(null);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Test Baskısı{profileName ? ` — ${profileName}` : ""}</DialogTitle>
          <DialogDescription>
            Profil geometrisinde örnek etiket. Boyut/payın doğru olup olmadığını kontrol et;
            istersen gerçek yazıcıya da gönder.
          </DialogDescription>
        </DialogHeader>

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
                  <Button type="button" disabled={localSending} onClick={() => void localTest()} className="gap-1">
                    <Printer className="h-3.5 w-3.5" /> {localSending ? "Gönderiliyor…" : "Bu PC'deki yazıcıya bas"}
                  </Button>
                </>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  Bu PC'de yazıcı ayarlı değil. Genel Ayarlar → Etiket Yazıcısı'ndan aç + kuyruğu/portu seç.
                </p>
              )}
              {localResult && (
                <div
                  className={`rounded-md border px-3 py-2 text-xs ${
                    localResult.ok
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "border-amber-300 bg-amber-50 text-amber-800"
                  }`}
                >
                  {localResult.ok ? `✓ ${localResult.text}` : `Gönderilemedi: ${localResult.text}`}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[12rem] flex-1">
                  <label className="text-xs text-muted-foreground" htmlFor="test-printer-ip">
                    Yazıcı IP
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
                  disabled={!printerIp.trim() || sendMut.isPending}
                  onClick={() => sendMut.mutate()}
                  className="gap-1"
                >
                  <Send className="h-3.5 w-3.5" /> {sendMut.isPending ? "Gönderiliyor…" : "Gönder"}
                </Button>
              </div>
              {result && (
                <div
                  className={`rounded-md border px-3 py-2 text-xs ${
                    result.delivered
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : result.simulated
                        ? "border-sky-300 bg-sky-50 text-sky-800"
                        : "border-amber-300 bg-amber-50 text-amber-800"
                  }`}
                >
                  {result.delivered
                    ? `✓ Gönderildi — ${result.bytes} bayt → ${result.target}`
                    : result.simulated
                      ? `Simüle edildi (doğrudan gönderim KAPALI — Genel Ayarlar'dan açın). Hedef: ${result.target}`
                      : `Gönderilemedi: ${result.error ?? result.note}`}
                </div>
              )}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            "Bu PC" = yerel yazıcıya doğrudan (USB/CUPS/seri). "Ağ (IP)" = backend'den ağ yazıcısına
            (9100); doğrudan gönderim kapalıysa simüle (Faz-1).
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
