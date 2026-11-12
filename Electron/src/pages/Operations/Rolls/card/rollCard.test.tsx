// TOP KARTI (2026-11-10) — alt bölümler veri varken çizilir; "Top bilgileri" tablosu (§7) asıl bilgilerin tek kaynağı,
// boşta "—"; sahipsiz top "Bizim mal" (emanet açıkken); son hareketler en yeni 5; liste rozeti + müşteri parti no.
// Negatif sonda (2026-11-10): CardRow'un boş değer erken dönüşü kaldırılınca §2b/§3b ❌; RollRecentEvents'te `.reverse()`
//   düşürülünce §5a ❌. Tablo: kg "tartılmadı" dalı null yapılınca §7b ❌; ana top onClick boşaltılınca §7d ❌;
//   splitRollProperties'te değerli dal `false` yapılınca §7a/§7g ❌; hepsi geri alındı.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Roll } from "../types";
import { RollInfoTable } from "./RollInfoTable";
import { printedValueRows, splitRollProperties } from "./rollInfoData";
import { RollOriginSection } from "./RollOriginSection";
import { RollLocationSection } from "./RollLocationSection";
import { RollRecentEvents, RECENT_EVENT_COUNT } from "./RollRecentEvents";
import { RollIdentitySection } from "./RollIdentitySection";
import { customerBatchOf } from "../columns";

const base = {
  id: "r1", barcode: "T1", itemId: "i", colorId: null, initialQty: 100, currentQty: 80, weightKg: null, width: null,
  status: "WAREHOUSE", qualityGrade: null, form: "TOP", entrySource: "SEMI_FINISHED", parentRollId: null, parentReceiptId: null,
  packageId: null, grossWeightKg: null, netWeightKg: null, packagingDate: null, createdAt: "2026-11-09T07:00:00Z", updatedAt: "2026-11-09T07:00:00Z",
  item: { id: "i", code: "K", name: "Tül Kumaş" },
} as unknown as Roll;
const mk = (over: Partial<Roll> = {}): Roll => ({ ...base, ...over }) as Roll;

describe("nereden geldi", () => {
  it("§2a gelen belge + gönderen no + (etikettekinden farklı) belge partisi + top no çizilir; ata top tabloda", () => {
    render(<RollOriginSection roll={mk({
      deliveryNote: { noteId: "n", noteNo: "GB-1", senderDocNo: "IRS-77", customerBatchNo: "P-9", senderRollNo: "12", inherited: true },
      parent: { id: "p", barcode: "TATA1" }, labelBatchNo: "J1",
    })} />);
    expect(screen.getByTestId("roll-origin-note").textContent).toContain("GB-1");
    expect(screen.getByTestId("roll-origin-note").textContent).toContain("ata topun belgesi");
    expect(screen.getByTestId("roll-origin-sender-doc").textContent).toBe("IRS-77");
    expect(screen.getByTestId("roll-origin-customer-batch").textContent).toBe("P-9");
    expect(screen.getByTestId("roll-origin-sender-roll").textContent).toBe("12");
    expect(screen.queryByTestId("roll-origin-parent")).toBeNull();
  });
  it("§2c belge partisi etikettekiyle aynıysa (tablo gösteriyor) burada tekrar edilmez", () => {
    render(<RollOriginSection roll={mk({
      deliveryNote: { noteId: "n", noteNo: "GB-1", senderDocNo: null, customerBatchNo: "P-9", senderRollNo: null, inherited: false },
      customerBatchNo: "P-9", // backend aynası: etiket partisi yoksa tablodaki "Etiketteki parti no" bu
    })} />);
    expect(screen.queryByTestId("roll-origin-customer-batch")).toBeNull();
  });
  it("§2b belgesiz/atasız topta bu satırlar YOK; giriş kaynağı yine var", () => {
    render(<RollOriginSection roll={mk({ deliveryNote: null, parent: null })} />);
    for (const id of ["roll-origin-note", "roll-origin-sender-doc", "roll-origin-customer-batch", "roll-origin-sender-roll", "roll-origin-parent"]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(screen.getByText("Giriş kaynağı")).toBeTruthy();
  });
});

describe("nerede / ne durumda", () => {
  it("§3a İE (adımdan) + istasyon; depo ve parti tabloda (burada yok)", () => {
    render(<RollLocationSection roll={mk({
      warehouse: { id: "w", code: "D", name: "EMANET DEPO" },
      batch: { id: "b", batchNumber: "PRT-1", workOrder: { id: "wo2", workOrderNumber: "IE-2" } },
      currentStep: { id: "s", stepSequence: 2, station: { id: "st", code: "K", name: "Kurşun", kind: "X" }, workOrder: { id: "wo1", workOrderNumber: "IE-1" } },
    })} />);
    expect(screen.queryByTestId("roll-location-warehouse")).toBeNull();
    expect(screen.getByTestId("roll-location-wo").textContent).toBe("IE-1");
    expect(screen.queryByTestId("roll-location-batch")).toBeNull();
    expect(screen.getByTestId("roll-location-station").textContent).toBe("Kurşun · 2. adım");
  });
  it("§3b İE/istasyon yoksa bölüm çizilmez (yalnız depo olsa da)", () => {
    const { container, rerender } = render(<RollLocationSection roll={mk()} />);
    expect(container.innerHTML).toBe("");
    rerender(<RollLocationSection roll={mk({ warehouse: { id: "w", code: "D", name: "Merkez" } })} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("kimlik başlığı", () => {
  it("§4 barkod başlığı kalır; eski Kimlik bölümü (tabloyla tekrar) yok", () => {
    render(<RollIdentitySection roll={mk()} />);
    expect(screen.getByTestId("roll-card-barcode").textContent).toBe("T1");
    expect(screen.queryByTestId("roll-card-identity")).toBeNull();
  });
});

const cell = (id: string) => screen.getByTestId(id).textContent;
const info = (over: Partial<Roll> = {}, emanetEnabled = true, onOpenRoll?: (id: string) => void) =>
  render(<RollInfoTable roll={mk(over)} emanetEnabled={emanetEnabled} onOpenRoll={onOpenRoll} />);

describe("top bilgileri tablosu", () => {
  it("§7a satırlar istenen sırada; özellik satırları Metre/Kalite'den hemen sonra", () => {
    info({ properties: [
      { propertyId: "p1", property: { id: "p1", code: "KG", name: "KURŞUN GRAMAJI" }, value: { code: "50", name: "50 gr" } },
      { propertyId: "p2", property: { id: "p2", code: "K", name: "KURŞUN" }, value: null },
      { propertyId: "p3", property: { id: "p3", code: "TS", name: "TAMBUR SARIMI" } },
    ] });
    const labels = within(screen.getByTestId("roll-card-info")).getAllByRole("rowheader").map((th) => th.textContent);
    expect(labels).toEqual([
      "Barkod", "Metre (ilk / kalan)", "Kalite", "KURŞUN GRAMAJI", "İşlemler", "Kat / biçim", "Aşama", "Durum / depo", "Ana top",
      "Kesildiği / girdiği yer", "Malın sahibi", "Etiket kimin için", "Bizim parti", "Etiketteki kumaş adı", "Etiketteki renk",
      "Etiketteki parti no", "Kg", "En", "Son etiket basımı", "Kumaş (kayıtta)", "Renk (kayıtta)",
    ]);
    expect(screen.getByTestId("roll-info-property").textContent).toBe("50 gr");
    expect(cell("roll-info-flags")).toBe("KURŞUN · TAMBUR SARIMI");
  });
  it("§7b boş değer '—'; kg yoksa 'tartılmadı'; özelliksiz topta özellik/İşlemler satırı yok", () => {
    info();
    expect(cell("roll-info-quality")).toBe("—");
    expect(cell("roll-info-parent")).toBe("—");
    expect(cell("roll-info-label-item")).toBe("—");
    expect(cell("roll-info-width")).toBe("—");
    expect(cell("roll-info-last-print")).toBe("—");
    expect(cell("roll-info-weight")).toBe("— tartılmadı");
    expect(screen.queryByTestId("roll-info-property")).toBeNull();
    expect(screen.queryByTestId("roll-info-flags")).toBeNull();
  });
  it("§7c dolu değerler: metre ilk/kalan, kat+biçim, aşama, durum+depo, kg+kaynak, en, etikette yazanlar", () => {
    info({
      qualityGrade: "A", foldType: "4-KAT", stage: "FINISHED", warehouse: { id: "w", code: "D", name: "EMANET DEPO" },
      weightKg: 12.5, weightSource: "SCALE", width: 160, labelItemName: "SULTAN", labelColorName: "EKRU", labelBatchNo: "J1",
      batch: { id: "b", batchNumber: "PRT-1", workOrder: null },
    });
    expect(cell("roll-info-qty")).toBe("100 m / 80 m");
    expect(cell("roll-info-fold")).toBe("4-KAT · Top");
    expect(cell("roll-info-stage")).toContain("Bitmiş");
    expect(cell("roll-info-status")).toMatch(/· EMANET DEPO$/);
    expect(cell("roll-info-weight")).toBe("12,5 kg · Kantar");
    expect(cell("roll-info-width")).toBe("160 cm");
    expect(cell("roll-info-label-item")).toBe("SULTAN");
    expect(cell("roll-info-label-color")).toBe("EKRU");
    expect(cell("roll-info-label-batch")).toBe("J1");
    expect(cell("roll-info-batch")).toBe("PRT-1");
  });
});

describe("top bilgileri: bağlantı, sahiplik, basım izi", () => {
  it("§7d ana top: barkod tıklanınca o topun kartı istenir; ilk/kalan metre yanında", () => {
    const open = vi.fn();
    info({ parent: { id: "p9", barcode: "TATA1", initialQty: 300, currentQty: 120 } }, true, open);
    expect(cell("roll-info-parent")).toContain("ilk 300 m / kalan 120 m");
    fireEvent.click(screen.getByTestId("roll-info-parent-link"));
    expect(open).toHaveBeenCalledWith("p9");
  });
  it("§7e sahip + etiket kimin için: alıcı varsa alıcı adı, yoksa 'malın sahibi'; emanet kapalı sahipsiz '—'", () => {
    const { unmount } = info({ ownerCustomer: { id: "c", name: "HHL MC" }, labelCustomer: { id: "c", name: "HHL MC" }, labelConsignee: { id: "k", name: "ACME USA" } });
    expect(screen.getByTestId("roll-owner-consigned").textContent).toBe("HHL MC (emanet)");
    expect(cell("roll-info-label-for")).toBe("HHL MC · alıcı: ACME USA");
    unmount();
    const r2 = info({ ownerCustomer: { id: "c", name: "HHL MC" }, labelCustomer: { id: "c", name: "HHL MC" } });
    expect(cell("roll-info-label-for")).toBe("HHL MC · malın sahibi");
    r2.unmount();
    const r3 = info({}, true);
    expect(screen.getByTestId("roll-owner-own").textContent).toBe("Bizim mal");
    r3.unmount();
    info({}, false);
    expect(cell("roll-info-owner")).toBe("—");
  });
  it("§7f son basım + 'basılan değerler' snapshot'tan; eski snapshot (printed yok) kırılmaz", () => {
    const snap = { customerId: "c", customerName: "HHL MC", orderNumber: null, itemName: "SULTAN", colorName: null, printedAt: "x", operatorId: null, operatorName: "Ali",
      printed: { lengthMeters: 80, qualityGrade: "A", labelBatchNo: "J1", weightKg: 12.5, widthCm: 160, consigneeName: "ACME USA" } };
    const { unmount } = info({ labelPrintedAt: "2026-11-10T08:00:00Z", lastLabelSnapshot: snap });
    expect(cell("roll-info-last-print")).toContain("Ali");
    expect(screen.queryByTestId("roll-info-printed-values")).toBeNull();
    fireEvent.click(screen.getByTestId("roll-info-printed-toggle"));
    const txt = screen.getByTestId("roll-info-printed-values").textContent;
    for (const s of ["Metre: 80 m", "Kalite: A", "Parti no: J1", "Kg: 12,5 kg", "En: 160 cm", "Etiket alıcısı: ACME USA", "Kumaş: SULTAN"]) expect(txt).toContain(s);
    unmount();
    const old = { ...snap, printed: undefined };
    expect(printedValueRows(old)).toEqual([["Müşteri", "HHL MC"], ["Kumaş", "SULTAN"]]);
    expect(printedValueRows(null)).toEqual([]);
  });
  it("§7g özellik ayrımı veri güdümlü (ad yazılmaz)", () => {
    expect(splitRollProperties(undefined)).toEqual({ valued: [], flags: [] });
    expect(splitRollProperties([{ propertyId: "x", property: { id: "x", code: "Z", name: "HER ŞEY" }, value: { code: "1", name: "bir" } }]).valued[0])
      .toEqual({ key: "x", label: "HER ŞEY", value: "bir" });
  });
});

describe("son hareketler", () => {
  const ev = (i: number) => ({ kind: "K", at: `2026-11-0${i}T08:00:00Z`, title: `Olay ${i}`, stationName: null, details: {}, operatorName: null });
  it("§5a en yeni 5 olay, en yeni önce; 'Tümünü göster' geri kalanı açar", () => {
    render(<RollRecentEvents events={[1, 2, 3, 4, 5, 6, 7].map(ev)} isLoading={false} isError={false} />);
    const items = screen.getAllByTestId("roll-recent-event");
    expect(items).toHaveLength(RECENT_EVENT_COUNT);
    expect(items[0]!.textContent).toContain("Olay 7");
    fireEvent.click(screen.getByTestId("roll-events-show-all"));
    expect(screen.getAllByTestId("roll-recent-event")).toHaveLength(7);
  });
  it("§5b olay yoksa bölüm çizilmez", () => {
    const { container } = render(<RollRecentEvents events={[]} isLoading={false} isError={false} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("liste", () => {
  it("§6b müşteri parti no: etiket partisi önce, yoksa gelen belgeden; ikisi de yoksa null", () => {
    expect(customerBatchOf({ labelBatchNo: "J1", customerBatchNo: "P-9" })).toBe("J1");
    expect(customerBatchOf({ labelBatchNo: null, customerBatchNo: "P-9" })).toBe("P-9");
    expect(customerBatchOf({ labelBatchNo: " ", customerBatchNo: null })).toBeNull();
  });
});
