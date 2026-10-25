// Taslak satır editörü: kayıt `PUT /lines` ile TAM KÜME (sunucu replace eder). Aynı ürün+renk tekrarını sunucu
// reddeder (PRICE_LIST_DUPLICATE_LINE). Maliyet kolonları yalnız sunucu alanı koyduysa; panel fiyat HESAPLAMAZ.
import { useRef, useState } from "react";
import { PackageSearch, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ItemPickerModal } from "@/components/forms/ItemPickerModal";
import { ColorPickerModal } from "@/components/forms/color-picker/ColorPickerModal";
import { decToInput, fmtDec, fmtDecFull, fmtPct } from "../shared/format";
import { hasListCostColumns, type PriceListDetail, type PriceListLine } from "./pl-types";
import { buildLinesBody, priceListService, type EditorLine } from "./service";
import { usePriceListMutation } from "./usePriceListMutation";

const toEditor = (l: PriceListLine): EditorLine => ({ key: l.id, item: l.item, colorId: l.colorId, unitPrice: decToInput(l.unitPrice), minQty: decToInput(l.minQty) });

export function PriceListLinesEditor({ list, onDirtyChange }: { list: PriceListDetail; onDirtyChange?: (d: boolean) => void }) {
  const [rows, setRows] = useState<EditorLine[]>(() => list.lines.map(toEditor));
  const [dirty, setDirtyState] = useState(false);
  const setDirty = (d: boolean) => { setDirtyState(d); onDirtyChange?.(d); };
  const [picking, setPicking] = useState(false);
  const seq = useRef(0); // yeni satırın yalnız React anahtarı (sunucuya gitmez)
  const cost = hasListCostColumns(list.lines);
  const byId = new Map(list.lines.map((l) => [l.id, l]));
  const body = buildLinesBody(rows);
  const save = usePriceListMutation({ listId: list.id, fn: (b: Array<Record<string, unknown>>) => priceListService.replaceLines(list.id, b) });
  const edit = (key: string, p: Partial<EditorLine>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
    setDirty(true);
  };
  return (
    <section className="space-y-2" aria-label="Satırlar">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Satırlar ({rows.length})</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setPicking(true)}><PackageSearch className="mr-1 h-4 w-4" />Satır ekle</Button>
          <Button size="sm" disabled={!dirty || !body || save.isPending} onClick={() => body && save.mutate(body)} data-testid="pl-lines-save">
            {save.isPending ? "Kaydediliyor…" : "Satırları kaydet"}
          </Button>
        </div>
      </div>
      {dirty && !body && <p className="text-xs text-destructive" role="note">Her satırın birim fiyatı girilmeli.</p>}
      {cost && dirty && <p className="text-xs text-muted-foreground" role="note">Elle kaydedilen satırlar standart maliyet bağını taşımaz; maliyet/kâr kolonu için "Standart maliyetten doldur"u kullanın.</p>}
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="pl-lines-empty">Satır yok — "Satır ekle" ya da "Standart maliyetten doldur".</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ürün</TableHead>
                <TableHead>Renk</TableHead>
                {cost && <TableHead className="text-right" data-testid="pl-col-cost">Maliyet (TL/m)</TableHead>}
                {cost && <TableHead className="text-right">Kâr</TableHead>}
                <TableHead>Birim fiyat ({list.currency}/m)</TableHead>
                <TableHead>Asgari miktar (m)</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const saved = byId.get(r.key);
                return (
                  <TableRow key={r.key} data-testid="pl-line">
                    <TableCell className="whitespace-nowrap text-sm"><span className="font-mono text-xs">{r.item.code}</span> {r.item.name}</TableCell>
                    <TableCell className="min-w-44"><ColorPickerModal value={r.colorId} onChange={(colorId) => edit(r.key, { colorId })} customerId={list.customerId} triggerClassName="h-8" /></TableCell>
                    {cost && <TableCell className="text-right tabular-nums">{fmtDecFull(saved?.costPerMTry ?? null, 4)}</TableCell>}
                    {cost && <TableCell className="text-right tabular-nums">{fmtPct(saved?.markupPct ?? null)}</TableCell>}
                    <TableCell><Input className="h-8 w-32" inputMode="decimal" value={r.unitPrice} onChange={(e) => edit(r.key, { unitPrice: e.target.value })} aria-label="Birim fiyat" /></TableCell>
                    <TableCell><Input className="h-8 w-28" inputMode="decimal" value={r.minQty} onChange={(e) => edit(r.key, { minQty: e.target.value })} aria-label="Asgari miktar" /></TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" aria-label="Satırı sil" onClick={() => { setRows((rs) => rs.filter((x) => x.key !== r.key)); setDirty(true); }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <ItemPickerModal
        open={picking}
        onOpenChange={setPicking}
        allowedTypes={["FABRIC"]}
        onPick={(it) => {
          setRows((rs) => [...rs, { key: `new-${++seq.current}`, item: { id: it.id, code: it.code, name: it.name }, colorId: null, unitPrice: "", minQty: "" }]);
          setDirty(true);
          setPicking(false);
        }}
      />
    </section>
  );
}

/** Yayında/arşivde liste: salt-okunur satırlar. */
export function PriceListLinesView({ list }: { list: PriceListDetail }) {
  const cost = hasListCostColumns(list.lines);
  if (list.lines.length === 0) return <p className="text-sm text-muted-foreground">Satır yok.</p>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ürün</TableHead>
            <TableHead>Renk</TableHead>
            {cost && <TableHead className="text-right" data-testid="pl-col-cost">Maliyet (TL/m)</TableHead>}
            {cost && <TableHead className="text-right">Kâr</TableHead>}
            <TableHead className="text-right">Birim fiyat ({list.currency}/m)</TableHead>
            <TableHead className="text-right">Asgari miktar (m)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.lines.map((l) => (
            <TableRow key={l.id} data-testid="pl-line">
              <TableCell className="whitespace-nowrap text-sm"><span className="font-mono text-xs">{l.item.code}</span> {l.item.name}</TableCell>
              <TableCell>{l.color ? `${l.color.code} — ${l.color.name}` : <span className="text-muted-foreground">Tüm renkler</span>}</TableCell>
              {cost && <TableCell className="text-right tabular-nums">{fmtDecFull(l.costPerMTry ?? null, 4)}</TableCell>}
              {cost && <TableCell className="text-right tabular-nums">{fmtPct(l.markupPct ?? null)}</TableCell>}
              <TableCell className="text-right tabular-nums">{fmtDec(l.unitPrice, 2)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtDecFull(l.minQty, 3)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
