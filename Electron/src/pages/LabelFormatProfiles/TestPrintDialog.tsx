import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Send } from "lucide-react";
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
  const [printerIp, setPrinterIp] = useState("");
  const [lang, setLang] = useState<PrinterLanguage>("PPLA");
  const [result, setResult] = useState<NativeSendResult | null>(null);

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
        if (!o) setResult(null);
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

        <div className="space-y-2 rounded-md border p-3">
          <div className="text-sm font-medium">Gerçek yazıcıya test gönder (opsiyonel)</div>
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
          <p className="text-[10px] text-muted-foreground">
            Doğrudan gönderim Genel Ayarlar'dan açık değilse yalnız simüle edilir (Faz-1).
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
