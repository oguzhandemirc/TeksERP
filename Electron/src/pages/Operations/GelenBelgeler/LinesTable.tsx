// Satır tablosu — dar ekranda kendi içinde yatay kayar; kumaş seçici tablo başına TEK modal.
import { useState } from "react";
import { ItemPickerModal } from "@/components/forms/ItemPickerModal";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { LineRow } from "./LineRow";
import type { DeliveryNoteDetail, LinePatch, NoteMatchSuggestions } from "./types";

interface Props {
  note: DeliveryNoteDetail;
  suggestions: NoteMatchSuggestions | undefined;
  editable: boolean;
  /** gelen-belge:write — PARTIAL düzeltme/atla yüzeyi de buna bağlı (backend 403 verir). */
  canWrite: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPatch: (lineId: string, p: LinePatch) => void;
  onDelete: (lineId: string) => void;
}

export function LinesTable({ note, suggestions, editable, canWrite, selectedId, onSelect, onPatch, onDelete }: Props) {
  const [pickFor, setPickFor] = useState<string | null>(null);
  // Sil ve atla geri alınamaz → kısa onay; atlanan son açık satırsa belge kapanır.
  const [confirm, setConfirm] = useState<{ kind: "delete" | "skip"; lineId: string } | null>(null);
  // Ürünsüz satır ipucu: sahibin ETKİN varsayılanı eşleşme yanıtından (E4; müşteri > fabrika); yoksa bugünkü "Kumaş seç".
  const defaultItem = suggestions?.defaultItem;
  const partial = note.status === "PARTIAL";
  const openLines = note.lines.filter((x) => !x.rollId && x.status !== "SKIPPED").length;
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
              fixable={canWrite && partial && l.status === "FAILED" && !l.rollId}
              selected={selectedId === l.id}
              ownerCustomerId={note.ownerCustomerId}
              defaultItem={defaultItem}
              onSelect={() => onSelect(l.id)}
              onPatch={(p) => (p.skip ? setConfirm({ kind: "skip", lineId: l.id }) : onPatch(l.id, p))}
              onDelete={() => setConfirm({ kind: "delete", lineId: l.id })}
              onPickItem={() => setPickFor(l.id)}
            />
          ))}
        </tbody>
      </table>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        destructive
        title={confirm?.kind === "skip" ? "Satır atlansın mı?" : "Satır silinsin mi?"}
        description={
          confirm?.kind === "skip"
            ? `Bu kalem girilmeyecek; geri alınamaz.${openLines === 1 ? " Bu son açık satır: belge onaylandı olarak kapanır." : ""}`
            : "Taslak satırı silinir; geri alınamaz."
        }
        confirmLabel={confirm?.kind === "skip" ? "Atla" : "Sil"}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === "skip") onPatch(confirm.lineId, { skip: true });
          else onDelete(confirm.lineId);
          setConfirm(null);
        }}
      />
      <ItemPickerModal
        open={pickFor !== null}
        onOpenChange={(o) => !o && setPickFor(null)}
        allowedTypes={["FABRIC"]}
        onPick={(row) => pickFor && onPatch(pickFor, { itemId: row.id })}
      />
    </div>
  );
}
