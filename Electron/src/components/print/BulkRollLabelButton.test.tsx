import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { BulkRollLabelButton } from "./BulkRollLabelButton";

// =============================================================================
// TOPLU TOP ETİKETİ DAMGASI (izlenebilirlik KARAR: toplu basım `labelPrintedAt` damgalar).
// Başarıda `bulk-print-event` çağrılır (künyeyle); iptal/hata → çağrılmaz (print-event yalnız
// başarıda). Sonda (2026-10-24): `if (out.proceed)` koşulu kaldırıldı → "iptalde çağrılmaz"
// kırmızı; geri alındı → yeşil.
// =============================================================================

vi.mock("@/lib/runtime-env", () => ({ IS_ELECTRON: true }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const printTracked = vi.fn();
vi.mock("@/lib/print", () => ({ printTracked: (...a: unknown[]) => printTracked(...a) }));

const printRollsBulk = vi.fn();
const directState = { enabled: false };
vi.mock("@/hooks/useLabelPrinter", () => ({
  useLabelPrinter: () => ({ directEnabled: directState.enabled, printRollsBulk, peripheralId: undefined }),
}));

const recordBulkRollPrintEvent = vi.fn();
vi.mock("@/services/labelService", () => ({
  labelService: {
    getRollPreview: vi.fn().mockResolvedValue({ mode: "html", language: "HTML", content: "<p>e</p>" }),
    getBulkRollLabelsHtml: vi.fn().mockResolvedValue("<p>toplu</p>"),
    recordBulkRollPrintEvent: (...a: unknown[]) => recordBulkRollPrintEvent(...a),
  },
}));

const JOB = { transport: "SISTEM_PENCERESI", durationMs: 4 };

function clickPrint(n: number) {
  renderWithProviders(<BulkRollLabelButton rollIds={Array.from({ length: n }, (_, i) => `r${i}`)} open onOpenChange={() => undefined} />);
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`${n} etiketi bas`) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  directState.enabled = false;
  recordBulkRollPrintEvent.mockResolvedValue({});
});

describe("BulkRollLabelButton — toplu damga", () => {
  it("sistem penceresi başarıda bulk-print-event künyeyle çağrılır", async () => {
    printTracked.mockResolvedValue({ status: "ILETILDI", proceed: true, printJob: JOB });
    clickPrint(2);
    await waitFor(() => expect(recordBulkRollPrintEvent).toHaveBeenCalledTimes(1));
    expect(recordBulkRollPrintEvent).toHaveBeenCalledWith(["r0", "r1"], JOB);
    expect(printTracked.mock.calls[0]?.[0]).toMatchObject({ subject: { kind: "ETIKET_TOPLU", ids: ["r0", "r1"] }, workEndpoint: true });
  });

  it("pencere iptal edilince bulk-print-event çağrılmaz", async () => {
    printTracked.mockResolvedValue({ status: "IPTAL", proceed: false, printJob: JOB });
    clickPrint(2);
    await waitFor(() => expect(printTracked).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(recordBulkRollPrintEvent).not.toHaveBeenCalled();
  });

  it("doğrudan yazıcı hatasında çağrılmaz, başarısında çağrılır", async () => {
    directState.enabled = true;
    printRollsBulk.mockResolvedValueOnce({ ok: false, error: "kapalı" });
    clickPrint(1);
    await waitFor(() => expect(printRollsBulk).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(recordBulkRollPrintEvent).not.toHaveBeenCalled();
  });

  it("doğrudan yazıcı başarısında künyeyle çağrılır", async () => {
    directState.enabled = true;
    printRollsBulk.mockResolvedValueOnce({ ok: true, printJob: { transport: "SERI" } });
    clickPrint(1);
    await waitFor(() => expect(recordBulkRollPrintEvent).toHaveBeenCalledWith(["r0"], { transport: "SERI" }));
  });
});
