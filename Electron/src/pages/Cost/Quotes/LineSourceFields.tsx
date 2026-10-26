// Kalem kaynağı: kart ürünü (ürün seçici DOĞRUDAN modal, yalnız kumaş) ya da yeni desen (Hızlı Hesaplayıcı'nın
// elle yapı bileşeni yeniden kullanılır). Renk seçici müşterinin renk adlarıyla açılır.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PackageSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ItemPickerModal } from "@/components/forms/ItemPickerModal";
import { ColorPickerModal } from "@/components/forms/color-picker/ColorPickerModal";
import { AdHocFields } from "../Calculator/AdHocFields";
import { finishingRateService } from "../FinishingRates/service";
import { fmtDecFull } from "../shared/format";
import type { LineForm } from "./line-body";

interface Props { value: LineForm; onChange: (patch: Partial<LineForm>) => void; customerId: string }

function ItemSource({ value, onChange, customerId }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">
        <span className="text-muted-foreground">Ürün (kumaş)</span>
        <Button type="button" variant="outline" className="mt-1 w-full justify-start font-normal" onClick={() => setOpen(true)} aria-haspopup="dialog">
          <PackageSearch className="mr-2 h-4 w-4" />{value.item ? `${value.item.code} — ${value.item.name}` : "Kumaş seç…"}
        </Button>
      </label>
      <div className="text-sm">
        <span className="text-muted-foreground">Renk</span>
        <div className="mt-1">
          <ColorPickerModal value={value.colorId} onChange={(colorId) => onChange({ colorId })} customerId={customerId} triggerClassName="h-9" />
        </div>
      </div>
      <ItemPickerModal
        open={open}
        onOpenChange={setOpen}
        allowedTypes={["FABRIC"]}
        onPick={(r) => {
          onChange({ item: { id: r.id, code: r.code, name: r.name }, colorId: null });
          setOpen(false);
        }}
      />
    </div>
  );
}

function AdHocSource({ value, onChange }: Props) {
  const rates = useQuery({ queryKey: ["cost-finishing-rates", "active"], queryFn: finishingRateService.listActive });
  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="text-muted-foreground">Desen adı (teklifte görünür) *</span>
        <Input className="mt-1" maxLength={200} value={value.description} onChange={(e) => onChange({ description: e.target.value })} aria-label="Desen adı" />
      </label>
      <AdHocFields value={value.adHoc} onChange={(adHoc) => onChange({ adHoc })} />
      <label className="block text-sm">
        <span className="text-muted-foreground">Fason tarifesi</span>
        <select aria-label="Fason tarifesi" value={value.rateCode} onChange={(e) => onChange({ rateCode: e.target.value })} className="mt-1 h-9 w-full rounded-md border bg-background px-2">
          <option value="">Ham satış (terbiye yok)</option>
          {(rates.data ?? []).map((r) => <option key={r.id} value={r.code}>{r.code} — {r.name} ({fmtDecFull(r.pricePerM)} {r.currency}/m)</option>)}
        </select>
      </label>
    </div>
  );
}

export function LineSourceFields(p: Props) {
  return (
    <div className="space-y-3">
      <div className="flex gap-2" role="group" aria-label="Kalem kaynağı">
        <Button type="button" size="sm" variant={p.value.mode === "item" ? "default" : "outline"} onClick={() => p.onChange({ mode: "item" })}>Kart ürünü</Button>
        <Button type="button" size="sm" variant={p.value.mode === "adHoc" ? "default" : "outline"} onClick={() => p.onChange({ mode: "adHoc" })}>Yeni desen</Button>
      </div>
      {p.value.mode === "item" ? <ItemSource {...p} /> : <AdHocSource {...p} />}
    </div>
  );
}
