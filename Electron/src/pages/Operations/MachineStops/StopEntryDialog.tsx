// =============================================================================
// ELLE DURUŞ GİRİŞİ (vardiya amiri) — kimlik `clientToken` (diyalog başına bir kez)
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { loadAllForPicker } from "@/lib/picker-loader";
import { machineService } from "@/pages/Machines/service";
import type { ReasonPreset } from "@/pages/ReasonPresets/service";
import type { OpenStopPayload } from "./service";
import { localInputToIso, nowLocalInput } from "./types";

interface Props {
  presets: ReasonPreset[];
  isPending: boolean;
  onClose: () => void;
  onConfirm: (body: OpenStopPayload) => void;
}

export function StopEntryDialog({ presets, isPending, onClose, onConfirm }: Props) {
  const [clientToken] = useState(() => crypto.randomUUID());
  const [machineId, setMachineId] = useState("");
  const [startedAt, setStartedAt] = useState(nowLocalInput());
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const machines = useQuery({ queryKey: ["machines", "stop-entry-picker"], queryFn: () => loadAllForPicker(machineService, { filters: { isActive: "true" }, sortBy: "code" }) });
  const ok = machineId !== "" && localInputToIso(startedAt) !== null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Elle duruş girişi</DialogTitle>
          <DialogDescription>
            Makinede tek açık duruş olabilir (ikincisi 409). Sebep şimdi verilmezse duruş yine açılır; sınıflandırma borcu doğar ve kuyrukta görünür.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Tezgah</Label>
            <Select value={machineId} onValueChange={setMachineId}>
              <SelectTrigger>
                <SelectValue placeholder={machines.isLoading ? "Yükleniyor..." : "Tezgah seç..."} />
              </SelectTrigger>
              <SelectContent>
                {(machines.data?.data ?? []).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.code} · {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="stop-started">Başlangıç</Label>
            <Input id="stop-started" type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Sebep (isteğe bağlı)</Label>
            <Select value={code} onValueChange={setCode}>
              <SelectTrigger>
                <SelectValue placeholder="Sonra atanacak (borç)" />
              </SelectTrigger>
              <SelectContent>
                {presets.map((p) => (
                  <SelectItem key={p.code} value={p.code}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="stop-note">Not</Label>
            <Textarea id="stop-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button
            disabled={!ok || isPending}
            onClick={() => onConfirm({ machineId, startedAt: localInputToIso(startedAt), reasonCode: code || null, reasonNote: note.trim() || null, clientToken })}
          >
            Duruşu Aç
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
