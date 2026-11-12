// Bildirimler — ortak DataTable sütunları. Seçimi SAYFA tutar (toplu "okundu say", süzgeç değişince sıfırlanır):
// tablo `selectedIds`/`onSelectedChange` ile denetlenir. Başlık + gövde + sebep sütunu çok satırlıdır.
import { useMemo, useRef } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useLocalTable } from "@/hooks/useLocalTable";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import type { NotificationItem } from "@/lib/bildirim/types";
import { ActionsCell, GroupCell, StatusCell, TimeCell, TitleCell, statusText, type NotificationActions } from "./NotificationTable";

interface Handlers {
  onAc: (b: NotificationItem) => void;
  eylemler: NotificationActions;
}

function notificationColumns(h: { current: Handlers }): ColumnDef<NotificationItem>[] {
  return [
    { id: "sonAn", header: "Zaman", size: 200, meta: { label: "Zaman", exportValue: (b) => fmtFactoryDateTime(b.sonAn) }, cell: ({ row }) => <TimeCell b={row.original} /> },
    { id: "grup", header: "Alan", size: 180, meta: { label: "Alan", exportValue: (b) => b.grup }, cell: ({ row }) => <GroupCell b={row.original} /> },
    {
      id: "baslik",
      header: "Bildirim",
      size: 420,
      meta: { label: "Bildirim", wrap: true, exportValue: (b) => [b.baslik, b.govde].filter(Boolean).join(" — ") },
      cell: ({ row }) => <TitleCell b={row.original} onAc={(b) => h.current.onAc(b)} />,
    },
    { id: "durum", header: "Durum", size: 150, meta: { label: "Durum", exportValue: statusText }, cell: ({ row }) => <StatusCell b={row.original} /> },
    {
      id: "actions",
      header: "İşlem",
      size: 240,
      enableHiding: false,
      meta: { label: "İşlem", align: "right", exportValue: () => "" },
      cell: ({ row }) => <ActionsCell b={row.original} onAc={(b) => h.current.onAc(b)} eylemler={h.current.eylemler} />,
    },
  ];
}

interface Options extends Handlers {
  items: NotificationItem[];
  secili: ReadonlySet<string>;
  setSecili: (s: Set<string>) => void;
}

/** Tablo — geri çağrılar ref'te (sütunlar bir kez kurulur), seçim sayfa durumunda. */
export function useNotificationTable({ items, secili, setSecili, onAc, eylemler }: Options) {
  const ref = useRef<Handlers>({ onAc, eylemler });
  ref.current = { onAc, eylemler };
  const columns = useMemo(() => notificationColumns(ref), []);
  return useLocalTable({
    tableKey: "notifications:list",
    data: items,
    columns,
    enableSelection: true,
    selectedIds: secili,
    onSelectedChange: setSecili,
  });
}
