// Gelen belge listesi tablosu — satır tıkı detaya gider. Dar ekranda tablo kendi içinde kayar (sayfa kaymaz).
import { formatFactory } from "@/lib/factory-time";
import { Badge } from "@/components/ui/badge";
import { NOTE_STATUS_LABEL, NOTE_STATUS_VARIANT, SOURCE_LABEL } from "./noteStatus";
import type { DeliveryNoteHeader } from "./types";

interface Props {
  rows: DeliveryNoteHeader[];
  onOpen: (id: string) => void;
}

export function NoteListTable({ rows, onOpen }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="p-3 text-left">No</th>
            <th className="p-3 text-left">Tarih</th>
            <th className="p-3 text-left">Sahip</th>
            <th className="p-3 text-left">Gönderen</th>
            <th className="p-3 text-left">Belge No</th>
            <th className="p-3 text-right">Satır</th>
            <th className="p-3 text-left">Kaynak</th>
            <th className="p-3 text-left">Durum</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => onOpen(r.id)} data-testid="note-row">
              <td className="p-3 font-mono text-xs">{r.noteNo}</td>
              <td className="p-3 whitespace-nowrap">{formatFactory(r.createdAt, "dd MMM yyyy HH:mm")}</td>
              <td className="p-3">{r.ownerCustomer?.name ?? <span className="text-amber-700 dark:text-amber-400">Sahip seçilmedi</span>}</td>
              <td className="p-3">{r.senderCustomer?.name ?? r.senderText ?? "—"}</td>
              <td className="p-3 text-xs text-muted-foreground">{r.senderDocNo ?? "—"}</td>
              <td className="p-3 text-right tabular-nums">{r._count.lines}</td>
              <td className="p-3 text-xs">{SOURCE_LABEL[r.sourceKind]}</td>
              <td className="p-3">
                <Badge variant={NOTE_STATUS_VARIANT[r.status]}>{NOTE_STATUS_LABEL[r.status]}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
