// =============================================================================
// Bağımsız şablon baskısı — KAYDEDİLMİŞ havuz şablonunu (varyant seç + kopya)
// örnek veriyle bastırır. Hedefler: Bu PC (native) / Ağ IP (RAW 9100) /
// Tarayıcı (HTML — normal yazıcılar için her zaman açık geri düşüş).
// TemplateTestPrintDialog'un kanıtlanmış gönderim mantığının kaydedilmiş-şablon hali.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Send, Printer, Usb, Globe, Star } from "lucide-react";
import { useMachineConfig } from "@/hooks/useMachineConfig";
import { printHtmlString } from "@/lib/print";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  LabelKind,
  RawCodeLang,
  labelTemplateService,
  type LabelTemplateListRow,
} from "@/services/labelTemplateService";
import { CopiesInput } from "./CopiesInput";
import { TemplatePrintPreview } from "./TemplatePrintPreview";

interface Props {
  template: LabelTemplateListRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Serbest etiket bağlamı — açıklama metnini "rulo verisi" yerine statik/örnek
   *  içerik olarak sadeleştirir (istek gövdesi değişmez). */
  standalone?: boolean;
}

type PrintTarget = "local" | "ip" | "html";

export function TemplatePrintDialog({ template, open, onOpenChange, standalone }: Props) {
  const { config } = useMachineConfig();
  const lpCfg = config.labelPrinter;
  const printerApi = typeof window !== "undefined" ? window.api?.printer : undefined;
  const localReady = Boolean(lpCfg?.enabled && lpCfg?.path && printerApi);

  const variantsQ = useQuery({
    queryKey: ["label-template-variants", template.id],
    queryFn: () => labelTemplateService.listVariants(template.id),
    enabled: open,
  });
  const variants = useMemo(() => variantsQ.data ?? [], [variantsQ.data]);

  // Varsayılan varyant: birincil (★), yoksa ilk.
  const [variantId, setVariantId] = useState<string | null>(null);
  const variant = variants.find((v) => v.id === variantId) ?? null;
  useEffect(() => {
    if (variants.length > 0 && !variants.some((v) => v.id === variantId)) {
      const pick = variants.find((v) => v.isPrimary) ?? variants[0];
      if (pick) setVariantId(pick.id);
    }
  }, [variants, variantId]);

  const [copies, setCopies] = useState(1);
  const [target, setTarget] = useState<PrintTarget>("local");
  const [printerIp, setPrinterIp] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Havuz şablonu türsüz olabilir — örnek verinin bağlamı için güvenli varsayılan.
  const kind = template.kind ?? LabelKind.ROLL_FINISHED;
  const noVariants = variantsQ.isFetched && variants.length === 0;
  const hasFieldBinds = Boolean(variant?.elements.elements.some((e) => e.type === "field"));
  const hasConditions = Boolean(variant?.elements.elements.some((e) => e.showIf));
  const canPrint = Boolean(variant) && !sending;

  const fetchOutput = (opts: { language?: RawCodeLang; peripheralId?: string }) => {
    if (!variant) return Promise.reject(new Error("Boyut varyantı seçilmedi."));
    return labelTemplateService.canvasPreview({
      kind,
      widthMm: variant.widthMm,
      heightMm: variant.heightMm,
      elements: variant.elements,
      language: opts.language,
      peripheralId: opts.peripheralId,
      // Yalnız >1 ise gövdeye eklenir — backend "verilmedi = 1" kabul eder.
      copies: copies > 1 ? copies : undefined,
    });
  };

  /** Native gönderim (Bu PC / Ağ IP) — TemplateTestPrintDialog ile aynı fail-closed mantık. */
  const doSendNative = async (
    transport: "cups" | "serial" | "tcp" | "winspool",
    targetPath: string,
    baudRate?: number,
  ) => {
    if (!printerApi || !targetPath || !variant) return;
    setSending(true);
    setResult(null);
    try {
      // Dil/medya seçili Cihaz Kaydı yazıcısından çözülür → gerçek dilde basar.
      const p = await fetchOutput({ peripheralId: lpCfg?.peripheralId });
      if (p.mode === "html" && !p.nativeB64) {
        // FAIL-CLOSED: gerçek HTML çıktısı ham yazıcıya gönderilmez (çöp etiket çıkar).
        // Raster modda mode "html" gelir ama nativeB64 zarfı taşır → o dal aşağıda basar.
        setResult({
          ok: false,
          text: lpCfg?.peripheralId
            ? `Aktif dil (${p.language}) HTML — seçili Cihaz Kaydı yazıcısının dili native değil (Tanımlar → Donanım'dan PPLA/PPLB/ZPL seçin) — veya "Tarayıcı (HTML)" hedefini kullanın.`
            : `Aktif dil (${p.language}) HTML — Genel Ayarlar → Bu Bilgisayar → Yazıcı → "Cihaz Kaydı yazıcısı" seçilmemiş; native baskı için seçin — veya "Tarayıcı (HTML)" hedefini kullanın.`,
        });
        return;
      }
      // Raster modda base64 zarf baytları (binary-safe); komut modunda ham native metin.
      const res = p.nativeB64
        ? await printerApi.send({ transport, target: targetPath, baudRate, contentB64: p.nativeB64 })
        : await printerApi.send({ transport, target: targetPath, baudRate, content: p.native });
      if (res.ok) {
        setResult({ ok: true, text: `Gönderildi → ${targetPath} (${res.bytes} bayt, ${p.language}, ${copies} kopya)` });
        toast.success("Etiket yazıcıya gönderildi.");
      } else {
        setResult({
          ok: false,
          text: res.available ? (res.error ?? "bilinmeyen hata") : "Yazıcı sürücüsü/hedef hazır değil.",
        });
      }
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  /** Tarayıcı baskısı — RASTER_HTML çıktısı izole iframe'den OS yazdırma diyaloğuna. */
  const doPrintHtml = async () => {
    if (!variant) return;
    setSending(true);
    setResult(null);
    try {
      const p = await fetchOutput({ language: RawCodeLang.RASTER_HTML });
      printHtmlString(p.content);
      setResult({ ok: true, text: `Yazdırma penceresi açıldı (${copies} kopya, HTML).` });
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
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Şablonu Yazdır — {template.name}</DialogTitle>
          <DialogDescription>
            {standalone
              ? "Serbest etiket — seçilen boyut varyantıyla doğrudan basılır (statik içerik, rulo/kartela verisi taşımaz)."
              : "Kaydedilmiş şablon, seçilen boyut varyantı ve örnek veriyle basılır. Gerçek top gerekmez."}
          </DialogDescription>
        </DialogHeader>

        {noVariants ? (
          <Callout tone="warning" title="Boyut varyantı yok">
            Bu şablon eski akış düzeninde — bağımsız baskı için Stüdyoda bir boyut varyantı ekleyin.
          </Callout>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[12rem] flex-1 space-y-1">
                <label className="text-xs text-muted-foreground" htmlFor="tpl-print-variant">
                  Boyut varyantı
                </label>
                <Select value={variantId ?? ""} onValueChange={setVariantId} disabled={variantsQ.isLoading}>
                  <SelectTrigger id="tpl-print-variant" className="h-8 text-xs">
                    <SelectValue placeholder={variantsQ.isLoading ? "Yükleniyor…" : "Varyant seçin"} />
                  </SelectTrigger>
                  <SelectContent>
                    {variants.map((v) => (
                      <SelectItem key={v.id} value={v.id} className="text-xs">
                        <span className="inline-flex items-center gap-1">
                          {v.isPrimary && <Star className="h-3 w-3" />}
                          {v.name} — {v.widthMm}×{v.heightMm} mm
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <CopiesInput id="tpl-print-copies" value={copies} onChange={setCopies} disabled={sending} />
            </div>

            {hasFieldBinds && (
              <Callout tone="info">
                Alan bağları örnek veriyle basılır (bu baskı gerçek rulo verisi taşımaz).
              </Callout>
            )}

            {/* Koşullu (showIf) eleman örnek topun kalitesine göre değerlendirilir →
                bu örnek baskıda görünmeyebilir. Sessiz kalırsa "tasarım bozuk" sanılır. */}
            {hasConditions && (
              <Callout tone="info">
                Bu tasarımda kaliteye bağlı (koşullu) eleman var — örnek baskı örnek
                topun kalitesini kullanır, o yüzden koşullu eleman burada
                çıkmayabilir. Koşulu denemek için Etiket Stüdyosu'ndaki önizlemede
                "Örnek: kalite" seçimini değiştirin.
              </Callout>
            )}

            {variant && <TemplatePrintPreview kind={kind} variant={variant} />}

            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">Hedef</div>
                <div className="flex gap-1">
                  <Button type="button" size="sm" variant={target === "local" ? "default" : "outline"}
                    className="h-7 gap-1 text-xs" onClick={() => setTarget("local")}>
                    <Usb className="h-3.5 w-3.5" /> Bu PC
                  </Button>
                  <Button type="button" size="sm" variant={target === "ip" ? "default" : "outline"}
                    className="h-7 gap-1 text-xs" onClick={() => setTarget("ip")}>
                    <Send className="h-3.5 w-3.5" /> Ağ (IP)
                  </Button>
                  <Button type="button" size="sm" variant={target === "html" ? "default" : "outline"}
                    className="h-7 gap-1 text-xs" onClick={() => setTarget("html")}>
                    <Globe className="h-3.5 w-3.5" /> Tarayıcı (HTML)
                  </Button>
                </div>
              </div>

              {target === "local" && (localReady ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Yerel yazıcı: <span className="font-mono">{lpCfg?.path}</span> (
                    {lpCfg?.transport ?? "serial"}). Genel Ayarlar → Etiket Yazıcısı'ndan değişir.
                  </p>
                  <Button type="button" disabled={!canPrint}
                    onClick={() => void doSendNative(lpCfg?.transport ?? "serial", lpCfg!.path!, lpCfg?.baudRate)}
                    className="gap-1">
                    <Printer className="h-3.5 w-3.5" /> {sending ? "Gönderiliyor…" : "Bu PC'deki yazıcıya bas"}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  Bu PC'de etiket yazıcısı ayarlı değil. Genel Ayarlar → Etiket Yazıcısı'ndan aç + kuyruğu/portu
                  seç — veya "Tarayıcı (HTML)" hedefiyle normal yazıcıya bas.
                </p>
              ))}

              {target === "ip" && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[10rem] flex-1">
                    <label className="text-xs text-muted-foreground" htmlFor="tpl-print-ip">
                      Yazıcı IP (ağ / 9100)
                    </label>
                    <Input id="tpl-print-ip" value={printerIp} onChange={(e) => setPrinterIp(e.target.value)}
                      placeholder="192.168.1.50" className="font-mono" />
                  </div>
                  <Button type="button" disabled={!printerIp.trim() || !canPrint || !printerApi}
                    onClick={() => void doSendNative("tcp", printerIp.trim())} className="gap-1">
                    <Send className="h-3.5 w-3.5" /> {sending ? "Gönderiliyor…" : "Gönder"}
                  </Button>
                </div>
              )}

              {target === "html" && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Etiket HTML olarak üretilir ve işletim sisteminin yazdırma penceresi açılır —
                    etiket yazıcısı olmayan normal (A4/ofis) yazıcılar için.
                  </p>
                  <Button type="button" disabled={!canPrint} onClick={() => void doPrintHtml()} className="gap-1">
                    <Printer className="h-3.5 w-3.5" /> {sending ? "Hazırlanıyor…" : "Tarayıcıdan Yazdır"}
                  </Button>
                </div>
              )}

              {result && (
                <div className={`rounded-md border px-3 py-2 text-xs ${
                  result.ok
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                    : "border-amber-300 bg-amber-50 text-amber-800"
                }`}>
                  {result.ok ? `✓ ${result.text}` : `Gönderilemedi: ${result.text}`}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                "Bu PC" = yerel etiket yazıcısına doğrudan (USB/CUPS/seri). "Ağ (IP)" = ağ yazıcısına
                (RAW 9100). "Tarayıcı (HTML)" = OS yazdırma penceresi (her yazıcı).
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
