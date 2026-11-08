// =============================================================================
// İstasyon PANELİ — liste görünümünde satıra tıklayınca sağda açılır (2026-11-08)
// =============================================================================
// İstasyonun TÜM işleri tek yerde: düzenle · pasife al/aktifleştir · kurşun ayarı (gramaj + varsayılan) ·
// makineler (mevcut `MachineRowActions`) · özellik yeteneği. Diğer detay panelleri (iş emri) gibi
// karartmalı ve modal: dışarı tıklamak, X ya da Esc kapatır.
// =============================================================================
import { Pencil, Plus, Power, PowerOff, Sparkles, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { stationTypeLabels, StationType } from "@/types/enums";
import type { Machine } from "@/pages/Machines/types";
import { peripheralKindLabels, type PeripheralDevice } from "@/pages/PeripheralDevices/types";
import type { StationCapabilitySummary } from "@/pages/StationCapabilities/types";
import type { Station } from "./types";
import type { StationKursunInfo } from "./stationListItems";
import { canHaveKursun } from "./stationListItems";
import { plainStationKindLabel } from "./stationPlainLabels";
import { capabilityChips, KursunBadge, StationStatusBadge } from "./StationListRow";
import { MachineRowActions, type MachineActionHandlers } from "./MachineRowActions";
import { StationKursunSection } from "./StationKursunSection";

interface Props {
  station: Station | null;
  machines: Machine[];
  peripheralsByMachine: ReadonlyMap<string, PeripheralDevice[]>;
  cap?: StationCapabilitySummary;
  kursun: StationKursunInfo | null;
  canWrite: boolean;
  onClose: () => void;
  onEdit: (s: Station) => void;
  onToggleActive: (s: Station) => void;
  onAddMachine: (stationId: string) => void;
  onEditCap: (cap: StationCapabilitySummary) => void;
  machine: MachineActionHandlers;
}

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>
      {action}
    </div>
  );
}

function MachineItem({ m, devices, canWrite, h, station }: { m: Machine; devices: PeripheralDevice[]; canWrite: boolean; h: MachineActionHandlers; station: Station }) {
  const active = m.isActive !== false;
  return (
    <li data-testid="panel-machine" className={cn("flex items-center gap-3 px-3 py-2", !active && "text-muted-foreground")}>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium">{m.name}</span>
          {m.code && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{m.code}</span>}
        </div>
        <div className="truncate text-xs text-muted-foreground" title={devices.map((d) => `${d.name} (${peripheralKindLabels[d.kind]})`).join(", ")}>
          {devices.length > 0 ? devices.map((d) => d.name).join(", ") : "Bağlı cihaz yok"}
        </div>
      </div>
      <StationStatusBadge active={active} />
      <MachineRowActions m={m} canWrite={canWrite} h={h} stationKind={station.kind} />
    </li>
  );
}

export function StationDetailPanel({ station: s, machines, peripheralsByMachine, cap, kursun, canWrite, onClose, onEdit, onToggleActive, onAddMachine, onEditCap, machine }: Props) {
  const chips = s ? capabilityChips(s) : [];
  const showKursun = !!s && (canHaveKursun(s) || kursun?.enabled === true);
  return (
    <Sheet open={!!s} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        data-testid="station-detail-panel"
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        {s && (
          <>
            <div className="border-b px-5 pb-4 pt-5">
              <div className="flex flex-wrap items-center gap-2 pr-8">
                <SheetTitle className="text-lg">{s.name}</SheetTitle>
                <StationStatusBadge active={s.isActive} />
              </div>
              <SheetDescription className="mt-1 text-xs">
                {[s.code, plainStationKindLabel(s.kind), s.defaultCategory?.name, s.type === StationType.EXTERNAL ? stationTypeLabels[s.type] : null, s.department]
                  .filter(Boolean)
                  .join(" · ")}
              </SheetDescription>
              {canWrite && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onEdit(s)}>
                    <Pencil className="h-3.5 w-3.5" /> Düzenle
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className={cn("gap-1.5", s.isActive ? "hover:text-amber-700" : "text-emerald-700 hover:text-emerald-800")}
                    onClick={() => onToggleActive(s)}
                  >
                    {s.isActive ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                    {s.isActive ? "Pasife al" : "Aktifleştir"}
                  </Button>
                </div>
              )}
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
              <section>
                <SectionTitle
                  action={
                    canWrite && cap?.canApplyProperty ? (
                      <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => onEditCap(cap)}>
                        <Sparkles className="h-3.5 w-3.5" /> Özellikleri düzenle
                      </Button>
                    ) : undefined
                  }
                >
                  Yetenekler
                </SectionTitle>
                <div className="flex flex-wrap items-center gap-1.5">
                  <KursunBadge kursun={kursun} />
                  {chips.map((c) => (
                    <Badge key={c} variant="muted">
                      {c}
                    </Badge>
                  ))}
                  {cap?.canApplyProperty && (
                    <Badge variant="outline" className="gap-1">
                      <Sparkles className="h-3 w-3" /> {cap.propertyCount} özellik
                    </Badge>
                  )}
                  {chips.length === 0 && !kursun?.enabled && !cap?.canApplyProperty && (
                    <span className="text-xs text-muted-foreground">Tanımlı yetenek yok.</span>
                  )}
                </div>
              </section>

              {showKursun && (
                <section data-testid="panel-kursun">
                  <SectionTitle>Kurşun</SectionTitle>
                  {canWrite ? (
                    <StationKursunSection key={s.id} stationId={s.id} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {kursun?.enabled
                        ? `Kurşun uygular${kursun.defaultGramaj ? ` · varsayılan gramaj ${kursun.defaultGramaj}` : ""}`
                        : "Kurşun uygulanmıyor."}
                    </p>
                  )}
                </section>
              )}

              <section data-testid="panel-machines">
                <SectionTitle>Makineler ({machines.length})</SectionTitle>
                {machines.length > 0 ? (
                  <ul className="divide-y rounded-md border">
                    {machines.map((m) => (
                      <MachineItem key={m.id} m={m} devices={peripheralsByMachine.get(m.id) ?? []} canWrite={canWrite} h={machine} station={s} />
                    ))}
                  </ul>
                ) : (
                  <div className="flex flex-col items-center gap-1 rounded-md border border-dashed px-4 py-6 text-center">
                    <Wrench className="h-5 w-5 text-muted-foreground" />
                    <p className="text-sm font-medium">Bu istasyonda makine yok</p>
                    <p className="text-xs text-muted-foreground">Tablette oturum makine QR etiketiyle açılır; önce bir makine ekleyin.</p>
                  </div>
                )}
                {canWrite && (
                  <Button size="sm" variant="outline" className="mt-3 w-full gap-1.5" onClick={() => onAddMachine(s.id)}>
                    <Plus className="h-4 w-4" /> Makine ekle
                  </Button>
                )}
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
