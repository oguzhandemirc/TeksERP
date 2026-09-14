import { MoreHorizontal, Tag, RefreshCw, History, Square, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PermissionGate } from "@/components/PermissionGate";
import type { MachineStop } from "./types";

export interface StopActions {
  onClassify: (r: MachineStop) => void;
  onReclassify: (r: MachineStop) => void;
  onLedger: (r: MachineStop) => void;
  onClose: (r: MachineStop) => void;
  onRevoke: (r: MachineStop) => void;
}

/** Satır menüsü — sınıflandırma `loom:classify`, elle giriş/kapatma/geri alma `loom:manual-entry`. */
export function StopRowMenu({ row, a }: { row: MachineStop; a: StopActions }) {
  const needsReason = row.requiresReason && !row.reasonCode;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Satır işlemleri">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <PermissionGate permission="loom:classify">
          <DropdownMenuItem disabled={!needsReason} onSelect={() => a.onClassify(row)}>
            <Tag className="mr-2 h-4 w-4" /> Sebep ata
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!row.reasonCode} onSelect={() => a.onReclassify(row)}>
            <RefreshCw className="mr-2 h-4 w-4" /> Yeniden sınıflandır
          </DropdownMenuItem>
        </PermissionGate>
        <DropdownMenuItem onSelect={() => a.onLedger(row)}>
          <History className="mr-2 h-4 w-4" /> Değişiklik defteri
        </DropdownMenuItem>
        <PermissionGate permission="loom:manual-entry">
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={row.endedAt !== null} onSelect={() => a.onClose(row)}>
            <Square className="mr-2 h-4 w-4" /> Kapat
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => a.onRevoke(row)}>
            <Undo2 className="mr-2 h-4 w-4" /> Geri al
          </DropdownMenuItem>
        </PermissionGate>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
