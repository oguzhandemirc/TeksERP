import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RawCodeLang,
  labelTemplateService,
  rawCodeLangLabels,
  type CatalogField,
  type LabelKind,
  type RawCodeMap,
} from "@/services/labelTemplateService";

interface Props {
  kind: LabelKind;
  catalog: CatalogField[];
  rawCode: RawCodeMap;
  onChange: (rc: RawCodeMap) => void;
}

const LANGS: RawCodeLang[] = ["PPLA", "PPLB", "ZPL", "RASTER_HTML"];

// "Yazıcıya gider ama basmaz" tuzağı: kod veri içeriyor ama komut yapısı eksik.
function codeIssue(lang: RawCodeLang, code: string): string | null {
  const c = code.trim();
  if (!c) return null;
  if (lang === "PPLB") {
    if (!/(^|\n)\s*q\d/i.test(c) || !/(^|\n)\s*P\d/.test(c)) {
      return "Bu bir EPL2 etiketi değil — en az `q<genişlik>`, `Q<yükseklik>` ve sonda `P1` (bas) gerekir. Sadece {{alan}} yazmak veri gönderir ama yazıcı BASMAZ. 'Başlangıç şablonu ekle'yi dene.";
    }
  }
  if (lang === "ZPL" && (!c.includes("^XA") || !c.includes("^XZ"))) {
    return "ZPL `^XA` ile başlayıp `^XZ` ile bitmeli; alanlar `^FO..^FD..^FS`. 'Başlangıç şablonu ekle'yi dene.";
  }
  return null;
}

/**
 * Uzman raw-code editörü — bir etiket düzeni için yazıcı dilinde KENDİ kodunu
 * yaz. Doluysa baskıda o kod kullanılır; boş bırakılırsa "Alanlar" sekmesindeki
 * otomatik üretim devreye girer. {{key}} yer-tutucuları baskıda payload değeriyle
 * doldurulur (çipe tıkla → imlece ekle). Önizleme sahte veriyle anlık.
 */
export function RawCodePanel({ kind, catalog, rawCode, onChange }: Props) {
  const [lang, setLang] = useState<RawCodeLang>("PPLA");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const code = rawCode[lang] ?? "";

  // İmlece {{key}} ekle (yoksa sona).
  const insertVar = (key: string) => {
    const ta = taRef.current;
    const token = `{{${key}}}`;
    if (!ta) {
      onChange({ ...rawCode, [lang]: code + token });
      return;
    }
    const start = ta.selectionStart ?? code.length;
    const end = ta.selectionEnd ?? code.length;
    const next = code.slice(0, start) + token + code.slice(end);
    onChange({ ...rawCode, [lang]: next });
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + token.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  const setCode = (v: string) => onChange({ ...rawCode, [lang]: v });

  const issue = codeIssue(lang, code);
  const [loadingDefault, setLoadingDefault] = useState(false);
  // "Varsayılan kodu getir" — otomatik üretilen kodu {{}} yer-tutuculu şablon olarak
  // editöre yükler (kullanıcı görüp üstünde düzenler; garantili basar).
  const fetchDefault = async () => {
    if (code.trim() && !window.confirm("Mevcut kod, varsayılan (otomatik) kodla değiştirilsin mi?")) return;
    setLoadingDefault(true);
    try {
      setCode(await labelTemplateService.defaultCode(kind, lang));
    } finally {
      setLoadingDefault(false);
    }
  };

  // Değişken çipleri: katalog anahtarları + HTML'de gömülü SVG'ler.
  const chips = useMemo(() => {
    const base = catalog.map((c) => ({ key: c.key, label: c.defaultLabel }));
    if (lang === "RASTER_HTML") {
      base.push({ key: "barcodeSvg", label: "Barkod SVG" }, { key: "qrSvg", label: "QR SVG" });
    }
    return base;
  }, [catalog, lang]);

  // Önizleme — debounce'lı (yazarken sürekli istek atma).
  const [debounced, setDebounced] = useState(code);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(code), 350);
    return () => clearTimeout(t);
  }, [code]);

  const previewQ = useQuery({
    queryKey: ["raw-code-preview", kind, lang, debounced],
    queryFn: () => labelTemplateService.previewRaw(kind, lang, debounced),
    enabled: debounced.trim().length > 0,
    staleTime: 0,
  });

  const filledCount = LANGS.filter((l) => (rawCode[l] ?? "").trim()).length;

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
        <strong>Uzman modu.</strong> Bir dil için kod yazarsan baskıda <em>senin kodun</em>{" "}
        kullanılır; boş bırakırsan o dilde "Alanlar" sekmesindeki otomatik üretim devreye girer.
        Kod içinde <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/40">{"{{anahtar}}"}</code>{" "}
        yer-tutucuları baskıda gerçek değerle değişir.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {LANGS.map((l) => {
          const filled = (rawCode[l] ?? "").trim().length > 0;
          return (
            <Button
              key={l}
              type="button"
              size="sm"
              variant={l === lang ? "default" : "outline"}
              className="h-8 gap-1 text-xs"
              onClick={() => setLang(l)}
            >
              {rawCodeLangLabels[l]}
              {filled && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
            </Button>
          );
        })}
        <Badge variant="muted" className="ml-auto text-[10px]">
          {filledCount}/4 dilde özel kod
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                title={`{{${c.key}}} ekle`}
                onClick={() => insertVar(c.key)}
                className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] hover:bg-muted"
              >
                {`{{${c.key}}}`}
              </button>
            ))}
          </div>
          <textarea
            ref={taRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            placeholder={`${rawCodeLangLabels[lang]} kodunu buraya yaz… (boş = otomatik üretim)`}
            className="h-[420px] w-full resize-none rounded-md border bg-background p-2 font-mono text-xs leading-relaxed outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              disabled={loadingDefault}
              onClick={() => void fetchDefault()}
            >
              {loadingDefault ? "Getiriliyor…" : "Varsayılan kodu getir"}
            </Button>
            {code.trim().length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-[11px] text-destructive"
                onClick={() => setCode("")}
              >
                Varsayılana dön (kodu sil)
              </Button>
            )}
          </div>
          {issue && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              ⚠️ {issue}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Önizleme (sahte veri)
          </div>
          <div className="rounded-md border bg-muted/20 p-2">
            {debounced.trim().length === 0 ? (
              <div className="py-12 text-center text-xs italic text-muted-foreground">
                Kod yaz → sahte veriyle çıktısını burada gör.
              </div>
            ) : previewQ.isLoading ? (
              <Skeleton className="h-[380px] w-full" />
            ) : previewQ.isError ? (
              <div className="py-8 text-center text-xs italic text-destructive">
                Önizleme alınamadı: {(previewQ.error as Error).message}
              </div>
            ) : (previewQ.data ?? "").trimStart().startsWith("<") ? (
              // HTML dili ya da native→SVG görsel (baskıyla birebir) → iframe.
              <iframe
                title="Raw-code önizleme"
                srcDoc={previewQ.data ?? ""}
                sandbox=""
                className="h-[400px] w-full rounded border bg-white"
              />
            ) : (
              // Görselleştirilemeyen native (geçersiz kod / çizici yok) → ham komut.
              <pre className="h-[400px] overflow-auto whitespace-pre-wrap break-all rounded bg-background p-2 font-mono text-[11px] leading-relaxed">
                {previewQ.data}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
