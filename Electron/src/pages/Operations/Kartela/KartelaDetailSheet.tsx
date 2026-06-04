import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { kartelaService } from "./service";

export type KartelaSelection =
  | { kind: "dispatch"; id: string }
  | { kind: "receipt"; id: string }
  | null;

const DEC = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
const fmtDate = (s: string) => format(new Date(s), "dd.MM.yyyy HH:mm", { locale: tr });

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{children}</span>
    </div>
  );
}

export function KartelaDetailSheet({
  selection,
  onClose,
}: {
  selection: KartelaSelection;
  onClose: () => void;
}) {
  const open = !!selection;
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {selection?.kind === "dispatch" ? (
          <DispatchDetail id={selection.id} />
        ) : selection?.kind === "receipt" ? (
          <ReceiptDetail id={selection.id} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DispatchDetail({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ["kartela", "dispatch", id],
    queryFn: () => kartelaService.getDispatch(id).then((r) => r.data),
    enabled: !!id,
  });
  const d = query.data;

  return (
    <>
      <SheetHeader>
        <SheetTitle>Kartela Sevki {d ? `· ${d.dispatchNo}` : ""}</SheetTitle>
        <SheetDescription>Çeki listesi — kartela firmasına gönderilen toplar</SheetDescription>
      </SheetHeader>

      <div className="mt-4 space-y-4">
        {query.isLoading || !d ? (
          <>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </>
        ) : (
          <>
            <div className="space-y-2 rounded-md border bg-card/40 p-3">
              <Row label="Firma">{d.subcontractor.name}</Row>
              <Row label="Tarih">{fmtDate(d.dispatchedAt)}</Row>
              <Row label="Gönderen">{d.dispatchedBy?.fullName ?? "—"}</Row>
              {d.plateNumber && <Row label="Plaka">{d.plateNumber}</Row>}
              {d.driverName && <Row label="Sürücü">{d.driverName}</Row>}
              <Row label="Toplam">
                {d.items.length} top · {DEC.format(d.totalQty)} m
              </Row>
              {d.notes && <Row label="Not">{d.notes}</Row>}
              {d.cancelledAt && (
                <Row label="İptal">
                  <Badge variant="destructive">{d.cancelReason ?? "İptal edildi"}</Badge>
                </Row>
              )}
            </div>

            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Çeki Listesi</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Top</TableHead>
                    <TableHead>Ürün / Renk</TableHead>
                    <TableHead className="text-right">Metre</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell className="font-mono text-xs">{it.roll.barcode ?? "—"}</TableCell>
                      <TableCell>
                        {it.roll.item.name}
                        {it.roll.color ? ` · ${it.roll.color.name}` : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {DEC.format(it.dispatchedQty)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {d.receipts.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">İlgili Kabuller</div>
                {d.receipts.map((r) => (
                  <div key={r.id} className="text-sm">
                    <span className="font-mono text-xs">{r.receiptNo}</span> · {fmtDate(r.receivedAt)}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function ReceiptDetail({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ["kartela", "receipt", id],
    queryFn: () => kartelaService.getReceipt(id).then((r) => r.data),
    enabled: !!id,
  });
  const r = query.data;

  return (
    <>
      <SheetHeader>
        <SheetTitle>Kartela Kabulü {r ? `· ${r.receiptNo}` : ""}</SheetTitle>
        <SheetDescription>Tüketilen toplar ve dönen kartelalar</SheetDescription>
      </SheetHeader>

      <div className="mt-4 space-y-4">
        {query.isLoading || !r ? (
          <>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </>
        ) : (
          <>
            <div className="space-y-2 rounded-md border bg-card/40 p-3">
              <Row label="Firma">{r.subcontractor.name}</Row>
              <Row label="Tarih">{fmtDate(r.receivedAt)}</Row>
              <Row label="Kabul eden">{r.receivedBy?.fullName ?? "—"}</Row>
              {r.dispatch && <Row label="Sevk">{r.dispatch.dispatchNo}</Row>}
              {r.manifestNo && <Row label="İrsaliye No">{r.manifestNo}</Row>}
              <Row label="Özet">
                {r.items.length} top → {r.swatches.length} kartela
              </Row>
              {r.notes && <Row label="Not">{r.notes}</Row>}
              {r.cancelledAt && (
                <Row label="İptal">
                  <Badge variant="destructive">{r.cancelReason ?? "İptal edildi"}</Badge>
                </Row>
              )}
            </div>

            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Tüketilen Toplar
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Top</TableHead>
                    <TableHead>Ürün / Renk</TableHead>
                    <TableHead className="text-right">Kartela</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell className="font-mono text-xs">
                        {it.consumedRoll.barcode ?? "—"}
                      </TableCell>
                      <TableCell>
                        {it.consumedRoll.item.name}
                        {it.consumedRoll.color ? ` · ${it.consumedRoll.color.name}` : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{it.kartelaCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Dönen Kartelalar ({r.swatches.length})
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kart No</TableHead>
                    <TableHead>Ürün / Renk</TableHead>
                    <TableHead className="text-right">cm</TableHead>
                    <TableHead className="text-right">kg</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.swatches.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">{s.cardNumber}</TableCell>
                      <TableCell>
                        {s.item.name}
                        {s.color ? ` · ${s.color.name}` : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.length != null ? DEC.format(s.length) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.weightKg != null ? DEC.format(s.weightKg) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
