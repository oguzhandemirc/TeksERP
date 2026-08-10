import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  BookmarkPlus,
  ChevronRight,
  MousePointerClick,
  Plus,
  Workflow,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import { springSnappy, springSoft } from "@/lib/motion";
import { toneFor } from "@/lib/station-colors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { routeService } from "@/pages/Routes/service";
import type { ProductionRoute } from "@/pages/Routes/types";
import { stationCapabilityService } from "@/pages/StationCapabilities/service";
import { capCanApplyColor } from "@/pages/StationCapabilities/types";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import { colorService } from "@/pages/Colors/service";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RouteStepDetail, type RouteTargetBinding } from "./RouteStepDetail";
import { deriveStepTargets, type RouteStepTargetPlan } from "./workOrderPrefill";
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
  /** İç "Şablondan başla" picker'ını gizle — WO formu onu bölüm başlığına taşıdı. */
  hideSeedPicker?: boolean;
  /**
   * `stepTargets`: iş emrinin düz hedefinden türetilen ADIM BAŞINA şablon hedefi
   * (2026-08-06). Burada türetilir çünkü istasyon yetenekleri zaten bu bileşende
   * yüklü — çağırana ikinci bir sorgu turu yaptırmak, ekranda gösterilen kuralla
   * kaydedilen kuralın ayrışma riskini de doğururdu.
   */
  onSaveTemplate: (
    name: string,
    forCustomer: boolean,
    stepTargets: Map<string, RouteStepTargetPlan>,
  ) => void;
  savePending: boolean;
  /** İç "Rotayı Kaydet" tetiğini gizle — WO formu onu bölüm başlığına, "Rota Seç"in
   *  yanına taşıdı. Kaydet modalı (ad + müşteri seçeneği) burada kalır; açık/kapalı
   *  durumu controlled prop'larla (saveModalOpen/onSaveModalOpenChange) dıştan yönetilir. */
  hideSaveTrigger?: boolean;
  saveModalOpen?: boolean;
  onSaveModalOpenChange?: (open: boolean) => void;
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
  hideSeedPicker,
  onSaveTemplate,
  savePending,
  hideSaveTrigger,
  saveModalOpen: saveModalOpenProp,
  onSaveModalOpenChange,
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
  // Uncontrolled fallback (ProductRecipeFormDialog gibi çağıranlar için) — WO formu
  // controlled prop'larla dıştan yönetir (tetik başlıkta, modal burada).
  const [internalSaveOpen, setInternalSaveOpen] = useState(false);
  const saveModalOpen = saveModalOpenProp ?? internalSaveOpen;
  const setSaveModalOpen = onSaveModalOpenChange ?? setInternalSaveOpen;
  const [saveName, setSaveName] = useState("");
  const [forCustomer, setForCustomer] = useState(false);

  // Tek adım eklenince onu seç; toplu (şablondan tohum) gelince İLK adımı seç.
  const prevLen = useRef(steps.length);
  useEffect(() => {
    if (steps.length > prevLen.current && steps.length > 0) {
      const isSingleAdd = steps.length === prevLen.current + 1;
      setSelectedId((isSingleAdd ? steps[steps.length - 1]! : steps[0]!).clientId);
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

  // Önleme (uyarı): rotanın SON adımı fason (EXTERNAL) ise, oradan dönen açık kumaş
  // depoda takılı kalabilir (normal sevk/kesim çıkışı olmaz). Engellemez — kaydedilebilir.
  const lastStepIsFason =
    steps.length > 0 && steps[steps.length - 1]?.stationType === "EXTERNAL";

  // --- Seçili adımın chip'ini, altındaki detay paneline bağlayan ok'un x konumu ---
  const flowRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [connectorX, setConnectorX] = useState<number | null>(null);
  // İstasyon adı/tipi değişince chip genişliği değişir → yeniden ölç.
  const flowSig = steps
    .map((s) => `${s.clientId}:${s.stationName ?? ""}:${s.stationType ?? ""}`)
    .join("|");
  useLayoutEffect(() => {
    const measure = () => {
      const flow = flowRef.current;
      const chip = selected ? chipRefs.current.get(selected.clientId) : null;
      if (!flow || !chip) {
        setConnectorX(null);
        return;
      }
      const fr = flow.getBoundingClientRect();
      const cr = chip.getBoundingClientRect();
      setConnectorX(cr.left + cr.width / 2 - fr.left);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // Perf: `selected` objesine DEĞİL, ölçümün gerçekten kullandığı clientId'ye
    // bağlan. updateStep seçili adımı klonladığından (yeni identity) not/firma
    // yazarken `selected` her tuşta değişip gereksiz senkron reflow (2x
    // getBoundingClientRect) tetikliyordu; chip düzeni flowSig'de zaten kodlu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowSig, selected?.clientId]);

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
  // Aynı yetenek yanıtları "Rotayı Kaydet"te adım başına hedef türetmek için de
  // kullanılır (deriveStepTargets) — ikinci bir sorgu turu YOK.
  const capsByStation = new Map<string, NonNullable<(typeof capResults)[number]["data"]>["data"]>();
  for (const [i, r] of capResults.entries()) {
    const cap = r.data?.data;
    if (!cap) continue;
    const sid = stationIds[i];
    if (sid) capsByStation.set(sid, cap);
    // Renk kısıtı yok — "renk veren adım var mı" sorusu yalnız kategori bayrağına
    // bakar (backend `appliesColor` kuralıyla aynı). Eskiden istasyonun renk
    // listesi de dolu olmak zorundaydı → yeni renk seçilince rota doğruyken bile
    // "karşılayan istasyon yok" uyarısı çıkıyordu.
    if (capCanApplyColor(cap)) hasColorStation = true;
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
      {/* Şablondan başla (tohum) — WO formunda bölüm başlığına taşındığında gizli. */}
      {!hideSeedPicker && (
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Şablondan başla (opsiyonel)</label>
          <EntityPickerModal<ProductionRoute>
            value={seedId}
            onChange={(id) => {
              setSeedId(id);
              onSeed(id);
            }}
            service={routeService}
            queryKey="routes"
            getLabel={(r) => r.name}
            getSubLabel={(r) => r.code}
            nullable
            noneLabel="— Boş başla"
            icon={Workflow}
            iconClassName="text-primary"
            title="Rota Şablonu Seç"
            description="Hazır rota — adımlar forma yüklenir. Yüzlerce şablonda ara."
            placeholder="Hazır rota seç — adımlar forma yüklenir..."
          />
        </div>
      )}

      {/* Yatay akış çubuğu */}
      <div ref={flowRef} className="flex flex-wrap items-center gap-1.5">
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
                isLast={i === steps.length - 1}
                active={selected?.clientId === node.clientId}
                onSelect={() => setSelectedId(node.clientId)}
                registerRef={(el) => {
                  if (el) chipRefs.current.set(node.clientId, el);
                  else chipRefs.current.delete(node.clientId);
                }}
              />
            ))}
          </SortableContext>
        </DndContext>
        <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.95 }} transition={springSnappy}>
          <Button
            type="button"
            size="sm"
            onClick={onAdd}
            className="h-8 gap-1 bg-gradient-to-b from-primary to-primary/80 text-primary-foreground shadow-sm shadow-primary/30 ring-1 ring-inset ring-white/10 hover:from-primary hover:to-primary hover:shadow-md hover:shadow-primary/40"
          >
            <Plus className="h-3.5 w-3.5" /> Adım Ekle
          </Button>
        </motion.div>
        {/* Bu rotayı kaydet — akış satırında en sağda, "Adım Ekle" ile aynı hizada.
            hideSaveTrigger ise (WO formu) tetik bölüm başlığına, "Rota Seç"in yanına
            taşınmıştır; modal (aşağıda) yine burada kalır. */}
        {!hideSaveTrigger && (
          <motion.div
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
            transition={springSnappy}
            className="ml-auto"
          >
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              disabled={steps.length === 0}
              onClick={() => setSaveModalOpen(true)}
            >
              <BookmarkPlus className="h-3.5 w-3.5" /> Rotayı Kaydet
            </Button>
          </motion.div>
        )}
      </div>

      {error && <Callout tone="danger">{error}</Callout>}

      {/* Önleme uyarısı — son adım fason (engellemez) */}
      {lastStepIsFason && (
        <Callout tone="warning">
          <strong>Son adım fason.</strong> Bu rotadan dönen açık kumaş depoda takılı
          kalabilir (normal sevk/kesim çıkışı olmadan). Rotayı Tambur veya bir iç
          istasyonla bitirmeniz önerilir.
        </Callout>
      )}

      {/* Karşılanma uyarısı */}
      {(uncoveredPropIds.length > 0 || colorUncovered) && (
        <Callout tone="warning">
          <strong>Rotada karşılayan istasyon yok:</strong>{" "}
          {colorUncovered && (
            <>renk{colorQ.data?.data ? ` (${colorQ.data.data.name})` : ""}</>
          )}
          {colorUncovered && uncoveredPropIds.length > 0 && " · "}
          {uncoveredPropNames.length > 0 && uncoveredPropNames.join(", ")}. Uygun
          istasyon ekle veya hedeften çıkar.
        </Callout>
      )}

      {/* Seçili adım detayı — üstteki chip ile ok'la birleşir */}
      {selected ? (
        <div className="relative">
          {/* Seçili chip'i panele bağlayan ok — adımın tonunda */}
          {connectorX != null && (
            <motion.span
              aria-hidden
              className={cn(
                "pointer-events-none absolute z-10 h-2.5 w-2.5 border-l border-t bg-muted/10",
                toneFor(selected.stationType, selected.stationKind).border,
              )}
              style={{ top: -5, rotate: 45 }}
              initial={false}
              animate={{ left: connectorX - 5 }}
              transition={springSoft}
            />
          )}
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
        </div>
      ) : steps.length === 0 ? (
        // Boş + zorunlu: boş durumun KENDİSİ nabız atan büyük çağrıdır.
        <motion.button
          type="button"
          onClick={onAdd}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          transition={springSnappy}
          className="attention-pulse flex w-full flex-col items-center gap-1 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 p-4 text-center text-primary transition-colors hover:border-primary/70 hover:bg-primary/10"
        >
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <Plus className="h-4 w-4" /> İlk üretim adımını ekle
          </span>
          <span className="text-[11px] text-primary/70">
            Tıkla ve başla — ya da yukarıdan hazır şablon seç.
          </span>
        </motion.button>
      ) : (
        <div className="rounded-lg border border-dashed bg-muted/20 p-3 text-center text-xs text-muted-foreground">
          Düzenlemek için bir adıma tıkla.
        </div>
      )}

      <Dialog open={saveModalOpen} onOpenChange={setSaveModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookmarkPlus className="h-4 w-4 text-primary" /> Rotayı Kaydet
            </DialogTitle>
            <DialogDescription>
              Bu üretim akışını yeniden kullanılabilir bir rota olarak kaydet — sonraki
              iş emirlerinde başlıktaki "Rota seç" ile tek tıkla gelir. Seçili hedef
              renk/özellikler de adımlarına yazılır; rota uygulanınca hazır gelirler.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Rota Adı *</label>
              <Input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Örn: Boyahane + Kurşun + Tambur"
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">Kod otomatik atanır.</p>
            </div>
            {customerId && (
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={forCustomer}
                  onChange={(e) => setForCustomer(e.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-primary"
                />
                Bu müşteriye özel varsayılan rota olarak kaydet
              </label>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setSaveModalOpen(false)}>
              Vazgeç
            </Button>
            <Button
              type="button"
              size="sm"
              className="gap-1.5 bg-gradient-to-b from-primary to-primary/80 text-primary-foreground shadow-sm shadow-primary/30 ring-1 ring-inset ring-white/10 hover:from-primary hover:to-primary hover:shadow-md hover:shadow-primary/40"
              disabled={savePending || !saveName.trim() || steps.length === 0}
              onClick={() => {
                onSaveTemplate(
                  saveName.trim(),
                  forCustomer,
                  deriveStepTargets(steps, target, capsByStation),
                );
                setSaveModalOpen(false);
              }}
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
              {savePending ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SortableChip({
  node,
  index,
  active,
  isLast,
  onSelect,
  registerRef,
}: {
  node: DesignerStep;
  index: number;
  active: boolean;
  isLast: boolean;
  onSelect: () => void;
  registerRef: (el: HTMLElement | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.clientId });
  const ext = node.stationType === "EXTERNAL";
  const hasStation = Boolean(node.stationId);
  const tone = toneFor(node.stationType, node.stationKind);
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 20 : undefined,
      }}
      className="flex items-center gap-1"
    >
      <motion.button
        ref={registerRef}
        type="button"
        onClick={onSelect}
        {...attributes}
        {...listeners}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.95 }}
        transition={springSnappy}
        className={cn(
          "group relative flex cursor-grab items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-xs shadow-sm transition-colors hover:shadow-md active:cursor-grabbing",
          !hasStation
            ? // Yapılandırılmamış adım — "beni seç" çağrısı (kesik kenar + nabız)
              "border-dashed border-primary/60 bg-primary/5 text-primary"
            : active
              ? cn(tone.borderStrong, tone.bgSoft, "ring-1", tone.ring)
              : cn("bg-background", tone.border, tone.borderHover, tone.bgHover),
        )}
      >
        {/* Yapılandırılmamış adım: nabız atan halka */}
        {!hasStation && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-md ring-2 ring-primary/50"
            animate={{ opacity: [0.55, 0, 0.55] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <span
          className={cn(
            "relative flex h-4 w-4 items-center justify-center rounded-full font-mono text-[9px] font-semibold transition-colors",
            !hasStation
              ? "bg-primary/15 text-primary"
              : active
                ? cn(tone.solid, "text-white")
                : tone.numIdle,
          )}
        >
          {index + 1}
        </span>
        <span className={cn("relative font-medium", active && hasStation && tone.text)}>
          {node.stationName || "İstasyon seç"}
        </span>
        {!hasStation && (
          <MousePointerClick className="relative h-3.5 w-3.5 shrink-0 animate-pulse" />
        )}
        {ext && hasStation && (
          <Badge
            variant="outline"
            className={cn("relative border-station-fason/60 text-[9px]", tone.text)}
          >
            FASON
          </Badge>
        )}
      </motion.button>
      {!isLast && (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40" />
      )}
    </div>
  );
}
