// K28 belge fotoğrafı saklama (panel): onay öncesi belge no vurgusu (kip FULL değilken), SİLİNDİ fotoğraf metni,
// tanıtma kapalı + açıklama, 410 kalıcı (yeniden denenmez, "silindi" metni).
// Negatif sonda: NoteHeaderForm'dan `docNoWarning` dalı ya da useScanImage'tan 410 dalı çıkarılınca kırmızı.
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { NoteHeaderForm } from "../NoteHeaderForm";
import { retentionDocNoWarning, SCAN_PURGED_TEXT } from "../photoRetention";
import { allReadPhotosPurged, teachableScans } from "../tanit/teachScans";
import { useScanImage } from "../useScanImage";
import type { DeliveryNoteDetail, DocumentScanInfo } from "../types";

vi.mock("@/components/forms/CustomerPickerField", () => ({ CustomerPickerField: () => null }));
vi.mock("@/components/forms/DatePickerInput", () => ({ DatePickerInput: () => null }));
const fetchScanBlob = vi.fn();
vi.mock("../service", () => ({ INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge", fetchScanBlob: (id: string) => fetchScanBlob(id) }));

const note = (o: Partial<DeliveryNoteDetail>) =>
  ({
    id: "n1", noteNo: "GB-0001", status: "DRAFT", ownerCustomerId: null, senderCustomerId: null, senderText: null, senderDocNo: "A-77",
    senderDocDate: null, customerBatchNo: null, customerOrderNo: null, processText: null, pageCount: null, declaredTopCount: null,
    updatedAt: "2026-11-03T08:00:00.000Z", ...o,
  }) as DeliveryNoteDetail;

describe("K28 onay öncesi belge no vurgusu", () => {
  it("§1 FULL ve eski backend (undefined) → uyarı yok", () => {
    expect(retentionDocNoWarning("FULL")).toBeNull();
    expect(retentionDocNoWarning(undefined)).toBeNull();
    render(<NoteHeaderForm note={note({ photoRetention: "FULL" })} suggestions={undefined} editable onPatch={vi.fn()} />);
    expect(screen.queryByTestId("docno-retention-warning")).toBeNull();
    expect(screen.getByLabelText("Gönderen belge no").getAttribute("data-highlight")).toBeNull();
  });
  it("§2 ONAYDA KÜÇÜLT → belge no kutusu vurgulu + uyarı", () => {
    render(<NoteHeaderForm note={note({ photoRetention: "SHRINK_ON_APPROVAL" })} suggestions={undefined} editable onPatch={vi.fn()} />);
    expect(screen.getByTestId("docno-retention-warning").textContent).toBe("Onaydan sonra fotoğraf küçültülecek — belge no'yu kontrol edin.");
    expect(screen.getByLabelText("Gönderen belge no").getAttribute("data-highlight")).toBe("retention");
  });
  it("§3 SİL kipleri kendi metnini söyler; onaylı (düzenlenemez) belgede vurgu yok", () => {
    expect(retentionDocNoWarning("DELETE_ON_APPROVAL")).toBe("Onaydan sonra fotoğraf silinecek — belge no'yu kontrol edin.");
    expect(retentionDocNoWarning("DELETE_ON_DISPATCH")).toContain("sevk edilince fotoğraf silinecek");
    render(<NoteHeaderForm note={note({ status: "APPROVED", photoRetention: "DELETE_ON_APPROVAL" })} suggestions={undefined} editable={false} onPatch={vi.fn()} />);
    expect(screen.queryByTestId("docno-retention-warning")).toBeNull();
  });
});

const scan = (o: Partial<DocumentScanInfo>): DocumentScanInfo => ({ id: "s1", noteId: "n1", pageNo: 1, regionNo: null, mimeType: "image/jpeg", sizeBytes: 1, status: "READ", attempts: 1, ...o });

describe("K28 SİLİNDİ fotoğraf", () => {
  it("§4 tanıtma: SİLİNDİ sayfa tanıtılamaz, KÜÇÜK tanıtılır", () => {
    expect(teachableScans([scan({ contentState: "PURGED" })])).toHaveLength(0);
    expect(teachableScans([scan({ contentState: "REDUCED" })])).toHaveLength(1);
    expect(allReadPhotosPurged([scan({ contentState: "PURGED" })])).toBe(true);
    expect(allReadPhotosPurged([scan({ contentState: "PURGED" }), scan({ id: "s2", contentState: "FULL" })])).toBe(false);
  });

  const wrap = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
    return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
  it("§5 410 → purged, yeniden denenmez; metin sabit", async () => {
    fetchScanBlob.mockReset().mockRejectedValue({ response: { status: 410 } });
    const { result } = renderHook(() => useScanImage("s1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.purged).toBe(true));
    expect(result.current.isError).toBe(false);
    expect(fetchScanBlob).toHaveBeenCalledTimes(1);
    expect(SCAN_PURGED_TEXT).toBe("Fotoğraf saklama ayarı gereği silindi.");
  });
  it("§6 künye SİLİNDİ → istek hiç atılmaz", () => {
    fetchScanBlob.mockReset();
    const { result } = renderHook(() => useScanImage("s1", { purged: true }), { wrapper: wrap() });
    expect(result.current.purged).toBe(true);
    expect(fetchScanBlob).not.toHaveBeenCalled();
  });
});
