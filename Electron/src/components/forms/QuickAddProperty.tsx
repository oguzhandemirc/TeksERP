import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PropertyStationsField } from "./PropertyStationsField";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import type { FabricProperty } from "@/pages/FabricProperties/types";

/**
 * Özellik seçicide hızlı özellik ekleme — Tanımlar'a gitmeden ad ile yeni
 * `FabricProperty` yaratır ve hemen seçer (kod OZL-… otomatik).
 *
 * `stationIds` ZORUNLU (2026-08-02, backend de reddeder): istasyona bağlanmamış
 * özellik hiçbir iş emrinde seçilemez. `defaultStationId` verilirse — örn. iş emri
 * rota adımından açıldığında — o istasyon ön-seçili gelir ve kullanıcının hiçbir
 * ek karar vermesi gerekmez; asıl otomasyon budur.
 */
export function QuickAddProperty({
  onCreated,
  defaultStationId,
  label = "Yeni Özellik Ekle",
}: {
  onCreated: (id: string) => void;
  /** Ön-seçili istasyon — bağlamdan biliniyorsa (rota adımı) geç. */
  defaultStationId?: string | null;
  label?: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [stationIds, setStationIds] = useState<string[]>([]);

  const canSubmit = Boolean(name.trim()) && stationIds.length > 0;

  const createMut = useMutation({
    mutationFn: () =>
      // Kod backend'de üretilir (OZL+GGAAYY+NNNN) — istemci göndermez.
      fabricPropertyService.create({
        name: name.trim(),
        stationIds,
        isActive: true,
      } as Partial<FabricProperty> & { stationIds: string[] }),
    onSuccess: (res) => {
      const created = res.data;
      toast.success(`Özellik eklendi: ${created.name}`);
      void qc.invalidateQueries({ queryKey: ["fabric-properties"] });
      void qc.invalidateQueries({ queryKey: ["station-capabilities"] });
      close();
      onCreated(created.id);
    },
  });

  function close() {
    setOpen(false);
    setName("");
    setStationIds([]);
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          className="gap-2 bg-emerald-600 font-medium text-white hover:bg-emerald-600/90"
          onClick={() => {
            setStationIds(defaultStationId ? [defaultStationId] : []);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          {label}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed p-2">
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Özellik adı (örn. Antibakteriyel)"
        className="h-8 text-sm"
        onKeyDown={(e) => {
          // isPending guard: çift-Enter mükerrer POST üretmesin (buton disabled ile aynı koşul).
          if (e.key === "Enter" && canSubmit && !createMut.isPending) {
            e.preventDefault();
            createMut.mutate();
          }
        }}
      />

      <div>
        <div className="mb-1 text-[11px] text-muted-foreground">
          Bu özelliği hangi istasyon uygular? (zorunlu)
        </div>
        <div className="h-40">
          <PropertyStationsField value={stationIds} onChange={setStationIds} />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="destructive" onClick={close}>
          Vazgeç
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!canSubmit || createMut.isPending}
          onClick={() => createMut.mutate()}
          className="bg-emerald-600 text-white hover:bg-emerald-600/90"
        >
          {createMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Ekle"}
        </Button>
      </div>
    </div>
  );
}
