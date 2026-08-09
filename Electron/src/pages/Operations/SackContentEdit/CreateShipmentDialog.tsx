import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageSquareText, Truck, UserRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Callout } from "@/components/ui/callout";
import { ShipmentMismatchSummary } from "./ContentMismatchBanner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { loadAllForPicker } from "@/lib/picker-loader";
import { customerService } from "@/pages/Customers/service";
import { BranchSelect } from "@/pages/Customers/BranchSelect";
import { useCustomerBranchesEnabled } from "@/hooks/usePricingEnabled";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";
import { ShipmentOrderSelect } from "./ShipmentOrderSelect";
import { ShipmentPreviewPanel } from "./ShipmentPreviewPanel";
import { destinationLabels, type SackSearchRow, type ShipmentDestination } from "./types";

interface Props {
  /** Sevk edilecek DEPO çuvalları (seçim); null = kapalı. */
  sacks: SackSearchRow[] | null;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

/**
 * Seçili depo çuvallarından sevkiyat kur — müşteri/şube çöz (çuvallar bir müşteriye
 * bağlıysa kilitli, değilse seçilir) → (opsiyonel) sipariş seç → CANLI önizleme
 * (fazla/mükerrer/siparişsiz uyarıları) → yurtiçi/dışı + kod → PLANNED sevkiyat.
 */
export function CreateShipmentDialog({ sacks, onOpenChange, onCreated }: Props) {
  const qc = useQueryClient();
  const open = !!sacks && sacks.length > 0;
  const rows = useMemo(() => sacks ?? [], [sacks]);
  // Yorumlu çuvallar — sevk kurulurken operatörün görmesi gereken notlar.
  const notedRows = useMemo(() => rows.filter((s) => s.hasNote), [rows]);
  const sackIds = useMemo(() => rows.map((s) => s.id), [rows]);
  const sackKey = sackIds.join(",");

  // Çuvallardaki (null-olmayan) müşteri/şube → kilit veya çakışma.
  const distinctCustomers = useMemo(() => [...new Set(rows.filter((s) => s.customer).map((s) => s.customer!.id))], [rows]);
  const distinctBranches = useMemo(() => [...new Set(rows.filter((s) => s.branch).map((s) => s.branch!.id))], [rows]);
  const lockedCustomerId = distinctCustomers.length === 1 ? distinctCustomers[0]! : null;
  const lockedCustomerName = rows.find((s) => s.customer?.id === lockedCustomerId)?.customer?.name ?? null;
  const lockedBranchId = distinctBranches.length === 1 ? distinctBranches[0]! : null;
  const customerConflict = distinctCustomers.length > 1;
  const branchConflict = distinctBranches.length > 1;

  const [customerId, setCustomerId] = useState<string | undefined>();
  const [branchId, setBranchId] = useState<string | null>(null);
  const branchesEnabled = useCustomerBranchesEnabled();
  const [orderless, setOrderless] = useState(false);
  const [orderIds, setOrderIds] = useState<Set<string>>(new Set());
  const [destination, setDestination] = useState<ShipmentDestination>("DOMESTIC");
  // İdempotency (A4) — ManualEntryDialog emsali: açılış başına taze token, deneme
  // içinde sabit → timeout-retry kurulmuş sevkiyatı geri alır (kör 409 yerine).
  const [clientToken, setClientToken] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    setCustomerId(lockedCustomerId ?? undefined);
    setBranchId(lockedBranchId ?? null);
    setOrderless(false);
    setOrderIds(new Set());
    setDestination("DOMESTIC");
    setClientToken(crypto.randomUUID()); // yeni açılış = yeni mantıksal deneme
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sackKey]);

  const effCustomerId = lockedCustomerId ?? customerId;
  const effBranchId = lockedBranchId ?? branchId;
  const activeOrderIds = orderless ? [] : [...orderIds];

  const customersQ = useQuery({
    queryKey: ["customers", "picker"],
    queryFn: () => loadAllForPicker(customerService),
    staleTime: 60_000,
    enabled: open && !lockedCustomerId,
  });
  const customers = (customersQ.data?.data ?? []) as Array<{ id: string; name?: string; code?: string }>;

  const previewQ = useQuery({
    queryKey: ["shipment-preview", sackKey, effCustomerId ?? null, effBranchId ?? null, orderless ? "none" : activeOrderIds.slice().sort().join(",")],
    queryFn: () =>
      sackHubService.previewShipment({ sackIds, customerId: effCustomerId ?? null, branchId: effBranchId ?? null, orderIds: activeOrderIds }),
    enabled: open,
    staleTime: 3_000,
  });

  const unweighed = rows.filter((s) => s.weightKg == null).length;

  const createMut = useMutation({
    mutationFn: () =>
      sackHubService.createShipment({
        sackIds,
        customerId: effCustomerId!,
        branchId: effBranchId ?? null,
        orderIds: activeOrderIds,
        destination,
        clientToken,
      }),
    onSuccess: (res) => {
      // Sevk onayı KAPALIYKEN (varsayılan) backend oluşturur oluşturmaz sevk eder
      // (dispatched=true, stok düştü); AÇIKKEN yalnız PLANNED kurulur.
      toast.success(
        res.data.dispatched
          ? `Sevk edildi: ${res.data.shipmentNo}`
          : `Sevkiyat kuruldu — onay bekliyor: ${res.data.shipmentNo}`,
      );
      invalidateSackHub(qc, { shipment: true });
      onOpenChange(false);
      onCreated();
    },
  });

  const blocked = customerConflict || branchConflict;
  const canCreate = !!effCustomerId && !blocked && !createMut.isPending;

  const toggleOrder = (id: string) =>
    setOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !createMut.isPending && onOpenChange(false)}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" /> Sevkiyat Kur — {rows.length} çuval
          </DialogTitle>
          <DialogDescription>
            Sevk onayı kapalıysa (varsayılan) çuvallar <strong>doğrudan sevk edilir</strong> ve stok anında düşer; açıksa yalnız planlı (PLANNED) sevkiyat kurulur. Seçili siparişlerin açık satırlarına dağıtılır; kalan mal siparişe sayılmaz.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-1">
          {blocked && (
            <Callout tone="danger" title="Seçim düzeltilmeli">
              {customerConflict
                ? "Seçili çuvallar farklı müşterilere ait — bir sevkiyat tek müşteriye kurulur."
                : "Seçili çuvallar farklı şubelere ait — bir sevkiyat tek şubeye kurulur."}
            </Callout>
          )}

          {/* Yorumlu çuval uyarısı — sevk kurmadan ÖNCE görülmesi en değerli yer
              ("bu çuvalı sevke koymayın" gibi notlar). Not sevki ENGELLEMEZ. */}
          {notedRows.length > 0 && (
            <Callout tone="warning" icon={MessageSquareText} title={`${notedRows.length} çuvalda not var`}>
              <ul className="mt-1 space-y-0.5 text-xs">
                {notedRows.map((s) => (
                  <li key={s.id}>
                    <span className="font-mono">{s.sackNo}</span>
                    <span className="text-muted-foreground"> — {s.notePreview}</span>
                  </li>
                ))}
              </ul>
            </Callout>
          )}

          {/* İçerik uyuşmazlığı — sevk kurmadan ÖNCEKİ SON kapı (2026-08-09).
              Notlarla aynı gerekçe: burada görülmesi en değerli, çünkü mal henüz
              araca yüklenmedi. ⚠️ Sevki ENGELLEMEZ — kural gereği uyarıdır. */}
          <ShipmentMismatchSummary sackIds={sackIds} />

          {/* Müşteri / şube */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Müşteri</span>
              {lockedCustomerId ? (
                <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm">
                  <UserRound className="h-4 w-4 text-primary" />
                  <span className="truncate font-medium">{lockedCustomerName}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">çuvaldan</span>
                </div>
              ) : (
                <Select value={customerId} onValueChange={(v) => { setCustomerId(v); setBranchId(null); setOrderIds(new Set()); }}>
                  <SelectTrigger className={!customerId ? "border-primary ring-2 ring-primary/30" : undefined}>
                    <SelectValue placeholder="Hedef müşteri seç…" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name ?? c.code ?? c.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {(branchesEnabled || lockedBranchId) && (
            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Şube</span>
              {lockedBranchId ? (
                <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">
                  {(() => {
                    const b = rows.find((s) => s.branch?.id === lockedBranchId)?.branch;
                    return b ? (b.code ? `${b.name} (${b.code})` : b.name) : "Şube (çuvaldan)";
                  })()}
                </div>
              ) : (
                <BranchSelect
                  customerId={effCustomerId ?? null}
                  value={branchId}
                  onChange={(v) => setBranchId(v)}
                />
              )}
            </div>
            )}
          </div>

          {/* Sipariş seçimi */}
          <div className="rounded-md border p-3">
            <label className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={orderless} onCheckedChange={(v) => setOrderless(!!v)} />
              Siparişsiz devam et (mal hiçbir siparişe sayılmaz)
            </label>
            {!orderless &&
              (effCustomerId ? (
                <ShipmentOrderSelect customerId={effCustomerId} branchId={effBranchId ?? null} selectedIds={orderIds} onToggle={toggleOrder} />
              ) : (
                <p className="py-2 text-center text-xs text-muted-foreground">Sipariş seçmek için önce müşteri seçin.</p>
              ))}
          </div>

          {/* Canlı önizleme + uyarılar */}
          <ShipmentPreviewPanel preview={previewQ.data?.data} isLoading={previewQ.isLoading} />

          {/* Kapsam (yurtiçi / yurtdışı) — ihracat/prosedür kodu artık belgede
              otomatik çözülür (şube kodu ?? müşteri ihracat kodu), elle girilmez. */}
          <div className="flex flex-wrap items-center gap-2">
            <Select value={destination} onValueChange={(v) => setDestination(v as ShipmentDestination)}>
              <SelectTrigger className="h-9 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DOMESTIC">{destinationLabels.DOMESTIC}</SelectItem>
                <SelectItem value="EXPORT">{destinationLabels.EXPORT}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {destination === "EXPORT" && unweighed > 0 && (
            <Callout tone="danger" title="Tartısız çuval var">
              {unweighed} çuval tartılmadı — yurtdışı sevkte tüm çuvallar tartılı olmalı, aksi halde backend reddeder.
            </Callout>
          )}
        </div>

        <DialogFooter className="border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createMut.isPending}>
            Vazgeç
          </Button>
          <Button
            onClick={() => createMut.mutate()}
            disabled={!canCreate}
            className="gap-2 bg-primary font-semibold shadow-md shadow-primary/30"
          >
            <Truck className="h-4 w-4" /> {createMut.isPending ? "İşleniyor…" : "Sevk Et"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
