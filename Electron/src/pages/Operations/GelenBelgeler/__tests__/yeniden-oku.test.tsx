// "Okundu ama satır çıkmadı" bandı: satırsız READ sayfada band + "Yeniden oku" (okut ucu), satırlı sayfada yok,
// eski backend (scanId yok) band çizmez, elle satır/taslak dışı düğmeyi gizler, red `details.code`ten okunur.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { renderWithProviders } from "@/test/render";
import { ScanReadBanner, readWithoutLines } from "../ScanReadBanner";
import type { DeliveryNoteLine, DocumentScanInfo } from "../types";

const requeueScan = vi.fn();
vi.mock("../service", () => ({ requeueScan: (...a: unknown[]) => requeueScan(...a) }));

const scan = (o: Partial<DocumentScanInfo> = {}): DocumentScanInfo => ({
  id: "s1", noteId: "n1", pageNo: 1, regionNo: null, mimeType: "image/jpeg", sizeBytes: 100, status: "READ", attempts: 1, ...o,
});
const line = (scanId: string | null | undefined): DeliveryNoteLine => ({ id: `l-${String(scanId)}`, scanId } as DeliveryNoteLine);

beforeEach(() => {
  requeueScan.mockReset().mockResolvedValue({});
});

describe("okundu ama satır çıkmadı", () => {
  it("satırsız READ sayfada band + Yeniden oku → okut ucu", async () => {
    const onRequeued = vi.fn();
    renderWithProviders(<ScanReadBanner scans={[scan()]} lines={[]} editable canRequeue onRequeued={onRequeued} />);
    expect(screen.getByTestId("scan-read-empty")).toHaveTextContent("Sayfa okundu ama bu sayfadan satır çıkmadı.");
    await userEvent.click(screen.getByRole("button", { name: /Yeniden oku/ }));
    await waitFor(() => expect(requeueScan).toHaveBeenCalledWith("s1"));
    expect(onRequeued).toHaveBeenCalled();
  });

  it("satırı olan sayfada band yok; yalnız satırsız sayfa çizilir", () => {
    renderWithProviders(
      <ScanReadBanner scans={[scan(), scan({ id: "s2", pageNo: 2 })]} lines={[line("s1")]} editable canRequeue onRequeued={() => {}} />,
    );
    const bands = screen.getAllByTestId("scan-read-empty");
    expect(bands).toHaveLength(1);
    expect(bands[0]).toHaveTextContent("Sayfa 2:");
  });

  it("eski backend (scanId yok), satır verilmemesi ve PDF band çizmez", () => {
    expect(readWithoutLines(scan(), [line(undefined)])).toBe(false);
    expect(readWithoutLines(scan(), undefined)).toBe(false);
    expect(readWithoutLines(scan({ mimeType: "application/pdf" }), [])).toBe(false);
    expect(readWithoutLines(scan({ status: "PENDING" }), [])).toBe(false);
    expect(readWithoutLines(scan(), [line("baska")])).toBe(true);
  });

  it("düğme yalnız izinli + taslak + elle satırsız durumda", () => {
    const { unmount } = renderWithProviders(<ScanReadBanner scans={[scan()]} lines={[]} editable={false} canRequeue onRequeued={() => {}} />);
    expect(screen.getByTestId("scan-read-empty")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Yeniden oku/ })).toBeNull();
    unmount();
    const r2 = renderWithProviders(<ScanReadBanner scans={[scan()]} lines={[]} editable canRequeue={false} onRequeued={() => {}} />);
    expect(screen.queryByRole("button", { name: /Yeniden oku/ })).toBeNull();
    r2.unmount();
    renderWithProviders(<ScanReadBanner scans={[scan()]} lines={[line(null)]} editable canRequeue onRequeued={() => {}} />);
    expect(screen.queryByRole("button", { name: /Yeniden oku/ })).toBeNull();
  });

  it("sunucu reddi details.code ile operatör diline çevrilir", async () => {
    requeueScan.mockRejectedValue(
      new AxiosError("x", "E", undefined, undefined, { status: 409, data: { message: "ham", details: { code: "DELIVERY_NOTE_NOT_DRAFT" } } } as AxiosResponse),
    );
    renderWithProviders(<ScanReadBanner scans={[scan()]} lines={[]} editable canRequeue onRequeued={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Yeniden oku/ }));
    expect(await screen.findByTestId("scan-reread-error")).toHaveTextContent("Belge artık taslak değil");
  });
});
