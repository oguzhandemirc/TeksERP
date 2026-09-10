// =============================================================================
// BEKÇİ — SEVKİYAT DETAY YÜZEYLERİ HATAYI "KAYIT YOK" DİYE BASMAZ
// =============================================================================
// ⭐ NEDEN VAR (2026-08-15). `ShipmentDetailSheet` ve `DirectShipmentDetailContent`
//    `!d` dalında "Sevkiyat bulunamadı." / "Fasondan sevk kaydı bulunamadı."
//    yazıyordu. İki uç da NON-NULLABLE döner → `!d` YALNIZCA hata demektir
//    (403 / ağ / 5xx). Yani ekran, var olan bir belgenin YOK olduğunu iddia
//    ediyordu.
//
// ⭐ NEDEN TAM ŞİMDİ KRİTİK: bu iki çekmece artık FATURA detayından da açılıyor
//    (`InvoicesPage` → "Kaynak (sevkiyat)" / "Kaynak (fasondan sevk)").
//    `role-template-catalog`taki "Kasa / Tahsilat" rolü `finance:read` taşır,
//    `shipping:read` TAŞIMAZ; `GET /api/shipping/shipments/:id` ise
//    `shipping:read|write|mobile:*` ile kapılı. O kullanıcı bir satış
//    faturasının kaynağına tıkladığında ekranda kalan TEK cümle "Sevkiyat
//    bulunamadı." oluyordu — interceptor'ın 403 toast'ı saniyelerde kaybolur ve
//    geriye faturanın dayandığı belgenin silindiği izlenimi kalır.
//
// ⭐ ÖLÇÜLEN: hata dalında (a) "bulunamadı" cümlesi YOK, (b) yüklenemedi başlığı
//    VAR, (c) "Tekrar dene" düğmesi VAR ve refetch'i çağırıyor, (d) backend'in
//    KENDİ cümlesi basılıyor (403 gövdesi ekranda kalır).
//    Kalıp: `GoodsReceiptDetailSheet` (aynı sınıf 2026-08-15'te orada kapandı).
//
// NEGATİF SONDA (koşuldu, kırmızı görüldü): iki dosyada da hata kutusu eski
// `<p>…bulunamadı.</p>` hâline döndürüldü → 6 kontrol KIRMIZI.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const getDetail = vi.fn();
const getDirectShipmentDetail = vi.fn();

vi.mock("./service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service")>();
  return {
    ...actual,
    shipmentService: {
      ...actual.shipmentService,
      getDetail: (...a: unknown[]) => getDetail(...a),
      getDirectShipmentDetail: (...a: unknown[]) => getDirectShipmentDetail(...a),
    },
  };
});

// Yazdırma/iptal diyalogları ağ konuşur ve ölçülen şey onlar değil.
vi.mock("./ShipmentDocDialog", () => ({ ShipmentDocDialog: () => null }));
vi.mock("./CancelShipmentDialog", () => ({ CancelShipmentDialog: () => null }));
vi.mock("./UndoDispatchDialog", () => ({ UndoDispatchDialog: () => null }));
vi.mock("./DirectShipPrintDialog", () => ({ DirectShipPrintDialog: () => null }));

import { ShipmentDetailSheet } from "./ShipmentDetailSheet";
import { DirectShipmentDetailContent } from "./DirectShipmentDetailContent";

/** Sahadaki gerçek olay: yetkisiz kullanıcı, gövdesinde kendi cümlesi olan 403. */
function forbidden(message: string) {
  return Object.assign(new Error("Request failed with status code 403"), {
    isAxiosError: true,
    response: { status: 403, data: { message } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ShipmentDetailSheet — hata dalı", () => {
  it("⭐ 403'te 'Sevkiyat bulunamadı' DEMEZ; yüklenemedi + Tekrar dene basar", async () => {
    getDetail.mockRejectedValue(forbidden("Bu işlem için yetkiniz bulunmuyor."));
    renderWithProviders(
      <ShipmentDetailSheet shipmentId="s1" open onOpenChange={() => {}} />,
    );

    await waitFor(() => expect(screen.getByText(/yüklenemedi/i)).toBeTruthy());
    // (a) YOK-luk iddiası basılmamalı.
    expect(screen.queryByText(/bulunamadı/i)).toBeNull();
    // (d) backend'in kendi cümlesi ekranda KALIR (toast kaybolur, kutu kalmaz).
    expect(screen.getByText(/yetkiniz bulunmuyor/i)).toBeTruthy();
    // (c) çıkış yolu var.
    const retry = screen.getByRole("button", { name: /tekrar dene/i });
    expect(retry).toBeTruthy();
  });

  it("Tekrar dene GERÇEKTEN yeniden sorar (ölü düğme değil)", async () => {
    getDetail.mockRejectedValue(forbidden("Sunucu hatası"));
    renderWithProviders(
      <ShipmentDetailSheet shipmentId="s2" open onOpenChange={() => {}} />,
    );
    await waitFor(() => expect(screen.getByText(/yüklenemedi/i)).toBeTruthy());
    const before = getDetail.mock.calls.length;
    screen.getByRole("button", { name: /tekrar dene/i }).click();
    await waitFor(() => expect(getDetail.mock.calls.length).toBeGreaterThan(before));
  });
});

describe("DirectShipmentDetailContent — hata dalı", () => {
  it("⭐ 403'te 'kaydı bulunamadı' DEMEZ; yüklenemedi + Tekrar dene basar", async () => {
    getDirectShipmentDetail.mockRejectedValue(
      forbidden("Bu işlem için yetkiniz bulunmuyor."),
    );
    renderWithProviders(<DirectShipmentDetailContent directShipmentId="d1" />);

    await waitFor(() => expect(screen.getByText(/yüklenemedi/i)).toBeTruthy());
    expect(screen.queryByText(/bulunamadı/i)).toBeNull();
    expect(screen.getByText(/yetkiniz bulunmuyor/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /tekrar dene/i })).toBeTruthy();
  });

  it("Tekrar dene GERÇEKTEN yeniden sorar", async () => {
    getDirectShipmentDetail.mockRejectedValue(forbidden("Sunucu hatası"));
    renderWithProviders(<DirectShipmentDetailContent directShipmentId="d2" />);
    await waitFor(() => expect(screen.getByText(/yüklenemedi/i)).toBeTruthy());
    const before = getDirectShipmentDetail.mock.calls.length;
    screen.getByRole("button", { name: /tekrar dene/i }).click();
    await waitFor(() =>
      expect(getDirectShipmentDetail.mock.calls.length).toBeGreaterThan(before),
    );
  });
});
