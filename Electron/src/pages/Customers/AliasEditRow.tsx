// Tek ad satırı (etiket · düzenlenebilir ad · Kaydet · Sil) — cari kartı ve kumaş kartı renk adı listeleri paylaşır.
import { useEffect, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PermissionGate } from "@/components/PermissionGate";

interface Props {
  label: ReactNode;
  alias: string;
  /** Yoksa ad salt okunur (yetki yok ya da kart yazıma kapalı). */
  onSave?: (alias: string) => void;
  /** Yoksa Sil düğmesi çizilmez. */
  onDelete?: () => void;
  /** Salt okunur adın nedeni (fare üstünde). */
  lockedHint?: string;
  /** Alt satır ("yalnız X kumaşında") — girintili ve küçük. */
  nested?: boolean;
  saving?: boolean;
}

export function AliasEditRow({ label, alias, onSave, onDelete, lockedHint, nested, saving }: Props) {
  const [value, setValue] = useState(alias);
  useEffect(() => setValue(alias), [alias]);
  const dirty = value.trim() !== alias;

  return (
    <li className={cn("flex items-center gap-2 p-2 text-sm", nested && "bg-muted/20 pl-8 text-xs")}>
      <div className="flex min-w-0 flex-1 items-center gap-2">{label}</div>
      <Input
        aria-label="Müşterideki ad"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        readOnly={!onSave}
        title={!onSave ? lockedHint : undefined}
        className={cn("w-48 text-sm", !onSave && "bg-muted/40")}
      />
      <PermissionGate permission="customer-alias:write">
        {onSave && (
          <Button
            type="button"
            size="sm"
            variant={dirty ? "default" : "outline"}
            disabled={!dirty || !value.trim() || saving}
            onClick={() => onSave(value.trim())}
          >
            Kaydet
          </Button>
        )}
        {onDelete && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Sil"
            className="h-8 w-8 text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </PermissionGate>
    </li>
  );
}

/** Renk etiketi: nokta · kod · ad. */
export function ColorLabel({ color }: { color: { code: string; name: string; hex: string | null } | null }) {
  if (!color) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      <span
        className={cn("h-3 w-3 shrink-0 rounded-full border border-black/10", !color.hex && "bg-muted")}
        style={color.hex ? { backgroundColor: color.hex } : undefined}
      />
      <span className="font-mono text-xs text-muted-foreground">{color.code}</span>
      <span className="truncate font-medium">{color.name}</span>
    </>
  );
}
