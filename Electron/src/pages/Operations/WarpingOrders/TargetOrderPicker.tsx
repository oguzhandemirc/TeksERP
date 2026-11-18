// Aktarma HEDEF siparişi seçici — tetik doğrudan modal açar (combobox yok). Liste sunucuda süzülür: aynı devereci,
// Açık/Sevkte durum, arama `search`; kaynağın kendisi listeden düşer (sunucu da 400 ile reddeder).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ListFilter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fmtFactoryDate } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import apiClient from "@/services/apiClient";
import { WARPING_ORDERS_QUERY_KEY } from "./service";
import { warpingStatusMeta, type WarpingOrderRow } from "./types";

export interface TargetOrderRef {
  id: string;
  orderNo: string;
}

async function listTargets(subcontractorId: string, search: string): Promise<WarpingOrderRow[]> {
  const res = await apiClient.get("/api/warping-orders", {
    params: { "filter[status]": "OPEN,IN_PROGRESS", "filter[subcontractorId]": subcontractorId, limit: 50, ...(search ? { search } : {}) },
  });
  return (res.data?.data ?? []) as WarpingOrderRow[];
}

function TargetRow({ o, selected, onPick }: { o: WarpingOrderRow; selected: boolean; onPick: () => void }) {
  const meta = warpingStatusMeta(o.status);
  return (
    <button type="button" role="option" aria-selected={selected} onClick={onPick}
      className={cn("flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted", selected && "bg-muted")}>
      <span className="min-w-0">
        <span className="font-medium">{o.orderNo}</span>
        <span className="block truncate text-xs text-muted-foreground">{o.warpSpec.code} — {o.warpSpec.name}{o.expectedReturnAt ? ` · termin ${fmtFactoryDate(o.expectedReturnAt)}` : ""}</span>
      </span>
      <Badge className={cn("shrink-0 font-normal", meta.badgeClass)}>{meta.label}</Badge>
    </button>
  );
}

interface Props {
  sourceId: string;
  subcontractorId: string;
  value: TargetOrderRef | null;
  onChange: (v: TargetOrderRef) => void;
}

export function TargetOrderPicker({ sourceId, subcontractorId, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "transfer-targets", subcontractorId, search.trim()], queryFn: () => listTargets(subcontractorId, search.trim()), enabled: open, staleTime: 15_000 });
  const rows = (q.data ?? []).filter((o) => o.id !== sourceId);
  return (
    <>
      <Button type="button" variant="outline" aria-label="Hedef sipariş seç" aria-haspopup="dialog" className={cn("w-full justify-between font-normal", !value && "text-muted-foreground")} onClick={() => setOpen(true)}>
        <span className="truncate">{value ? value.orderNo : "Hedef sipariş seç"}</span>
        <ListFilter className="ml-1 h-4 w-4 shrink-0 opacity-50" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Hedef sipariş</DialogTitle>
            <DialogDescription>Aynı deverecinin açık ya da sevkte siparişleri. İplik hedef siparişin planında olmalı.</DialogDescription>
          </DialogHeader>
          <Input placeholder="Sipariş ara" title="Sipariş no ya da çözgü kartı ara" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Hedef sipariş ara" />
          <div className="max-h-[50vh] overflow-y-auto rounded-md border" role="listbox" aria-label="Hedef siparişler">
            {q.isLoading && <p className="p-3 text-sm text-muted-foreground">Yükleniyor…</p>}
            {q.isSuccess && rows.length === 0 && <p className="p-3 text-sm text-muted-foreground">Bu devereciye açık başka sipariş yok — önce hedef siparişi açın.</p>}
            {rows.map((o) => <TargetRow key={o.id} o={o} selected={value?.id === o.id} onPick={() => { onChange({ id: o.id, orderNo: o.orderNo }); setOpen(false); }} />)}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
