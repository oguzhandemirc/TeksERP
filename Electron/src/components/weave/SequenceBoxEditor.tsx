// Kutu şeridi düzenleyici (atkı sırası · çözgü dizilimi): her kutu bir atkı/tel, rengi ve harfi ipliği. Tıklama
// harfi sıradakine çevirir; seçili kutu harf düğmeleri/klavye ile değişir, önüne/sonrasına eklenir, silinir.
// Metin kodu ile İKİ YÖNLÜ eşleniktir: kaydedilen değer daima koddur (A2 B1 · 2A 1B biçimi korunur); şerit
// yalnız düzenleme taslağıdır, kayıtlı görünüm sunucudan çizilir (dokuma.md).
import { useState, type KeyboardEvent } from "react";
import { ArrowLeftToLine, ArrowRightToLine, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  boxesToCode, cycleBox, insertBox, letterCoverage, parseSequenceCode, removeBox, runsToBoxes, setBox, SEQUENCE_EDIT_MAX, type CodeStyle,
} from "./sequence-edit";
import { yarnColor, yarnLetter } from "./weave-palette";

export interface SequenceBoxEditorProps {
  value: string;
  onChange: (code: string) => void;
  /** Kartın iplik satırı sayısı (A … harfleri). */
  letterCount: number;
  /** Boş koddan başlarken yazım biçimi (atkı "letter-first", çözgü "digit-first"). */
  defaultStyle: CodeStyle;
  /** "atkı" ya da "tel" — kutu ve özet metni. */
  unit: string;
  disabled?: boolean;
  /** Kutu üstü kısa başlık (erişilebilir ad). */
  label: string;
}

const BOX = "flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] border text-[10px] font-semibold leading-none";

export function SequenceBoxEditor({ value, onChange, letterCount, defaultStyle, unit, disabled, label }: SequenceBoxEditorProps) {
  const [active, setActive] = useState<number | null>(null);
  const parsed = parseSequenceCode(value);
  const boxes = parsed ? runsToBoxes(parsed.runs) : null;
  const letters = Math.max(1, letterCount);
  if (!parsed || !boxes) {
    return (
      <div className="space-y-1.5 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground" data-testid="seq-editor-unreadable">
        <p>{parsed ? `Kod ${formatQty(SEQUENCE_EDIT_MAX, 0)} ${unit}tan uzun; metinden düzenleyin.` : `“${value}” kutulara çevrilemedi — biçim: harf + adet (ör. ${defaultStyle === "digit-first" ? "2A 1B ya da 5x(2A 1B) 4C" : "A2 B1 ya da 10x(A2 B2 C1) D4"}).`}</p>
        {!disabled && !parsed && <Button type="button" size="sm" variant="outline" onClick={() => onChange(boxesToCode([1], defaultStyle))}>Şeridi baştan başlat</Button>}
      </div>
    );
  }
  const style: CodeStyle = parsed.runs.length > 0 ? parsed.style : defaultStyle;
  const emit = (next: number[], focus: number | null) => {
    onChange(boxesToCode(next, style));
    setActive(focus === null || next.length === 0 ? null : Math.max(0, Math.min(next.length - 1, focus)));
  };
  const sel = active !== null && active < boxes.length ? active : null;
  return (
    <div className="space-y-2" data-testid="seq-editor">
      {parsed.repeated && !disabled && (
        <p className="text-xs text-muted-foreground" data-testid="seq-editor-repeat-note">Şeritte değişiklik yapınca tekrar kısaltması açılır.</p>
      )}
      <BoxStrip boxes={boxes} active={sel} letters={letters} unit={unit} label={label} disabled={disabled} setActive={setActive} emit={emit} />
      {!disabled && <BoxActions boxes={boxes} active={sel} letters={letters} unit={unit} emit={emit} />}
      <Summary boxes={boxes} letters={letterCount} unit={unit} />
    </div>
  );
}

interface StripProps {
  boxes: number[]; active: number | null; letters: number; unit: string; label: string; disabled?: boolean;
  setActive: (i: number | null) => void; emit: (next: number[], focus: number | null) => void;
}

function BoxStrip({ boxes, active, letters, unit, label, disabled, setActive, emit }: StripProps) {
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const k = e.key;
    let handled = true;
    if (k === "ArrowRight" || k === "ArrowLeft") {
      const j = Math.max(0, Math.min(boxes.length - 1, i + (k === "ArrowRight" ? 1 : -1)));
      setActive(j);
      (e.currentTarget.parentElement?.children[j] as HTMLElement | undefined)?.focus();
    } else if (/^[a-z]$/i.test(k) && k.toUpperCase().charCodeAt(0) - 64 <= letters) emit(setBox(boxes, i, k.toUpperCase().charCodeAt(0) - 64), i);
    else if (k === "Delete" || k === "Backspace") emit(removeBox(boxes, i), i - (k === "Backspace" ? 1 : 0));
    else if (k === "Insert" || k === "+") emit(insertBox(boxes, i + 1, boxes[i]!), i + 1);
    else handled = false;
    if (handled && !disabled) e.preventDefault();
  };
  if (boxes.length === 0) return <p className="text-xs text-muted-foreground">Kod boş — aşağıdan {unit} ekleyin.</p>;
  return (
    <div role="group" aria-label={label} className="flex max-h-48 flex-wrap gap-0.5 overflow-y-auto rounded-md border bg-background p-1.5">
      {boxes.map((b, i) => (
        <button key={i} type="button" disabled={disabled} tabIndex={(active ?? 0) === i ? 0 : -1}
          aria-label={`${i + 1}. ${unit}: ${yarnLetter(b - 1)}${disabled ? "" : " — tıkla: sonraki iplik"}`} aria-pressed={active === i}
          title={`${i + 1}. ${unit} · ${yarnLetter(b - 1)}`}
          className={cn(BOX, "text-white disabled:cursor-default", active === i ? "ring-2 ring-primary ring-offset-1" : "border-transparent",
            b > letters && "border-destructive text-destructive")}
          style={{ background: b > letters ? "transparent" : yarnColor(b) }}
          onClick={() => emit(cycleBox(boxes, i, letters), i)}
          onKeyDown={(e) => onKey(e, i)}>
          {yarnLetter(b - 1)}
        </button>
      ))}
    </div>
  );
}

function BoxActions({ boxes, active, letters, unit, emit }: Pick<StripProps, "boxes" | "active" | "letters" | "unit" | "emit">) {
  const chips = Array.from({ length: letters }, (_, i) => i + 1);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <div className="flex items-center gap-1" role="group" aria-label={active === null ? `Sona ${unit} ekle` : "Seçili kutunun ipliği"}>
        <span className="text-muted-foreground">{active === null ? `Sona ${unit} ekle:` : `${active + 1}. ${unit}:`}</span>
        {chips.map((l) => (
          <button key={l} type="button" className={cn(BOX, "text-white", active !== null && boxes[active] === l ? "ring-2 ring-primary ring-offset-1" : "border-transparent")}
            style={{ background: yarnColor(l) }} aria-label={active === null ? `Sona ${yarnLetter(l - 1)} ekle` : `${yarnLetter(l - 1)} yap`}
            onClick={() => (active === null ? emit(insertBox(boxes, boxes.length, l), null) : emit(setBox(boxes, active, l), active))}>
            {active === null ? `+${yarnLetter(l - 1)}` : yarnLetter(l - 1)}
          </button>
        ))}
      </div>
      {active !== null && (
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2" onClick={() => emit(insertBox(boxes, active, boxes[active]!), active)}>
            <ArrowLeftToLine className="h-3.5 w-3.5" />Önüne ekle
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2" onClick={() => emit(insertBox(boxes, active + 1, boxes[active]!), active + 1)}>
            <ArrowRightToLine className="h-3.5 w-3.5" />Sonrasına ekle
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2" aria-label={`${active + 1}. ${unit} kutusunu sil`} onClick={() => emit(removeBox(boxes, active), active)}>
            <Trash2 className="h-3.5 w-3.5" />Sil
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => emit(boxes, null)}>Seçimi bırak</Button>
        </div>
      )}
    </div>
  );
}

function Summary({ boxes, letters, unit }: { boxes: number[]; letters: number; unit: string }) {
  if (boxes.length === 0) return null;
  const counts = new Map<number, number>();
  for (const b of boxes) counts.set(b, (counts.get(b) ?? 0) + 1);
  const { unknown, missing } = letterCoverage(boxes, letters);
  const parts = [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([l, n]) => `${yarnLetter(l - 1)} ${formatQty(n, 0)}`);
  return (
    <div className="space-y-0.5 text-xs tabular-nums" data-testid="seq-editor-summary">
      <p>{parts.join(" · ")} = <strong>{formatQty(boxes.length, 0)} {unit}/rapor</strong> <span className="text-muted-foreground">(taslak)</span></p>
      {unknown.length > 0 && <p className="text-destructive" role="alert">Kartta {unknown.map((l) => yarnLetter(l - 1)).join(", ")} satırı yok — iplik satırı ekleyin ya da kutuyu değiştirin.</p>}
      {missing.length > 0 && <p className="text-amber-700 dark:text-amber-400">{missing.map((l) => yarnLetter(l - 1)).join(", ")} ipliği sırada hiç geçmiyor.</p>}
    </div>
  );
}
