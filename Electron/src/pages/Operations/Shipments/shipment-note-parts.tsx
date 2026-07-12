import { safeFormat } from "@/lib/format";

// =============================================================================
// Sevk İrsaliyesi ortak parçaları + donmuş belge payload tipleri.
// Hem donmuş (FrozenSheet) hem taslak (DraftSheet) render'ı paylaşır.
// =============================================================================

export const NUM = new Intl.NumberFormat("tr-TR", { useGrouping: false, maximumFractionDigits: 0 });
export const NUMKG = new Intl.NumberFormat("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

// Backend buildShipmentDispatchDoc ile birebir aynı şekil.
export interface ShipmentDocLine {
  lineId: string;
  orderNumber: string;
  itemName: string;
  colorName: string | null;
  width: number | null;
  qty: number;
}
export interface ShipmentDocSack {
  seq: number;
  sackNo: string | null;
  weightKg: number | null;
  productSummary: {
    itemName: string;
    colorName: string | null;
    width: number | null;
    totalQty: number;
    rollCount: number;
  }[];
  swatches: {
    itemName: string | null;
    colorName: string | null;
    width: number | null;
    length: number | null;
  }[];
}
export interface ShipmentDoc {
  shipmentNo: string;
  dispatchedAt: string | null;
  readyAt: string | null;
  plateNumber: string | null;
  driverName: string | null;
  carrier: string | null;
  customer: { code: string; name: string };
  branch: { name: string } | null;
  lines: ShipmentDocLine[];
  sacks: ShipmentDocSack[];
  summary: {
    rollCount: number;
    swatchCount: number;
    sackCount: number;
    totalMeters: number;
    totalKg: number;
  };
}

/** Tablo satırının render-hazır hali (donmuş/taslak ortak). */
export interface ItemRow {
  key: string;
  orderNumber: string;
  itemName: string;
  colorName: string | null;
  width: number | null;
  qty: number;
}

export function NoteHeader({ title, no, date }: { title: string; no: string; date: string | null }) {
  return (
    <div className="flex items-start justify-between border-b-2 border-black pb-3">
      <div>
        <div className="text-[18px] font-bold uppercase tracking-wide">{title}</div>
        <div className="mt-1 text-[11px]">
          Sevkiyat No: <span className="font-mono font-semibold">{no}</span>
        </div>
      </div>
      <div className="text-right text-[11px]">
        <div>
          Tarih: <span className="font-semibold">{date ? safeFormat(date, "dd.MM.yyyy HH:mm") : "—"}</span>
        </div>
      </div>
    </div>
  );
}

export function ItemTable({ lines, totalQty }: { lines: ItemRow[]; totalQty: number }) {
  return (
    <div className="mt-4">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide">Gönderilen Kalemler</div>
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
            <tr key={l.key} className="border-b border-gray-300">
              <Td className="text-center tabular-nums">{i + 1}</Td>
              <Td className="font-mono">{l.orderNumber}</Td>
              <Td>{l.itemName}</Td>
              <Td>{l.colorName ?? "—"}</Td>
              <Td className="text-center tabular-nums">{l.width != null ? `${l.width} cm` : "—"}</Td>
              <Td className="text-right tabular-nums">{NUM.format(l.qty)}</Td>
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
  );
}

export function SackBreakdown({ sacks, totalKg }: { sacks: ShipmentDocSack[]; totalKg: number }) {
  return (
    <div className="mt-4">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide">
        Çuval Dökümü ({sacks.length} çuval · {NUMKG.format(totalKg)} kg brüt)
      </div>
      <div className="space-y-2">
        {sacks.map((s) => (
          <div key={s.seq} className="border border-gray-300">
            <div className="flex items-center justify-between border-b border-gray-300 bg-gray-50 px-2 py-1 text-[11px] font-semibold">
              <span>
                Çuval #{s.seq}
                {s.sackNo ? ` · ${s.sackNo}` : ""}
              </span>
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
                    <Td className="text-center tabular-nums">{p.width != null ? `${p.width} cm` : "—"}</Td>
                    <Td className="text-right tabular-nums">{NUM.format(p.totalQty)}</Td>
                    <Td className="text-right tabular-nums">{p.rollCount}</Td>
                  </tr>
                ))}
                {s.swatches.map((sw, i) => (
                  <tr key={`sw-${i}`} className="border-b border-gray-200 text-gray-600">
                    <Td>Kartela · {sw.itemName ?? "—"}</Td>
                    <Td>{sw.colorName ?? "—"}</Td>
                    <Td className="text-center tabular-nums">{sw.width != null ? `${sw.width} cm` : "—"}</Td>
                    <Td className="text-right tabular-nums">{sw.length != null ? `${sw.length} cm` : "—"}</Td>
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
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-gray-300 p-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-600">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[70px_1fr] gap-x-2">
      <span className="text-gray-600">{label}:</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-1.5 py-1 text-left text-[10px] font-semibold uppercase ${className}`}>{children}</th>
  );
}

export function Td({
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
