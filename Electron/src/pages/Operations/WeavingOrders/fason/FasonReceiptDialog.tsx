// =============================================================================
// FASON DOKUMA — "Top kabul et": satır satır metre/en/kg/kalite, toplar KK1 girişiyle doğar
// =============================================================================
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WeavingOrder } from "../types";
import { EMPTY_ROW, rowToPayload, validateReceiptRow } from "./fason-summary";
import { FasonReceiptRows } from "./FasonReceiptRows";
import type { FasonReceiptBody } from "./service";
import type { FasonReceiptRow } from "./types";

interface Props {
  order: WeavingOrder;
  isPending: boolean;
  /** Son kabulden dönen düşen satırlar (amber şerit) — diyalog açık kalırken gösterilir. */
  failed: { index: number; message: string }[];
  onClose: () => void;
  onConfirm: (body: FasonReceiptBody) => void;
}

export function FasonReceiptDialog({ order, isPending, failed, onClose, onConfirm }: Props) {
  const [rows, setRows] = useState<FasonReceiptRow[]>([{ ...EMPTY_ROW }]);
  const [manifestNo, setManifestNo] = useState("");
  const [notes, setNotes] = useState("");
  // `clientToken` mantıksal deneme başına bir kez: diyalog koşullu mount edilir, her açılış taze.
  const [clientToken] = useState(() => crypto.randomUUID());
  const ok = rows.length > 0 && rows.every((r) => validateReceiptRow(r).ok);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{order.weavingOrderNumber} — fasondan dönen topları kabul et</DialogTitle>
          <DialogDescription>
            Her satır bir TOP olarak doğar (kumaş {order.item.name}, {order.color?.name ?? "renksiz"}; giriş kaynağı “Dokuma”). Ölçüm ve etiket KK1 akışında; makbuz kalemi tutulmaz, parti iş emrine katılırken doğar.
          </DialogDescription>
        </DialogHeader>
        {failed.length > 0 && (
          <Callout tone="warning" title="Düşen satırlar">
            {failed.map((f) => (
              <div key={f.index}>
                Satır {f.index + 1}: {f.message}
              </div>
            ))}
          </Callout>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="fr-manifest">İrsaliye no (fasoncunun)</Label>
            <Input id="fr-manifest" value={manifestNo} onChange={(e) => setManifestNo(e.target.value)} maxLength={64} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fr-notes">Not</Label>
            <Input id="fr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </div>
        </div>
        <FasonReceiptRows rows={rows} onChange={setRows} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Vazgeç</Button>
          <Button
            disabled={!ok || isPending}
            onClick={() => onConfirm({ weavingOrderId: order.id, manifestNo: manifestNo.trim() || null, notes: notes.trim() || null, clientToken, rolls: rows.map(rowToPayload) })}
          >
            {rows.length} topu kabul et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
