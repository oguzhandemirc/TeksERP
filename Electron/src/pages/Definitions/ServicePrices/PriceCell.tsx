// Satır içi fiyat hücresi: tıkla / Enter / F2 / rakam yaz → düzenle · Enter kaydet + alt satıra geç ·
// Shift+Enter kaydet + üst satır · Esc vazgeç. Gezinme `data-price-cell` ile (satır sırası = DOM sırası).
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtFactoryDate } from "@/lib/factory-time";
import type { PriceSlot } from "./service";
import { formatPrice, parsePriceInput } from "./servicePrices";

interface Props {
  /** "<satır>:<kolon>" — klavye gezintisi bu anahtarla hücre bulur. */
  cellId: string;
  slot: PriceSlot | null;
  editable: boolean;
  saving: boolean;
  /** Kaydet; çözülürse hücre kapanır. `move` = kaydettikten sonra gidilecek yön. */
  onCommit: (price: number, move: 1 | -1 | 0) => Promise<boolean>;
  onMove: (delta: 1 | -1) => void;
  placeholder?: string;
}

function usePriceCell({ slot, editable, onCommit, onMove }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const current = slot?.current ?? null;

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const open = (seed?: string) => {
    if (!editable) return;
    setDraft(seed ?? (current ? String(Number(current.price)).replace(".", ",") : ""));
    setError(null);
    setEditing(true);
  };

  const commit = async (move: 1 | -1 | 0) => {
    const n = parsePriceInput(draft);
    if (n === null) {
      setEditing(false);
      if (move) onMove(move);
      return;
    }
    if (Number.isNaN(n)) {
      setError("Geçerli bir fiyat girin (ör. 12,50)");
      return;
    }
    if (current && Number(current.price) === n) {
      setEditing(false);
      if (move) onMove(move);
      return;
    }
    if (await onCommit(n, move)) setEditing(false);
  };

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commit(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setEditing(false);
    }
  };

  const onCellKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      open();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      onMove(e.key === "ArrowDown" ? 1 : -1);
    } else if (/^[0-9]$/.test(e.key) && editable) {
      e.preventDefault();
      open(e.key);
    }
  };
  return { editing, setEditing, draft, setDraft, error, inputRef, current, open, onInputKey, onCellKey };
}

export function PriceCell(props: Props) {
  const { cellId, editable, saving, placeholder = "—" } = props;
  const { editing, setEditing, draft, setDraft, error, inputRef, current, open, onInputKey, onCellKey } =
    usePriceCell(props);

  if (editing) {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="relative">
          <input
            ref={inputRef}
            aria-label="Fiyat"
            inputMode="decimal"
            className={cn(
              "h-8 w-full rounded border bg-background px-2 text-right text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring",
              error && "border-destructive",
            )}
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onInputKey}
            onBlur={() => !saving && setEditing(false)}
          />
          {saving && (
            <Loader2 className="absolute right-1 top-2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
        {error && <span className="text-[11px] text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-price-cell={cellId}
      onClick={() => open()}
      onKeyDown={onCellKey}
      className={cn(
        "flex h-8 w-full items-center justify-end gap-1 rounded px-2 text-right text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring",
        editable ? "cursor-text hover:bg-muted/60" : "cursor-default",
        !current && "text-muted-foreground",
      )}
      title={editable ? "Düzenlemek için tıklayın, Enter ya da rakam yazın" : undefined}
    >
      {current?.until && (
        <span title={`İleri tarihli fiyatla ${fmtFactoryDate(current.until)} itibarıyla değişecek`}>
          <CalendarClock className="h-3.5 w-3.5 text-amber-600" />
        </span>
      )}
      {current ? formatPrice(current.price) : placeholder}
    </button>
  );
}
