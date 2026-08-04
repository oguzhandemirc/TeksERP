import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Scissors } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { travelerTemplateService } from "./service";
import { FIELD_GROUPS, LOOP_GROUPS } from "./field-catalog";

/**
 * UZMAN MODU editörü — kartın tüm HTML'i burada yazılır.
 *
 * Paletten bir alana tıklamak, imlecin BULUNDUĞU YERE `{{alan}}` gömer. Bu
 * ayrıntı önemli: alan adlarını ezberden yazdırmak, bu ekranı yalnız kataloğu
 * bilen kişinin kullanabileceği bir yer yapardı.
 *
 * Uyarılar (kesilecek içerik + bilinmeyen alan) backend'in KENDİ denetiminden
 * gelir (`/inspect`) — istemcide ikinci bir kural seti yazmak, iki kuralın
 * zamanla ayrışması demekti. Uyarı KIRMIZI DEĞİL sarıdır: bilinmeyen alan boş
 * basar, baskıyı durdurmaz.
 */
export function RawHtmlEditor({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const debounced = useDebouncedValue(value, 400);

  const inspection = useQuery({
    queryKey: ["traveler-template-inspect", debounced],
    queryFn: () => travelerTemplateService.inspect(debounced),
    enabled: debounced.trim().length > 0,
    staleTime: 30_000,
  });

  // İmleci takip et — palet gömmesi son bilinen konuma yapılır.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const track = () => setCursor(el.selectionStart);
    el.addEventListener("keyup", track);
    el.addEventListener("click", track);
    return () => {
      el.removeEventListener("keyup", track);
      el.removeEventListener("click", track);
    };
  }, []);

  const insert = (token: string) => {
    const el = areaRef.current;
    const at = cursor ?? el?.selectionStart ?? value.length;
    const next = value.slice(0, at) + token + value.slice(at);
    onChange(next);
    // Gömdükten sonra imleci token'ın SONUNA taşı — arka arkaya alan eklerken
    // her seferinde tıklamak zorunda kalmasın.
    requestAnimationFrame(() => {
      const pos = at + token.length;
      el?.focus();
      el?.setSelectionRange(pos, pos);
      setCursor(pos);
    });
  };

  const stripped = inspection.data?.stripped ?? [];
  const unknown = inspection.data?.unknownKeys ?? [];

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
      <div className="flex min-h-0 flex-col gap-2">
        <Textarea
          ref={areaRef}
          value={value}
          disabled={disabled}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          placeholder="<div>{{companyName}} — {{workOrderNumber}}</div>"
          className="min-h-[320px] flex-1 resize-none font-mono text-xs leading-relaxed"
        />
        {(stripped.length > 0 || unknown.length > 0) && (
          <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px]">
            {stripped.length > 0 && (
              <div className="flex items-start gap-1.5 text-amber-800 dark:text-amber-300">
                <Scissors className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>
                  Güvenlik gereği kaydedilirken çıkarılacak: <b>{stripped.join(", ")}</b>
                </span>
              </div>
            )}
            {unknown.length > 0 && (
              <div className="flex items-start gap-1.5 text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>
                  Tanınmayan alan (boş basılır): <b>{unknown.join(", ")}</b>
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="min-h-0 overflow-auto rounded-md border bg-muted/30 p-2">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Alanlar
        </div>
        <p className="mb-2 text-[10px] leading-snug text-muted-foreground">
          Tıklayınca imlecin olduğu yere eklenir.
        </p>
        {FIELD_GROUPS.map((g) => (
          <div key={g.title} className="mb-2">
            <div className="mb-1 text-[10px] font-medium text-muted-foreground">{g.title}</div>
            <div className="flex flex-wrap gap-1">
              {g.fields.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  disabled={disabled}
                  title={`${f.label} — örn. ${f.sample}`}
                  onClick={() => insert(`{{${f.key}}}`)}
                  className="rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] hover:bg-accent disabled:opacity-50"
                >
                  {f.key}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Listeler
        </div>
        <p className="mb-2 text-[10px] leading-snug text-muted-foreground">
          Blok ekler; içine o satırın alanlarını yazarsınız.
        </p>
        {LOOP_GROUPS.map((l) => (
          <div key={l.key} className="mb-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => insert(`{{#${l.key}}}\n  \n{{/${l.key}}}`)}
              className="mb-1 w-full rounded border bg-background px-1.5 py-1 text-left font-mono text-[10px] hover:bg-accent disabled:opacity-50"
            >
              {`{{#${l.key}}}…{{/${l.key}}}`}
            </button>
            <div className="flex flex-wrap gap-1">
              {l.fields.map((f) => (
                <Badge
                  key={f.key}
                  variant="outline"
                  role="button"
                  tabIndex={0}
                  title={`${f.label} — yalnız ${l.label} bloğu içinde`}
                  onClick={() => !disabled && insert(`{{${f.key}}}`)}
                  onKeyDown={(e) => e.key === "Enter" && !disabled && insert(`{{${f.key}}}`)}
                  className="cursor-pointer px-1 py-0 font-mono text-[9px] font-normal"
                >
                  {f.key}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
