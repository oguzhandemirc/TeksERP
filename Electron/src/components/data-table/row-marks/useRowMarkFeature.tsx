import { useMemo, useState, type KeyboardEvent } from "react";
import type { RowMarkEntity } from "@/lib/row-mark-entities";
import type { RowMarkInput } from "@/services/rowMarkService";
import { RowMarkNoteDialog } from "./RowMarkNoteDialog";
import { useRowMarks, type RowMarkEntry } from "./useRowMarks";

/** Satıra inen KARARLI eylem nesnesi (memo'lu satır her işaret değişiminde çizilmesin diye tek nesne). */
export interface RowMarkActions {
  onSet: (recordId: string, patch: Partial<RowMarkInput>) => void;
  onEditNote: (recordId: string) => void;
}

/** Varsayılan kayıt kimliği: satırın `id` alanı (çoğu liste). */
export function defaultMarkRecordId(row: unknown): string | null {
  const id = (row as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : null;
}

/**
 * DataTable'ın işaret yeteneği: görünür satırların kimlikleri → toplu lookup, iyimser yazım,
 * TEK not penceresi. `entity` verilmezse hiçbir şey yapmaz (istek de atılmaz).
 */
export function useRowMarkFeature(entity: RowMarkEntity | undefined, recordIds: readonly string[]) {
  const ids = useMemo(() => (entity ? recordIds : []), [entity, recordIds]);
  const { entries, setMark } = useRowMarks(entity, ids);
  const [editing, setEditing] = useState<string | null>(null);
  const actions = useMemo<RowMarkActions | undefined>(
    () => (entity ? { onSet: (id, patch) => void setMark(id, patch), onEditNote: setEditing } : undefined),
    [entity, setMark],
  );
  const dialog = entity ? (
    <RowMarkNoteDialog
      open={editing !== null}
      mark={editing ? (entries[editing]?.mine ?? null) : null}
      onClose={() => setEditing(null)}
      onSave={(patch) => editing && void setMark(editing, patch)}
    />
  ) : null;
  return { enabled: Boolean(entity), entries, actions, dialog };
}

export type { RowMarkEntry };

/** Odaklı satırda `m` → satırın sağ tık menüsünü açar (Radix ContextMenu `contextmenu` olayını dinler). */
export function openRowMenuByKey(e: KeyboardEvent<HTMLElement>): boolean {
  if (e.key !== "m" || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  e.preventDefault();
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 24, clientY: r.top + r.height }),
  );
  return true;
}
