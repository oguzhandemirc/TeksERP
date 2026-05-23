import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormField } from "@/components/forms/FormField";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import { StatusBadge, orderStatusTones } from "@/components/operations/StatusBadge";
import { orderStatusLabels, type OrderStatus } from "@/types/enums";
import { safeFormat } from "@/lib/format";
import { shipmentService, type ReadyOrder } from "./service";

interface PickerRow {
  rollId: string;
  barcode: string | null;
  itemName: string;
  itemCode: string;
  colorName: string | null;
  colorHex: string | null;
  qty: number;
  weightKg: number | null;
  width: number | null;
  qualityGrade: string;
  rollStatus: string;
}

function flattenRolls(order: ReadyOrder | undefined): PickerRow[] {
  if (!order) return [];
  const out: PickerRow[] = [];
  for (const line of order.lines) {
    for (const a of line.allocatedRolls) {
      out.push({
        rollId: a.rollId,
        barcode: a.barcode,
        itemName: line.itemName,
        itemCode: line.itemCode,
        colorName: line.color?.name ?? null,
        colorHex: line.color?.hex ?? null,
        qty: a.allocatedQty,
        weightKg: a.weightKg,
        width: a.width,
        qualityGrade: a.qualityGrade,
        rollStatus: a.rollStatus,
      });
    }
  }
  return out;
}

function formatCurrency(amount: string | null, currency: string): string {
  if (!amount) return "—";
  const num = Number(amount);
  if (!Number.isFinite(num)) return "—";
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(num);
}

export function ShipFromOrderPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [driverName, setDriverName] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [carrier, setCarrier] = useState("");
  const [plannedDate, setPlannedDate] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  // /ready-orders tüm listeyi döner; orderId ile filtrele.
  const ordersQ = useQuery({
    queryKey: ["ready-orders", "all"],
    queryFn: () => shipmentService.readyOrders(),
  });

  const order = useMemo(
    () => ordersQ.data?.data.find((o) => o.orderId === orderId),
    [ordersQ.data, orderId]
  );

  const rows = useMemo(() => flattenRolls(order), [order]);

  // Sayfa ilk açıldığında tüm hazır toplari otomatik seç.
  useEffect(() => {
    if (rows.length > 0 && selected.size === 0) {
      setSelected(new Set(rows.map((r) => r.rollId)));
    }
    // selected.size === 0 koşulu kullanıcı manuel hepsini kaldırırsa otomatik seçimi
    // tekrar çalıştırmaz (ama satır sayısı değişirse de değişmez — bilinçli).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  const finalizeMut = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error("Sipariş bulunamadı");
      const driver = driverName.trim();
      const plate = plateNumber.trim();
      const carrierName = carrier.trim();
      const created = await shipmentService.create({
        customerId: order.customerId,
        branchId: order.branchId,
        ...(driver ? { driverName: driver } : {}),
        ...(plate ? { plateNumber: plate } : {}),
        ...(carrierName ? { carrier: carrierName } : {}),
        plannedDate: plannedDate ? new Date(plannedDate).toISOString() : null,
      });
      const shipmentId = created.data.id;
      const shipmentNumber = created.data.shipmentNumber;
      await shipmentService.addItems(shipmentId, Array.from(selected));
      const finalized = await shipmentService.finalize(shipmentId);
      return { shipmentNumber, message: finalized.message };
    },
    onSuccess: (res) => {
      toast.success(`${res.shipmentNumber} sevk edildi · ${res.message ?? ""}`);
      void qc.invalidateQueries({ queryKey: ["ready-orders"] });
      void qc.invalidateQueries({ queryKey: ["shipments"] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      navigate("/operations/shipments");
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error ? err.message : "Sevkiyat oluşturulurken hata oluştu";
      toast.error(msg);
    },
  });

  const handleToggle = (rollId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rollId)) next.delete(rollId);
      else next.add(rollId);
      return next;
    });

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.rollId));
  const someChecked = !allChecked && rows.some((r) => selected.has(r.rollId));
  const totalSelectedQty = rows
    .filter((r) => selected.has(r.rollId))
    .reduce((s, r) => s + r.qty, 0);
  const totalSelectedWeight = rows
    .filter((r) => selected.has(r.rollId))
    .reduce((s, r) => s + (r.weightKg ?? 0), 0);
  const totalRequestedQty = order?.lines.reduce((s, l) => s + l.requestedQty, 0) ?? 0;

  if (ordersQ.isLoading) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Sevkiyat Hazırla" description="Yükleniyor..." />
        <div className="space-y-3 p-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Sevkiyat Hazırla" description="Sipariş bulunamadı veya hazır top kalmadı." />
        <div className="p-4">
          <Button asChild variant="outline">
            <Link to="/operations/shipments">
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Sevkiyatlara dön
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={`Sevk Et — ${order.orderNumber}`}
        description={`${order.customerName}${
          order.branch ? ` · ${order.branch.name}` : ""
        } · Sipariş: ${safeFormat(order.orderDate, "dd.MM.yyyy")}`}
        actions={
          <>
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link to="/operations/shipments">
                <ArrowLeft className="h-4 w-4" /> Geri
              </Link>
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={selected.size === 0 || finalizeMut.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              <CheckCircle2 className="h-4 w-4" />
              {finalizeMut.isPending ? "Onaylanıyor..." : "Sevkiyatı Oluştur ve Onayla"}
            </Button>
          </>
        }
      />

      <div className="flex-1 space-y-4 overflow-auto p-4">
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2 border-b pb-3">
              <span className="font-mono text-sm font-semibold">{order.orderNumber}</span>
              <StatusBadge
                status={order.status as OrderStatus}
                labels={orderStatusLabels}
                tones={orderStatusTones}
              />
              <span className="text-muted-foreground">·</span>
              <span className="text-base font-medium">{order.customerName}</span>
              {order.branch && (
                <Badge variant="outline" className="text-[11px]">
                  Şube: {order.branch.name}
                  {order.branch.city && ` · ${order.branch.city}`}
                  {order.branch.district && ` / ${order.branch.district}`}
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div>
                <div className="text-muted-foreground text-xs">Sipariş Tarihi</div>
                <div className="font-medium">
                  {safeFormat(order.orderDate, "dd.MM.yyyy")}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Termin</div>
                <div className="mt-0.5">
                  <DeadlineBadge deadline={order.deadline} />
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Sipariş Metraj</div>
                <div className="font-medium tabular-nums">
                  {totalRequestedQty.toLocaleString("tr-TR")} m
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Sipariş Tutarı</div>
                <div className="font-medium tabular-nums">
                  {formatCurrency(order.totalAmount, order.currency)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Seçili / Hazır</div>
                <div className="font-medium tabular-nums">
                  {selected.size}/{rows.length}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Sevk Edilecek</div>
                <div className="font-medium tabular-nums">
                  {totalSelectedQty.toFixed(0)} m
                  {totalSelectedWeight > 0 && (
                    <span className="text-muted-foreground text-xs">
                      {" "}
                      · {totalSelectedWeight.toFixed(1)} kg
                    </span>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <section>
          <div className="mb-2 border-b pb-2">
            <h2 className="text-sm font-semibold">Sipariş Kalemleri</h2>
            <p className="text-muted-foreground text-xs">
              Müşterinin istediği ürünler ve her kalemden hazır miktar.
            </p>
          </div>
          <ul className="space-y-1.5">
            {order.lines.map((line) => {
              const lineReadyQty = line.allocatedRolls.reduce(
                (s, r) => s + r.allocatedQty,
                0,
              );
              const pct = line.requestedQty > 0
                ? Math.min(100, Math.round((lineReadyQty / line.requestedQty) * 100))
                : 0;
              return (
                <li key={line.lineId} className="rounded-md border p-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{line.itemCode}</span>
                    <span className="font-medium">{line.itemName}</span>
                    {line.color && (
                      <Badge variant="muted" className="gap-1 text-[10px]">
                        {line.color.hex && (
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: line.color.hex }}
                          />
                        )}
                        {line.color.name}
                      </Badge>
                    )}
                    {line.width != null && (
                      <Badge variant="muted" className="text-[10px]">
                        En: {line.width} cm
                      </Badge>
                    )}
                    <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                      Hazır:{" "}
                      <span className="text-foreground font-medium">
                        {lineReadyQty.toLocaleString("tr-TR")}
                      </span>
                      {" / "}
                      {line.requestedQty.toLocaleString("tr-TR")} m
                      <span className="ml-1.5">({pct}%)</span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between border-b pb-2">
            <div>
              <h2 className="text-sm font-semibold">Hazır Toplar</h2>
              <p className="text-muted-foreground text-xs">
                Bu siparişe atanmış ve READY durumda toplar. Tümü seçili — istemediğini
                tikten çıkar.
              </p>
            </div>
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allChecked || (someChecked && "indeterminate")}
                      onCheckedChange={(v) =>
                        setSelected(v === true ? new Set(rows.map((r) => r.rollId)) : new Set())
                      }
                      aria-label="Tümünü seç"
                    />
                  </TableHead>
                  <TableHead>Barkod</TableHead>
                  <TableHead>Ürün</TableHead>
                  <TableHead>Renk</TableHead>
                  <TableHead className="text-right">En</TableHead>
                  <TableHead className="text-right">Metre</TableHead>
                  <TableHead className="text-right">Kg</TableHead>
                  <TableHead>Kalite</TableHead>
                  <TableHead>Durum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const checked = selected.has(r.rollId);
                  return (
                    <TableRow
                      key={r.rollId}
                      data-state={checked ? "selected" : undefined}
                      onClick={() => handleToggle(r.rollId)}
                      className="cursor-pointer"
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => handleToggle(r.rollId)}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.barcode}</TableCell>
                      <TableCell>
                        <span className="text-muted-foreground mr-1.5 font-mono text-[10px]">
                          {r.itemCode}
                        </span>
                        {r.itemName}
                      </TableCell>
                      <TableCell>
                        {r.colorName ? (
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            {r.colorHex && (
                              <span
                                className="h-2.5 w-2.5 rounded-full border"
                                style={{ backgroundColor: r.colorHex }}
                              />
                            )}
                            {r.colorName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {r.width != null ? `${r.width} cm` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.qty.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {r.weightKg != null ? r.weightKg.toFixed(1) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="muted" className="text-[10px]">
                          {r.qualityGrade}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {r.rollStatus}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>

        <section>
          <div className="mb-2 border-b pb-2">
            <h2 className="text-sm font-semibold">Nakliye Bilgileri</h2>
            <p className="text-muted-foreground text-xs">
              Şoför, plaka, nakliyeci — irsaliyede yer alır.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Şoför">
              <Input
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder="Ahmet Yılmaz"
              />
            </FormField>
            <FormField label="Plaka">
              <Input
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value)}
                placeholder="34 ABC 123"
                className="font-mono"
              />
            </FormField>
            <FormField label="Nakliyeci">
              <Input
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder="Hızlı Nakliyat"
              />
            </FormField>
            <FormField label="Planlı Sevk Tarihi">
              <Input
                type="date"
                value={plannedDate}
                onChange={(e) => setPlannedDate(e.target.value)}
              />
            </FormField>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Sevkiyatı oluştur ve onayla"
        description={`${selected.size} top SHIPPED durumuna geçecek; sipariş tölerans dahilinde otomatik COMPLETED olur. Devam edilsin mi?`}
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
