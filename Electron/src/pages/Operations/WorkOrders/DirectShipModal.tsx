import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Truck, AlertTriangle, UserRound, Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { customerService } from "@/pages/Customers/service";
import { BranchSelect } from "@/pages/Customers/BranchSelect";
import {
  useCustomerBranchesEnabled,
  useShippingOrderRequirement,
} from "@/hooks/usePricingEnabled";
import type { Customer } from "@/pages/Customers/types";
import { workOrderService } from "./service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string;
  dispatchId: string;
  dispatchNo: string;
}

/**
 * Fasondan Doğrudan Sevk — fasondaki topların TÜMÜ veya BİR KISMI doğrudan müşteriye
 * sevk edilir (seçilmeyenler fasonda kalır, normal kabulle döner). Operatör ayrıca
 * "iş emrini tamamla" derse kalan adımlar atlanır + WO kapanır; demezse WO açık kalır
 * (kalan üretim devam). İstenirse hangi sipariş(ler)e gittiği karşılanmaya işlenir.
 */
export function DirectShipModal({ open, onOpenChange, workOrderId, dispatchId, dispatchNo }: Props) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [completeWO, setCompleteWO] = useState(false);
  // orderLineId → karşılanan metraj (yalnız seçili satırlar).
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  // Mal kime gitti — ZORUNLU (DirectShipment + irsaliye muhatabı).
  const [customerId, setCustomerId] = useState<string | null>(null);
  // Teslim şubesi — müşteriye bağlı, opsiyonel (siparişsiz sevkte de sorulur).
  const [branchId, setBranchId] = useState<string | null>(null);
  const branchesEnabled = useCustomerBranchesEnabled();
  // rollId → sevk edilecek metre (varsayılan = topun tam metresi; azsa top bölünür).
  const [rollQtys, setRollQtys] = useState<Record<string, number>>({});
  // Karşılanma metrajı elle düzenlenebilir (input açık) olan sipariş satırları —
  // varsayılan OTOMATİK; pencil'e basınca override input'u açılır.
  const [allocOpen, setAllocOpen] = useState<Set<string>>(new Set());
  // "Bu mal bilerek siparişsiz gidiyor" beyanı — `block` rejiminin TEK kaçış
  // yolu. Fason doğrudan sevk çoğu zaman son duraktır (numune / kalan mal);
  // kaçış olmasaydı `block` bu akışı tamamen kilitlerdi.
  const [orderless, setOrderless] = useState(false);
  const orderRequirement = useShippingOrderRequirement();

  const previewQ = useQuery({
    queryKey: ["direct-ship-preview", dispatchId],
    queryFn: () => workOrderService.getDirectShipPreview(dispatchId),
    enabled: open && Boolean(dispatchId),
    staleTime: 0,
  });
  const preview = previewQ.data?.data;

  // Açılışta/önizleme yüklenince: tüm toplar seçili (default), diğer alanlar temiz.
  useEffect(() => {
    if (open) {
      setReason("");
      setAlloc({});
      setAllocOpen(new Set());
      setCompleteWO(false);
      setCustomerId(null);
      setBranchId(null);
    }
  }, [open, dispatchId]);
  useEffect(() => {
    if (preview?.affectedRolls) {
      setSelected(new Set(preview.affectedRolls.map((r) => r.id)));
      setRollQtys(
        Object.fromEntries(preview.affectedRolls.map((r) => [r.id, Number(r.currentQty)])),
      );
    }
  }, [preview?.affectedRolls]);

  const mut = useMutation({
    mutationFn: () =>
      workOrderService.directShip(dispatchId, {
        reason: reason.trim(),
        rollIds: [...selected],
        rollShipQtys: Object.fromEntries([...selected].map((id) => [id, rollQtys[id] ?? 0])),
        customerId: customerId ?? undefined,
        branchId: branchId ?? undefined,
        completeWorkOrder: completeWO,
        orderLineAllocations: Object.entries(alloc)
          .filter(([, qty]) => qty > 0)
          .map(([orderLineId, qty]) => ({ orderLineId, qty })),
        orderless,
      }),
    onSuccess: (res) => {
      toast.success(`Fasondan sevk edildi: ${res.data?.dispatchNo ?? dispatchNo}`);
      void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work-order-branches", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      // Direkt sevk İE'yi tamamlayabilir + shippedQty değiştirir → sipariş
      // listesi ("İş Emri" rozeti + Sevk kolonu) tazelensin.
      void qc.invalidateQueries({ queryKey: ["orders"] });
      onOpenChange(false);
    },
  });

  const allocTotal = useMemo(
    () => Object.values(alloc).reduce((s, q) => s + (q > 0 ? q : 0), 0),
    [alloc],
  );
  // Toplam FİZİKSEL sevk metresi (seçili topların sevk metrajları) — karşılanma
  // bunun üstüne çıkamaz; artан kısım "stok" (siparişsiz) sayılır.
  const shippedTotal = useMemo(
    () => [...selected].reduce((s, id) => s + (rollQtys[id] ?? 0), 0),
    [selected, rollQtys],
  );
  const unallocated = shippedTotal - allocTotal;
  const total = preview?.affectedRolls.length ?? 0;
  const selectedCount = selected.size;
  const allSelected = total > 0 && selectedCount === total;
  const canSubmit =
    !!preview &&
    !preview.cancelled &&
    !preview.alreadyDirectShipped &&
    selectedCount > 0 &&
    Boolean(customerId) &&
    reason.trim().length >= 3 &&
    allocTotal <= shippedTotal && // siparişlere işlenen, fiziksel sevkten fazla olamaz
    // `block` rejimi: sipariş bağı YOK ve niyet BEYAN edilmedi → sunucu 400
    // verir. Kullanıcıyı 400'e kadar götürmek yerine kapıyı burada tut
    // (`CreateShipmentDialog` deseninin birebir ikizi).
    !(orderRequirement === "block" && allocTotal <= 0 && !orderless) &&
    !mut.isPending;

  const toggleRoll = (id: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  // Sipariş işaretlenince karşılanma OTOMATİK dolar: sevk edilen metreden kalan
  // kapasite kadar (FIFO, satırın kalanına kadar). İşareti kalkınca temizlenir.
  const toggleLine = (id: string, remaining: number, checked: boolean) => {
    setAlloc((prev) => {
      const next = { ...prev };
      if (checked) {
        const others = Object.entries(next).reduce(
          (s, [k, v]) => (k === id ? s : s + (v > 0 ? v : 0)),
          0,
        );
        next[id] = Math.max(0, Math.min(remaining, shippedTotal - others));
      } else {
        delete next[id];
      }
      return next;
    });
    if (!checked)
      setAllocOpen((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
  };
  // Otomatik metrajı elle düzeltmek için input'u aç (pencil).
  const openOverride = (id: string) => setAllocOpen((prev) => new Set(prev).add(id));

  // Siparişler seçilen MÜŞTERİ (+ varsa ŞUBE) ile daraltılır — bir sipariş zaten
  // bir müşteri/şubeye aittir. Şube boşsa o müşterinin tüm şubeleri listelenir.
  const customerOrderLines = useMemo(
    () =>
      customerId
        ? (preview?.candidateOrderLines ?? []).filter(
            (l) => l.customerId === customerId && (!branchId || l.branchId === branchId),
          )
        : [],
    [customerId, branchId, preview?.candidateOrderLines],
  );

  // Daraltma değişince eşleşmeyen karşılanmaları at (ortak yardımcı).
  const pruneAllocTo = (custId: string | null, brId: string | null) =>
    setAlloc((prev) => {
      const validIds = new Set(
        (preview?.candidateOrderLines ?? [])
          .filter((l) => l.customerId === custId && (!brId || l.branchId === brId))
          .map((l) => l.orderLineId),
      );
      const next: Record<string, number> = {};
      for (const [k, v] of Object.entries(prev)) if (validIds.has(k)) next[k] = v;
      return next;
    });

  // Müşteri değişince: şubeyi sıfırla + artık o müşteriye ait olmayan karşılanmaları at.
  const handleCustomerChange = (id: string | null) => {
    setCustomerId(id);
    setBranchId(null);
    pruneAllocTo(id, null);
  };
  // Şube değişince: yalnız o şubenin (veya boşsa müşterinin tüm) satırlarını tut.
  const handleBranchChange = (id: string | null) => {
    setBranchId(id);
    pruneAllocTo(customerId, id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" />
            Fasondan Sevk
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono">{dispatchNo}</span> — seçilen toplar fasondan müşteriye sevk
            edilir; seçilmeyenler fasonda kalır (normal kabulle döner). Bu işlem geri alınamaz.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {previewQ.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : previewQ.isError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
              <div className="font-medium text-destructive">
                Önizleme yüklenemedi — görmeden onaylanamaz.
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => void previewQ.refetch()}
              >
                Yeniden Dene
              </Button>
            </div>
          ) : preview ? (
            preview.cancelled || preview.alreadyDirectShipped ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {preview.cancelled
                  ? "Bu sevk iptal edilmiş — fasondan sevk edilemez."
                  : "Bu sevk zaten fasondan sevk edilmiş."}
              </div>
            ) : (
              <>
                {/* Müşteri + Şube — mal KİME / nereye gitti (irsaliye muhatabı).
                    Müşteri önce seçilir; siparişler bu müşteriye göre daraltılır. */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium">
                      Müşteri <span className="text-destructive">*</span>
                    </label>
                    <EntityPickerModal<Customer>
                      value={customerId}
                      onChange={handleCustomerChange}
                      service={customerService}
                      queryKey="direct-ship-customer"
                      getLabel={(c) => c.name}
                      getSubLabel={(c) => c.code}
                      icon={UserRound}
                      iconClassName="text-primary"
                      title="Müşteri Seç"
                      description="Mal kime sevk edildi — irsaliye ve sevkiyat kaydı için zorunlu."
                      placeholder="Müşteri seç..."
                    />
                  </div>
                  {branchesEnabled && (
                    <div>
                      <label className="mb-1 block text-xs font-medium">Şube</label>
                      <BranchSelect
                        customerId={customerId}
                        value={branchId}
                        onChange={handleBranchChange}
                        showCity={false}
                      />
                    </div>
                  )}
                </div>

                {/* Sevk edilecek toplar — per-roll seçim */}
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Sevk edilecek toplar ({selectedCount}/{total})
                    </span>
                    <button
                      type="button"
                      className="text-[11px] font-medium text-primary hover:underline"
                      onClick={() =>
                        setSelected(
                          allSelected ? new Set() : new Set(preview.affectedRolls.map((r) => r.id)),
                        )
                      }
                    >
                      {allSelected ? "Hiçbirini" : "Tümünü seç"}
                    </button>
                  </div>
                  <ul data-testid="ship-rolls" className="max-h-36 space-y-1 overflow-y-auto rounded-md border p-2">
                    {preview.affectedRolls.map((r) => {
                      const on = selected.has(r.id);
                      return (
                        <li
                          key={r.id}
                          className={cn(
                            "flex items-center gap-2 rounded px-1 py-0.5 text-xs",
                            !on && "opacity-50",
                          )}
                        >
                          <Checkbox checked={on} onCheckedChange={(v) => toggleRoll(r.id, Boolean(v))} />
                          <span className="flex min-w-0 flex-1 items-center gap-1.5">
                            <span className="font-mono">{r.barcode ?? "açık kumaş"}</span>
                            <span className="truncate text-muted-foreground">{r.itemName}</span>
                            {r.colorName && (
                              <Badge variant="muted" className="text-[10px]">
                                {r.colorName}
                              </Badge>
                            )}
                          </span>
                          {on ? (
                            <span className="flex shrink-0 items-center gap-1">
                              <input
                                type="number"
                                min={1}
                                max={Number(r.currentQty)}
                                step={1}
                                value={rollQtys[r.id] ?? ""}
                                onChange={(e) => {
                                  const v = Math.max(
                                    0,
                                    Math.min(Number(r.currentQty), Number(e.target.value) || 0),
                                  );
                                  setRollQtys((p) => ({ ...p, [r.id]: v }));
                                }}
                                className="w-14 rounded border bg-background px-1.5 py-0.5 text-right text-xs tabular-nums outline-none focus:ring-2 focus:ring-ring"
                                title="Sevk metresi — topun tam metresinden azsa top bölünür"
                              />
                              <span className="text-[10px] text-muted-foreground">
                                /{formatNumber(r.currentQty, 0)}m
                              </span>
                            </span>
                          ) : (
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {formatNumber(r.currentQty, 0)} m
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {selectedCount < total && (
                    <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-warning">
                      <AlertTriangle className="h-3 w-3" />
                      {total - selectedCount} top fasonda kalacak (kabulle döner)
                    </div>
                  )}
                </div>

                {/* İş emrini tamamla toggle */}
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm transition-colors",
                    completeWO
                      ? "border-success/50 bg-success/5"
                      : "border-border hover:bg-muted/40",
                  )}
                >
                  <Checkbox
                    checked={completeWO}
                    onCheckedChange={(v) => setCompleteWO(Boolean(v))}
                    aria-label="İş emrini tamamla"
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="font-medium">Bu iş emrini tamamla</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {completeWO ? (
                        <span className="inline-flex items-center gap-1 text-warning">
                          <AlertTriangle className="h-3 w-3" />
                          {preview.downstreamStepsToSkip.length > 0
                            ? `${preview.downstreamStepsToSkip.length} sonraki adım atlanacak (${preview.downstreamStepsToSkip.map((s) => s.stationName).join(", ")}) ve WO KAPANACAK.`
                            : "Adım tamamlanacak ve WO KAPANACAK."}
                        </span>
                      ) : (
                        "Kapalı: yalnız seçilen toplar sevk edilir, iş emri AÇIK kalır (kalan üretim devam eder)."
                      )}
                    </span>
                  </span>
                </label>

                {/* Sebep */}
                <div>
                  <label className="mb-1 block text-xs font-medium" htmlFor="ds-reason">
                    Sebep <span className="text-destructive">*</span>
                  </label>
                  <textarea
                    id="ds-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder="Örn. Boyahane malı doğrudan müşteriye sevk etti"
                    className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                {/* Hangi siparişe gitti — SEÇİLEN müşterinin açık satırları (opsiyonel).
                    Müşteri seçilmeden pasif; her satır şubesiyle listelenir. */}
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Hangi siparişe gitti? (opsiyonel — sevk edilen metre otomatik işlenir)
                  </div>
                  {/* `block` rejiminde bu kutu bir tercih değil TEK KAÇIŞ
                      YOLUDUR — sunucu siparişsiz doğrudan sevki 400 ile
                      reddeder. Diğer rejimlerde çizilmez (gürültü olurdu). */}
                  {orderRequirement === "block" && (
                    <>
                      <label className="mb-2 flex items-center gap-2 text-xs font-medium">
                        <Checkbox
                          data-testid="ds-orderless"
                          checked={orderless}
                          onCheckedChange={(v) => setOrderless(!!v)}
                        />
                        Siparişsiz devam et (mal hiçbir siparişe sayılmaz)
                      </label>
                      {!orderless && allocTotal <= 0 && (
                        <p className="mb-2 text-xs text-amber-600 dark:text-amber-500">
                          Bu kurulumda sevkiyat siparişe bağlanmalı — aşağıdan sipariş
                          seçin ya da yukarıdaki kutuyu işaretleyip siparişsiz sevk
                          niyetini beyan edin.
                        </p>
                      )}
                    </>
                  )}
                  {!customerId ? (
                    <div className="rounded-md border border-dashed p-2 text-center text-xs italic text-muted-foreground">
                      Önce müşteri seçin — siparişler o müşteriye göre listelenir.
                    </div>
                  ) : customerOrderLines.length === 0 ? (
                    <div className="rounded-md border border-dashed p-2 text-center text-xs italic text-muted-foreground">
                      Bu müşterinin{branchId ? " / şubenin" : ""} eşleşen açık sipariş satırı yok.
                      Boş bırakılırsa karşılanmaya dokunulmaz.
                    </div>
                  ) : (
                    <ul
                      data-testid="ship-orders"
                      className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2"
                    >
                      {customerOrderLines.map((l) => {
                        const checked = l.orderLineId in alloc;
                        const isOpen = allocOpen.has(l.orderLineId);
                        return (
                          <li key={l.orderLineId} className="flex items-center gap-2 text-xs">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) =>
                                toggleLine(l.orderLineId, l.remaining, Boolean(v))
                              }
                            />
                            <span className="flex min-w-0 flex-1 items-center gap-1.5">
                              <span className="font-mono">{l.orderNumber}</span>
                              {l.branchName && (
                                <Badge variant="muted" className="text-[10px]">
                                  {l.branchName}
                                </Badge>
                              )}
                              {l.isWorkOrderLinked && (
                                <Badge variant="outline" className="text-[10px]">
                                  WO
                                </Badge>
                              )}
                              <span className="truncate text-muted-foreground">
                                {l.itemName}
                                {l.colorName ? ` · ${l.colorName}` : ""}
                              </span>
                            </span>
                            <span className="shrink-0 text-muted-foreground">
                              kalan {formatNumber(l.remaining, 0)} m
                            </span>
                            {/* Karşılanma: varsayılan OTOMATİK (salt-okunur) → pencil'e
                                basınca elle düzeltme input'u açılır. */}
                            {!checked ? (
                              <span className="w-[72px] shrink-0" />
                            ) : isOpen ? (
                              <input
                                type="number"
                                min={0}
                                max={l.remaining}
                                step={1}
                                autoFocus
                                value={alloc[l.orderLineId]}
                                onChange={(e) =>
                                  setAlloc((prev) => ({
                                    ...prev,
                                    [l.orderLineId]: Math.max(
                                      0,
                                      Math.min(l.remaining, Number(e.target.value) || 0),
                                    ),
                                  }))
                                }
                                className="w-[72px] shrink-0 rounded-md border bg-background px-2 py-1 text-right text-xs tabular-nums outline-none focus:ring-2 focus:ring-ring"
                                title="Karşılanan metre (elle düzeltme)"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => openOverride(l.orderLineId)}
                                className="flex w-[72px] shrink-0 items-center justify-end gap-1 rounded-md px-1 py-1 text-muted-foreground hover:bg-muted/60"
                                title="Otomatik metrajı elle düzelt"
                              >
                                <span className="tabular-nums">
                                  {formatNumber(alloc[l.orderLineId] ?? 0, 0)} m
                                </span>
                                <Pencil className="h-3 w-3 opacity-60" />
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {/* Özet — fiziksel sevk vs siparişlere işlenen vs stok (siparişsiz). */}
                  {allocTotal > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
                      <span className="text-muted-foreground">
                        Sevk edilen: <b className="text-foreground">{formatNumber(shippedTotal, 0)} m</b>
                      </span>
                      <span className="text-muted-foreground">
                        İşlenen: <b className="text-foreground">{formatNumber(allocTotal, 0)} m</b>
                      </span>
                      {unallocated < 0 ? (
                        <span className="inline-flex items-center gap-1 font-medium text-destructive">
                          <AlertTriangle className="h-3 w-3" />
                          {formatNumber(-unallocated, 0)} m fazla işlendi
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          İşlenmeyen (stok):{" "}
                          <b className="text-foreground">{formatNumber(unallocated, 0)} m</b>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </>
            )
          ) : null}
        </div>

        <DialogFooter className="shrink-0 border-t bg-background px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            disabled={!canSubmit}
            className={cn(completeWO && "bg-success text-white hover:bg-success/90")}
            onClick={() => mut.mutate()}
          >
            {mut.isPending
              ? "Sevk ediliyor..."
              : completeWO
                ? `Sevk Et + WO'yu Tamamla (${selectedCount})`
                : `Fasondan Sevk Et (${selectedCount})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
