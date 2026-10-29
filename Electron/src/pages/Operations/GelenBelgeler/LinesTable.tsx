// Satır tablosu — dar ekranda kendi içinde yatay kayar; kumaş seçici tablo başına TEK modal.
import { useState } from "react";
import { ItemPickerModal } from "@/components/forms/ItemPickerModal";
import { LineRow } from "./LineRow";
import type { DeliveryNoteDetail, LinePatch, NoteMatchSuggestions } from "./types";

interface Props {
  note: DeliveryNoteDetail;
  suggestions: NoteMatchSuggestions | undefined;
  editable: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPatch: (lineId: string, p: LinePatch) => void;
  onDelete: (lineId: string) => void;
}

export function LinesTable({ note, suggestions, editable, selectedId, onSelect, onPatch, onDelete }: Props) {
  const [pickFor, setPickFor] = useState<string | null>(null);
  const partial = note.status === "PARTIAL";
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="p-2 text-left">Blok/Satır</th>
            <th className="p-2 text-left">Top No</th>
            <th className="p-2 text-left">Metre</th>
            <th className="p-2 text-left">Kilo</th>
            <th className="p-2 text-left">En</th>
            <th className="p-2 text-left">Kumaş</th>
            <th className="p-2 text-left">Renk</th>
            <th className="p-2 text-left">Durum</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {note.lines.length === 0 && (
            <tr>
              <td colSpan={9} className="p-6 text-center text-sm text-muted-foreground">
                Satır yok. Elle ekleyin ya da Excel'den yükleyin.
              </td>
            </tr>
          )}
          {note.lines.map((l) => (
            <LineRow
              key={l.id}
              line={l}
              suggestion={suggestions?.lines.find((s) => s.lineId === l.id)}
              editable={editable}
              fixable={partial && l.status === "FAILED" && !l.rollId}
              selected={selectedId === l.id}
              ownerCustomerId={note.ownerCustomerId}
              onSelect={() => onSelect(l.id)}
              onPatch={(p) => onPatch(l.id, p)}
              onDelete={() => onDelete(l.id)}
              onPickItem={() => setPickFor(l.id)}
            />
          ))}
        </tbody>
      </table>
      <ItemPickerModal
        open={pickFor !== null}
        onOpenChange={(o) => !o && setPickFor(null)}
        allowedTypes={["FABRIC"]}
        onPick={(row) => pickFor && onPatch(pickFor, { itemId: row.id })}
      />
    </div>
  );
}
