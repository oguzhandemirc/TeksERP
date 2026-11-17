// =============================================================================
// DOĞRUDAN DEVERE SİPARİŞİ seçici (D4c, K1) — iplik tedarikçiden devereciye depoya girmeden gider
// =============================================================================
// Tetik kutusu → modal liste (açık + sevkte siparişler; arama sunucuda). Kullanıcı tercihi: seçici doğrudan
// modal açar, combobox yok. Alan yalnız devere modülü açık VE `warping-order:write` varsa çizilir — yoksa fiş
// gövdesi bugünküyle bayt-aynı kalır (servis anahtarı yalnız seçiliyken yazar).
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ListFilter, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import apiClient from "@/services/apiClient";
import { useDevereEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";

export interface DirectWarpingOrderRef {
  id: string;
  orderNo: string;
  subcontractorName: string;
}
interface WarpingOrderRow {
  id: string;
  orderNo: string;
  status: "OPEN" | "IN_PROGRESS" | string;
  warpSpec: { code: string; name: string };
  subcontractor: { id: string; name: string };
  targetLengthM: string;
}
const STATUS_TR: Record<string, string> = { OPEN: "Açık", IN_PROGRESS: "Sevkte" };

/** Alan görünür mü: devere modülü açık ve kullanıcı devere sevki yazabiliyor. */
export function useDirectWarpingAvailable(): boolean {
  const devere = useDevereEnabled();
  const { hasPermission } = useRoleAccess();
  return devere && hasPermission("warping-order:write");
}

async function listDispatchableWarpingOrders(search: string): Promise<WarpingOrderRow[]> {
  const res = await apiClient.get("/api/warping-orders", {
    params: { "filter[status]": "OPEN,IN_PROGRESS", limit: 50, ...(search ? { search } : {}) },
  });
  return (res.data?.data ?? []) as WarpingOrderRow[];
}

interface Props {
  value: DirectWarpingOrderRef | null;
  onChange: (next: DirectWarpingOrderRef | null) => void;
  disabled?: boolean;
}

export function DirectWarpingOrderField({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const q = useQuery({
    queryKey: ["warping-orders", "direct-receipt-picker", search],
    queryFn: () => listDispatchableWarpingOrders(search.trim()),
    enabled: open,
    staleTime: 30_000,
  });
  const rows = q.data ?? [];
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        aria-label="Doğrudan devere siparişi seç (liste)"
        aria-haspopup="dialog"
        title="İplik tedarikçiden devereciye depoya girmeden gidiyorsa siparişi seçin — her iplik satırı aynı işlemde bu siparişe sevk edilir"
        className={cn("w-full min-w-0 justify-between font-normal", !value && "text-muted-foreground")}
        onClick={() => setOpen(true)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Truck className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">{value ? `${value.orderNo} — ${value.subcontractorName}` : "Yok — iplik depoya girer"}</span>
        </span>
        <ListFilter className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
      {value && !disabled && (
        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="Doğrudan devere bağını kaldır" title="Bağı kaldır — iplik depoya girer" onClick={() => onChange(null)}>
          <X className="h-4 w-4" />
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Doğrudan devere siparişi</DialogTitle>
            <DialogDescription>
              Tedarikçi ipliği doğrudan devereciye teslim ediyorsa siparişi seçin. Fişin iplik satırları depoya
              girer ve aynı işlemde bu siparişe sevk edilir (depo etkisi sıfır). Yalnız siparişin planındaki iplikler girilebilir.
            </DialogDescription>
          </DialogHeader>
          <Input autoFocus placeholder="Sipariş no, fasoncu ya da kart ara…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Devere siparişi ara" />
          <div className="max-h-[50vh] overflow-y-auto rounded-md border" role="listbox" aria-label="Açık devere siparişleri">
            {q.isLoading && <p className="p-3 text-sm text-muted-foreground">Yükleniyor…</p>}
            {!q.isLoading && rows.length === 0 && <p className="p-3 text-sm text-muted-foreground">Açık ya da sevkte devere siparişi yok.</p>}
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={value?.id === r.id}
                className={cn("flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted", value?.id === r.id && "bg-muted")}
                onClick={() => {
                  onChange({ id: r.id, orderNo: r.orderNo, subcontractorName: r.subcontractor.name });
                  setOpen(false);
                }}
              >
                <span className="min-w-0">
                  <span className="font-medium">{r.orderNo}</span>
                  <span className="ml-2 text-muted-foreground">{r.subcontractor.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{r.warpSpec.code} · {r.warpSpec.name} · {r.targetLengthM} m</span>
                </span>
                <span className="shrink-0 rounded bg-secondary px-2 py-0.5 text-xs">{STATUS_TR[r.status] ?? r.status}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
