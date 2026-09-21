import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PackagePlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { customerService } from "@/pages/Customers/service";
import { BranchSelect } from "@/pages/Customers/BranchSelect";
import {
  useCustomerBranchesEnabled,
  usePackageNoMode,
  usePackingGroupMode,
  usePackingGroupsEnabled,
  usePackingLotRequired,
} from "@/hooks/usePricingEnabled";
import { Input } from "@/components/ui/input";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";
import { isLotMode, newSackLotTarget, packageNoField, parsePackageNoInput } from "./packingLotUi";
import { CUSTOMERLESS_FILTER_VALUE, UNGROUPED_FILTER_VALUE, type EditorTarget, type OpenedSack, type PackingGroup } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Çuval açıldıktan sonra editöre geç. */
  onCreated: (target: EditorTarget) => void;
}

/**
 * Yeni çuval aç — müşteri OPSİYONEL (varsayılan müşterisiz/genel stok). Müşteri picker'ı
 * ARAMALI (ReferenceSelect — sunucu-taraflı, debounce'lı). Müşteri seçilirse şube de
 * seçilebilir. Açılınca doğrudan editöre geçilir (top okutulur). Çözülmüş ad/kod backend
 * yanıtından gelir → editör hedefi fetch'siz kurulur.
 */
export function NewSackDialog({ open, onOpenChange, onCreated }: Props) {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  // Sevk partisi (2026-09-21) — durum ve kurallar `useNewSackLot`ta.
  const lot = useNewSackLot(open, customerId, searchParams);
  const { lotMode, noField, target, noParse, noMissing } = lot;
  // İdempotency (A4) — ManualEntryDialog emsali: her açılışta taze token, deneme
  // içinde sabit → retry mükerrer boş çuval açmaz (backend replay).
  const [clientToken, setClientToken] = useState(() => crypto.randomUUID());
  const branchesEnabled = useCustomerBranchesEnabled();

  useEffect(() => {
    if (!open) {
      setCustomerId(null);
      setBranchId(null);
    } else {
      setClientToken(crypto.randomUUID()); // yeni açılış = yeni mantıksal deneme
    }
  }, [open]);

  const mut = useMutation({
    mutationFn: () =>
      sackHubService.openSack({
        customerId: target.packingGroupId ? null : customerId,
        branchId: target.packingGroupId ? null : branchId,
        clientToken,
        packingGroupId: target.packingGroupId,
        packageNo: target.packingGroupId && noField.shown ? noParse.value : null,
      }),
    onSuccess: (res) => {
      invalidateSackHub(qc);
      toast.success(res.message ?? `Çuval açıldı: ${res.data.sackNo}`);
      onOpenChange(false);
      onCreated(openedToTarget(res.data));
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !mut.isPending && onOpenChange(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="h-4 w-4" /> Yeni Çuval Aç
          </DialogTitle>
          <DialogDescription>
            Müşteri opsiyonel — boş bırakırsan çuval genel stok (müşterisiz) açılır, sevkiyat kurarken atanır.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {lotMode && <LotFields lot={lot} />}
          {/* Partide açılan çuvalın carisi PARTİDEN gelir — cari/şube alanı çizilmez. */}
          {!(lotMode && target.packingGroupId) && (
            <CustomerFields
              customerId={customerId}
              branchId={branchId}
              branchesEnabled={branchesEnabled}
              onCustomer={(v) => {
                setCustomerId(v);
                setBranchId(null);
              }}
              onBranch={setBranchId}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            İptal
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !!target.blocked || noMissing || !!noParse.error}
            className="gap-1"
          >
            <PackagePlus className="h-4 w-4" /> {mut.isPending ? "Açılıyor…" : "Çuval Aç & Doldur"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Backend `OpenedSack` → editör hedefi (çözülmüş ad/kod + parti alanları). */
function openedToTarget(d: OpenedSack): EditorTarget {
  return {
    sackId: d.id,
    sackNo: d.sackNo,
    customerId: d.customerId,
    customerName: d.customerName,
    branchId: d.branchId,
    branchName: d.branchName,
    branchCode: d.branchCode,
    isNew: true,
    packingGroupId: d.packingGroupId ?? null,
    packingGroupName: d.packingGroupName ?? null,
    packageNo: d.packageNo ?? null,
  };
}

/** Müşteri (opsiyonel) + şube (opsiyonel) alanları — partisiz çuval yolu. */
function CustomerFields({
  customerId,
  branchId,
  branchesEnabled,
  onCustomer,
  onBranch,
}: {
  customerId: string | null;
  branchId: string | null;
  branchesEnabled: boolean;
  onCustomer: (v: string | null) => void;
  onBranch: (v: string | null) => void;
}) {
  return (
    <>
      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">Müşteri (opsiyonel)</span>
        <ReferenceSelect
          value={customerId}
          onChange={onCustomer}
          service={customerService}
          queryKey="customers"
          getLabel={(c) => (c.code ? `${c.code} — ${c.name}` : c.name)}
          placeholder="Müşteri ara/seç…"
          nullable
          noneLabel="Müşterisiz (genel stok)"
        />
      </label>
      {customerId && branchesEnabled && (
        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">Şube (opsiyonel)</span>
          <BranchSelect customerId={customerId} value={branchId} onChange={onBranch} />
        </label>
      )}
    </>
  );
}

/**
 * Sevk partisi (2026-09-21) — çuval PARTİDE doğar ve ambalaj no alır. Varsayılan parti:
 * listede seçili çip (`filter[packingGroupId]`); cari partiden çözülür. Numara alanı moda
 * göre (`packageNoField`): yok / opsiyonel / zorunlu. Grup modunda hepsi etkisiz.
 */
function useNewSackLot(open: boolean, customerId: string | null, searchParams: URLSearchParams) {
  const lotMode = isLotMode(usePackingGroupsEnabled(), usePackingGroupMode());
  const lotRequired = usePackingLotRequired();
  const noField = packageNoField(usePackageNoMode());
  const selectedChip = searchParams.get("filter[packingGroupId]") ?? "";
  const [lotId, setLotId] = useState<string | null>(null);
  const [packageNoRaw, setPackageNoRaw] = useState("");
  const customerFilter = (searchParams.get("filter[customerId]") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v && v !== CUSTOMERLESS_FILTER_VALUE);
  const lotCustomerId = customerId ?? (customerFilter.length === 1 ? customerFilter[0] : null) ?? null;
  const lots = useQuery({
    queryKey: ["packing-groups", lotCustomerId, "OPEN"],
    queryFn: () => sackHubService.listPackingGroups(lotCustomerId!, "OPEN"),
    enabled: open && lotMode && !!lotCustomerId,
  });
  const openLots: PackingGroup[] = lots.data?.data ?? [];
  const target = newSackLotTarget({ lotMode, selectedLotId: lotId, lotRequired });
  const noParse = parsePackageNoInput(packageNoRaw);
  const noMissing = lotMode && !!target.packingGroupId && noField.required && noParse.value == null;
  useEffect(() => {
    if (!open) {
      setLotId(null);
      setPackageNoRaw("");
    } else {
      setLotId(selectedChip && selectedChip !== UNGROUPED_FILTER_VALUE ? selectedChip : null);
    }
    // `selectedChip` yalnız açılış anında okunur (pencere açıkken çip değişmez).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return { lotMode, lotRequired, noField, lotId, setLotId, packageNoRaw, setPackageNoRaw, openLots, target, noParse, noMissing, lotCustomerId };
}

/** Sevk partisi alanları (parti seçimi + ambalaj no). Ayrı bileşen: diyalog 80 satır altında kalsın. */
function LotFields({ lot }: { lot: ReturnType<typeof useNewSackLot> }) {
  const { lotRequired, lotCustomerId, lotId, setLotId, openLots: lots, target, noField, noParse, packageNoRaw, setPackageNoRaw } = lot;
  const blocked = target.blocked;
  const showNo = !!target.packingGroupId && noField.shown;
  const noRequired = noField.required;
  const noHint = noParse.error ?? noField.hint;
  return (
    <>
      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">Sevk partisi{lotRequired ? " (zorunlu)" : " (opsiyonel)"}</span>
        <select
          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          value={lotId ?? ""}
          disabled={!lotCustomerId}
          onChange={(e) => setLotId(e.target.value || null)}
        >
          <option value="">{lotCustomerId ? "Partisiz (havuz)" : "Önce cari seçin"}</option>
          {lots.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.sackCount} açık çuval · sıradaki no {p.nextPackageNo}
            </option>
          ))}
        </select>
        {blocked && <p className="mt-1 text-[11px] text-destructive">{blocked}</p>}
      </label>
      {showNo && (
        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">Ambalaj no{noRequired ? " (zorunlu)" : ""}</span>
          <Input
            inputMode="numeric"
            value={packageNoRaw}
            placeholder={noRequired ? "örn. 12" : "boş = sıradaki"}
            onChange={(e) => setPackageNoRaw(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">{noHint}</p>
        </label>
      )}
    </>
  );
}
