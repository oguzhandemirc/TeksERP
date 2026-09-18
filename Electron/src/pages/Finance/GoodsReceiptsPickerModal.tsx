// Mal kabul fişi ÇOKLU seçici — carinin faturalanmamış aktif fişleri; satıra dokun = ekle/çıkar; "Uygula" kümeyi verir.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PICKER_MAX_PAGE_SIZE } from "@/lib/picker-loader";
import { listGoodsReceipts, type GoodsReceiptListRow } from "@/pages/Operations/GoodsReceipts/service";
import { receiptLabel } from "./invoiceReceipts";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Cari kartı — liste `filter[supplierId]` ile bu carinin fişlerine daralır. */
  supplierId: string;
  value: string[];
  onApply: (ids: string[]) => void;
}

export function GoodsReceiptsPickerModal({ open, onOpenChange, supplierId, value, onApply }: Props) {
  const [selected, setSelected] = useState<string[]>(value);
  const [term, setTerm] = useState("");
  const q = useQuery({
    queryKey: ["goods-receipts", "picker", "uninvoiced", supplierId],
    // Faturalanmamış + aktif + bu cari: süzme SUNUCUDA (filtre-liste kuralı); bağlı fişler zaten faturalı görünmez,
    // bu yüzden mevcut seçim satırları sunucu listesinde yoksa yine de "seçili" sayılır (küme korunur).
    queryFn: () => listGoodsReceipts({ page: 1, pageSize: PICKER_MAX_PAGE_SIZE, filter: { invoiced: "false", supplierId, status: "ACTIVE" } }),
    enabled: open,
  });
  const rows = useMemo(() => q.data?.data ?? [], [q.data]);
  const shown = useMemo(() => {
    const t = term.trim().toLowerCase();
    return t ? rows.filter((r) => receiptLabel(r).toLowerCase().includes(t)) : rows;
  }, [rows, term]);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Mal kabul fişleri</DialogTitle>
          <DialogDescription>Bu carinin faturalanmamış fişleri. Satıra dokun: ekle/çıkar.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Fiş ya da irsaliye no" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Fiş ara" />
        </div>
        <div className="max-h-[50vh] overflow-auto rounded-md border" role="listbox" aria-multiselectable="true">
          {q.isLoading ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Yükleniyor…</p>
          ) : q.isError ? (
            <p className="p-4 text-center text-sm text-destructive">Liste okunamadı — bu, fiş yok demek DEĞİLDİR. Kapatıp tekrar deneyin.</p>
          ) : shown.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">{rows.length === 0 ? "Bu carinin faturalanmamış fişi yok." : "Aramaya uyan fiş yok."}</p>
          ) : (
            shown.map((r) => <Row key={r.id} row={r} selected={selected.includes(r.id)} onToggle={() => toggle(r.id)} />)
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button type="button" onClick={() => { onApply(selected); onOpenChange(false); }} data-testid="fis-uygula">
            Uygula ({selected.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ row, selected, onToggle }: { row: GoodsReceiptListRow; selected: boolean; onToggle: () => void }) {
  const count = row._count.rolls > 0 ? `${row._count.rolls} top` : `${row._count.yarnMovements ?? 0} iplik satırı`;
  return (
    <button type="button" role="option" aria-selected={selected} onClick={onToggle} className={cn("flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50", selected && "bg-primary/5")}>
      <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded border", selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>
        {selected && <Check className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{receiptLabel(row)}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleDateString("tr-TR")} · {count}</span>
    </button>
  );
}
