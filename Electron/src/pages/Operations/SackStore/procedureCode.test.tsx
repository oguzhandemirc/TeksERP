import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { procedureCodeView } from "./procedureCode";
import { SackStoreCard } from "./SackStoreCard";
import type { SackStoreShipment } from "./types";

// K15 (2026-09-23, e2e SK3 görüntüsü): yurtiçi planlı sevkte "Gümrük/İhracat No MUS… (varsayılan)"
// görünüyordu — değer cari KODUNDAN uyduruluyor, hiçbir yere kaydedilmiyordu.
const sevk = (o: Partial<SackStoreShipment>): SackStoreShipment => ({
  id: "sh", shipmentNo: "SVK-1", status: "PLANNED", destination: "DOMESTIC", procedureCode: null,
  createdAt: "2026-09-23T08:00:00Z", customer: { id: "c", name: "ACME", code: "MUS0001" }, branch: null,
  sackCount: 1, rollCount: 1, totalKg: 0, totalQty: 27, ...o,
} as SackStoreShipment);

describe("procedureCodeView — tek yüklem", () => {
  it("yurtiçinde satır GİZLİ (dolu değer olsa bile)", () => {
    expect(procedureCodeView(sevk({ destination: "DOMESTIC", procedureCode: "GB-1" })).goster).toBe(false);
  });
  it("yurtdışında görünür; boşsa değer null (uydurma yok)", () => {
    expect(procedureCodeView(sevk({ destination: "EXPORT" }))).toEqual({ goster: true, deger: null });
    expect(procedureCodeView(sevk({ destination: "EXPORT", procedureCode: " GB-1 " })).deger).toBe("GB-1");
  });
});

describe("Sevk Kapısı kartı", () => {
  const kart = (s: SackStoreShipment) => renderWithProviders(<SackStoreCard shipment={s} onOpen={vi.fn()} onDispatch={vi.fn()} />);
  it("yurtiçi: cari kodu kimlik olarak görünür, 'Gümrük' YOK", () => {
    kart(sevk({ destination: "DOMESTIC", procedureCode: "GB-1" }));
    expect(screen.getByText(/MUS0001/)).toBeInTheDocument();
    expect(screen.queryByText(/Gümrük/)).toBeNull();
  });
  it("yurtdışı + kayıtlı no: 'Gümrük: GB-1'; kayıtsız: cari kodu gümrük no gibi yazılmaz", () => {
    const { unmount } = kart(sevk({ destination: "EXPORT", procedureCode: "GB-1" }));
    expect(screen.getByText(/Gümrük: GB-1/)).toBeInTheDocument();
    unmount();
    kart(sevk({ destination: "EXPORT" }));
    expect(screen.queryByText(/Gümrük/)).toBeNull();
  });
});

// Tripwire: gümrük no'yu şube/cari koduyla YEDEKLEYEN zincir panelde yeniden doğmasın.
describe("tripwire — procedureCode yedek zinciri", () => {
  it("SackStore + sevkiyat detayında `procedureCode || …code` kalıbı yok", () => {
    const kok = path.resolve(__dirname, "..");
    const dosyalar = ["SackStore/ShipmentContentsSheet.tsx", "SackStore/SackStoreCard.tsx", "Shipments/detail/ShipmentDetailMeta.tsx"];
    const ihlal = dosyalar.filter((f) => /procedureCode\s*\|\|[^\n]*\.code/.test(fs.readFileSync(path.join(kok, f), "utf-8")));
    expect(ihlal).toEqual([]);
  });
});
