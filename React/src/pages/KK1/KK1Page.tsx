import { useState, useRef } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ScanLine,
  PackageCheck,
  Printer,
  CheckCircle2,
  Gauge,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { rollService, type InitialEntryRequest } from "@/services/rollService";
import { itemService, type ItemVariant } from "@/services/itemService";

// ─── Şema ────────────────────────────────────────────────────────────────────
interface FormValues {
  itemId: string;
  variantId: string;
  width: string;
  initialQty: string;
  weightKg: string;
  qualityGrade: string;
}

const qualityOptions = [
  { value: "1.KALITE", label: "1. Kalite" },
  { value: "A1", label: "A1" },
  { value: "2.KALITE", label: "2. Kalite" },
  { value: "FIRE", label: "Fire" },
];

const defaultValues: FormValues = {
  itemId: "",
  variantId: "",
  width: "",
  initialQty: "",
  weightKg: "",
  qualityGrade: "1.KALITE",
};

// ─── Son Kayıt Kartı ──────────────────────────────────────────────────────────
interface LastEntry {
  barcode: string;
  itemName: string;
  variantCode: string;
  variantName: string;
  initialQty: number;
  printed: boolean;
}

function LastEntryCard({ entry, onPrint }: { entry: LastEntry; onPrint: () => void }) {
  return (
    <Card className="border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900">
      <CardContent className="p-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-50 px-2 py-0.5 rounded border border-green-200 dark:border-green-800">
                {entry.barcode}
              </code>
              <Badge variant="outline" className="text-xs">
                {entry.initialQty} mt
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {entry.itemName}
              {entry.variantName && ` · ${entry.variantName}`}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant={entry.printed ? "outline" : "default"}
          onClick={onPrint}
          className="shrink-0"
        >
          <Printer className="h-4 w-4 mr-1" />
          {entry.printed ? "Baskı Alındı" : "Etiket Bas"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Ana Ekran ───────────────────────────────────────────────────────────────
export default function KK1Page() {
  const qc = useQueryClient();

  // Form state
  const [form, setForm] = useState<FormValues>(defaultValues);
  const [pulling, setPulling] = useState(false);
  const [lastEntry, setLastEntry] = useState<LastEntry | null>(null);

  // Input refs for quick focus
  const qtyRef = useRef<HTMLInputElement>(null);
  const variantRef = useRef<HTMLSelectElement>(null);

  // Item options
  const { data: itemsData } = useQuery({
    queryKey: ["items", "all-active-for-kk1"],
    queryFn: () =>
      itemService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: "code",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
  });
  const itemOptions =
    itemsData?.data?.map((i) => ({
      value: i.id,
      label: `${i.code} — ${i.name}`,
    })) ?? [];

  // Variants for selected item
  const { data: variantsData } = useQuery({
    queryKey: ["items", form.itemId, "variants"],
    queryFn: () => itemService.getVariants(form.itemId),
    enabled: !!form.itemId,
  });
  const variantOptions: { value: string; label: string }[] =
    variantsData?.data?.map((v: ItemVariant) => ({
      value: v.id,
      label: `${v.code} — ${v.name}`,
    })) ?? [];

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: InitialEntryRequest) => rollService.createInitialEntry(data),
    onSuccess: (res) => {
      if (res.success && res.data) {
        toast.success("Top kaydedildi", {
          description: `Barkod: ${res.data.barcode}`,
        });
        const variant = variantOptions.find((v) => v.value === form.variantId);
        setLastEntry({
          barcode: res.data.barcode,
          itemName: res.data.item?.name ?? "",
          variantCode: variant?.value ?? "",
          variantName: variant?.label ?? "",
          initialQty: res.data.initialQty,
          printed: false,
        });
      }
      // Reset form for next entry (keep item selected)
      setForm((f) => ({ ...defaultValues, itemId: f.itemId, qualityGrade: "1.KALITE" }));
      qc.invalidateQueries({ queryKey: ["rolls"] });
      qc.invalidateQueries({ queryKey: ["rolls-stock"] });
    },
    onError: () => {
      toast.error("Top oluşturulurken hata oluştu");
    },
  });

  // Handle metraj pull from device
  const handlePullFromDevice = () => {
    setPulling(true);
    setTimeout(() => {
      setForm((f) => ({ ...f, initialQty: Math.floor(Math.random() * 500 + 100).toString() }));
      setPulling(false);
      toast.success("Metraj cihazdan çekildi");
    }, 1200);
  };

  // Handle form submit
  const handleSubmit = () => {
    if (!form.itemId) {
      toast.error("Ürün seçimi zorunludur");
      return;
    }
    if (!form.initialQty || Number(form.initialQty) <= 0) {
      toast.error("Metraj girilmesi zorunludur");
      qtyRef.current?.focus();
      return;
    }

    createMutation.mutate({
      itemId: form.itemId,
      variantId: form.variantId || null,
      initialQty: Number(form.initialQty),
      weightKg: form.weightKg ? Number(form.weightKg) : undefined,
      qualityGrade: form.qualityGrade || undefined,
      width: form.width ? Number(form.width) : undefined,
    });
  };

  // Handle print
  const handlePrint = () => {
    if (lastEntry) {
      toast.success(`Etiket yazdırılıyor: ${lastEntry.barcode}`);
      setLastEntry((prev) => (prev ? { ...prev, printed: true } : null));
    }
  };

  // Handle Enter key navigation
  const handleKeyDown = (e: React.KeyboardEvent, nextRef?: React.RefObject<HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (nextRef?.current) {
        nextRef.current.focus();
      } else {
        handleSubmit();
      }
    }
  };

  const updateForm = (field: keyof FormValues, value: string) => {
    setForm((f) => {
      // When item changes, reset variant
      if (field === "itemId" && value !== f.itemId) {
        return { ...f, itemId: value, variantId: "" };
      }
      return { ...f, [field]: value };
    });
  };

  return (
    <div className="min-h-screen bg-background p-4 lg:p-6">
      <div className="max-w-xl mx-auto space-y-6">
        {/* ── Başlık ─────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ScanLine className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">KK1 — Tambur Girişi</h1>
              <p className="text-sm text-muted-foreground">Tambur kesim sonrası kumaş girişi</p>
            </div>
          </div>
          <Badge variant="outline" className="text-sm px-3 py-1.5 font-mono">
            TAMBUR-1
          </Badge>
        </div>

        {/* ── Son Kayıt (varsa) ──────────────────────── */}
        {lastEntry && (
          <LastEntryCard
            entry={lastEntry}
            onPrint={handlePrint}
          />
        )}

        {/* ── Form Kartı ──────────────────────────────── */}
        <Card className="shadow-lg">
          <CardContent className="p-6 space-y-5">
            {/* Ürün Seçimi - En önemli */}
            <div className="space-y-2">
              <Label htmlFor="kk1-item" className="text-base font-semibold">
                Ürün (Stok Kartı) <span className="text-destructive">*</span>
              </Label>
              <Select
                id="kk1-item"
                value={form.itemId}
                onChange={(e) => updateForm("itemId", e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, variantRef)}
                options={itemOptions}
                placeholder="Ürün seçiniz..."
                className="text-base h-12"
                autoFocus
              />
            </div>

            {/* Desen/Varyant */}
            <div className="space-y-2">
              <Label htmlFor="kk1-variant" className="text-base font-semibold">
                Desen / Varyant
              </Label>
              <Select
                id="kk1-variant"
                ref={variantRef}
                value={form.variantId}
                onChange={(e) => updateForm("variantId", e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, qtyRef)}
                options={variantOptions}
                placeholder={form.itemId ? "Desen/Varyant seçiniz..." : "Önce ürün seçiniz"}
                className="text-base h-12"
                disabled={!form.itemId}
              />
              {form.itemId && variantOptions.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Bu ürüne ait tanımlı varyant yok. Stok kartından eklenebilir.
                </p>
              )}
            </div>

            {/* Metraj (Ana Giriş) */}
            <div className="space-y-2">
              <Label htmlFor="kk1-qty" className="text-base font-semibold">
                Metraj (mt) <span className="text-destructive">*</span>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="kk1-qty"
                  ref={qtyRef}
                  type="number"
                  step="0.1"
                  min="0"
                  value={form.initialQty}
                  onChange={(e) => updateForm("initialQty", e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e)}
                  placeholder="0.0"
                  className="text-2xl font-bold h-16 text-center"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={handlePullFromDevice}
                  disabled={pulling}
                  className="h-16 px-4 border-amber-500/50 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950"
                  title="Metraj cihazından çek"
                >
                  {pulling ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <Gauge className="h-6 w-6" />
                  )}
                </Button>
              </div>
            </div>

            {/* En + KG */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="kk1-width" className="text-base font-semibold">
                  En (cm)
                </Label>
                <Input
                  id="kk1-width"
                  type="number"
                  step="1"
                  min="0"
                  value={form.width}
                  onChange={(e) => updateForm("width", e.target.value)}
                  placeholder="örn: 280"
                  className="text-base h-12"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="kk1-kg" className="text-base font-semibold">
                  Ağırlık (kg)
                </Label>
                <Input
                  id="kk1-kg"
                  type="number"
                  step="0.1"
                  min="0"
                  value={form.weightKg}
                  onChange={(e) => updateForm("weightKg", e.target.value)}
                  placeholder="örn: 45.2"
                  className="text-base h-12"
                />
              </div>
            </div>

            {/* Kalite Sınıfı */}
            <div className="space-y-2">
              <Label className="text-base font-semibold">Kalite Sınıfı</Label>
              <div className="grid grid-cols-4 gap-2">
                {qualityOptions.map((opt) => (
                  <Button
                    key={opt.value}
                    type="button"
                    variant={form.qualityGrade === opt.value ? "default" : "outline"}
                    size="lg"
                    onClick={() => updateForm("qualityGrade", opt.value)}
                    className="h-12 text-sm"
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Kaydet Butonu ───────────────────────────── */}
        <Button
          size="lg"
          className="w-full h-16 text-lg font-bold shadow-lg"
          onClick={handleSubmit}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? (
            <>
              <Loader2 className="h-6 w-6 mr-2 animate-spin" />
              Kaydediliyor...
            </>
          ) : (
            <>
              <PackageCheck className="h-6 w-6 mr-2" />
              Kaydet ve Etiket Bas
            </>
          )}
        </Button>

        {/* ── Kısayol Bilgisi ────────────────────────── */}
        <p className="text-center text-xs text-muted-foreground">
          Ürün seçtikten sonra <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">Enter</kbd> ile metraj alanına geç
        </p>
      </div>
    </div>
  );
}
