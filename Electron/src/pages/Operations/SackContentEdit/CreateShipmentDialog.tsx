import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Truck, UserRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Callout } from "@/components/ui/callout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { loadAllForPicker } from "@/lib/picker-loader";
import { customerService } from "@/pages/Customers/service";
import { customerBranchService } from "@/pages/Customers/branchService";
import { BranchSelect } from "@/pages/Customers/BranchSelect";
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
  const [orderless, setOrderless] = useState(false);
  const [orderIds, setOrderIds] = useState<Set<string>>(new Set());
  const [destination, setDestination] = useState<ShipmentDestination>("DOMESTIC");
  const [procedureCode, setProcedureCode] = useState("");
  // Kullanıcı prosedür/ihracat kodunu ELLE değiştirdiyse şube kodu artık ezmez.
  const [procedureTouched, setProcedureTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCustomerId(lockedCustomerId ?? undefined);
    setBranchId(lockedBranchId ?? null);
    setOrderless(false);
    setOrderIds(new Set());
    setDestination("DOMESTIC");
    setProcedureCode("");
    setProcedureTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sackKey]);

  const effCustomerId = lockedCustomerId ?? customerId;
  const effBranchId = lockedBranchId ?? branchId;
  const activeOrderIds = orderless ? [] : [...orderIds];

  // Seçili (picker) şubenin kodunu çözmek için — kilitli şube kodu zaten rows'ta.
  const branchesQ = useQuery({
    queryKey: ["customer-branches", effCustomerId, "select"],
    queryFn: () => customerBranchService.list(effCustomerId as string, false),
    enabled: open && !!effCustomerId && !lockedBranchId,
    staleTime: 60_000,
  });
  // Efektif şubenin kodu = "ihracat kodu" ön-değeri (müşterinin şube kodu).
  const effBranchCode = useMemo(() => {
    if (!effBranchId) return null;
    if (lockedBranchId) return rows.find((s) => s.branch?.id === lockedBranchId)?.branch?.code ?? null;
    return branchesQ.data?.data.find((b) => b.id === effBranchId)?.code ?? null;
  }, [effBranchId, lockedBranchId, rows, branchesQ.data]);

  // Şube kodu → prosedür/ihracat kodu input'una OTOMATİK gelir; kullanıcı elle
  // değiştirmediyse (procedureTouched=false) şube değişiminde güncellenir. Override serbest.
  useEffect(() => {
    if (!open || procedureTouched) return;
    setProcedureCode(effBranchCode ?? "");
  }, [open, procedureTouched, effBranchCode]);

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
        procedureCode: procedureCode.trim() || null,
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
                <Select value={customerId} onValueChange={(v) => { setCustomerId(v); setBranchId(null); setOrderIds(new Set()); setProcedureTouched(false); }}>
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
                  onChange={(v) => {
                    setBranchId(v);
                    setProcedureTouched(false); // yeni şube → ihracat kodunu tekrar öner
                  }}
                />
              )}
            </div>
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

          {/* Kapsam + prosedür kodu */}
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
            <Input
              value={procedureCode}
              onChange={(e) => {
                setProcedureCode(e.target.value);
                setProcedureTouched(true);
              }}
              placeholder="Prosedür / ihracat kodu (şubeden gelir, değiştirilebilir)"
              className="h-9 flex-1"
            />
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
