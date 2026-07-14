import { useMemo } from "react";
import {
  RefreshCw,
  Info,
  Clock,
  Palette,
  Truck,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColorPickerModal } from "@/components/forms/color-picker/ColorPickerModal";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { rollStatusLabels, type RollStatus } from "@/types/enums";
import type { SplitMode, BatchSplitPreviewRoll } from "../service";
import type { TebdilResult } from "./useTebdilWizard";

const MODE_META: Record<SplitMode, { title: string; desc: string; icon: typeof RefreshCw }> = {
  REDYE_SAME_COLOR: {
    title: "Aynı renk — yeniden boya (tebdil)",
    desc: "Aynı iş emri, yeni parti. Seçilen toplar boyahaneye geri sarılıp aynı renge yeniden boyanır.",
    icon: RefreshCw,
  },
  NEW_COLOR: {
    title: "Farklı renk — yeni iş emri",
    desc: "Seçilen toplar yeni bir iş emrine taşınıp yeni renge boyanır.",
    icon: Palette,
  },
  UNDYED_MOVE: {
    title: "Boyanmadan yeni iş emrine taşı",
    desc: "Fasonda bekleyen parti boyanmadan yeni bir iş emrine taşınır.",
    icon: ArrowUpRight,
  },
};

/** ADIM 1 — hangi toplar? Uygun olmayanlar (çuvalda/sevkte/boyahane öncesi) disabled. */
export function TebdilRollStep({
  rolls,
  selected,
  onToggle,
  onToggleAll,
  selectableCount,
  allSelectable,
}: {
  rolls: BatchSplitPreviewRoll[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  selectableCount: number;
  /** true → tüm toplar seçilebilir (UNDYED_MOVE: redye-uygun top yok ama parti taşınabilir). */
  allSelectable: boolean;
}) {
  const selectedQty = useMemo(
    () => rolls.filter((r) => selected.has(r.id)).reduce((s, r) => s + r.currentQty, 0),
    [rolls, selected],
  );
  const allSel = selectableCount > 0 && selected.size === selectableCount;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Toplar ({selected.size}/{selectableCount}) · {formatNumber(selectedQty, 0)} m
        </span>
        <button type="button" className="text-[11px] font-medium text-primary hover:underline" onClick={onToggleAll}>
          {allSel ? "Hiçbirini" : "Tümünü seç"}
        </button>
      </div>
      <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
        {rolls.map((r, i) => {
          const on = selected.has(r.id);
          const canPick = allSelectable || r.eligible;
          return (
            <li
              key={r.id}
              className={cn("flex items-center gap-2 text-xs", !canPick && "opacity-45")}
              title={canPick ? undefined : "Uygun değil — çuvalda/sevkte ya da boyahane öncesinde"}
            >
              <Checkbox
                checked={on}
                disabled={!canPick}
                onCheckedChange={() => canPick && onToggle(r.id)}
              />
              <span className="font-mono text-muted-foreground">Top {i + 1}</span>
              <span className="ml-auto flex shrink-0 items-center gap-2">
                {!canPick && <span className="text-[10px] text-muted-foreground">uygun değil</span>}
                <Badge variant="outline" className="text-[10px] text-warning">
                  {rollStatusLabels[r.status as RollStatus] ?? r.status}
                </Badge>
                <span className="tabular-nums text-muted-foreground">{formatNumber(r.currentQty, 0)} m</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** ADIM 2 — renk kararı: aynı renk / farklı renk (+ seçici) / boyanmadan taşı. */
export function TebdilColorStep({
  allowedModes,
  mode,
  setMode,
  isNewColor,
  newColorId,
  setNewColorId,
}: {
  allowedModes: SplitMode[];
  mode: SplitMode | null;
  setMode: (m: SplitMode) => void;
  isNewColor: boolean;
  newColorId: string | null;
  setNewColorId: (id: string | null) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        {allowedModes.map((m) => {
          const meta = MODE_META[m];
          const Icon = meta.icon;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "rounded-md border px-3 py-2 text-left text-xs transition-colors",
                mode === m ? "border-primary bg-primary/5" : "hover:bg-muted/50",
              )}
            >
              <div className="flex items-center gap-2 font-medium">
                <Icon className="h-3.5 w-3.5 text-primary" />
                {meta.title}
              </div>
              <div className="mt-0.5 pl-5 text-[11px] text-muted-foreground">{meta.desc}</div>
            </button>
          );
        })}
      </div>
      {isNewColor && (
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="mb-2 text-xs text-muted-foreground">Yeni renk</div>
          <ColorPickerModal
            value={newColorId}
            onChange={setNewColorId}
            allowNone={false}
            label="Yeni Renk"
            placeholder="Yeni renk seç..."
          />
        </div>
      )}
    </div>
  );
}

/** ADIM 3 — sevk kararı. REDYE/dispatchOnly: hemen sevk (boyahane+sebep) / sahada okut. */
export function TebdilDispatchStep({
  mode,
  dispatchOnly,
  dispatchNow,
  setDispatchNow,
  subcontractorId,
  setSubcontractorId,
  reason,
  setReason,
  plate,
  setPlate,
  driver,
  setDriver,
}: {
  mode: SplitMode | null;
  dispatchOnly: boolean;
  dispatchNow: boolean;
  setDispatchNow: (v: boolean) => void;
  subcontractorId: string | null;
  setSubcontractorId: (id: string | null) => void;
  reason: string;
  setReason: (v: string) => void;
  plate: string;
  setPlate: (v: string) => void;
  driver: string;
  setDriver: (v: string) => void;
}) {
  const isRedye = dispatchOnly || mode === "REDYE_SAME_COLOR";

  // NEW_COLOR / UNDYED_MOVE → sevk yeni iş emrinde yapılır.
  if (!isRedye) {
    return (
      <div className="space-y-3 text-sm">
        <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>
            <strong>Yeni iş emri</strong> oluşturulacak ve toplar oraya taşınacak. Fason sevki
            (hangi boyahane) <strong>yeni iş emrinde</strong> yapılır — bitince aşağıdaki bağlantıdan geçin.
          </span>
        </div>
        {mode === "NEW_COLOR" && <ReasonField reason={reason} setReason={setReason} />}
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-2">
        <ToggleCard
          active={dispatchNow}
          onClick={() => setDispatchNow(true)}
          icon={Truck}
          title="Hemen Fason Sevk"
          desc="Boyahaneyi seç, çeki listesi bas — toplar şimdi gönderilsin."
        />
        <ToggleCard
          active={!dispatchNow}
          onClick={() => setDispatchNow(false)}
          icon={MapPin}
          title="Sahada okutulacak"
          desc="Şimdi sevk etme; toplar boyahane adımında bekler, sevki saha yapar."
        />
      </div>

      {dispatchNow && (
        <div className="space-y-3 rounded-md border bg-muted/10 p-3">
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Boyahane (fason firma)</div>
            <ReferenceSelect<Subcontractor>
              value={subcontractorId}
              onChange={setSubcontractorId}
              service={subcontractorService}
              queryKey="subcontractors-tebdil"
              getLabel={(s) => s.name}
              placeholder="Boyahane seç..."
            />
          </div>
          <ReasonField reason={reason} setReason={setReason} label="Tebdil sebebi / fason talimatı" />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Plaka (ops.)</div>
              <Input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="34 ABC 123" />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Sürücü (ops.)</div>
              <Input value={driver} onChange={(e) => setDriver(e.target.value)} placeholder="Ad Soyad" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReasonField({
  reason,
  setReason,
  label = "Tebdil sebebi (ops.)",
}: {
  reason: string;
  setReason: (v: string) => void;
  label?: string;
}) {
  return (
    <div>
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Ör. renk tutmadı / ton farkı / leke"
        rows={2}
        maxLength={500}
        className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}

function ToggleCard({
  active,
  onClick,
  icon: Icon,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Truck;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-2 text-left text-xs transition-colors",
        active ? "border-primary bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <div className="flex items-center gap-2 font-medium">
        <Icon className="h-3.5 w-3.5 text-primary" />
        {title}
      </div>
      <div className="mt-0.5 pl-5 text-[11px] text-muted-foreground">{desc}</div>
    </button>
  );
}

/** ADIM 4 — sonuç kartı: çeki yazdır / yeni iş emrine git / dürüst kısmi-başarı. */
export function TebdilResultView({
  result,
  onPrintCeki,
  onGoWorkOrder,
}: {
  result: TebdilResult;
  onPrintCeki: (dispatchId: string) => void;
  onGoWorkOrder: (woId: string) => void;
}) {
  const newWo = result.newWorkOrderId && result.newWorkOrderNumber;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-success">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="space-y-0.5">
          {result.dispatched ? (
            <div>
              <strong>{result.newBatchNumber ?? "Parti"}</strong> boyahaneye sevk edildi
              {result.dispatchNo ? ` (${result.dispatchNo})` : ""}.
            </div>
          ) : newWo ? (
            <div>
              Yeni iş emri <strong className="font-mono">{result.newWorkOrderNumber}</strong> oluşturuldu.
            </div>
          ) : (
            <div>
              Yeni parti <strong>{result.newBatchNumber ?? ""}</strong> oluşturuldu — boyahane adımına geri sarıldı.
            </div>
          )}
          {!result.dispatched && !newWo && (
            <div className="text-xs text-success/80">
              Şimdi <strong>Fason Sevk</strong> ile boyahaneye gönderin (şeritteki "Fasona sevk bekliyor"), dönünce
              <strong> Fason Kabul</strong> ile alın.
            </div>
          )}
        </div>
      </div>

      {result.dispatchError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Parti oluştu ama sevk başarısız: {result.dispatchError} — şeritteki "Fasona sevk bekliyor" üzerinden tekrar deneyin.
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {result.dispatched && result.dispatchId && (
          <Button size="sm" className="gap-1.5" onClick={() => onPrintCeki(result.dispatchId!)}>
            <Truck className="h-4 w-4" /> Çeki Yazdır
          </Button>
        )}
        {newWo && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onGoWorkOrder(result.newWorkOrderId!)}>
            <ArrowUpRight className="h-4 w-4" /> Yeni İş Emrine Git
          </Button>
        )}
      </div>
    </div>
  );
}

export { MODE_META };
export const StepClock = Clock;
