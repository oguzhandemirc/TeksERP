import { Package, Scroll } from "lucide-react";
import type { UndoDispatchPreview } from "./service";
import { undoAffectedRows } from "./undo-affected";

/** Sevki Geri Al önizlemesi — etkilenen çuval/top listesi (çekirdek: HER kayıt somut). */
export function UndoAffectedList({ preview }: { preview: Pick<UndoDispatchPreview, "sacks" | "looseRolls"> }) {
  const rows = undoAffectedRows(preview);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-md border" data-testid="undo-affected-list">
      <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">Etkilenen çuval ve toplar</div>
      <ul className="max-h-48 divide-y overflow-y-auto text-xs">
        {rows.map((r) => (
          <li
            key={r.key}
            data-kind={r.kind}
            className={r.kind === "sack" ? "flex items-center justify-between bg-muted/20 px-3 py-1 font-medium" : "flex items-center justify-between py-1 pl-7 pr-3"}
          >
            <span className="flex items-center gap-1.5 font-mono">
              {r.kind === "sack" ? <Package className="h-3 w-3 text-muted-foreground" /> : <Scroll className="h-3 w-3 text-muted-foreground" />}
              {r.label}
            </span>
            <span className="tabular-nums text-muted-foreground">{r.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
