import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Factory, Trash2, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { easeOut } from "@/lib/motion";
import { toneFor } from "@/lib/station-colors";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { ColorPickerModal } from "@/components/forms/color-picker/ColorPickerModal";
import { QuickAddProperty } from "@/components/forms/QuickAddProperty";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { stationService } from "@/pages/Stations/service";
import type { Station } from "@/pages/Stations/types";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import { stationKindLabels } from "@/types/enums";
import { stationCapabilityService } from "@/pages/StationCapabilities/service";
import { capCanApplyColor, isTargetableProperty } from "@/pages/StationCapabilities/types";
import type { DesignerStep } from "./RouteDesignerDialog";

export interface RouteTargetBinding {
  colorId: string | null;
  propertyIds: string[];
  onColor: (id: string | null) => void;
  onProperties: (ids: string[]) => void;
  colorLocked?: boolean;
  lockedPropertyIds?: string[];
  /** Bağlı sipariş(ler) tek müşteriye çözülüyorsa o müşteri — renk picker'da
   *  müşterinin renkleri üstte/vurgulu gösterilir. */
  customerId?: string | null;
}

interface Props {
  step: DesignerStep;
  sequence: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onPickStation: (id: string | null) => void;
  onSetNotes: (notes: string) => void;
  onSetFirm: (patch: { plannedSubcontractorId?: string | null }) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  target: RouteTargetBinding;
}

export function RouteStepDetail({
  step,
  sequence,
  canMoveUp,
  canMoveDown,
  onPickStation,
  onSetNotes,
  onSetFirm,
  onMove,
  onRemove,
  target,
}: Props) {
  const isExternal = step.stationType === "EXTERNAL";
  const tone = toneFor(step.stationType, step.stationKind);
  const { hasPermission } = useRoleAccess();
  const canWriteProperty = hasPermission("property:write");

  const capQ = useQuery({
    queryKey: ["station-capabilities", step.stationId],
    queryFn: () => stationCapabilityService.getByStation(step.stationId),
    enabled: Boolean(step.stationId),
    staleTime: 300_000,
  });
  const cap = capQ.data?.data;

  const lockedSet = useMemo(
    () => new Set(target.lockedPropertyIds ?? []),
    [target.lockedPropertyIds],
  );
  const selectedProps = useMemo(() => new Set(target.propertyIds), [target.propertyIds]);

  const toggleProp = (id: string) => {
    if (lockedSet.has(id)) return;
    const next = new Set(target.propertyIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    target.onProperties(Array.from(next));
  };

  // Renk KISITLANMAZ (2026-08-02): boyahane her rengi boyar. Adımda renk seçici
  // "bu adım renk veren bir kategoride mi" sorusuna göre çıkar (backend'in
  // `appliesColor` kuralıyla aynı kaynak), ve tüm aktif katalog gösterilir.
  // İstasyonun StationColor listesi artık okunmuyor — geri ekleme, yeni tanımlanan
  // renk hiçbir listede olmadığı için tekrar görünmez olur.
  // Tek bayrak (2026-08-10) — bileşik `hasDefaultCategory && …` kalktı; bkz.
  // StationCapabilities/types.capCanApplyColor.
  const appliesColor = capCanApplyColor(cap);

  const subFilter = step.requiredCategoryId
    ? { categoryId: step.requiredCategoryId }
    : undefined;

  // "Uygulamaz" ile "listesi boş" AYRI şeyler. Eskiden ikisi de aynı cümleyi
  // basıyordu ("Bu istasyon renk/özellik uygulamaz — sadece işlem yapar") ve
  // yetenek listesi hiç doldurulmamış bir istasyon, sistemin öyle tasarlandığı
  // sanılarak geçiliyordu. Zımpara (Fason) tam bu durumdaydı.
  const appliesNothing = !cap || (!appliesColor && !cap.canApplyProperty);
  // SEÇİM tipli özellikler (KAT) hedef listesinde GÖRÜNMEZ — kendi alanında
  // seçilir. Boş-liste kontrolü SÜZÜLMÜŞ küme üzerinden (RouteStepTargets ile
  // aynı gerekçe: ham liste "boş değil" derken hiç chip çizilmezdi).
  const targetableProps = (cap?.properties ?? []).filter(isTargetableProperty);
  const propertyListEmpty = Boolean(
    cap && !appliesNothing && cap.canApplyProperty && targetableProps.length === 0,
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={easeOut}
      className={cn(
        "space-y-3 rounded-lg border bg-muted/10 p-3 shadow-sm ring-1",
        tone.border,
        tone.ringSoft,
      )}
    >
      <div className="flex items-center gap-2">
        <Badge
          className={cn(
            "h-5 min-w-5 justify-center border-transparent px-1 font-mono text-[10px] font-semibold text-white",
            tone.solid,
          )}
        >
          {sequence}
        </Badge>
        <span className={cn("text-sm font-semibold", tone.text)}>
          {step.stationName || "İstasyon seç"}
        </span>
        {isExternal && (
          <Badge variant="outline" className={cn("border-station-fason/60 text-[9px]", tone.text)}>
            FASON
          </Badge>
        )}
        <div className="ml-auto flex gap-1">
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={!canMoveUp} onClick={() => onMove(-1)} aria-label="Sola">
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={!canMoveDown} onClick={() => onMove(1)} aria-label="Sağa">
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onRemove} aria-label="Sil">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className={isExternal ? "grid grid-cols-1 gap-2 sm:grid-cols-2" : undefined}>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">İstasyon</label>
          <EntityPickerModal<Station>
            value={step.stationId || null}
            onChange={onPickStation}
            service={stationService}
            queryKey="stations-wo-step"
            getLabel={(s) => s.name}
            getSubLabel={(s) => `${s.code} · ${stationKindLabels[s.kind] ?? s.kind}`}
            renderLeading={(s) => (
              <span
                className={cn(
                  "h-2.5 w-2.5 shrink-0 rounded-full",
                  toneFor(s.type === "EXTERNAL" ? "EXTERNAL" : "INTERNAL", s.kind).solid,
                )}
              />
            )}
            filters={{ allowAsWorkOrderStep: "true" }}
            icon={Factory}
            iconClassName="text-primary"
            title="İstasyon Seç"
            description="İş emri adımının istasyonu. Ada veya koda göre ara."
            placeholder="İstasyon seç..."
            triggerClassName="h-8 text-xs"
          />
        </div>

        {isExternal && (
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">Fason Firma</label>
            <EntityPickerModal<Subcontractor>
              value={step.plannedSubcontractorId}
              onChange={(v) => onSetFirm({ plannedSubcontractorId: v })}
              service={subcontractorService}
              queryKey={`subcontractors-${step.requiredCategoryId ?? "all"}`}
              getLabel={(s) => s.name}
              getSubLabel={(s) => (s.taxNumber ? `VKN ${s.taxNumber}` : s.code)}
              filters={subFilter}
              nullable
              noneLabel="— Seçilmedi"
              icon={Truck}
              iconClassName="text-station-fason"
              title="Fason Firma Seç"
              description="Bu fason adımını yürütecek firma."
              placeholder={step.requiredCategoryId ? "Firma seç..." : "İstasyona kategori atanmamış"}
              triggerClassName="h-8 text-xs"
            />
          </div>
        )}
      </div>

      {step.stationId &&
        (capQ.isLoading ? (
          <div className="text-[11px] text-muted-foreground">Yetenekler yükleniyor...</div>
        ) : appliesNothing ? (
          <div className="text-[11px] text-muted-foreground">
            Bu istasyon renk/özellik uygulamaz — sadece işlem yapar.
          </div>
        ) : (
          <div className="space-y-2.5">
            {appliesColor && (
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">
                  Bu istasyonda uygulanan renk
                </label>
                <ColorPickerModal
                  value={target.colorId}
                  onChange={(id) => target.onColor(id)}
                  customerId={target.customerId}
                  disabled={target.colorLocked}
                  lockedTooltip="Renk kilitli (bağlı sipariş satırından geliyor)"
                  triggerClassName="h-8 text-xs"
                  placeholder="Renk seç..."
                />
              </div>
            )}
            {cap!.canApplyProperty && (
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">
                  Bu istasyonda uygulanan özellikler
                </label>
                {propertyListEmpty ? (
                  <div className="text-[11px] italic text-muted-foreground">
                    Bu istasyonun yetenek listesi boş — henüz hiçbir özellik
                    tanımlanmamış. Aşağıdan ekleyebilir ya da Tanımlar → Kumaş
                    Özellikleri'nden bu istasyona atayabilirsiniz.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {targetableProps.map((p) => {
                      const on = selectedProps.has(p.id);
                      const locked = lockedSet.has(p.id);
                      return (
                        <Badge
                          key={p.id}
                          variant={on ? "default" : "outline"}
                          className={cn("cursor-pointer gap-1 text-[10px]", locked && "cursor-not-allowed opacity-50")}
                          onClick={() => toggleProp(p.id)}
                        >
                          {on && <Check className="h-3 w-3" />}
                          {p.name}
                        </Badge>
                      );
                    })}
                  </div>
                )}
                {/* Asıl otomasyon: istasyon zaten belli, yeni özellik ona
                    BAĞLI doğar ve anında seçili gelir — ikinci ekran yok. */}
                {canWriteProperty && (
                  <div className="pt-1">
                    <QuickAddProperty
                      label="Yeni özellik tanımla"
                      defaultStationId={step.stationId}
                      onCreated={(id) => {
                        void capQ.refetch();
                        if (!selectedProps.has(id)) {
                          target.onProperties([...target.propertyIds, id]);
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">Not (opsiyonel)</label>
        <Input
          value={step.notes}
          onChange={(e) => onSetNotes(e.target.value)}
          placeholder="Adıma özel talimat"
          className="h-8 text-xs"
        />
      </div>
    </motion.div>
  );
}
