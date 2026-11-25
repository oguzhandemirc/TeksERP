// Gövde formlarının seçicileri — hepsi doğrudan modal açar (combobox yok); ad birincil, kod ikincil.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cog, Truck, Warehouse as WarehouseIcon } from "lucide-react";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { MultiSelectCheckboxList } from "@/components/forms/MultiSelectCheckboxList";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { loadAllForPicker } from "@/lib/picker-loader";
import { machineService } from "@/pages/Machines/service";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import { warehouseService } from "@/pages/Warehouses/service";
import type { Warehouse } from "@/pages/Warehouses/types";
import { useSubcontractorRecordForm } from "@/pages/Subcontractors/useSubcontractorRecordForm";
import { useWarehouseRecordForm } from "@/pages/Warehouses/useWarehouseRecordForm";

export function SubcontractorPicker({ value, onChange, id, title = "Devereci seç" }: { value: string | null; onChange: (id: string | null) => void; id?: string; title?: string }) {
  const subcontractorForm = useSubcontractorRecordForm();
  return (
    <div id={id}>
      <EntityPickerModal<Subcontractor>
        value={value}
        onChange={(v) => onChange(v)}
        service={subcontractorService}
        recordForm={subcontractorForm}
        queryKey="subcontractors-beam-body"
        filters={{ isActive: "true" }}
        getLabel={(s) => s.name}
        getSubLabel={(s) => s.code}
        icon={Truck}
        title={title}
        placeholder="Devereci seç"
      />
    </div>
  );
}

export function WarehousePicker({ value, onChange, id, placeholder = "Depo seç (isteğe bağlı)" }: { value: string | null; onChange: (id: string | null) => void; id?: string; placeholder?: string }) {
  const warehouseForm = useWarehouseRecordForm();
  return (
    <div id={id}>
      <EntityPickerModal<Warehouse>
        value={value}
        onChange={(v) => onChange(v)}
        service={warehouseService}
        recordForm={warehouseForm}
        queryKey="warehouses-beam-body"
        filters={{ isActive: "true" }}
        getLabel={(w) => w.name}
        getSubLabel={(w) => (w.isDefault ? `${w.code} · varsayılan` : w.code)}
        icon={WarehouseIcon}
        nullable
        noneLabel="Depo belirtme"
        title="Depo seç"
        placeholder={placeholder}
      />
    </div>
  );
}

/** Uyumlu tezgâhlar: düğme seçili kodları gösterir, tıklayınca çoklu seçim modalı açılır. Boş liste = her tezgâha uyar. */
export function MachineFitPicker({ value, onChange, initialLabels }: { value: string[]; onChange: (ids: string[]) => void; initialLabels?: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(value);
  const machines = useQuery({
    queryKey: ["machines", "beam-body-fit-picker"],
    queryFn: () => loadAllForPicker(machineService, { filters: { isActive: "true" }, sortBy: "code" }),
    staleTime: 60_000,
  });
  const list = machines.data?.data ?? [];
  const labelOf = (id: string) => {
    const m = list.find((x) => x.id === id);
    return m ? m.code : (initialLabels?.[id] ?? "…");
  };
  const items = list.map((m) => ({ id: m.id, label: `${m.name}`, hint: m.code, group: m.station?.name }));
  const shown = value.slice(0, 8).map(labelOf).join(", ");
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-9 w-full justify-start whitespace-normal py-1.5 text-left font-normal"
        onClick={() => {
          setDraft(value);
          setOpen(true);
        }}
      >
        <Cog className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
        {value.length === 0 ? <span className="text-muted-foreground">Seçilmedi — her tezgâha uyar</span> : <span>{value.length > 8 ? `${shown} +${value.length - 8}` : shown} <span className="text-muted-foreground">({value.length} tezgâh)</span></span>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Uyumlu tezgâhlar</DialogTitle>
            <DialogDescription>Bu gövdenin takılabildiği tezgâhları işaretleyin. Hiçbiri seçilmezse gövde her tezgâha uyar sayılır.</DialogDescription>
          </DialogHeader>
          <MultiSelectCheckboxList items={items} value={draft} onChange={setDraft} columns={3} placeholder="Tezgâh ara…" emptyHint={machines.isLoading ? "Yükleniyor…" : "Aktif tezgâh yok."} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Vazgeç</Button>
            <Button
              type="button"
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
            >
              Seç ({draft.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
