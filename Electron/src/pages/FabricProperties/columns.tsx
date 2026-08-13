import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import type { FabricProperty } from "./types";

export const fabricPropertyColumns: ColumnDef<FabricProperty>[] = [
  {
    id: "swatch",
    header: "",
    size: 40,
    cell: ({ row }) =>
      row.original.color ? (
        <div className="h-4 w-4 rounded" style={{ backgroundColor: row.original.color }} />
      ) : (
        <div className="h-4 w-4 rounded border border-dashed" />
      ),
  },
  {
    accessorKey: "code",
    header: () => <SortableHeader field="code" label="Kod" />,
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
  },
  {
    accessorKey: "name",
    header: () => <SortableHeader field="name" label="Ad" />,
  },
  {
    accessorKey: "category",
    header: () => <SortableHeader field="category" label="Kategori" />,
    cell: ({ row }) =>
      row.original.category ? (
        <Badge variant="muted">{row.original.category}</Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "valueType",
    header: "Tip",
    // SEÇİM tipli özellik hedef-özellik seçicilerinde GÖRÜNMEZ; hangi satırın
    // öyle olduğu listede okunabilmeli, yoksa "neden listede yok" sorusunun
    // cevabı hiçbir ekranda yazmaz.
    cell: ({ row }) => {
      const vt = row.original.valueType ?? "FLAG";
      if (vt !== "CHOICE") return <span className="text-xs text-muted-foreground">Bayrak</span>;
      const active = (row.original.values ?? []).filter((v) => v.isActive);
      return (
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="outline" className="text-[10px]">
            Seçim
          </Badge>
          {active.slice(0, 4).map((v) => (
            <Badge key={v.code} variant="muted" className="font-mono text-[10px]">
              {v.code}
            </Badge>
          ))}
          {active.length > 4 && (
            <span className="text-[10px] text-muted-foreground">+{active.length - 4}</span>
          )}
        </div>
      );
    },
  },
  {
    id: "stations",
    header: "Uygulayan İstasyonlar",
    // Bağsız özellik = hiçbir iş emrinde seçilemez. Eskiden bu durum hiçbir
    // yüzeyde görünmüyordu ve ZIMPARALI iki hafta fark edilmeden kullanılamadı.
    cell: ({ row }) => {
      const caps = row.original.stationCapabilities ?? [];
      if (caps.length === 0) {
        return (
          <Badge
            variant="outline"
            className="border-warning/60 text-warning"
            title="Bu özellik hiçbir istasyona bağlı değil — hiçbir iş emrinde seçilemez. Düzenle'den istasyon ata."
          >
            İstasyon atanmamış
          </Badge>
        );
      }
      return (
        <div className="flex flex-wrap gap-1">
          {caps.map((c) => (
            <Badge key={c.stationId} variant="muted" className="text-[10px]">
              {c.station.name}
            </Badge>
          ))}
        </div>
      );
    },
  },
  {
    accessorKey: "sortOrder",
    header: () => <SortableHeader field="sortOrder" label="Sıra" />,
  },
  {
    accessorKey: "isActive",
    header: () => <SortableHeader field="isActive" label="Durum" />,
    cell: ({ row }) => (row.original.isActive ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>),
  },
];
