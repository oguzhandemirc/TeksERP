import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { FIELD_TYPE_LABELS, sampleText, type ContractField } from "../binding/contract";

interface Props {
  label: string;
  path: string;
  field?: ContractField;
  locked: boolean;
  onClick?: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  depth?: number;
}

/** Veri ağacı satırı: etiket · tür · birim · örnek değer; kilitli iç alan kilit simgesiyle. */
export function FieldNodeRow({ label, path, field, locked, onClick, draggable, onDragStart, onDragEnd, depth = 0 }: Props) {
  const meta = [field ? FIELD_TYPE_LABELS[field.tur] : null, field?.birim ?? null].filter(Boolean).join(" · ");
  const sample = field ? sampleText(field, "") : "";
  return (
    <button
      type="button"
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={path}
      data-yol={path}
      className={cn(
        "flex w-full items-start gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted",
        locked && "text-muted-foreground",
        draggable && "cursor-grab",
      )}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
    >
      {locked ? <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-label="İç alan — kilitli" /> : <span className="w-3 shrink-0" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {meta}
          {sample ? ` · örn. ${sample}` : ""}
        </span>
      </span>
    </button>
  );
}
