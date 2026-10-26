// Teklif kalemleri. Tutar, önerilen fiyat, maliyet ve kâr SUNUCU alanlarıdır; maliyet sütunları alan yanıtta yoksa
// hiç çizilmez. Taslakta kesin fiyat düzenlenir (PATCH) ve kalem silinir; önerilenden farklı fiyat nötr "elle" işareti alır.
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDec, fmtDecFull, fmtPct } from "../shared/format";
import { PRICE_SOURCE_LABEL } from "./labels";
import { hasCostColumns } from "./line-columns";
import { PriceCell } from "./PriceCell";
import type { QuoteLine } from "./quote-types";

interface Props {
  lines: QuoteLine[];
  currency: string;
  editable: boolean;
  busy?: boolean;
  onPrice: (line: QuoteLine, text: string) => void;
  onDelete: (line: QuoteLine) => void;
}

function Product({ l }: { l: QuoteLine }) {
  return (
    <div className="min-w-40">
      <p className="font-medium">{l.item ? `${l.item.code ?? ""} ${l.item.name}`.trim() : l.description}</p>
      {!l.itemId && <Badge variant="outline" className="mt-0.5 border-warning/50 text-warning">Yeni desen — ürün bağlı değil</Badge>}
      {l.item && l.description !== l.item.name && <p className="text-xs text-muted-foreground">{l.description}</p>}
    </div>
  );
}

export function QuoteLinesTable({ lines, currency, editable, busy, onPrice, onDelete }: Props) {
  const cost = hasCostColumns(lines);
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Ürün / tanım</TableHead>
            <TableHead>Renk</TableHead>
            <TableHead className="text-right">En</TableHead>
            <TableHead className="text-right">Miktar</TableHead>
            {cost && <TableHead className="text-right" data-testid="col-cost">Maliyet (TL/m)</TableHead>}
            {cost && <TableHead className="text-right">Kâr</TableHead>}
            {cost && <TableHead className="text-right">Önerilen</TableHead>}
            <TableHead className="text-right">Fiyat ({currency})</TableHead>
            <TableHead className="text-right">Tutar</TableHead>
            {editable && <TableHead className="w-10" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l) => (
            <TableRow key={l.id} data-testid="quote-line">
              <TableCell className="tabular-nums">{l.lineNo}</TableCell>
              <TableCell><Product l={l} /></TableCell>
              <TableCell className="whitespace-nowrap">{l.color?.name ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtDecFull(l.width, 1)}</TableCell>
              <TableCell className="whitespace-nowrap text-right tabular-nums">{fmtDecFull(l.quantity, 3)} m</TableCell>
              {cost && <TableCell className="text-right tabular-nums">{fmtDecFull(l.costPerMTry, 4)}</TableCell>}
              {cost && <TableCell className="text-right tabular-nums">{fmtPct(l.markupPct)}</TableCell>}
              {cost && <TableCell className="text-right tabular-nums">{fmtDecFull(l.suggestedUnitPrice, 4)}</TableCell>}
              <TableCell className="text-right">
                <div className="flex flex-col items-end gap-0.5">
                  {editable ? (
                    <PriceCell value={l.unitPrice} disabled={busy} label={`${l.lineNo}. kalem fiyatı`} onCommit={(t) => onPrice(l, t)} />
                  ) : (
                    <span className="tabular-nums">{fmtDec(l.unitPrice)}</span>
                  )}
                  <span className={l.priceSource === "MANUAL" ? "text-xs text-info" : "text-xs text-muted-foreground"} data-testid="price-source">
                    {l.priceSource === "MANUAL" ? "≠ elle" : PRICE_SOURCE_LABEL[l.priceSource]}
                  </span>
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{fmtDec(l.lineTotal)}</TableCell>
              {editable && (
                <TableCell>
                  <Button size="icon" variant="ghost" disabled={busy} aria-label={`${l.lineNo}. kalemi sil`} onClick={() => onDelete(l)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
