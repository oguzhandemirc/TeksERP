import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, Plus } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { routeService } from "@/pages/Routes/service";
import type { ProductionRoute } from "@/pages/Routes/types";
import { stationCapabilityService } from "@/pages/StationCapabilities/service";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import { colorService } from "@/pages/Colors/service";
import { RouteDesignerTemplatePanel } from "./RouteDesignerTemplatePanel";
import { RouteStepDetail, type RouteTargetBinding } from "./RouteStepDetail";
import type { DesignerStep } from "./RouteDesignerDialog";

interface Props {
  steps: DesignerStep[];
  onAdd: () => void;
  onRemove: (clientId: string) => void;
  onMove: (clientId: string, dir: -1 | 1) => void;
  onReorder: (activeId: string, overId: string) => void;
  onPickStation: (clientId: string, stationId: string | null) => void;
  onSetNotes: (clientId: string, notes: string) => void;
  onSetFirm: (clientId: string, patch: { plannedSubcontractorId?: string | null }) => void;
  onSeed: (routeId: string | null) => void;
  onSaveTemplate: (name: string, forCustomer: boolean) => void;
  savePending: boolean;
  customerId: string | null;
  target: RouteTargetBinding;
  error?: string;
}

export function RouteEditor({
  steps,
  onAdd,
  onRemove,
  onMove,
  onReorder,
  onPickStation,
  onSetNotes,
  onSetFirm,
  onSeed,
  onSaveTemplate,
  savePending,
  customerId,
  target,
  error,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) onReorder(String(active.id), String(over.id));
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [seedId, setSeedId] = useState<string | null>(null);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [forCustomer, setForCustomer] = useState(false);

  // Yeni adım eklendiğinde sonuncuyu otomatik seç.
  const prevLen = useRef(steps.length);
  useEffect(() => {
    if (steps.length > prevLen.current && steps.length > 0) {
      setSelectedId(steps[steps.length - 1]!.clientId);
    }
    prevLen.current = steps.length;
  }, [steps]);

  const selected = useMemo(
    () => steps.find((s) => s.clientId === selectedId) ?? steps[0] ?? null,
    [steps, selectedId],
  );
  const selectedIndex = selected
    ? steps.findIndex((s) => s.clientId === selected.clientId)
    : -1;

  // --- Sipariş özelliği/rengi karşılanma uyarısı ---
  const stationIds = useMemo(
    () => Array.from(new Set(steps.map((s) => s.stationId).filter(Boolean))),
    [steps],
  );
  const capResults = useQueries({
    queries: stationIds.map((id) => ({
      queryKey: ["station-capabilities", id],
      queryFn: () => stationCapabilityService.getByStation(id),
      staleTime: 300_000,
    })),
  });
  const coveredProps = new Set<string>();
  let hasColorStation = false;
  for (const r of capResults) {
    const cap = r.data?.data;
    if (!cap) continue;
    if (cap.canApplyColor && cap.colors.length > 0) hasColorStation = true;
    if (cap.canApplyProperty) for (const p of cap.properties) coveredProps.add(p.id);
  }
  const uncoveredPropIds = target.propertyIds.filter((id) => !coveredProps.has(id));
  const colorUncovered = Boolean(target.colorId) && !hasColorStation;

  const allPropsQ = useQuery({
    queryKey: ["fabric-properties", "all"],
    queryFn: () =>
      fabricPropertyService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "sortOrder",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    enabled: uncoveredPropIds.length > 0,
    staleTime: 300_000,
  });
  const colorQ = useQuery({
    queryKey: ["color", target.colorId],
    queryFn: () => colorService.getById(target.colorId as string),
    enabled: colorUncovered,
    staleTime: 300_000,
  });
  const uncoveredPropNames = uncoveredPropIds.map(
    (id) => allPropsQ.data?.data.find((p) => p.id === id)?.name ?? id,
  );

  return (
    <div className="space-y-2">
      {/* Şablondan başla (tohum) */}
      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">Şablondan başla (opsiyonel)</label>
        <ReferenceSelect<ProductionRoute>
          value={seedId}
          onChange={(id) => {
            setSeedId(id);
            onSeed(id);
          }}
          service={routeService}
          queryKey="routes"
          getLabel={(r) => (r.code ? `${r.name} (${r.code})` : r.name)}
          placeholder="Hazır rota seç — adımlar forma yüklenir..."
          nullable
          noneLabel="— Boş başla"
        />
      </div>

      {/* Yatay akış çubuğu */}
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Üretim Akışı
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={steps.map((s) => s.clientId)}
            strategy={horizontalListSortingStrategy}
          >
            {steps.map((node, i) => (
              <SortableChip
                key={node.clientId}
                node={node}
                index={i}
                active={selected?.clientId === node.clientId}
                onSelect={() => setSelectedId(node.clientId)}
              />
            ))}
          </SortableContext>
        </DndContext>
        <Button type="button" size="sm" variant="outline" onClick={onAdd} className="h-8 gap-1">
          <Plus className="h-3.5 w-3.5" /> Adım
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        İpucu: adımları sürükleyerek sırayı değiştirebilirsin.
      </p>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Karşılanma uyarısı */}
      {(uncoveredPropIds.length > 0 || colorUncovered) && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <span className="font-medium">Rotada karşılayan istasyon yok:</span>{" "}
            {colorUncovered && (
              <>renk{colorQ.data?.data ? ` (${colorQ.data.data.name})` : ""}</>
            )}
            {colorUncovered && uncoveredPropIds.length > 0 && " · "}
            {uncoveredPropNames.length > 0 && uncoveredPropNames.join(", ")}. Uygun
            istasyon ekle veya hedeften çıkar.
          </div>
        </div>
      )}

      {/* Seçili adım detayı */}
      {selected ? (
        <RouteStepDetail
          key={selected.clientId}
          step={selected}
          sequence={selectedIndex + 1}
          canMoveUp={selectedIndex > 0}
          canMoveDown={selectedIndex < steps.length - 1}
          onPickStation={(id) => onPickStation(selected.clientId, id)}
          onSetNotes={(notes) => onSetNotes(selected.clientId, notes)}
          onSetFirm={(patch) => onSetFirm(selected.clientId, patch)}
          onMove={(dir) => onMove(selected.clientId, dir)}
          onRemove={() => onRemove(selected.clientId)}
          target={target}
        />
      ) : (
        <div className="rounded-md border border-dashed bg-muted/20 p-3 text-center text-xs text-muted-foreground">
          Akış boş. "Adım" ile başla veya yukarıdan bir şablon seç.
        </div>
      )}

      {/* Şablon olarak kaydet */}
      <RouteDesignerTemplatePanel
        enabled={saveAsTemplate}
        onEnabledChange={setSaveAsTemplate}
        name={saveName}
        onNameChange={setSaveName}
        customerId={customerId}
        forCustomer={forCustomer}
        onForCustomerChange={setForCustomer}
      />
      {saveAsTemplate && (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            disabled={savePending || !saveName.trim() || steps.length === 0}
            onClick={() => onSaveTemplate(saveName.trim(), forCustomer)}
          >
            {savePending ? "Kaydediliyor..." : "Şablonu kaydet"}
          </Button>
        </div>
      )}
    </div>
  );
}

function SortableChip({
  node,
  index,
  active,
  onSelect,
}: {
  node: DesignerStep;
  index: number;
  active: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.clientId });
  const ext = node.stationType === "EXTERNAL";
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="flex items-center gap-1"
    >
      <button
        type="button"
        onClick={onSelect}
        {...attributes}
        {...listeners}
        className={
          "flex cursor-grab items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors active:cursor-grabbing " +
          (active
            ? "border-primary bg-primary/10"
            : ext
              ? "border-amber-300 bg-amber-50/40 hover:bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20"
              : "bg-background hover:bg-muted/50")
        }
      >
        <span className="font-mono text-[10px] text-muted-foreground">{index + 1}</span>
        <span className="font-medium">{node.stationName || "İstasyon seç"}</span>
        {ext && (
          <Badge variant="outline" className="text-[9px]">
            FASON
          </Badge>
        )}
      </button>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
    </div>
  );
}
