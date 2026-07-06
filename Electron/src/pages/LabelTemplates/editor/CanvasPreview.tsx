// =============================================================================
// Etiket Stüdyosu — kanvas WYSIWYG önizleme (backend render; önizleme = baskı)
// =============================================================================
// Nihai görüntü DAİMA backend'ten: tasarım → emit → native→SVG / HTML. Kanvas
// sahnesi yaklaşıktır; buradaki görüntü yazıcıya gidenin aynısıdır. 350ms
// debounce ile kaydetmeden canlı yansır. Dil seçilebilir (Aktif = cihaz ayarı).

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, Code2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  labelTemplateService,
  rawCodeLangLabels,
  type LabelKind,
  type RawCodeLang,
} from "@/services/labelTemplateService";
import type { CanvasLayout } from "@/types/label-canvas";

interface Props {
  kind: LabelKind;
  widthMm: number;
  heightMm: number;
  layout: CanvasLayout;
}

export function CanvasPreview({ kind, widthMm, heightMm, layout }: Props) {
  const [view, setView] = useState<"visual" | "code">("visual");
  const [lang, setLang] = useState<"active" | RawCodeLang>("active");

  // 350ms debounce — her sürükleme adımında backend'e gitmesin.
  const liveKey = JSON.stringify({ kind, widthMm, heightMm, layout, lang });
  const [debouncedKey, setDebouncedKey] = useState(liveKey);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedKey(liveKey), 350);
    return () => clearTimeout(t);
  }, [liveKey]);

  const previewQ = useQuery({
    queryKey: ["label-canvas-preview", debouncedKey],
    queryFn: () => {
      const p = JSON.parse(debouncedKey) as {
        kind: LabelKind; widthMm: number; heightMm: number; layout: CanvasLayout; lang: "active" | RawCodeLang;
      };
      return labelTemplateService.canvasPreview({
        kind: p.kind,
        widthMm: p.widthMm,
        heightMm: p.heightMm,
        elements: p.layout,
        language: p.lang === "active" ? undefined : p.lang,
      });
    },
    enabled: layout.elements.length > 0,
    staleTime: 0,
    retry: false,
  });
  const p = previewQ.data;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="Önizleme görünümü">
          <button type="button" role="tab" aria-selected={view === "visual"} onClick={() => setView("visual")}
            className={cn("flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium",
              view === "visual" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            <Eye className="h-3 w-3" /> Görsel
          </button>
          <button type="button" role="tab" aria-selected={view === "code"} onClick={() => setView("code")}
            className={cn("flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium",
              view === "code" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            <Code2 className="h-3 w-3" /> Kod
          </button>
        </div>
        <div className="flex items-center gap-1">
          <Select value={lang} onValueChange={(v) => setLang(v as "active" | RawCodeLang)}>
            <SelectTrigger className="h-6 w-[130px] text-[10px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active" className="text-xs">Aktif dil</SelectItem>
              {(Object.keys(rawCodeLangLabels) as RawCodeLang[]).map((l) => (
                <SelectItem key={l} value={l} className="text-xs">{rawCodeLangLabels[l]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {p && (
            <Badge variant="outline" className="text-[10px]" title="Baskıya giden çıktının aynısı">
              {p.language}{p.mode === "text" ? " · ham" : " · önizleme = baskı"}
            </Badge>
          )}
        </div>
      </div>

      <div className="rounded-lg border-2 border-dashed bg-background p-2 shadow-sm">
        {layout.elements.length === 0 ? (
          <div className="py-8 text-center text-xs italic text-muted-foreground">Tuval boş.</div>
        ) : previewQ.isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : previewQ.isError ? (
          <div className="py-6 text-center text-xs italic text-destructive">
            Önizleme alınamadı: {(previewQ.error as Error).message}
          </div>
        ) : view === "code" || p?.mode === "text" ? (
          <pre className="h-[480px] overflow-auto whitespace-pre-wrap break-all rounded bg-muted/20 p-2 font-mono text-[11px] leading-relaxed">
            {view === "code" ? p?.native ?? "" : p?.content ?? ""}
          </pre>
        ) : (
          <iframe
            title="Kanvas önizleme"
            srcDoc={p?.content ?? ""}
            sandbox="allow-same-origin allow-modals"
            className="h-[480px] w-full rounded border bg-white"
          />
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Örnek (mock) veriyle backend'te üretildi — yazıcıya gidenin aynısı. Native dillerde
        Türkçe karakter ASCII'ye katlanır (Ş→S); HTML/ev-tipi tam Türkçe basar.
      </p>
    </div>
  );
}
