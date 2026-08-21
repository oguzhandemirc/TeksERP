import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { safeFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fireConfetti } from "@/lib/confetti";
import { Lock, Pencil, Ban, Factory, Undo2, Info, AlertTriangle } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AnimatedProgress } from "@/components/motion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PermissionGate } from "@/components/PermissionGate";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { customerAliasService } from "@/pages/Customers/aliasService";
import { StatusBadge, orderStatusTones } from "@/components/operations/StatusBadge";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import { orderStatusLabels } from "@/types/enums";
import { CoveragePanel } from "@/pages/Operations/WorkOrders/CoveragePanel";
import { lineOpen } from "@/pages/Operations/WorkOrders/order-fulfillment";
import { buildPicked, type PickedOrderLine } from "@/pages/Operations/WorkOrders/OrderPickerDialog";
import { orderService } from "./service";
import { returnsService } from "@/pages/Operations/Returns/service";
import { OrderCancelDialog } from "./OrderCancelDialog";
import { PartyCard } from "@/components/operations/PartyCard";
import { LinkedWorkOrdersCard } from "./LinkedWorkOrdersCard";
import { RecordInfoButton } from "@/components/RecordInfoButton";
import { OrderLineWoChips } from "./OrderLineWoChips";
import { OrderShipmentsCard } from "./OrderShipmentsCard";
import type { Order, OrderLine } from "./types";

/** Tek iş emri = tek kumaş+renk+en. Kalem imzası bu üçlüden türer. */
const lineSig = (l: OrderLine) => `${l.itemId}::${l.colorId ?? ""}::${l.width ?? ""}`;
/**
 * Açık (sevk edilmemiş) metre — 0 ise kalem iş emrine alınamaz.
 *
 * Formül TEK YERDE: `order-fulfillment.lineOpen` (kanonik). Buradaki yerel kopya
 * clamp'siz olduğu için aşırı sevkte NEGATİF dönüyordu; iki çağrı yeri de sonucu
 * ya `> 0` ile karşılaştırdığı ya da yalnız açık kalemde kullandığı için görünür
 * bir fark yok — ama kopya kalsaydı üçüncü çağrı yerinde "−12 m açık" basardı.
 */
const lineRem = (l: OrderLine) => lineOpen(Number(l.quantity), Number(l.shippedQty ?? 0));
/** Çapaya göre hangi nitelikler farklı — overlay'de "neden seçilemez" metni için. */
const diffLabel = (anchor: OrderLine, line: OrderLine) => {
  const parts: string[] = [];
  if (anchor.itemId !== line.itemId) parts.push("kumaş");
  if ((anchor.colorId ?? "") !== (line.colorId ?? "")) parts.push("renk");
  if ((anchor.width ?? "") !== (line.width ?? "")) parts.push("en");
  return parts.length ? `Farklı ${parts.join(" + ")}` : "Farklı spec";
};

interface Props {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (order: Order) => void;
  /** "Bu kumaştan iş emri oluştur" — tek kumaşın açık kalemlerini WO formuna seed'ler. */
  onCreateWorkOrder?: (lines: PickedOrderLine[]) => void;
}

export function OrderDetailSheet({
  order,
  open,
  onOpenChange,
  onEdit,
  onCreateWorkOrder,
}: Props) {
  const qc = useQueryClient();
  const [closeOpen, setCloseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());

  // Panel başka siparişe geçince veya kapanınca kalem seçimini sıfırla.
  useEffect(() => {
    setSelectedLineIds(new Set());
  }, [order?.id, open]);

  const closeMut = useMutation({
    mutationFn: ({ id, r }: { id: string; r: string }) => orderService.manualClose(id, r),
    onSuccess: () => {
      toast.success("Sipariş manuel olarak kapatıldı.");
      fireConfetti();
      void qc.invalidateQueries({ queryKey: ["orders"] });
      setCloseOpen(false);
      setReason("");
      onOpenChange(false);
    },
  });

  // Bu siparişe gelen (aktif) iade özeti — bilgilendirici (sevk muhasebesini değiştirmez).
  const returnsSummary = useQuery({
    queryKey: ["returns", "order-summary", order?.id],
    queryFn: () => returnsService.summaryForOrder(order!.id),
    enabled: open && !!order?.id,
    staleTime: 30_000,
  });

  // Müşterinin kalıcı (master) kumaş/renk adları. Kalemdeki 1-shot override boşsa
  // "müşterideki ad" buradan düşer — terfi edilmiş VEYA panelden girilmiş ad fark
  // etmez, ikisi de gösterilir. customer-alias:read yoksa sessizce override'a düşülür.
  const { hasPermission } = useRoleAccess();
  const aliasEnabled = open && !!order?.customerId && hasPermission("customer-alias:read");
  const itemAliasesQuery = useQuery({
    queryKey: ["customer", order?.customerId, "item-aliases"],
    queryFn: () => customerAliasService.listItemAliases(order!.customerId),
    enabled: aliasEnabled,
    staleTime: 60_000,
  });
  const colorAliasesQuery = useQuery({
    queryKey: ["customer", order?.customerId, "color-aliases"],
    queryFn: () => customerAliasService.listColorAliases(order!.customerId),
    enabled: aliasEnabled,
    staleTime: 60_000,
  });
  // itemId/colorId → müşterideki ad (master). Renk alias'ı null olabilir (atandı
  // ama ad verilmedi) → o kaydı haritaya alma.
  const itemAliasMap = new Map(
    (itemAliasesQuery.data?.data ?? []).map((a) => [a.itemId, a.alias]),
  );
  const colorAliasMap = new Map(
    (colorAliasesQuery.data?.data ?? [])
      .filter((a) => a.alias)
      .map((a) => [a.colorId, a.alias as string]),
  );
  /** Kalemdeki müşteri adı: 1-shot override > master alias > yok. */
  const customerNames = (line: OrderLine) => ({
    item: line.customerItemName ?? itemAliasMap.get(line.itemId) ?? null,
    color: line.customerColorName ?? (line.colorId ? colorAliasMap.get(line.colorId) ?? null : null),
  });

  const totalQty = order?.lines.reduce((acc, l) => acc + Number(l.quantity), 0) ?? 0;
  const isEditable = order && (order.status === "APPROVED" || order.status === "PARTIAL_SHIPPED");
  const isCancellable = order && order.status !== "COMPLETED" && order.status !== "CANCELLED";
  const canClose = order && (order.status === "PENDING" || order.status === "APPROVED" || order.status === "PARTIAL_SHIPPED");
  // İş emri kalem bazında açılır (tek WO = tek kumaş/renk/en). Durum uygun + handler
  // varsa kalemler seçilebilir; seçimden tek "İş emri oluştur" ile WO başlatılır.
  const woEligible =
    Boolean(onCreateWorkOrder) &&
    Boolean(order) &&
    (order!.status === "APPROVED" || order!.status === "PARTIAL_SHIPPED");

  // Seçili kalemler + "çapa" imza: ilk seçilen kalemin kumaş/renk/en imzası. Bu
  // imzaya uymayan açık kalemler söner (tek WO = tek spec).
  const selectedLines = order ? order.lines.filter((l) => selectedLineIds.has(l.id)) : [];
  const anchor = selectedLines[0];
  const anchorSig = anchor ? lineSig(anchor) : null;
  const selectedCount = selectedLines.length;

  const toggleLine = (lineId: string) => {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  };

  // Seçili kalemleri (hepsi aynı imza) WO formuna seed'le; panel açık kalır.
  const handleCreateWo = () => {
    if (!order || selectedLineIds.size === 0) return;
    const picked = order.lines
      .filter((l) => selectedLineIds.has(l.id))
      .map((l) => buildPicked(order, { ...l, openQty: lineRem(l) }));
    onCreateWorkOrder?.(picked);
    setSelectedLineIds(new Set());
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="font-mono">{order?.orderNumber}</span>
            {order && (
              <>
                <StatusBadge
                  status={order.status}
                  labels={orderStatusLabels}
                  tones={orderStatusTones}
                />
                {/* ⓘ — kim oluşturdu / en son kim değiştirdi (2026-08-17). */}
                <RecordInfoButton
                  table="ORDER"
                  id={order.id}
                  createdAt={order.createdAt}
                  updatedAt={order.updatedAt}
                />
              </>
            )}
          </SheetTitle>
          {/* a11y açıklaması — görsel kimlik PartyCard'da; burası ekran
              okuyucu için kısa özet (Radix Description zorunlu). */}
          <SheetDescription className="sr-only">
            {order?.customer?.name}
            {order?.branch ? ` — Şube: ${order.branch.name}` : ""}
            {order?.branch?.code ? ` (${order.branch.code})` : ""}
          </SheetDescription>
        </SheetHeader>

        {order && (
          <div className="mt-4 space-y-4">
            <PartyCard customer={order.customer} branch={order.branch} />

            <div className="grid grid-cols-3 gap-2 text-sm">
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Sipariş Tarihi</div>
                  <div className="font-medium">{safeFormat(order.orderDate, "dd.MM.yyyy")}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Termin</div>
                  <div className="mt-1">
                    <DeadlineBadge deadline={order.deadline} />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Toplam</div>
                  <div className="font-medium tabular-nums">
                    {totalQty.toLocaleString("tr-TR", { useGrouping: false })} m
                  </div>
                </CardContent>
              </Card>
            </div>

            {totalQty > 0 && (
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Sevk İlerlemesi</span>
                    <span className="font-medium tabular-nums">
                      {order.shippedQty.toLocaleString("tr-TR", { useGrouping: false })} / {totalQty.toLocaleString("tr-TR", { useGrouping: false })} m
                      <span className="ml-1 text-muted-foreground">
                        (%{Math.round((order.shippedQty / totalQty) * 100)})
                      </span>
                    </span>
                  </div>
                  <AnimatedProgress
                    value={(order.shippedQty / totalQty) * 100}
                    className="mt-2 h-1.5"
                  />
                </CardContent>
              </Card>
            )}

            {order.completedAt && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <div className="font-medium">
                  Tamamlandı: {safeFormat(order.completedAt, "dd.MM.yyyy HH:mm")}
                </div>
                {order.manualCloseReason && (
                  <div className="mt-1 text-muted-foreground">
                    Manuel kapatma sebebi: {order.manualCloseReason}
                  </div>
                )}
              </div>
            )}

            {/* Kapsama: istenen − sevk − WO-rezerve − serbest depo − ham stok = net açık.
                "Depoda zaten karşılayan stok var mıydı" sorusunun cevabı. */}
            {order.status !== "CANCELLED" && order.status !== "COMPLETED" && (
              <CoveragePanel lineIds={order.lines.map((l) => l.id)} />
            )}

            {/* Bu siparişe gelen iadeler — bilgilendirici (sipariş yeniden açılmaz). */}
            {returnsSummary.data && returnsSummary.data.count > 0 && (
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Undo2 className="h-3.5 w-3.5" /> Bu siparişe gelen iadeler
                    </span>
                    <span className="font-medium tabular-nums">
                      {returnsSummary.data.count} top ·{" "}
                      {returnsSummary.data.totalQty.toLocaleString("tr-TR", { useGrouping: false })} m
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Bağlı iş emirleri — kaleme WO açıldıysa görünür; tıkta İE detayı
                açılır (sheet kapanır). Bağ yoksa kart null döner. */}
            <LinkedWorkOrdersCard lines={order.lines} onNavigate={() => onOpenChange(false)} />

            {/* Sevkiyatlar drill-down — hangi sevkiyatlarla sevk edildi/bekliyor.
                Bağ yoksa kart null döner. */}
            <OrderShipmentsCard
              orderId={order.id}
              open={open}
              onNavigate={() => onOpenChange(false)}
            />

            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Sipariş Kalemleri ({order.lines.length})
              </div>
              {woEligible && (
                <div className="mb-2 flex items-start gap-2 rounded-md border border-info/25 bg-info/10 px-3 py-2 text-xs text-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <p>
                    Aynı <span className="font-medium">kumaş · renk · en</span> kombinasyonundaki
                    kalemleri işaretle, ardından{" "}
                    <span className="font-medium">İş emri oluştur</span>. Uyumsuz kalemler
                    otomatik gri olur.
                  </p>
                </div>
              )}
              <ul className="space-y-2">
                {order.lines.map((line) => {
                  const open = lineRem(line) > 0;
                  const isSel = selectedLineIds.has(line.id);
                  const dimmed =
                    woEligible && open && anchorSig !== null && lineSig(line) !== anchorSig;
                  // Çapadan farkın nedeni (kumaş/renk/en) — overlay metninde gösterilir.
                  const reason = dimmed && anchor ? diffLabel(anchor, line) : null;
                  // Müşterideki kumaş/renk adı (1-shot override veya master alias).
                  const cust = customerNames(line);
                  return (
                    <li
                      key={line.id}
                      className={cn(
                        "relative rounded-md border p-3 transition-colors",
                        isSel && "border-primary bg-primary/5",
                        dimmed && "cursor-not-allowed select-none grayscale",
                      )}
                    >
                      {dimmed && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-muted-foreground/30 backdrop-grayscale">
                          <span className="rounded-md bg-foreground/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-background shadow-sm">
                            {reason} — seçilemez
                          </span>
                        </div>
                      )}
                      <div className="flex items-start gap-3">
                        {/* Seçim kutusu YALNIZ açık (sevk edilmemiş) kalemde çıkar.
                            Sevki tamamlanan kalemde kutu yerine bilgi rozeti gösterilir. */}
                        {woEligible && open && (
                          <Checkbox
                            checked={isSel}
                            disabled={dimmed}
                            onCheckedChange={() => toggleLine(line.id)}
                            className="mt-0.5 shrink-0"
                            aria-label="Kalemi iş emri için seç"
                            title={dimmed ? reason ?? undefined : undefined}
                          />
                        )}
                        {woEligible && !open && (
                          <Badge
                            variant="muted"
                            className="mt-0.5 shrink-0 text-[10px] text-muted-foreground"
                          >
                            Sevk edildi
                          </Badge>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{line.item?.name}</span>
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
                            {(cust.item || cust.color) && (
                              <Badge variant="outline" className="text-[10px]">
                                Müşteride:{" "}
                                {[cust.item, cust.color].filter(Boolean).join(" · ")}
                              </Badge>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span>
                              <span className="font-medium text-foreground">
                                {line.quantity.toLocaleString("tr-TR", { useGrouping: false })}
                              </span>{" "}
                              metre
                            </span>
                            {line.width != null && <span>En: {line.width} cm</span>}
                            {line.unitPrice && (
                              <span>
                                {line.unitPrice} {order.currency}
                              </span>
                            )}
                          </div>
                          {line.cutNote && (
                            <div className="mt-1.5 rounded bg-warning/10 px-2 py-1 text-xs text-foreground">
                              <span className="font-medium">Kesim notu:</span> {line.cutNote}
                            </div>
                          )}
                          {line.requiredProperties && line.requiredProperties.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1">
                              <span className="text-[10px] text-muted-foreground">
                                Özellik:
                              </span>
                              {line.requiredProperties.map((p) => (
                                <Badge key={p.propertyId} variant="muted" className="text-[10px]">
                                  {p.property.name}
                                </Badge>
                              ))}
                            </div>
                          )}
                          <OrderLineWoChips links={line.workOrderLinks} />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {(woEligible || isEditable || canClose || isCancellable) && (
              <div className="space-y-1.5 border-t pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  {woEligible && (
                    <PermissionGate permission="workorder:write">
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleCreateWo}
                        disabled={selectedCount === 0}
                        title={
                          selectedCount === 0
                            ? "Önce birleştirilecek uyumlu kalemleri seç"
                            : undefined
                        }
                        className="gap-1.5 bg-success text-success-foreground shadow-sm transition-all duration-150 hover:bg-success/85 hover:shadow-md hover:shadow-success/40 hover:-translate-y-0.5 active:translate-y-0"
                      >
                        <Factory className="h-3.5 w-3.5" />
                        İş emri oluştur{selectedCount > 0 ? ` (${selectedCount})` : ""}
                      </Button>
                    </PermissionGate>
                  )}
                  <PermissionGate permission="order:write">
                    {isEditable && onEdit && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => onEdit(order)}
                        className="gap-1.5 bg-info text-info-foreground shadow-sm transition-all duration-150 hover:bg-info/85 hover:shadow-md hover:shadow-info/40 hover:-translate-y-0.5 active:translate-y-0"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Düzenle
                      </Button>
                    )}
                    {canClose && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setCloseOpen(true)}
                        className="gap-1.5 bg-warning text-white shadow-sm transition-all duration-150 hover:bg-warning/85 hover:shadow-md hover:shadow-warning/40 hover:-translate-y-0.5 active:translate-y-0"
                      >
                        <Lock className="h-3.5 w-3.5" /> Manuel Kapat
                      </Button>
                    )}
                    {isCancellable && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setCancelOpen(true)}
                        className="ml-auto gap-1.5 bg-destructive text-destructive-foreground shadow-sm transition-all duration-150 hover:bg-destructive/85 hover:shadow-md hover:shadow-destructive/40 hover:-translate-y-0.5 active:translate-y-0"
                      >
                        <Ban className="h-3.5 w-3.5" /> İptal Et
                      </Button>
                    )}
                  </PermissionGate>
                </div>
                <PermissionGate permission="order:write">
                  {canClose && (
                    <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <p>Manuel Kapat, eksik sevkiyat olsa bile siparişi tamamlanmış işaretler.</p>
                    </div>
                  )}
                </PermissionGate>
              </div>
            )}

          </div>
        )}

        <OrderCancelDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          orderId={order?.id ?? null}
          orderNumber={order?.orderNumber}
          onCancelled={() => onOpenChange(false)}
        />

        <Dialog
          open={closeOpen}
          onOpenChange={(open) => {
            setCloseOpen(open);
            if (!open) setReason("");
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Siparişi manuel kapat</DialogTitle>
              <DialogDescription>
                Bu işlem siparişi "Tamamlandı" duruma alır ve audit log'a düşer. Sebep zorunludur.
              </DialogDescription>
            </DialogHeader>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Örn: müşteri talebi, fire kabul edildi..."
              autoFocus
            />
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setCloseOpen(false);
                  setReason("");
                }}
              >
                İptal
              </Button>
              <Button
                disabled={!reason.trim() || closeMut.isPending}
                onClick={() => {
                  if (!order) return;
                  closeMut.mutate({ id: order.id, r: reason.trim() });
                }}
              >
                {closeMut.isPending ? "Kapatılıyor..." : "Kapat"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}
