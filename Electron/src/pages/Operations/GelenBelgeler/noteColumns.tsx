// Gelen belge listesi sütunları (DataTable). Sıralama SUNUCUDA sabit (kayıt anı, yeni üstte) — başlıklar sıralamaz.
import type { ColumnDef } from "@tanstack/react-table";
import { formatFactory } from "@/lib/factory-time";
import { FileX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TERIM } from "@/lib/terim";
import { isDeletable, NOTE_STATUS_LABEL, NOTE_STATUS_VARIANT } from "./noteStatus";
import { NoteWorkOrdersCell } from "./NoteWorkOrdersCell";
import type { DeliveryNoteHeader } from "./types";

export const NOTE_COLUMNS: ColumnDef<DeliveryNoteHeader>[] = [
  { id: "noteNo", header: "No", accessorKey: "noteNo", cell: ({ row }) => <span className="whitespace-nowrap font-mono text-xs">{row.original.noteNo}</span> },
  {
    id: "createdAt",
    header: "Kayıt",
    accessorFn: (r) => formatFactory(r.createdAt, "dd MMM yyyy HH:mm"),
    cell: ({ getValue }) => <span className="whitespace-nowrap">{String(getValue())}</span>,
  },
  {
    id: "owner",
    header: "Sahip",
    accessorFn: (r) => r.ownerCustomer?.name ?? "",
    cell: ({ row }) => row.original.ownerCustomer?.name ?? <span className="text-amber-700 dark:text-amber-400">Sahip seçilmedi</span>,
  },
  { id: "sender", header: "Gönderen", accessorFn: (r) => r.senderCustomer?.name ?? r.senderText ?? "—" },
  {
    id: "senderDocNo",
    header: "Belge No",
    accessorFn: (r) => r.senderDocNo ?? "—",
    // Sipariş no ayrı kolon değil (genişlik): aramayla bulunan satırda neden eşleştiği görünsün diye ikinci satırda.
    cell: ({ row }) => (
      <span className="flex flex-col text-xs text-muted-foreground">
        <span>{row.original.senderDocNo ?? "—"}</span>
        {row.original.customerOrderNo && <span data-testid="note-order-no">Sip. {row.original.customerOrderNo}</span>}
      </span>
    ),
  },
  // Belgenin top satırları; onayda doğan parti kaydı (özet satırı) sayılmaz. Eski sunucu `docLineCount` göndermez.
  { id: "lines", header: "Top", accessorFn: (r) => r.docLineCount ?? r._count.lines, cell: ({ getValue }) => <span className="tabular-nums">{String(getValue())}</span> },
  // "Kaynak" listede yok (hep "Fotoğraf" diyordu; belge detayında kalır). İE adı rejimden okuma anında çözülür.
  {
    id: "workOrders",
    header: () => TERIM.terbiyeIsEmri.tekil,
    meta: { get label() { return TERIM.terbiyeIsEmri.tekil; } },
    accessorFn: (r) => (r.workOrders ?? []).map((w) => w.workOrderNumber).join(", "),
    cell: ({ row }) => <NoteWorkOrdersCell workOrders={row.original.workOrders} />,
  },
  {
    id: "status",
    header: "Durum",
    accessorFn: (r) => NOTE_STATUS_LABEL[r.status],
    cell: ({ row }) => <Badge variant={NOTE_STATUS_VARIANT[row.original.status]}>{NOTE_STATUS_LABEL[row.original.status]}</Badge>,
  },
];

/** Satır sonu "Taslağı iptal et" (yalnız DRAFT): sağ tık menüsünü bilmeyen kullanıcı da yarım taslağı görüp kaldırır.
 *  Tıklama satır tıkına (detaya git) kabarmaz; onay önizlemeli silme diyaloğundadır. */
export function cancelDraftColumn(onCancel: (id: string) => void): ColumnDef<DeliveryNoteHeader> {
  return {
    id: "actions", // dışa aktarılmaz (export-kolon-degeri bekçisinin eylem kolonu kimliği)
    header: "",
    enableHiding: false,
    cell: ({ row }) =>
      isDeletable(row.original.status) ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 whitespace-nowrap border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onCancel(row.original.id);
          }}
          data-testid="note-row-cancel-draft"
        >
          <FileX className="h-3.5 w-3.5" /> Taslağı iptal et
        </Button>
      ) : null,
  };
}
