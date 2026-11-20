import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReportIssueDialog } from "./ReportIssueDialog";
import { useDestekStore } from "./destek-store";
import { destekService } from "./service";
import { codeError } from "./testing";
import type { CreateTicketBody, TicketView } from "./types";

vi.mock("./service", () => ({ destekService: { create: vi.fn(), unread: vi.fn() } }));
const svc = vi.mocked(destekService);

const TICKET: TicketView = {
  id: "5f0c2a1e-8d4b-4c61-9a57-1d2e3f4a5b6c",
  number: "DST-2026-000123",
  type: "BUG",
  status: "NEW",
  subject: "Yazdırma",
  createdAt: "2026-11-15T09:12:44.120Z",
  updatedAt: "2026-11-15T09:12:44.120Z",
  closedAt: null,
  messages: [],
};

function open(shot: string | null = null) {
  act(() => useDestekStore.getState().openReport(shot));
}

function fill() {
  fireEvent.change(screen.getByLabelText("Konu"), { target: { value: "Yazdırma" } });
  fireEvent.change(screen.getByLabelText("Mesaj"), { target: { value: "Boş sayfa çıkıyor" } });
}

const tokens = () => svc.create.mock.calls.map((c) => (c[0] as CreateTicketBody).clientToken);

beforeEach(() => {
  vi.resetAllMocks();
  useDestekStore.getState().reset();
  useDestekStore.getState().setEnabled(true);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReportIssueDialog />
    </QueryClientProvider>,
  );
});

describe("talep formu — doğrulama ve bağlam", () => {
  it("boş konu/mesaj gönderilmez, Türkçe hata çıkar", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
    expect(screen.getByText("Konu boş olamaz.")).toBeInTheDocument();
    expect(screen.getByText("Mesaj boş olamaz.")).toBeInTheDocument();
    expect(svc.create).not.toHaveBeenCalled();
  });

  it("açılış ekran görüntüsü ilk ek olarak gider; bağlam otomatik eklenir; aydınlatma satırı görünür", async () => {
    svc.create.mockResolvedValue(TICKET);
    open("UE5H");
    expect(screen.getByText("Destek talepleri Etkili Yazılım destek sisteminde işlenir.")).toBeInTheDocument();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
    await waitFor(() => expect(svc.create).toHaveBeenCalledTimes(1));
    const body = svc.create.mock.calls[0]![0] as CreateTicketBody;
    expect(body.files).toEqual([{ name: "ekran-goruntusu.png", contentType: "image/png", dataBase64: "UE5H" }]);
    expect(body.context?.technical).toHaveProperty("windowSize");
    expect(body).toMatchObject({ type: "BUG", subject: "Yazdırma" });
    await waitFor(() => expect(useDestekStore.getState().report.open).toBe(false));
  });
});

describe("talep formu — clientToken deneme başına bir kez", () => {
  it("504 sonrası form kapanmaz; tekrar deneme AYNI token'la gider", async () => {
    svc.create.mockRejectedValueOnce(codeError(504, "DESTEK_ZAMAN_ASIMI")).mockResolvedValueOnce(TICKET);
    open();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
    expect(await screen.findByText(/ulaşılamıyor/)).toBeInTheDocument();
    expect(useDestekStore.getState().report.open).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    await waitFor(() => expect(svc.create).toHaveBeenCalledTimes(2));
    expect(tokens()[0]).toBeTruthy();
    expect(tokens()[1]).toBe(tokens()[0]);
  });

  it("çift tıklama ikinci istek atmaz", async () => {
    let resolve: (t: TicketView) => void = () => {};
    svc.create.mockImplementation(() => new Promise<TicketView>((r) => (resolve = r)));
    open();
    fill();
    const btn = screen.getByRole("button", { name: "Gönder" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.submit(btn.closest("form")!);
    await act(async () => {});
    expect(svc.create).toHaveBeenCalledTimes(1);
    await act(async () => resolve(TICKET));
  });

  it("başarıdan sonra yeni açılan form YENİ token üretir", async () => {
    svc.create.mockResolvedValue(TICKET);
    open();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
    await waitFor(() => expect(useDestekStore.getState().report.open).toBe(false));
    open();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
    await waitFor(() => expect(svc.create).toHaveBeenCalledTimes(2));
    expect(tokens()[1]).not.toBe(tokens()[0]);
  });
});
