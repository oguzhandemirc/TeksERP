import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { safeFormat } from "@/lib/format";
import { shipmentService } from "./service";
import type { ShipmentDetail } from "./types";

const NUM = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const NUMKG = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

interface Props {
  shipmentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShipmentDispatchNote({ shipmentId, open, onOpenChange }: Props) {
  // Aynı queryKey → detay sheet'in çektiği veriyi cache'ten kullanır (ekstra fetch yok).
  const q = useQuery({
    queryKey: ["shipment-detail", shipmentId],
    queryFn: () => shipmentService.getDetail(shipmentId!),
    enabled: open && Boolean(shipmentId),
    staleTime: 30_000,
  });
  const d = q.data?.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Sevk İrsaliyesi</DialogTitle>
          <DialogDescription>
            Sevkiyat içeriğinin A4 çıktısı. "Yazdır" ile al.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto rounded-md border bg-muted/30 p-4">
          {q.isLoading && <Skeleton className="h-64 w-full" />}
          {!q.isLoading && !d && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Sevkiyat bulunamadı.
            </div>
          )}
          {d && <NoteSheet d={d} />}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
          <Button
            type="button"
            className="gap-1"
            disabled={!d}
            onClick={() => window.print()}
          >
            <Printer className="h-4 w-4" /> Yazdır
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoteSheet({ d }: { d: ShipmentDetail }) {
  // Yalnız bu sevkiyatta metraj düşen kalemler (irsaliyede giden mal).
  const lines = d.orders.flatMap((o) =>
    o.lines
      .filter((l) => l.thisShipment > 0)
      .map((l) => ({ ...l, orderNumber: o.orderNumber })),
  );
  const totalQty = lines.reduce((s, l) => s + l.thisShipment, 0);
  const docDate = d.dispatchedAt ?? d.readyAt ?? null;

  return (
    <div className="print-area mx-auto max-w-[210mm] bg-white p-6 text-[12px] text-black">
      <div className="flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <div className="text-[18px] font-bold uppercase tracking-wide">Sevk İrsaliyesi</div>
          <div className="mt-1 text-[11px]">
            Sevkiyat No:{" "}
            <span className="font-mono font-semibold">{d.shipmentNo}</span>
          </div>
        </div>
        <div className="text-right text-[11px]">
          <div>
            Tarih:{" "}
            <span className="font-semibold">
              {docDate ? safeFormat(docDate, "dd.MM.yyyy HH:mm") : "—"}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-4">
        <Section title="Müşteri">
          <Row label="Adı" value={d.customer.name} />
          {d.branch && <Row label="Şube" value={d.branch.name} />}
        </Section>
        <Section title="Sevk Bilgileri">
          <Row label="Plaka" value={d.plateNumber || "—"} />
          <Row label="Sürücü" value={d.driverName || "—"} />
          <Row label="Taşıyıcı" value={d.carrier || "—"} />
        </Section>
      </div>

      <div className="mt-4">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide">
          Gönderilen Kalemler
        </div>
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b-2 border-black">
              <Th className="w-8 text-center">#</Th>
              <Th>Sipariş</Th>
              <Th>Ürün</Th>
              <Th>Renk</Th>
              <Th className="text-center">En</Th>
              <Th className="text-right">Metre</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.lineId} className="border-b border-gray-300">
                <Td className="text-center tabular-nums">{i + 1}</Td>
                <Td className="font-mono">{l.orderNumber}</Td>
                <Td>{l.customerItemName ?? l.item.name}</Td>
                <Td>{l.color ? l.customerColorName ?? l.color.name : "—"}</Td>
                <Td className="text-center tabular-nums">
                  {l.width != null ? `${l.width} cm` : "—"}
                </Td>
                <Td className="text-right tabular-nums">{NUM.format(l.thisShipment)}</Td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <Td colSpan={6} className="py-2 text-center text-gray-500">
                  Bu sevkiyatta siparişe düşen metraj yok.
                </Td>
              </tr>
            )}
            <tr className="border-t-2 border-black font-semibold">
              <Td colSpan={5} className="text-right">
                TOPLAM
              </Td>
              <Td className="text-right tabular-nums">{NUM.format(totalQty)} m</Td>
            </tr>
          </tbody>
        </table>
      </div>

      {d.sacks.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide">
            Çuval Dökümü ({d.sacks.length} çuval · {NUMKG.format(d.summary.totalKg)} kg brüt)
          </div>
          <div className="space-y-2">
            {d.sacks.map((s) => (
              <div key={s.id} className="border border-gray-300">
                <div className="flex items-center justify-between border-b border-gray-300 bg-gray-50 px-2 py-1 text-[11px] font-semibold">
                  <span>Çuval #{s.seq}</span>
                  <span className="tabular-nums">
                    {s.weightKg != null ? `${NUMKG.format(s.weightKg)} kg` : "—"} brüt
                  </span>
                </div>
                <table className="w-full border-collapse text-[10px]">
                  <thead>
                    <tr className="border-b border-gray-300 text-gray-600">
                      <Th>Ürün</Th>
                      <Th>Renk</Th>
                      <Th className="text-center">En</Th>
                      <Th className="text-right">Metre</Th>
                      <Th className="text-right">Top</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.productSummary.map((p, i) => (
                      <tr key={i} className="border-b border-gray-200">
                        <Td>{p.itemName}</Td>
                        <Td>{p.colorName ?? "—"}</Td>
                        <Td className="text-center tabular-nums">
                          {p.width != null ? `${p.width} cm` : "—"}
                        </Td>
                        <Td className="text-right tabular-nums">{NUM.format(p.totalQty)}</Td>
                        <Td className="text-right tabular-nums">{p.rollCount}</Td>
                      </tr>
                    ))}
                    {s.swatches.map((sw) => (
                      <tr key={sw.id} className="border-b border-gray-200 text-gray-600">
                        <Td>Kartela · {sw.item?.name ?? "—"}</Td>
                        <Td>{sw.color?.name ?? "—"}</Td>
                        <Td className="text-center tabular-nums">
                          {sw.width != null ? `${sw.width} cm` : "—"}
                        </Td>
                        <Td className="text-right tabular-nums">
                          {sw.length != null ? `${sw.length} cm` : "—"}
                        </Td>
                        <Td className="text-right tabular-nums">1</Td>
                      </tr>
                    ))}
                    {s.productSummary.length === 0 && s.swatches.length === 0 && (
                      <tr>
                        <Td colSpan={5} className="py-1 text-center text-gray-500">
                          boş
                        </Td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mt-2 text-[11px]">
        <span className="font-semibold">Top sayısı:</span> {d.summary.rollCount} ·{" "}
        <span className="font-semibold">Toplam metraj:</span>{" "}
        {NUM.format(d.summary.totalMeters)} m
      </div>

      <div className="mt-10 grid grid-cols-3 gap-6 text-[11px]">
        <Sign label="Sevkeden" />
        <Sign label="Sürücü" />
        <Sign label="Teslim Alan" />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-gray-300 p-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[70px_1fr] gap-x-2">
      <span className="text-gray-600">{label}:</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-1.5 py-1 text-left text-[10px] font-semibold uppercase ${className}`}>
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
  colSpan,
}: {
  children: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td className={`px-1.5 py-1 ${className}`} colSpan={colSpan}>
      {children}
    </td>
  );
}

function Sign({ label }: { label: string }) {
  return (
    <div>
      <div className="text-gray-600">{label}</div>
      <div className="mt-8 border-b border-black" />
      <div className="mt-1 text-center text-[10px] text-gray-600">Ad-Soyad / İmza</div>
    </div>
  );
}
