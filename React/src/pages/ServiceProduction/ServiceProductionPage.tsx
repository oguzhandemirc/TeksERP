import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Handshake,
  Loader2,
  Plus,
  Trash2,
  Printer,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { customerService } from "@/services/customerService";
import { itemService } from "@/services/itemService";
import {
  serviceProductionService,
  type ServiceIntakeRollInput,
} from "@/services/serviceProductionService";
import { StationKind, stationKindLabels } from "@/types/enums";
import { CompanyType } from "@/types/enums";

interface RollRow {
  key: string;
  initialQty: string;
  weightKg: string;
  width: string;
  qualityGrade: string;
  customerDescription: string;
}

const qualityOptions = [
  { value: "1.KALITE", label: "1. Kalite" },
  { value: "A1", label: "A1" },
  { value: "2.KALITE", label: "2. Kalite" },
  { value: "FIRE", label: "Fire" },
];

// Müşteri talebine göre seçilebilir hizmet adımları. Paketleme zorunlu — server
// otomatik ekler ama UI'da da göstermek istiyoruz: disabled checkbox, her zaman ON.
const selectableSteps: { kind: StationKind; required: boolean }[] = [
  { kind: StationKind.RAW_QC, required: false },
  { kind: StationKind.PROCESS_QC, required: false },
  { kind: StationKind.SUBCONTRACTOR, required: false },
  { kind: StationKind.TAMBUR, required: false },
  { kind: StationKind.PACKAGING, required: true },
];

function emptyRoll(): RollRow {
  return {
    key: crypto.randomUUID(),
    initialQty: "",
    weightKg: "",
    width: "",
    qualityGrade: "1.KALITE",
    customerDescription: "",
  };
}

interface LastResult {
  batchNumber: string;
  barcodes: string[];
}

export default function ServiceProductionPage() {
  const qc = useQueryClient();

  const [customerId, setCustomerId] = useState("");
  const [itemId, setItemId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [servicePricePerMeter, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedKinds, setSelectedKinds] = useState<Set<StationKind>>(
    new Set([
      StationKind.PROCESS_QC,
      StationKind.TAMBUR,
      StationKind.PACKAGING,
    ]),
  );
  const [rolls, setRolls] = useState<RollRow[]>([emptyRoll()]);
  const [lastResult, setLastResult] = useState<LastResult | null>(null);

  const { data: customersData } = useQuery({
    queryKey: ["customers", "active-buyers"],
    queryFn: () =>
      customerService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true", type: CompanyType.CUSTOMER },
      }),
  });

  const { data: itemsData } = useQuery({
    queryKey: ["items", "all-active"],
    queryFn: () =>
      itemService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: "code",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
  });

  const { data: variantsData } = useQuery({
    queryKey: ["items", itemId, "variants"],
    queryFn: () => itemService.getVariants(itemId),
    enabled: !!itemId,
  });

  const customerOptions = useMemo(
    () =>
      customersData?.data?.map((c) => ({
        value: c.id,
        label: `${c.code} — ${c.name}`,
      })) ?? [],
    [customersData],
  );

  const itemOptions = useMemo(
    () =>
      itemsData?.data?.map((i) => ({
        value: i.id,
        label: `${i.code} — ${i.name}`,
      })) ?? [],
    [itemsData],
  );

  const variantOptions = useMemo(
    () =>
      variantsData?.data?.map((v) => ({
        value: v.id,
        label: `${v.code} — ${v.name}`,
      })) ?? [],
    [variantsData],
  );

  const totalMeterage = rolls.reduce(
    (s, r) => s + (Number(r.initialQty) || 0),
    0,
  );
  const totalWeight = rolls.reduce(
    (s, r) => s + (Number(r.weightKg) || 0),
    0,
  );
  const priceNum = Number(servicePricePerMeter) || 0;
  const totalBill = totalMeterage * priceNum;

  const toggleStep = (kind: StationKind) => {
    setSelectedKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const updateRoll = (key: string, patch: Partial<RollRow>) => {
    setRolls((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const addRoll = () => setRolls((rs) => [...rs, emptyRoll()]);
  const removeRoll = (key: string) =>
    setRolls((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));

  const mutation = useMutation({
    mutationFn: serviceProductionService.createIntake,
    onSuccess: (res) => {
      if (res.success && res.data) {
        toast.success(res.message ?? "Fason üretim kabul edildi");
        setLastResult({
          batchNumber: res.data.batchNumber,
          barcodes: res.data.barcodes,
        });
        // Form temizle (müşteri/ürün/fiyat kalsın — aynı müşteriden seri kabul olur)
        setRolls([emptyRoll()]);
        setNotes("");
        qc.invalidateQueries({ queryKey: ["rolls"] });
        qc.invalidateQueries({ queryKey: ["work-orders"] });
      } else {
        toast.error(res.message ?? "Kabul oluşturulamadı");
      }
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error ? err.message : "Kabul oluştururken hata oluştu";
      toast.error(msg);
    },
  });

  const handleSubmit = () => {
    if (!customerId) {
      toast.error("Müşteri seçimi zorunludur");
      return;
    }
    if (!itemId) {
      toast.error("Ürün seçimi zorunludur");
      return;
    }
    if (!(priceNum > 0)) {
      toast.error("Metre başı hizmet bedeli pozitif olmalı");
      return;
    }
    if (selectedKinds.size === 0) {
      toast.error("En az bir rota adımı seçilmelidir");
      return;
    }
    const rollInputs: ServiceIntakeRollInput[] = [];
    for (const r of rolls) {
      const qty = Number(r.initialQty);
      if (!(qty > 0)) {
        toast.error("Tüm topların metrajı pozitif olmalı");
        return;
      }
      rollInputs.push({
        initialQty: qty,
        weightKg: r.weightKg ? Number(r.weightKg) : null,
        width: r.width ? Number(r.width) : null,
        qualityGrade: r.qualityGrade || null,
        customerDescription: r.customerDescription?.trim() || null,
      });
    }

    mutation.mutate({
      customerId,
      itemId,
      variantId: variantId || null,
      servicePricePerMeter: priceNum,
      routeStationKinds: Array.from(selectedKinds),
      notes: notes.trim() || null,
      rolls: rollInputs,
    });
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Handshake className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Fason Üretim Kabul
          </h1>
          <p className="text-sm text-muted-foreground">
            Müşterinin getirdiği kumaşı işlemek üzere kabul et — toplar
            müşteriye kilitlenir, sadece sahibine sevk edilebilir.
          </p>
        </div>
      </div>

      {lastResult && (
        <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30">
          <CardContent className="p-4 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold">
                Kabul edildi: Parti {lastResult.batchNumber}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {lastResult.barcodes.map((b) => (
                  <code
                    key={b}
                    className="text-xs font-mono bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-50 px-2 py-0.5 rounded border border-green-200 dark:border-green-800"
                  >
                    {b}
                  </code>
                ))}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                toast.info(
                  `Yazdırma henüz simülasyon: ${lastResult.barcodes.length} etiket`,
                )
              }
            >
              <Printer className="h-4 w-4 mr-1" />
              Etiketleri Bas
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">1. Müşteri ve Ürün</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="sp-customer">
              Müşteri <span className="text-destructive">*</span>
            </Label>
            <Select
              id="sp-customer"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              options={customerOptions}
              placeholder="Müşteri seçiniz..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sp-item">
              Ürün (Stok Kartı) <span className="text-destructive">*</span>
            </Label>
            <Select
              id="sp-item"
              value={itemId}
              onChange={(e) => {
                setItemId(e.target.value);
                setVariantId("");
              }}
              options={itemOptions}
              placeholder="Ürün seçiniz..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sp-variant">Desen / Varyant</Label>
            <Select
              id="sp-variant"
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              options={variantOptions}
              placeholder={
                itemId ? "Varyant seçiniz..." : "Önce ürün seçiniz"
              }
              disabled={!itemId}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sp-price">
              Metre Başı Hizmet Bedeli (₺/m){" "}
              <span className="text-destructive">*</span>
            </Label>
            <Input
              id="sp-price"
              type="number"
              step="0.01"
              min="0"
              value={servicePricePerMeter}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="örn: 2.50"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            2. Uygulanacak İşlemler (Rota)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Müşteri hangi adımları talep ettiyse seç. Paketleme her zaman
            zorunludur.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {selectableSteps.map((s) => {
            const checked = selectedKinds.has(s.kind) || s.required;
            return (
              <label
                key={s.kind}
                className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors ${
                  checked
                    ? "bg-primary/10 border-primary/40"
                    : "hover:bg-muted"
                } ${s.required ? "opacity-80 cursor-not-allowed" : ""}`}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => !s.required && toggleStep(s.kind)}
                  disabled={s.required}
                />
                <span className="text-sm font-medium">
                  {stationKindLabels[s.kind]}
                </span>
                {s.required && (
                  <Badge variant="secondary" className="text-[10px]">
                    zorunlu
                  </Badge>
                )}
              </label>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">3. Toplar</CardTitle>
            <p className="text-xs text-muted-foreground">
              Her top için metraj zorunlu. Müşteri Tanımı opsiyonel — desen
              için müşteri kodu ise buraya yazılır.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={addRoll}>
            <Plus className="h-4 w-4 mr-1" />
            Top Ekle
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-[80px_1fr_1fr_1fr_1fr_2fr_auto] gap-2 items-center text-xs font-semibold text-muted-foreground px-2">
            <span>#</span>
            <span>Metraj (m) *</span>
            <span>Ağırlık (kg)</span>
            <span>En (cm)</span>
            <span>Kalite</span>
            <span>Müşteri Tanımı</span>
            <span></span>
          </div>
          {rolls.map((r, idx) => (
            <div
              key={r.key}
              className="grid grid-cols-[80px_1fr_1fr_1fr_1fr_2fr_auto] gap-2 items-center"
            >
              <div className="text-sm font-mono text-muted-foreground px-2">
                {idx + 1}
              </div>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={r.initialQty}
                onChange={(e) =>
                  updateRoll(r.key, { initialQty: e.target.value })
                }
                placeholder="0.0"
              />
              <Input
                type="number"
                step="0.1"
                min="0"
                value={r.weightKg}
                onChange={(e) =>
                  updateRoll(r.key, { weightKg: e.target.value })
                }
                placeholder="-"
              />
              <Input
                type="number"
                step="1"
                min="0"
                value={r.width}
                onChange={(e) => updateRoll(r.key, { width: e.target.value })}
                placeholder="-"
              />
              <Select
                value={r.qualityGrade}
                onChange={(e) =>
                  updateRoll(r.key, { qualityGrade: e.target.value })
                }
                options={qualityOptions}
              />
              <Input
                value={r.customerDescription}
                onChange={(e) =>
                  updateRoll(r.key, { customerDescription: e.target.value })
                }
                placeholder="müşteri desen kodu (ops.)"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeRoll(r.key)}
                disabled={rolls.length === 1}
                title="Satırı sil"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-4 pt-3 border-t text-sm">
            <Badge variant="secondary">{rolls.length} top</Badge>
            <span>Toplam metraj: {totalMeterage.toFixed(1)} m</span>
            <span>Toplam ağırlık: {totalWeight.toFixed(1)} kg</span>
            {priceNum > 0 && (
              <span className="font-semibold text-primary">
                Hizmet Bedeli: ₺{totalBill.toFixed(2)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Not (Opsiyonel)</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Kabul için iç not..."
          />
        </CardContent>
      </Card>

      <div className="sticky bottom-4 z-10 flex justify-end">
        <Button
          size="lg"
          className="h-12 px-8 shadow-lg"
          onClick={handleSubmit}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Kaydediliyor...
            </>
          ) : (
            <>
              <CheckCircle2 className="h-5 w-5 mr-2" />
              Kabul Et ve Etiket Bas
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
