import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// ═══════════════════════════════════════════════════════════════════════════
// BEKÇİ — sevkiyat kur modalında SİPARİŞ ARAMA (2026-09-04 saha isteği)
//
//   §1  Terim SUNUCUYA gider (`search` parametresi) — istemcide süzülmez.
//       ⚠️ Bu bekçinin asıl işi bu: uç `take: 300` ile keser, kesilmiş diziyi
//       istemcide süzmek "sonuç yok" YALANI üretir (2026-08-12 dersi).
//   §2  Sunucu boş dönerse mesaj "bu müşterinin siparişi yok" DEMEZ — arama
//       terimini söyler (olmayan bir gerçeği bildirmek yasak).
//   §3  Aramanın dışında kalan SEÇİLİ sipariş sessizce kaybolmaz; şerit sayıyı
//       söyler ve seçimin durduğunu yazar.
//   §4  Müşteri değişince arama SIFIRLANIR (eski terim yeni cariyi boş gösterir).
// ═══════════════════════════════════════════════════════════════════════════

const listOpenOrders = vi.fn();
vi.mock("./service", () => ({
  sackHubService: { listOpenOrders: (...a: unknown[]) => listOpenOrders(...a) },
}));

import { ShipmentOrderSelect } from "./ShipmentOrderSelect";

const order = (id: string, no: string) => ({
  order: { id, orderNumber: no, status: "OPEN", deadline: null, customer: { id: "c1", name: "ACME" }, branch: null },
  lines: [{ lineId: `${id}-l1`, item: { id: "i1", code: "P", name: "PATOS" }, color: null, width: null, customerItemName: null, customerColorName: null, requested: 100, shipped: 0, openQty: 100, warehouseAvailable: 0, covered: false }],
});

// ⚠️ GÖVDE PARANTEZLİ: `() => listOpenOrders.mockReset()` yazımı mock'un
// KENDİSİNİ döndürür ve vitest, beforeEach'ten dönen fonksiyonu bir CLEANUP
// kancası sayıp test sonunda ARGÜMANSIZ çağırır — sahte bir `listOpenOrders()`
// çağrısı doğar ve çağrı sayısına/argümanlarına bakan sondalar bozulur.
beforeEach(() => {
  listOpenOrders.mockReset();
});

describe("ShipmentOrderSelect — sipariş arama", () => {
  it("§1 arama terimi SUNUCUYA gider (istemci süzmesi değil)", async () => {
    listOpenOrders.mockResolvedValue({ success: true, data: [order("o1", "SIP-001"), order("o2", "SIP-002")] });
    renderWithProviders(
      <ShipmentOrderSelect customerId="c1" branchId={null} selectedIds={new Set()} onToggle={vi.fn()} />,
    );
    await screen.findByText("SIP-001");

    // İlk çağrı süzgeçsiz.
    expect(listOpenOrders).toHaveBeenCalledWith({ customerId: "c1", branchId: undefined, search: undefined });

    await userEvent.type(screen.getByPlaceholderText(/Sipariş no/i), "SIP-002");

    // ⚠️ SUNUCU çağrısı terimi TAŞIMALI. İstemci süzmesine dönülürse bu bekleyiş
    // zaman aşımına düşer — negatif sondanın tuttuğu yer burası.
    await waitFor(() =>
      expect(listOpenOrders).toHaveBeenCalledWith({ customerId: "c1", branchId: undefined, search: "SIP-002" }),
    );
  });

  it("§2 sunucu boş dönünce 'siparişi yok' DEMEZ, terimi söyler", async () => {
    listOpenOrders.mockImplementation((p: { search?: string }) =>
      Promise.resolve({ success: true, data: p.search ? [] : [order("o1", "SIP-001")] }),
    );
    renderWithProviders(
      <ShipmentOrderSelect customerId="c1" branchId={null} selectedIds={new Set()} onToggle={vi.fn()} />,
    );
    await screen.findByText("SIP-001");
    await userEvent.type(screen.getByPlaceholderText(/Sipariş no/i), "yok");

    const msg = await screen.findByText(/eşleşen açık sipariş yok/i);
    expect(msg.textContent).toContain("yok");
    // Olmayan gerçeği bildirme yasağı: cari GERÇEKTEN siparişsiz değil.
    expect(screen.queryByText(/Bu müşterinin açık siparişi yok/i)).toBeNull();
  });

  it("§3 aramanın dışında kalan SEÇİLİ sipariş şeritle söylenir", async () => {
    // Sunucu yalnız o2'yi döndürüyor; o1 seçili ama listede YOK.
    listOpenOrders.mockResolvedValue({ success: true, data: [order("o2", "SIP-002")] });
    renderWithProviders(
      <ShipmentOrderSelect customerId="c1" branchId={null} selectedIds={new Set(["o1", "o2"])} onToggle={vi.fn()} />,
    );
    await screen.findByText("SIP-002");
    const note = await screen.findByText(/aramanın dışında kaldı/i);
    expect(note.textContent).toMatch(/^1 seçili sipariş/);
  });

  it("§4 müşteri değişince arama sıfırlanır", async () => {
    listOpenOrders.mockResolvedValue({ success: true, data: [order("o1", "SIP-001")] });
    const { rerender } = renderWithProviders(
      <ShipmentOrderSelect customerId="c1" branchId={null} selectedIds={new Set()} onToggle={vi.fn()} />,
    );
    await screen.findByText("SIP-001");
    const box = screen.getByPlaceholderText(/Sipariş no/i) as HTMLInputElement;
    await userEvent.type(box, "abc");
    expect(box.value).toBe("abc");

    rerender(<ShipmentOrderSelect customerId="c2" branchId={null} selectedIds={new Set()} onToggle={vi.fn()} />);
    await waitFor(() => expect((screen.getByPlaceholderText(/Sipariş no/i) as HTMLInputElement).value).toBe(""));
    // Yeni cari süzgeçsiz sorulur — eski terim taşınmaz.
    await waitFor(() =>
      expect(listOpenOrders).toHaveBeenCalledWith({ customerId: "c2", branchId: undefined, search: undefined }),
    );
  });
});
