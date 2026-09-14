import { Pencil, CheckCircle2, Ban, Truck } from "lucide-react";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { PermissionGate } from "@/components/PermissionGate";
import { WEAVING_STATUS_META, type WeavingOrder } from "./types";
import { isFasonSectionVisible } from "./fason/fason-summary";

interface Props {
  row: WeavingOrder;
  onEdit: (r: WeavingOrder) => void;
  onClose: (r: WeavingOrder) => void;
  onCancel: (r: WeavingOrder) => void;
  onFason: (r: WeavingOrder) => void;
}

/** Satır menüsü — üç eylem yalnız AÇIK durumda ve `weavingorder:write` ile; "Fason" fasonda dokunan işte (okuma yeter, kapalı işte de). */
export function WeavingOrderRowMenu({ row, onEdit, onClose, onCancel, onFason }: Props) {
  const open = WEAVING_STATUS_META[row.status].open;
  return (
    <>
      {isFasonSectionVisible(row) && (
        <ContextMenuItem onSelect={() => onFason(row)}>
          <Truck /> Fason (sevk · kabul)
        </ContextMenuItem>
      )}
      <PermissionGate permission="weavingorder:write">
        <ContextMenuItem disabled={!open} onSelect={() => onEdit(row)}>
          <Pencil /> Düzenle
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!open} onSelect={() => onClose(row)}>
          <CheckCircle2 /> Kapat
        </ContextMenuItem>
        <ContextMenuItem disabled={!open} onSelect={() => onCancel(row)}>
          <Ban /> İptal et
        </ContextMenuItem>
      </PermissionGate>
    </>
  );
}
