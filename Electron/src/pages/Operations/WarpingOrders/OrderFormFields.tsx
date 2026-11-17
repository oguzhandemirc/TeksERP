// Yeni/düzenle formunun alanları: kart (modal) · devereci (modal) · levent adedi × boy satırları · ek tel grubu ·
// müşteri siparişi bağı · ücret · termin · fire/tolerans · not. `planLocked` (sevkli sipariş) plan alanlarını kilitler.
import { Handshake, Layers, Plus, ShoppingCart, Trash2, X } from "lucide-react";
import { FormField } from "@/components/forms/FormField";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { warpSpecService } from "@/pages/WarpSpecs/service";
import type { WarpSpec } from "@/pages/WarpSpecs/types";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import { orderService } from "@/pages/Operations/Orders/service";
import type { Order } from "@/pages/Operations/Orders/types";
import { MAX_BEAM_LINES, type WarpingOrderFormState } from "./order-model";
import { WARPING_CURRENCIES, WARPING_FEE_UNIT_LABEL, type SpecRef, type WarpingFeeUnit } from "./types";

interface Props {
  s: WarpingOrderFormState;
  up: (patch: Partial<WarpingOrderFormState>) => void;
  /** Kayıtlı siparişte kart ve devereci değişmez (yeni sipariş açılır). */
  identityLocked: boolean;
  /** Sevkli siparişte plan donuktur (levent satırı, ek grup, sabit fire). */
  planLocked: boolean;
  /** Önizlemenin önerdiği aynı-levent kartları (SHARED_BEAM) + seçili olanlar. */
  extraOptions: SpecRef[];
  defaultFixedWasteM: string | null;
}

export function OrderFormFields({
  s,
  up,
  identityLocked,
  planLocked,
  extraOptions,
  defaultFixedWasteM,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Çözgü kartı" required>
          <EntityPickerModal<WarpSpec>
            value={s.warpSpecId}
            onChange={(id) => up({ warpSpecId: id, extraWarpSpecIds: [] })}
            service={warpSpecService}
            queryKey="warp-specs-warping-order-picker"
            getLabel={(w) => `${w.code} — ${w.name}`}
            getSubLabel={(w) => `${w.endsCount} tel`}
            icon={Layers}
            title="Çözgü kartı seç"
            placeholder="Çözgü kartı seç"
            disabled={identityLocked}
            lockedTooltip="Kayıtlı siparişin kartı değişmez — gerekirse iptal edip yeni sipariş açın."
          />
        </FormField>
        <FormField label="Devereci" required>
          <EntityPickerModal<Subcontractor>
            value={s.subcontractorId}
            onChange={(id) => up({ subcontractorId: id })}
            service={subcontractorService}
            queryKey="subcontractors-warping-order-picker"
            getLabel={(x) => x.name}
            icon={Handshake}
            title="Devereci seç"
            placeholder="Devereci seç"
            disabled={identityLocked}
            lockedTooltip="Kayıtlı siparişin deverecisi değişmez."
          />
        </FormField>
      </div>

      <BeamLinesFieldset s={s} up={up} planLocked={planLocked} extraOptions={extraOptions} />

      <SalesOrderLinks s={s} up={up} />

      <div className="grid gap-4 md:grid-cols-3">
        <FormField label="Devere ücreti birimi">
          <Select value={s.feeUnit} onValueChange={(v) => up({ feeUnit: v as WarpingFeeUnit })}>
            <SelectTrigger aria-label="Devere ücreti birimi">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(WARPING_FEE_UNIT_LABEL) as WarpingFeeUnit[]).map((u) => (
                <SelectItem key={u} value={u}>
                  {WARPING_FEE_UNIT_LABEL[u]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField
          label="Birim ücret"
          htmlFor="wo-fee-price"
          hint="Boş bırakılabilir; fatura sonraki adımda."
        >
          <div className="flex gap-2">
            <Input
              id="wo-fee-price"
              inputMode="decimal"
              value={s.feeUnitPrice}
              onChange={(e) => up({ feeUnitPrice: e.target.value })}
            />
            <Select value={s.feeCurrency} onValueChange={(v) => up({ feeCurrency: v })}>
              <SelectTrigger className="w-24" aria-label="Para birimi">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WARPING_CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </FormField>
        <FormField label="Termin (dönüş)">
          <DatePickerInput value={s.expectedReturnDay} onChange={(v) => up({ expectedReturnDay: v })} />
        </FormField>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          label="Sabit fire (m)"
          htmlFor="wo-fixed-waste"
          hint={`Baş/son/düğüm payı, siparişe bir kez. Boşsa fabrika ayarı${defaultFixedWasteM === null ? "" : ` (${defaultFixedWasteM} m)`} kullanılır.`}
        >
          <Input
            id="wo-fixed-waste"
            inputMode="decimal"
            disabled={planLocked}
            placeholder="ayardan"
            value={s.fixedWasteM}
            onChange={(e) => up({ fixedWasteM: e.target.value })}
          />
        </FormField>
        <FormField
          label="Fire toleransı (%)"
          htmlFor="wo-tolerance"
          hint="Kapanışta aşılırsa uyarır, engellemez. Boş = denetim yok (yeni siparişte ayardan)."
        >
          <Input
            id="wo-tolerance"
            inputMode="decimal"
            value={s.wasteTolerancePct}
            onChange={(e) => up({ wasteTolerancePct: e.target.value })}
          />
        </FormField>
      </div>

      <FormField label="Not" htmlFor="wo-notes" hint="Çözgü talimatına da basılır.">
        <Textarea
          id="wo-notes"
          rows={2}
          maxLength={500}
          value={s.notes}
          onChange={(e) => up({ notes: e.target.value })}
        />
      </FormField>
    </div>
  );
}

/** Müşteri siparişi bağı (isteğe bağlı; boş = stoğa çözgü). Seçici doğrudan modal açar; her seçim listeye eklenir. */
function SalesOrderLinks({ s, up }: Pick<Props, "s" | "up">) {
  return (
    <FormField label="Müşteri siparişi" hint="Boş bırakılırsa çözgü stoğa yapılır.">
      <div className="space-y-2">
        {s.salesOrders.map((o) => (
          <div key={o.id} className="flex items-center gap-2 text-sm">
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            <span>{o.label}</span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label={`${o.label} bağını kaldır`}
              onClick={() => up({ salesOrders: s.salesOrders.filter((x) => x.id !== o.id) })}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <EntityPickerModal<Order>
          value={null}
          onChange={(id, item) => {
            if (!id || s.salesOrders.some((x) => x.id === id)) return;
            up({
              salesOrders: [
                ...s.salesOrders,
                { id, label: item ? `${item.orderNumber} — ${item.customer?.name ?? ""}` : id },
              ],
            });
          }}
          service={orderService}
          queryKey="orders-warping-order-picker"
          getLabel={(o) => o.orderNumber}
          getSubLabel={(o) => o.customer?.name}
          icon={ShoppingCart}
          title="Müşteri siparişi seç"
          placeholder="Sipariş bağla"
        />
      </div>
    </FormField>
  );
}

/** Levent adedi × boy satırları + aynı-levent ek tel grubu; sevkli siparişte kilitli. */
function BeamLinesFieldset({
  s,
  up,
  planLocked,
  extraOptions,
}: Pick<Props, "s" | "up" | "planLocked" | "extraOptions">) {
  const setLine = (i: number, patch: Partial<WarpingOrderFormState["beamLines"][number]>) =>
    up({ beamLines: s.beamLines.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
  const toggleExtra = (id: string, on: boolean) =>
    up({ extraWarpSpecIds: on ? [...s.extraWarpSpecIds, id] : s.extraWarpSpecIds.filter((x) => x !== id) });
  return (
    <fieldset className="space-y-2" disabled={planLocked}>
      <legend className="text-sm font-medium">
        Leventler{" "}
        {planLocked && (
          <span className="font-normal text-muted-foreground">— iplik sevk edildi, plan değişmez</span>
        )}
      </legend>
      {s.beamLines.map((l, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            className="w-24"
            inputMode="numeric"
            aria-label={`${i + 1}. satır levent adedi`}
            value={l.beamCount}
            onChange={(e) => setLine(i, { beamCount: e.target.value })}
          />
          <span className="text-sm text-muted-foreground">levent ×</span>
          <Input
            className="w-32"
            inputMode="decimal"
            aria-label={`${i + 1}. satır levent boyu (m)`}
            placeholder="boy"
            value={l.beamLengthM}
            onChange={(e) => setLine(i, { beamLengthM: e.target.value })}
          />
          <span className="text-sm text-muted-foreground">m</span>
          {s.beamLines.length > 1 && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`${i + 1}. levent satırını sil`}
              onClick={() => up({ beamLines: s.beamLines.filter((_, k) => k !== i) })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
      {s.beamLines.length < MAX_BEAM_LINES && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => up({ beamLines: [...s.beamLines, { beamCount: "1", beamLengthM: "" }] })}
        >
          <Plus className="mr-1 h-4 w-4" /> Farklı boyda levent ekle
        </Button>
      )}
      {extraOptions.length > 0 && (
        <div className="space-y-1 rounded-md border border-dashed p-2">
          <p className="text-sm font-medium">Aynı levente sarılacak ek tel grubu</p>
          <p className="text-xs text-muted-foreground">
            Bu kartla aynı levende sarılan kartlar (kumaş katmanından). İşaretlenen grubun ipliği plana
            eklenir.
          </p>
          {extraOptions.map((x) => (
            <label key={x.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={s.extraWarpSpecIds.includes(x.id)}
                onCheckedChange={(v) => toggleExtra(x.id, v === true)}
                aria-label={`Ek tel grubu ${x.code}`}
              />
              <span className="font-mono text-xs">{x.code}</span> {x.name}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
