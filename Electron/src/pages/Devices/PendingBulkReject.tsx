import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { safeFormat } from "@/lib/format";
import { deviceService } from "./service";
import type { DeviceListItem } from "./types";

/**
 * Bekleyen cihazları seçerek toplu reddet (VDS O3): her satır kaynak adres ve ilk görülmeyle
 * listelenir, yönetici tek tek seçer; reddedilen cihaz pasife düşer (silinmez, geri açılabilir).
 */
export function PendingBulkReject({ devices, onDone }: { devices: DeviceListItem[]; onDone: () => void }) {
  const pending = useMemo(() => devices.filter((d) => d.status === "PENDING" && d.isActive && !d.mergedIntoId), [devices]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const mut = useMutation({
    mutationFn: () => deviceService.rejectPending([...selected]),
    onSuccess: (r) => {
      const n = r.data?.rejected.length ?? 0;
      toast.success(`${n} cihaz reddedildi (pasife alındı)`);
      setSelected(new Set());
      setConfirm(false);
      onDone();
    },
  });
  if (pending.length < 2) return null;
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const chosen = pending.filter((d) => selected.has(d.id));
  return (
    <details className="rounded-md border p-3" data-testid="pending-bulk-reject">
      <summary className="cursor-pointer text-sm font-medium">Onay bekleyen {pending.length} cihaz — toplu reddet</summary>
      <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm">
        {pending.map((d) => (
          <li key={d.id}>
            <label className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} className="h-4 w-4" />
              <span className="font-medium">{d.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{d.announcedFrom ?? "adres bilinmiyor"}</span>
              <span className="text-xs text-muted-foreground">ilk görülme {safeFormat(d.createdAt, "dd.MM.yyyy HH:mm")}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setSelected(new Set(pending.map((d) => d.id)))}>Tümünü seç</Button>
        <Button size="sm" variant="destructive" disabled={chosen.length === 0 || mut.isPending} onClick={() => setConfirm(true)}>
          Seçilenleri reddet ({chosen.length})
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Seçili cihazlar reddedilsin mi?"
        description={`${chosen.map((d) => d.name).join(", ")} pasife alınacak. Kayıtlar silinmez; gerekirse cihaz listesinden yeniden etkinleştirilebilir.`}
        confirmLabel="Reddet"
        destructive
        isPending={mut.isPending}
        onConfirm={() => mut.mutate()}
      />
    </details>
  );
}
