// TOP KARTI (2026-11-10) — bölümler veri varken çizilir, yokken çizilmez; sahipsiz top "Bizim mal" (emanet açıkken);
// etiket müşterisi sahiplik DEĞİL (ayrı satır); son hareketler en yeni 5; liste rozeti + müşteri parti no.
// Negatif sonda (2026-11-10): RollOwnershipSection'da `owner ?` dalı `false ?` yapılınca §1a ❌; CardRow'un boş
//   değer erken dönüşü kaldırılınca §2b/§3b/§4 ❌; RollRecentEvents'te `.reverse()` düşürülünce §5a ❌; hepsi geri alındı.
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Roll } from "../types";
import { RollOwnershipSection } from "./RollOwnershipSection";
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

describe("sahiplik", () => {
  it("§1a sahipli: 'Müşteri malı (emanet) — müşteri' en üstte", () => {
    render(<RollOwnershipSection roll={mk({ ownerCustomer: { id: "c", name: "HHL MC" } })} emanetEnabled />);
    expect(screen.getByTestId("roll-owner-consigned").textContent).toBe(" Müşteri malı (emanet) — HHL MC");
    expect(screen.queryByTestId("roll-owner-own")).toBeNull();
  });
  it("§1b sahipsiz + emanet açık: 'Bizim mal'; emanet kapalı: hiçbir şey", () => {
    const { rerender, container } = render(<RollOwnershipSection roll={mk({ ownerCustomer: null })} emanetEnabled />);
    expect(screen.getByTestId("roll-owner-own").textContent).toContain("Bizim mal");
    rerender(<RollOwnershipSection roll={mk({ ownerCustomer: null })} emanetEnabled={false} />);
    expect(container.innerHTML).toBe("");
  });
  it("§1c etiket müşterisi ayrı satır, sahiplik sayılmaz", () => {
    render(<RollOwnershipSection roll={mk({ ownerCustomer: null, labelCustomer: { id: "l", name: "ETİKET A.Ş." } })} emanetEnabled />);
    expect(screen.getByTestId("roll-label-customer").textContent).toContain("Etiketteki müşteri: ETİKET A.Ş.");
    expect(screen.getByTestId("roll-owner-own")).toBeTruthy();
    expect(screen.queryByTestId("roll-owner-consigned")).toBeNull();
  });
});

describe("nereden geldi", () => {
  it("§2a gelen belge + gönderen no + müşteri parti + top no + ata top çizilir", () => {
    render(<RollOriginSection roll={mk({
      deliveryNote: { noteId: "n", noteNo: "GB-1", senderDocNo: "IRS-77", customerBatchNo: "P-9", senderRollNo: "12", inherited: true },
      parent: { id: "p", barcode: "TATA1" },
    })} />);
    expect(screen.getByTestId("roll-origin-note").textContent).toContain("GB-1");
    expect(screen.getByTestId("roll-origin-note").textContent).toContain("ata topun belgesi");
    expect(screen.getByTestId("roll-origin-sender-doc").textContent).toBe("IRS-77");
    expect(screen.getByTestId("roll-origin-customer-batch").textContent).toBe("P-9");
    expect(screen.getByTestId("roll-origin-sender-roll").textContent).toBe("12");
    expect(screen.getByTestId("roll-origin-parent").textContent).toBe("TATA1");
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
  it("§3a depo + İE (adımdan) + parti + istasyon", () => {
    render(<RollLocationSection roll={mk({
      warehouse: { id: "w", code: "D", name: "EMANET DEPO" },
      batch: { id: "b", batchNumber: "PRT-1", workOrder: { id: "wo2", workOrderNumber: "IE-2" } },
      currentStep: { id: "s", stepSequence: 2, station: { id: "st", code: "K", name: "Kurşun", kind: "X" }, workOrder: { id: "wo1", workOrderNumber: "IE-1" } },
    })} />);
    expect(screen.getByTestId("roll-location-warehouse").textContent).toBe("EMANET DEPO");
    expect(screen.getByTestId("roll-location-wo").textContent).toBe("IE-1");
    expect(screen.getByTestId("roll-location-batch").textContent).toBe("PRT-1");
    expect(screen.getByTestId("roll-location-station").textContent).toBe("Kurşun · 2. adım");
  });
  it("§3b hiç veri yoksa bölüm çizilmez; yalnız depo varsa İE/parti/istasyon satırı yok", () => {
    const { container, rerender } = render(<RollLocationSection roll={mk()} />);
    expect(container.innerHTML).toBe("");
    rerender(<RollLocationSection roll={mk({ warehouse: { id: "w", code: "D", name: "Merkez" } })} />);
    expect(screen.getByTestId("roll-location-warehouse")).toBeTruthy();
    expect(screen.queryByTestId("roll-location-wo")).toBeNull();
    expect(screen.queryByTestId("roll-location-station")).toBeNull();
  });
});

describe("kimlik", () => {
  it("§4 metre ilk/kalan; kg yoksa satır yok, varsa çizilir", () => {
    const { rerender } = render(<RollIdentitySection roll={mk()} />);
    expect(screen.getByTestId("roll-identity-qty").textContent).toContain("80 m");
    expect(screen.getByTestId("roll-identity-qty").textContent).toContain("ilk 100 m");
    expect(screen.queryByText("Ağırlık")).toBeNull();
    rerender(<RollIdentitySection roll={mk({ weightKg: 12.5 })} />);
    expect(screen.getByText("Ağırlık")).toBeTruthy();
  });
  it("§4b aşama: eski sunucu (alan yok) satır çizmez; varsa Türkçe etiket", () => {
    const { rerender } = render(<RollIdentitySection roll={mk()} />);
    expect(screen.queryByTestId("roll-identity-stage")).toBeNull();
    rerender(<RollIdentitySection roll={mk({ stage: "FINISHED" })} />);
    expect(screen.getByTestId("roll-identity-stage").textContent).toContain("Bitmiş");
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
