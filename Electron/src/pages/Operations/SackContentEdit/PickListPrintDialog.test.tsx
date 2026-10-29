import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PickListPrintDialog } from "./PickListPrintDialog";
import type { PickListRow } from "./types";

// =============================================================================
// ÇEKİ LİSTESİ NO — kâğıt KAYITTAN çizilir, numara sağ üstte (2026-09-23, kullanıcı kararı).
// "Yazdır" sunucuda kaydı doğurur; basılan içerik dönen anlık görüntüdür, numara istemcide
// üretilmez. Baskı, numara DOM'a girdikten SONRA tetiklenir.
// =============================================================================

const row = (id: string, sackNo: string, qty: number): PickListRow =>
  ({
    id, sackNo, seq: 1, weightKg: null, notes: null, tags: [], customer: { id: "c", name: "Cari" }, branch: null,
    shipment: null, rollCount: 1, swatchCount: 0, totalQty: qty, contents: [],
  }) as unknown as PickListRow;

const pickList = vi.fn();
const printPickList = vi.fn();
vi.mock("./service", () => ({
  sackHubService: {
    pickList: (...a: unknown[]) => pickList(...a),
    printPickList: (...a: unknown[]) => printPickList(...a),
  },
}));
const basilanlar: string[] = [];
const basimKonusu: unknown[] = [];
vi.mock("@/lib/print", () => ({
  printTracked: (o: { root: HTMLElement; subject: unknown }) => {
    basilanlar.push(o.root.textContent ?? "");
    basimKonusu.push(o.subject);
    return Promise.resolve({ status: "ILETILDI", proceed: true, printJob: {} });
  },
  preparePrintJob: () => Promise.resolve({ clientToken: "11111111-1111-4111-8111-111111111111", transport: "SISTEM_PENCERESI" }),
}));
// Yetenek tespiti sahtelenir: eski backend (uç yok) ↔ yeni backend.
const yetenek = vi.hoisted(() => ({ var: false }));
vi.mock("@/services/printJobService", () => ({ supportsPrintJobs: () => Promise.resolve(yetenek.var) }));

function ciz() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PickListPrintDialog sackIds={["s1", "s2"]} onOpenChange={() => undefined} />
    </QueryClientProvider>,
  );
}

describe("PickListPrintDialog — çeki listesi no", () => {
  beforeEach(() => {
    pickList.mockReset();
    printPickList.mockReset();
    basilanlar.length = 0;
    basimKonusu.length = 0;
    yetenek.var = false;
    pickList.mockResolvedValue({ success: true, data: [row("s1", "C-ONIZLEME", 10)] });
  });

  it("⭐ önizlemede numara YOK; Yazdır → kayıt doğar, kâğıt ANLIK GÖRÜNTÜDEN çizilir, numara sağ üstte, baskı numarayla", async () => {
    printPickList.mockResolvedValue({
      success: true,
      data: { id: "m1", manifestNo: "CL2309260001", printedAt: "2026-09-23T10:00:00Z", reused: false, snapshot: [row("s1", "C-KAYIT", 12)] },
    });
    ciz();
    await screen.findByText("C-ONIZLEME");
    expect(screen.queryByTestId("ceki-listesi-no")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Yazdır/ }));
    await waitFor(() => expect(basilanlar).toHaveLength(1));
    expect(printPickList).toHaveBeenCalledWith(["s1", "s2"], expect.stringMatching(/^[0-9a-f-]{36}$/), undefined);
    expect(basimKonusu[0]).toMatchObject({ kind: "CEKI_LISTESI", table: "manifests", id: "m1", no: "CL2309260001" });
    expect(screen.getByTestId("ceki-listesi-no").textContent).toContain("CL2309260001");
    expect(basilanlar[0]).toContain("CL2309260001"); // basılan kâğıtta numara var
    expect(basilanlar[0]).toContain("C-KAYIT"); // içerik kayıttan
    expect(basilanlar[0]).not.toContain("C-ONIZLEME");
  });

  it("kesin 4xx → token yapışmaz (sonraki deneme yeni token); 5xx → aynı token", async () => {
    const err = (status: number) => Object.assign(new Error("x"), { response: { status } });
    printPickList.mockRejectedValueOnce(err(400)).mockRejectedValueOnce(err(503)).mockRejectedValueOnce(err(503));
    ciz();
    await screen.findByText("C-ONIZLEME");
    const dugme = () => screen.getByRole("button", { name: /Yazdır/ });
    fireEvent.click(dugme());
    await waitFor(() => expect(printPickList).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(dugme()).not.toBeDisabled());
    fireEvent.click(dugme());
    await waitFor(() => expect(printPickList).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(dugme()).not.toBeDisabled());
    fireEvent.click(dugme());
    await waitFor(() => expect(printPickList).toHaveBeenCalledTimes(3));
    const t = printPickList.mock.calls.map((c) => c[1]);
    expect(t[1]).not.toBe(t[0]); // 400 sonrası yeni deneme
    expect(t[2]).toBe(t[1]); // 503 sonrası aynı deneme
    expect(basilanlar).toHaveLength(0); // kayıt doğmadan kâğıt basılmaz
  });

  it("⭐ ESKİ backend (yazdırma geçmişi yok): katı şemalı uca `printJob` alanı GÖNDERİLMEZ (400 olmasın)", async () => {
    yetenek.var = false;
    printPickList.mockResolvedValue({
      success: true,
      data: { id: "m1", manifestNo: "CL1", printedAt: "2026-09-23T10:00:00Z", reused: false, snapshot: [row("s1", "C-KAYIT", 12)] },
    });
    ciz();
    await screen.findByText("C-ONIZLEME");
    fireEvent.click(screen.getByRole("button", { name: /Yazdır/ }));
    await waitFor(() => expect(basilanlar).toHaveLength(1));
    expect(printPickList.mock.calls[0]?.[2]).toBeUndefined();
  });

  it("YENİ backend: künye (`printJob`) eklenir", async () => {
    yetenek.var = true;
    printPickList.mockResolvedValue({
      success: true,
      data: { id: "m1", manifestNo: "CL1", printedAt: "2026-09-23T10:00:00Z", reused: false, snapshot: [row("s1", "C-KAYIT", 12)] },
    });
    ciz();
    await screen.findByText("C-ONIZLEME");
    fireEvent.click(screen.getByRole("button", { name: /Yazdır/ }));
    await waitFor(() => expect(basilanlar).toHaveLength(1));
    expect(printPickList.mock.calls[0]?.[2]).toMatchObject({ transport: "SISTEM_PENCERESI" });
  });
});

// MÜŞTERİ BELGESİNDEKİ AD (gelen belge E3): seçenek varsayılan KAPALI; yalnız metni olan çuval varken görünür.
describe("PickListPrintDialog — müşteri belgesindeki ad", () => {
  const withContents = (contents: PickListRow["contents"]): PickListRow => ({ ...row("s1", "C-ONIZLEME", 10), contents });
  beforeEach(() => pickList.mockReset());
  it("⭐ müşteri belgesi adı: kutu varsayılan KAPALI, işaretlenince içerik altında basılır", async () => {
    pickList.mockResolvedValue({ success: true, data: [withContents([
      { itemName: "Süprem", colorName: null, width: 150, qty: 10, rollCount: 1, deliveryNoteItemText: "Müşteri Süprem", deliveryNoteColorText: "Lacivert" },
    ])] });
    ciz();
    await screen.findByText("C-ONIZLEME");
    const kutu = screen.getByRole("checkbox", { name: /Müşteri belgesindeki adı bas/ });
    expect(kutu).not.toBeChecked();
    expect(screen.queryByTestId("ceki-musteri-adi")).toBeNull();
    fireEvent.click(kutu);
    expect(screen.getByTestId("ceki-musteri-adi").textContent).toBe("Müşteri belgesi: Müşteri Süprem · Lacivert");
  });

  it("müşteri belgesi metni olmayan dökümde kutu HİÇ çizilmez", async () => {
    pickList.mockResolvedValue({ success: true, data: [withContents([{ itemName: "Süprem", colorName: null, width: 150, qty: 10, rollCount: 1 }])] });
    ciz();
    await screen.findByText("C-ONIZLEME");
    expect(screen.queryByRole("checkbox", { name: /Müşteri belgesindeki adı bas/ })).toBeNull();
  });
});
