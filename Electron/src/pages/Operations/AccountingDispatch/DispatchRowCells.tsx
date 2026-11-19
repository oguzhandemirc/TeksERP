import { FilePlus2, FileText, MoreHorizontal, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { safeFormat } from "@/lib/format";
import type { DispatchMenuKey, DispatchRowView } from "./dispatchRowActions";
import type { DispatchListItem } from "./types";

/** Satır eylemlerinin sayfa tarafı — her biri mevcut bir diyaloğu açar. */
export interface DispatchRowHandlers {
  /** Sevk irsaliyesi (ShipmentDocDialog). */
  onBelge: (row: DispatchListItem) => void;
  /** Dış fatura izi formu (InvoiceDialog, `shipping:invoice`). */
  onTrace: (row: DispatchListItem) => void;
  /** İç fatura taslağı (ShipmentInvoiceDraft, `finance:write`). */
  onDraft: (row: DispatchListItem) => void;
  /** İç fatura detayı (InvoiceDetailDialog). */
  onOpenInvoice: (invoiceId: string) => void;
  /** İç faturanın donmuş belgesi (PrintedDocDialog INVOICE_INTERNAL). */
  onPrintInvoice: (doc: { invoiceId: string; docNo: string }) => void;
  view: (row: DispatchListItem) => DispatchRowView;
}

const stop = (fn: () => void) => (e: React.MouseEvent) => {
  e.stopPropagation();
  fn();
};

/** Fatura sütunu — yalnız BİLGİ (no · tarih, tıklanınca fatura açılır) ya da faturasızda "Fatura kes". */
export function InvoiceInfoCell({ row, h }: { row: DispatchListItem; h: DispatchRowHandlers }) {
  const v = h.view(row);
  if (!v.info) {
    if (!v.create) return <span className="text-xs text-muted-foreground">—</span>;
    const draft = v.create === "draft";
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-6 gap-1 px-2 text-[11px]"
        title={draft ? "Bu sevkiyattan iç satış faturası taslağı oluştur" : "Dış muhasebe programında kesilen faturanın no/tarihini gir"}
        onClick={stop(() => (draft ? h.onDraft(row) : h.onTrace(row)))}
      >
        {draft ? <FilePlus2 className="h-3.5 w-3.5" /> : <Receipt className="h-3.5 w-3.5" />}
        Fatura kes
      </Button>
    );
  }
  const text = (
    <>
      <span className="font-mono">{v.info.no}</span>
      {v.info.date && <span className="text-muted-foreground"> · {safeFormat(v.info.date, "dd.MM.yyyy")}</span>}
      {v.info.draft && <span className="ml-1 text-[10px] font-medium text-amber-600">taslak</span>}
    </>
  );
  const open = v.infoOpen;
  if (!open) return <span className="whitespace-nowrap text-xs">{text}</span>;
  return (
    <button
      type="button"
      className="whitespace-nowrap rounded-sm text-xs text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={open.kind === "detail" ? "Faturayı aç" : "Fatura bilgisini düzenle"}
      onClick={stop(() => (open.kind === "detail" ? h.onOpenInvoice(open.invoiceId) : h.onTrace(row)))}
    >
      {text}
    </button>
  );
}

/** Belgeler sütunu — eşit iki düğme (İrsaliye · Fatura) + satır sonu ⋯ menüsü. */
export function DocumentsCell({ row, h }: { row: DispatchListItem; h: DispatchRowHandlers }) {
  const v = h.view(row);
  const doc = v.doc;
  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        className="h-7 w-[5.5rem] gap-1 px-2 text-xs"
        title="Sevk irsaliyesi — yazdır, indir (PDF/Excel), sürüm geçmişi, baskı seçenekleri"
        onClick={stop(() => h.onBelge(row))}
      >
        <FileText className="h-3.5 w-3.5" /> İrsaliye
      </Button>
      {/* Devre dışı düğme fare olayı almaz → ipucu sarmalayıcıda. */}
      <span title={doc ? `Fatura belgesi — ${doc.docNo}` : (v.docReason ?? undefined)} className="inline-flex">
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-[5.5rem] gap-1 px-2 text-xs"
          disabled={!doc}
          aria-label={doc ? "Fatura belgesi" : `Fatura belgesi — ${v.docReason ?? ""}`}
          onClick={stop(() => doc && h.onPrintInvoice(doc))}
        >
          <Receipt className="h-3.5 w-3.5" /> Fatura
        </Button>
      </span>
      <RowMenu row={row} v={v} h={h} />
    </div>
  );
}

function RowMenu({ row, v, h }: { row: DispatchListItem; v: DispatchRowView; h: DispatchRowHandlers }) {
  const run: Record<DispatchMenuKey, () => void> = {
    openInvoice: () => v.infoOpen?.kind === "detail" && h.onOpenInvoice(v.infoOpen.invoiceId),
    editTrace: () => h.onTrace(row),
    markTrace: () => h.onTrace(row),
    draft: () => h.onDraft(row),
    irsaliye: () => h.onBelge(row),
  };
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          aria-label={`${row.shipmentNo} — diğer işlemler`}
          title="Diğer işlemler"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[13rem]" onClick={(e) => e.stopPropagation()}>
        {v.menu.map((m, i) => (
          <MenuEntry key={m.key} m={m} sep={m.key === "irsaliye" && i > 0} onSelect={run[m.key]} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuEntry({ m, sep, onSelect }: { m: DispatchRowView["menu"][number]; sep: boolean; onSelect: () => void }) {
  return (
    <>
      {sep && <DropdownMenuSeparator />}
      <DropdownMenuItem onSelect={onSelect} title={m.note}>
        {m.label}
        {m.note && <span className="ml-auto text-amber-600 dark:text-amber-500">•</span>}
      </DropdownMenuItem>
    </>
  );
}
