import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { TEMP_CODE_GROUP, TEMP_CODE_LENGTH, TEMP_CODE_PREFIX, normalizeTempCode, normalizeTempGroup } from "@/lib/license/temp-code";

interface Props {
  groups: readonly string[];
  onChange: (groups: string[]) => void;
  /** Kırmızı çizilecek kutular (yerel biçim hatası ya da backend'in `konum`u). */
  errorGroups: ReadonlySet<number>;
  disabled?: boolean;
}

/**
 * Geçici açılış kodu girişi: 23 kutu × 5 karakter. Yazarken büyük harf ve O→0, I/L→1; kutu dolunca sonrakine geçer,
 * boş kutuda geri silme öncekine döner. Yapıştırılan metin kutulara bölüştürülür (tam kod ilk kutudan başlar).
 */
export function TempCodeInput({ groups, onChange, errorGroups, disabled }: Props) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const focus = (i: number) => refs.current[Math.max(0, Math.min(groups.length - 1, i))]?.focus();

  const fill = (start: number, text: string) => {
    const next = [...groups];
    let i = start;
    for (let p = 0; p < text.length && i < next.length; p += TEMP_CODE_GROUP, i++) next[i] = text.slice(p, p + TEMP_CODE_GROUP);
    onChange(next);
    focus(Math.min(i, next.length - 1));
  };

  const write = (i: number, raw: string) => {
    const v = normalizeTempGroup(raw);
    if (v.length > TEMP_CODE_GROUP) return fill(i, v);
    const next = [...groups];
    next[i] = v;
    onChange(next);
    if (v.length === TEMP_CODE_GROUP && i < groups.length - 1) focus(i + 1);
  };

  const paste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    const raw = e.clipboardData.getData("text");
    const full = new RegExp(`^${TEMP_CODE_PREFIX}[\\s-]`, "i").test(raw.trim()) || normalizeTempCode(raw).length >= TEMP_CODE_LENGTH;
    const text = full ? normalizeTempCode(raw) : normalizeTempGroup(raw);
    if (!full && text.length <= TEMP_CODE_GROUP) return; // kısa yapıştırma: tarayıcının kendi davranışı + onChange
    e.preventDefault();
    fill(full ? 0 : i, text);
  };

  const key = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && groups[i] === "" && i > 0) {
      e.preventDefault();
      focus(i - 1);
    } else if (e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0 && i > 0) focus(i - 1);
    else if (e.key === "ArrowRight" && e.currentTarget.selectionStart === groups[i]?.length) focus(i + 1);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="gecici-kod-girisi">
      <span className="font-mono text-sm text-muted-foreground">{TEMP_CODE_PREFIX}-</span>
      {groups.map((g, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={g}
          disabled={disabled}
          aria-label={`Grup ${i + 1}`}
          aria-invalid={errorGroups.has(i) || undefined}
          autoComplete="off"
          spellCheck={false}
          maxLength={TEMP_CODE_GROUP * 2}
          onChange={(e) => write(i, e.target.value)}
          onPaste={(e) => paste(i, e)}
          onKeyDown={(e) => key(i, e)}
          className={cn(
            "h-8 w-[4.25rem] rounded-md border bg-background px-1.5 text-center font-mono text-sm uppercase tracking-wider outline-none focus:ring-2 focus:ring-ring",
            errorGroups.has(i) && "border-destructive bg-destructive/10 text-destructive",
          )}
        />
      ))}
    </div>
  );
}
