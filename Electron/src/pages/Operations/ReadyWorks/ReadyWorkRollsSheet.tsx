// Sevke Hazır İşler — birimin topları çekmecesi (ikinci uç `/ready-works/:unit/:id/rolls`). "Sevke al" YENİ bir
// yaratıcı değildir: seçili HAZIR toplarla mevcut Hızlı Sevk diyaloğunu açar (`POST /api/shipping/shipments/from-rolls`).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Truck } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { formatNumber } from "@/lib/format";
import { getReadyWorkRolls, READY_WORKS_QUERY_KEY, type ReadinessClass, type ReadyWorkRoll, type ReadyWorkRow } from "./service";
import { isQuickShippable, primaryWarehouseKey, rollBlockLabel, warehouseKey } from "./ready-works-view";

const CLASS_LABEL: Record<ReadinessClass, string> = { READY: "Hazır", IN_PROCESS: "İşlemde", GONE: "Sevk edildi", SCRAP: "Fire" };
const CLASS_ORDER: Record<ReadinessClass, number> = { READY: 0, IN_PROCESS: 1, GONE: 2, SCRAP: 3 };

interface Props {
  row: ReadyWorkRow;
  onClose: () => void;
  /** Sevk yetkisi + ticaret rejimi (Hızlı Sevk yüklemi `canQuickShip` ile aynı rejim şartı). */
  canShip: boolean;
  onShip: (rolls: ReadyWorkRoll[], customerId: string | null) => void;
}

interface RollItemProps {
  r: ReadyWorkRoll;
  canShip: boolean;
  checked: boolean;
  showWarehouse: boolean;
  onToggle: (on: boolean) => void;
}

function RollItem({ r, canShip, checked, showWarehouse, onToggle }: RollItemProps) {
  const shippable = isQuickShippable(r);
  const blocked = rollBlockLabel(r);
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      {canShip && (
        <Checkbox aria-label={`${r.barcode ?? r.id} seç`} disabled={!shippable} checked={checked} onCheckedChange={(v) => onToggle(v === true)} />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{r.barcode ?? "Etiketsiz top"}</div>
        <div className="truncate text-xs text-muted-foreground">
          {[r.itemName, r.colorName, showWarehouse ? r.warehouseName ?? "Depo yok" : null].filter(Boolean).join(" · ") || "—"}
        </div>
      </div>
      <span className="whitespace-nowrap tabular-nums">{formatNumber(Number(r.currentQty), 1)} m</span>
      <Badge variant={shippable ? "default" : "muted"} className="whitespace-nowrap" title={blocked ? "Hızlı Sevk'e alınamaz" : undefined}>
        {blocked ?? CLASS_LABEL[r.readinessClass]}
      </Badge>
    </li>
  );
}

export function ReadyWorkRollsSheet({ row, onClose, canShip, onShip }: Props) {
  const q = useQuery({
    queryKey: [READY_WORKS_QUERY_KEY, "rolls", row.unit, row.id],
    queryFn: () => getReadyWorkRolls(row.unit, row.id),
  });
  const rolls = useMemo(
    () => [...(q.data ?? [])].sort((a, b) => CLASS_ORDER[a.readinessClass] - CLASS_ORDER[b.readinessClass]),
    [q.data],
  );
  // Seçim yalnız Hızlı Sevk'in kabul edeceği toplarda; varsayılan = ana depodaki hepsi (kullanıcı tek tek değiştirir).
  const primary = useMemo(() => primaryWarehouseKey(rolls), [rolls]);
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const isOn = (r: ReadyWorkRoll) => isQuickShippable(r) && (overrides.get(r.id) ?? warehouseKey(r) === primary);
  const selected = rolls.filter(isOn);
  const selectedMeters = selected.reduce((s, r) => s + Number(r.currentQty), 0);
  const mixedWarehouses = new Set(selected.map(warehouseKey)).size > 1;
  const manyWarehouses = new Set(rolls.filter(isQuickShippable).map(warehouseKey)).size > 1;
  const toggle = (id: string, on: boolean) =>
    setOverrides((prev) => new Map(prev).set(id, on));

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col overflow-hidden sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{row.label}</SheetTitle>
          <SheetDescription>
            {row.customerName ? `${row.customerName} · ` : ""}
            {row.readyCount} hazır top ({formatNumber(row.readyMeters, 1)} m) · {row.inProcessCount} işlemde ({formatNumber(row.inProcessMeters, 1)} m)
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {q.isLoading ? (
            <div className="text-sm text-muted-foreground">Yükleniyor…</div>
          ) : q.isError ? (
            <div className="text-sm text-destructive">Toplar yüklenemedi.</div>
          ) : rolls.length === 0 ? (
            <div className="text-sm text-muted-foreground">Bu işte canlı top yok.</div>
          ) : (
            <ul className="divide-y rounded-md border" aria-label="İşin topları">
              {rolls.map((r) => (
                <RollItem key={r.id} r={r} canShip={canShip} checked={isOn(r)} showWarehouse={manyWarehouses} onToggle={(on) => toggle(r.id, on)} />
              ))}
            </ul>
          )}
        </div>
        <div className="border-t pt-3">
          {canShip && mixedWarehouses && (
            <Callout tone="warning" className="mb-2">Seçilen toplar farklı depolarda — tek sevkiyat tek depodan çıkar.</Callout>
          )}
          {canShip ? (
            <Button className="w-full sm:w-auto" disabled={selected.length === 0 || mixedWarehouses} onClick={() => onShip(selected, row.customerId)}>
              <Truck className="mr-2 h-4 w-4" />
              Hazır topları sevke al ({selected.length} top · {formatNumber(selectedMeters, 1)} m)
            </Button>
          ) : (
            <Callout tone="info">
              Bu kurulumda sevk Sevk Kapısı / çuval akışından yapılır ya da sevk yetkiniz yok — buradan doğrudan sevk açılmaz.
            </Callout>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
