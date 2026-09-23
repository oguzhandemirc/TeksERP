// Liste görünümü SATIRI — istasyon hücreleri + makine hücreleri (her biri 80 satır tavanının altında).
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { toneFor } from "@/lib/station-colors";
import { stationKindLabel, stationTypeLabels } from "@/types/enums";
import { peripheralKindLabels } from "@/pages/PeripheralDevices/types";
import type { Station } from "./types";
import type { StationMachineRow } from "./stationMachineRows";
import { MachineRowActions, type MachineActionHandlers } from "./MachineRowActions";

/** Yetenek rozetleri — dışa aktarımdaki Evet/Hayır sütunlarının satır içi karşılığı. */
export function capabilityChips(s: Station): string[] {
  const out: string[] = [];
  if (s.appliesColor) out.push("Renk");
  if (s.appliesProperty) out.push("Özellik");
  if (s.appliesQuality) out.push("Kalite");
  if (s.producesWarpBeam) out.push("Levent sarar");
  if (s.consumesWarpBeam) out.push("Levent tüketir");
  return out;
}

const LINK_BTN = "text-left font-medium hover:underline disabled:cursor-default disabled:no-underline";

function StationCells({ s, canWrite, onEditStation }: { s: Station; canWrite: boolean; onEditStation: (s: Station) => void }) {
  const tone = toneFor(s.type, s.kind);
  const chips = capabilityChips(s);
  return (
    <>
      <TableCell className="py-1.5">
        <div className="flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", tone.solid)} />
          <button type="button" disabled={!canWrite} className={LINK_BTN} onClick={() => canWrite && onEditStation(s)} title={canWrite ? "İstasyonu düzenle" : undefined}>
            {s.name}
          </button>
          {s.code && <span className="shrink-0 font-mono text-xs text-muted-foreground">{s.code}</span>}
          {!s.isActive && (
            <Badge variant="outline" className="shrink-0">
              pasif
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="py-1.5">
        <Badge className={cn("border-transparent font-medium", tone.bgSoft, tone.text)}>{stationKindLabel(s.kind)}</Badge>
      </TableCell>
      <TableCell className="py-1.5 text-xs">{stationTypeLabels[s.type]}</TableCell>
      <TableCell className="py-1.5 text-xs">{s.department ?? "—"}</TableCell>
      <TableCell className="py-1.5">
        <div className="flex flex-wrap gap-1">
          {chips.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
          {chips.map((c) => (
            <Badge key={c} variant="muted" className="text-[10px]">
              {c}
            </Badge>
          ))}
        </div>
      </TableCell>
    </>
  );
}

function MachineCells({ r, canWrite, onAddMachine, h }: { r: StationMachineRow; canWrite: boolean; onAddMachine: (stationId: string) => void; h: MachineActionHandlers }) {
  const m = r.machine;
  if (!m) {
    return (
      <>
        <TableCell className="py-1.5"><span className="text-muted-foreground">—</span></TableCell>
        <TableCell className="py-1.5"><span className="text-xs text-muted-foreground">Makine yok</span></TableCell>
        <TableCell className="py-1.5" />
        <TableCell className="py-1.5">
          {canWrite && (
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => onAddMachine(r.station.id)}>
                <Plus className="h-3.5 w-3.5" /> Makine
              </Button>
            </div>
          )}
        </TableCell>
      </>
    );
  }
  const active = m.isActive !== false;
  return (
    <>
      <TableCell className="py-1.5">
        <button type="button" disabled={!canWrite} className={LINK_BTN} onClick={() => canWrite && h.onEdit(m)} title={canWrite ? "Makineyi düzenle" : undefined}>
          {m.name}
        </button>
      </TableCell>
      <TableCell className="py-1.5">
        <Badge variant={active ? "secondary" : "muted"} className="gap-1.5">
          <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-emerald-500" : "bg-muted-foreground/50")} />
          {active ? "Aktif" : "Pasif"}
        </Badge>
      </TableCell>
      <TableCell className="py-1.5 text-xs" title={r.devices.map((d) => `${d.name} (${peripheralKindLabels[d.kind]})`).join(", ")}>
        {r.devices.length > 0 ? r.devices.map((d) => d.name).join(", ") : "—"}
      </TableCell>
      <TableCell className="py-1.5">
        <MachineRowActions m={m} canWrite={canWrite} h={h} />
      </TableCell>
    </>
  );
}

export function StationListRow({ r, canWrite, onEditStation, onAddMachine, machine }: { r: StationMachineRow; canWrite: boolean; onEditStation: (s: Station) => void; onAddMachine: (stationId: string) => void; machine: MachineActionHandlers }) {
  const active = r.machine ? r.machine.isActive !== false : r.station.isActive;
  return (
    <TableRow className={active ? undefined : "opacity-60"}>
      <StationCells s={r.station} canWrite={canWrite} onEditStation={onEditStation} />
      <MachineCells r={r} canWrite={canWrite} onAddMachine={onAddMachine} h={machine} />
    </TableRow>
  );
}
