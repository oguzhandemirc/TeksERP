import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Plus, Truck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { StatusBadge, shipmentStatusTones } from "@/components/operations/StatusBadge";
import { shipmentStatusLabels } from "@/types/enums";
import { safeFormat, formatNumber } from "@/lib/format";
import { shipmentService } from "./service";
import { ReadyRollsPicker } from "./ReadyRollsPicker";

export function ShipmentEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const detailQ = useQuery({
    queryKey: ["shipment-detail", id],
    queryFn: () => shipmentService.getById(id!),
    enabled: !!id,
  });

  const ship = detailQ.data?.data;
  const items = ship?.items ?? [];
  const totalQty = items.reduce((s, i) => s + i.shippedQty, 0);
  const totalKg = items.reduce((s, i) => s + (i.shippedWeight ?? 0), 0);

  const excludeRollIds = useMemo(
    () => new Set(items.map((i) => i.rollId)),
    [items]
  );

  const addMut = useMutation({
    mutationFn: (rollIds: string[]) => shipmentService.addItems(id!, rollIds),
    onSuccess: (res) => {
      const { added, reassigned, alreadyInShipment, wrongStatus, ownerMismatch, notFound } =
        res.data;
      const parts: string[] = [];
      if (added > 0) parts.push(`${added} eklendi`);
      if (reassigned > 0) parts.push(`${reassigned} yeniden atandı`);
      if (alreadyInShipment > 0) parts.push(`${alreadyInShipment} zaten ekli`);
      if (wrongStatus > 0) parts.push(`${wrongStatus} uygun değil`);
      if (ownerMismatch > 0) parts.push(`${ownerMismatch} sahip uyumsuz`);
      if (notFound > 0) parts.push(`${notFound} bulunamadı`);
      toast.success(parts.join(" · ") || "Güncellendi");
      void qc.invalidateQueries({ queryKey: ["shipment-detail", id] });
      void qc.invalidateQueries({ queryKey: ["ready-orders"] });
      void qc.invalidateQueries({ queryKey: ["ready-fason"] });
      setSelected(new Set());
    },
  });

  const finalizeMut = useMutation({
    mutationFn: () => shipmentService.finalize(id!),
    onSuccess: (res) => {
      toast.success(res.message ?? "Sevkiyat onaylandı");
      void qc.invalidateQueries({ queryKey: ["shipments"] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      navigate("/operations/shipments");
    },
  });

  const handleToggle = (rollId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rollId)) next.delete(rollId);
      else next.add(rollId);
      return next;
    });

  // toggleAll picker'a gelen tüm rollId'leri seçer; biz burada kasıtlı state-set bırakıyoruz.
  const handleToggleAll = (checked: boolean, allIds?: string[]) => {
    if (!checked) setSelected(new Set());
    else if (allIds) setSelected(new Set(allIds));
  };

  if (detailQ.isLoading || !ship) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Sevkiyat" description="Yükleniyor..." />
        <div className="space-y-3 p-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  const isPreparing = ship.status === "PREPARING";
  const customerId = ship.customerId;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={`Sevkiyat ${ship.shipmentNumber}`}
        description={`${ship.customer?.name ?? ship.customerNameSnapshot ?? "—"}${
          ship.branch?.name || ship.branchNameSnapshot
            ? ` · ${ship.branch?.name ?? ship.branchNameSnapshot}`
            : ""
        }`}
        actions={
          <>
            <StatusBadge
              status={ship.status}
              labels={shipmentStatusLabels}
              tones={shipmentStatusTones}
            />
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link to="/operations/shipments">
                <ArrowLeft className="h-4 w-4" /> Sevkiyatlar
              </Link>
            </Button>
            {isPreparing && (
              <Button
                size="sm"
                className="gap-1.5"
                disabled={items.length === 0 || finalizeMut.isPending}
                onClick={() => setConfirmOpen(true)}
              >
                <CheckCircle2 className="h-4 w-4" />
                {finalizeMut.isPending ? "Onaylanıyor..." : "Sevkiyatı Onayla"}
              </Button>
            )}
          </>
        }
      />

      <div className="flex-1 space-y-4 overflow-auto p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="p-3">
              <div className="text-muted-foreground text-xs">Eklenen Top</div>
              <div className="text-xl font-semibold tabular-nums">{items.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="text-muted-foreground text-xs">Toplam Metre</div>
              <div className="text-xl font-semibold tabular-nums">
                {formatNumber(totalQty, 0)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="text-muted-foreground text-xs">Toplam Kg</div>
              <div className="text-xl font-semibold tabular-nums">
                {formatNumber(totalKg, 1)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="text-muted-foreground text-xs">Planlı Sevk</div>
              <div className="font-medium">
                {ship.plannedDate ? safeFormat(ship.plannedDate, "dd.MM.yyyy") : "—"}
              </div>
            </CardContent>
          </Card>
        </div>

        {(ship.driverName || ship.plateNumber || ship.carrier) && (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <Truck className="text-muted-foreground h-4 w-4" />
              {ship.carrier && <span>{ship.carrier}</span>}
              {ship.driverName && (
                <span className="text-muted-foreground">Şoför: {ship.driverName}</span>
              )}
              {ship.plateNumber && (
                <span className="font-mono">{ship.plateNumber}</span>
              )}
            </CardContent>
          </Card>
        )}

        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b pb-2">
            <div>
              <h2 className="text-sm font-semibold">Sevkiyata Eklenen Toplar</h2>
              <p className="text-muted-foreground text-xs">
                Onay sonrası bu toplar SHIPPED, ilgili siparişler tölerans dahilinde
                otomatik COMPLETED olur.
              </p>
            </div>
          </div>
          {items.length === 0 ? (
            <div className="text-muted-foreground flex h-20 items-center justify-center rounded-md border border-dashed text-sm">
              Henüz top eklenmedi.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="flex items-center justify-between gap-3 rounded-md border p-2.5 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{it.rollBarcodeSnapshot ?? it.rollId}</span>
                    {it.orderNumberSnapshot && (
                      <Badge variant="muted" className="font-mono text-[10px]">
                        {it.orderNumberSnapshot}
                      </Badge>
                    )}
                    {(it.itemCodeSnapshot || it.itemNameSnapshot) && (
                      <span className="text-muted-foreground text-xs">
                        {it.itemCodeSnapshot} · {it.itemNameSnapshot}
                      </span>
                    )}
                  </div>
                  <div className="text-right text-xs tabular-nums">
                    <div className="text-sm">{formatNumber(it.shippedQty, 0)} m</div>
                    {it.shippedWeight != null && (
                      <div className="text-muted-foreground">
                        {formatNumber(it.shippedWeight, 1)} kg
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {isPreparing && (
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
              <div>
                <h2 className="text-sm font-semibold">Sevkiyata Eklenebilir Hazır Toplar</h2>
                <p className="text-muted-foreground text-xs">
                  Bu müşteri için: tahsisli siparişlerden + fason (sahibi bu müşteri)
                  toplar.
                </p>
              </div>
              <Button
                size="sm"
                className="gap-1.5"
                disabled={selected.size === 0 || addMut.isPending}
                onClick={() => addMut.mutate(Array.from(selected))}
              >
                <Plus className="h-3.5 w-3.5" />
                {addMut.isPending ? "Ekleniyor..." : `Seçilenleri Ekle (${selected.size})`}
              </Button>
            </div>
            <ReadyRollsPicker
              customerId={customerId}
              excludeRollIds={excludeRollIds}
              selected={selected}
              onToggle={handleToggle}
              onToggleAll={(checked) => handleToggleAll(checked, undefined)}
            />
            <p className="text-muted-foreground pt-1 text-[11px]">
              İpucu: Tümünü seç hâlâ aktif değilse, satıra tıklayarak tek tek seçebilirsin.
              Backend bilgisi: yanlış müşteriye tahsisli toplar otomatik bu sevkiyatın
              müşterisine yeniden atanır.
            </p>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Sevkiyatı onayla"
        description={`${items.length} top SHIPPED durumuna geçecek. İlgili siparişler tölerans dahilinde COMPLETED olacak. Devam edilsin mi?`}
        confirmLabel="Onayla"
        isPending={finalizeMut.isPending}
        onConfirm={() => {
          setConfirmOpen(false);
          finalizeMut.mutate();
        }}
      />
    </div>
  );
}
