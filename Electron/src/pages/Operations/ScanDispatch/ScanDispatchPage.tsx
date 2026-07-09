import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Truck, DoorOpen, X, PackageCheck, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScanField } from "@/components/scanner/ScanField";
import { useContinuousScan } from "@/hooks/useContinuousScan";
import { sackStoreService } from "@/pages/Operations/SackStore/service";
import { sackStoreStatusLabels, type SackStoreShipment } from "@/pages/Operations/SackStore/types";
import { DispatchConfirmDialog } from "@/pages/Operations/SackStore/DispatchConfirmDialog";

const DEC = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

interface ScannedGroup {
  shipment: SackStoreShipment;
  codes: string[];
}

/**
 * Okutarak Sevk — kapıda çuvalları arka arkaya okut (CV-…), sistem her çuvalı
 * sevkiyatına eşler ve sevkiyata göre gruplar. READY → "Kapıya Taşı", AT_DOOR →
 * "Sevk Et" (yıkıcı onay, çuvalları listeler). Yalnız sevke hazır (Çuval Depo /
 * Kapı Önü) sevkiyatlardaki çuvallar eşleşir.
 */
export function ScanDispatchPage() {
  const qc = useQueryClient();
  const [scanValue, setScanValue] = useState("");
  const [groups, setGroups] = useState<ScannedGroup[]>([]);
  const [dispatchTarget, setDispatchTarget] = useState<ScannedGroup | null>(null);

  const upsertGroup = (shipment: SackStoreShipment, code: string) => {
    setGroups((prev) => {
      const idx = prev.findIndex((g) => g.shipment.id === shipment.id);
      if (idx < 0) return [...prev, { shipment, codes: [code] }];
      const next = [...prev];
      const g = next[idx]!;
      next[idx] = {
        shipment, // taze sayaç/durum
        codes: g.codes.includes(code) ? g.codes : [...g.codes, code],
      };
      return next;
    });
  };

  // Çuval kodunu (sackNo/manualCode) sevke-hazır (READY/AT_DOOR) sevkiyatına eşle.
  // Birden çok DİSTİNKT sevkiyat eşleşirse (nadir kod çakışması) tahmin etme — uyar.
  const resolveSack = async (code: string): Promise<SackStoreShipment | null> => {
    const { data } = await sackStoreService.list({ search: code, limit: 5 });
    const distinct = new Map(data.map((s) => [s.id, s]));
    if (distinct.size > 1) {
      toast.warning(`"${code}" birden fazla sevkiyatla eşleşti — Çuval Depo'dan elle seçin.`);
      return null;
    }
    return data[0] ?? null;
  };

  const { push, resolving, lastError } = useContinuousScan<SackStoreShipment>({
    resolve: resolveSack,
    onResolved: (shipment, code) => upsertGroup(shipment, code),
    alreadyInList: (code) => groups.some((g) => g.codes.includes(code)),
  });

  const handleScan = (code: string) => {
    push(code);
    setScanValue("");
  };

  const removeGroup = (id: string) => setGroups((prev) => prev.filter((g) => g.shipment.id !== id));

  const moveMut = useMutation({
    mutationFn: (id: string) => sackStoreService.moveToDoor(id),
    onSuccess: (_res, id) => {
      toast.success("Kapı önüne taşındı.");
      setGroups((prev) =>
        prev.map((g) =>
          g.shipment.id === id ? { ...g, shipment: { ...g.shipment, status: "AT_DOOR" } } : g,
        ),
      );
      void qc.invalidateQueries({ queryKey: ["sack-store"] });
    },
  });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Okutarak Sevk"
        description="Çuvalları kapıda okut → sevkiyatına göre gruplanır → kapıya taşı / sevk et."
        actions={
          groups.length > 0 ? (
            <Button variant="outline" size="sm" onClick={() => setGroups([])}>
              <Trash2 className="mr-1 h-4 w-4" /> Listeyi Temizle
            </Button>
          ) : undefined
        }
      />

      <ScanField
        className="border-b px-6 py-3"
        value={scanValue}
        onChange={setScanValue}
        onScan={handleScan}
        placeholder="Çuval kodu okut (CV-…) → sevkiyatı bul"
        autoFocus
        expectPrefix="SACK"
        submitLabel="Ekle"
      />
      {(resolving.length > 0 || lastError) && (
        <div className="border-b px-6 py-1.5 text-xs">
          {resolving.length > 0 && (
            <span className="text-muted-foreground">Çözümleniyor: {resolving.join(", ")}</span>
          )}
          {lastError && <span className="text-destructive">{lastError}</span>}
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
            <Truck className="h-8 w-8 opacity-50" />
            <p className="text-sm">Henüz çuval okutulmadı. Kapıdaki çuvalları okutmaya başlayın.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.shipment.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{g.shipment.shipmentNo}</span>
                      <Badge variant={g.shipment.status === "AT_DOOR" ? "default" : "secondary"}>
                        {sackStoreStatusLabels[g.shipment.status]}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {g.shipment.customer.name}
                      {g.shipment.branch ? ` · ${g.shipment.branch.name}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {g.codes.length} / {g.shipment.sackCount} çuval okutuldu ·{" "}
                      {DEC.format(g.shipment.totalQty)} m
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => removeGroup(g.shipment.id)}
                    aria-label="Listeden çıkar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {g.codes.map((c) => (
                    <span key={c} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                      {c}
                    </span>
                  ))}
                </div>

                <div className="mt-3 flex justify-end">
                  {g.shipment.status === "READY" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={moveMut.isPending}
                      onClick={() => moveMut.mutate(g.shipment.id)}
                    >
                      <DoorOpen className="mr-1 h-4 w-4" /> Kapıya Taşı
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => setDispatchTarget(g)}>
                      <PackageCheck className="mr-1 h-4 w-4" /> Sevk Et
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <DispatchConfirmDialog
        shipment={
          dispatchTarget
            ? {
                id: dispatchTarget.shipment.id,
                shipmentNo: dispatchTarget.shipment.shipmentNo,
                customerName: dispatchTarget.shipment.customer.name,
                branchName: dispatchTarget.shipment.branch?.name ?? null,
              }
            : null
        }
        scannedCodes={dispatchTarget?.codes}
        onOpenChange={(o) => !o && setDispatchTarget(null)}
        onDispatched={(id) => {
          removeGroup(id);
          setDispatchTarget(null);
        }}
      />
    </div>
  );
}
