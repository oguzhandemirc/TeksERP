import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Callout, type CalloutTone } from "@/components/ui/callout";

export interface CodeNote {
  readonly tone: CalloutTone;
  readonly text: string;
  readonly testId?: string;
}

/**
 * Kod sekmesinin uyarı/ipucu kutuları — TEK SATIR, daraltılabilir. Üç ayrı Callout üst üste
 * 1280×720'de editörü sıkıştırıyordu (TZ bulgusu): daraltıkken ilk not kırpılır + "+N" sayısı;
 * açıkken hepsi tam metin. Editör `flex-1`dir, notlar sabit tek satır → editör yüksekliği korunur.
 */
export function CodeNotes({ notes }: { notes: readonly CodeNote[] }) {
  const [open, setOpen] = useState(false);
  if (notes.length === 0) return null;
  const first = notes[0]!;
  return (
    <div data-testid="kod-notlari" data-expanded={open ? "1" : "0"} className="px-2 pt-2">
      <div className={cn("flex items-start gap-2 rounded-md border px-2 py-1 text-xs", open ? "bg-muted/30" : "bg-muted/30")}>
        <div className="min-w-0 flex-1">
          {open ? (
            <div className="space-y-1 py-0.5">
              {notes.map((n, i) => (
                <div key={i} data-testid={n.testId}>
                  <Callout tone={n.tone} className="p-2">{n.text}</Callout>
                </div>
              ))}
            </div>
          ) : (
            <p data-testid={first.testId} className="truncate leading-6" title={notes.map((n) => n.text).join("\n")}>
              {first.text}
            </p>
          )}
        </div>
        {!open && notes.length > 1 && (
          <span className="shrink-0 self-center rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground" data-testid="kod-notlari-fazla">
            +{notes.length - 1}
          </span>
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Notları daralt" : "Notları genişlet"}
          className="shrink-0 self-center rounded p-0.5 text-muted-foreground hover:text-foreground"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
