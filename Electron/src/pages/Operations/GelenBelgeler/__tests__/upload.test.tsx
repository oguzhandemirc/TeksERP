// E1 panel yükleme: küçültme (2600 px), sha256 isteğe girer, aynı dosya bir kez, yarıda kalan gönderimin
// tekrarı ikinci taslak açmaz, PDF notu, READ_FAILED bandı + yeniden okut, tarih süzgeci sunucuya gider.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { renderWithProviders } from "@/test/render";
import { fitLongEdge, mergePages, prepareFile, readBytes, sha256Hex, type ImageCodec, type UploadPage } from "../uploadPrep";
import { submitUpload, nextPageNo, pageLimitError, UploadError } from "../submitUpload";
import { ScanReadBanner, scanFailCode } from "../ScanReadBanner";
import { UploadDialog } from "../UploadDialog";
import { IncomingDocumentsPage } from "../GelenBelgelerPage";
import type { DocumentScanInfo } from "../types";

vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/forms/CustomerPickerField", () => ({
  CustomerPickerField: ({ placeholder }: { placeholder?: string }) => <button type="button">{placeholder}</button>,
}));
vi.mock("@/components/forms/DateRangeInput", () => ({
  DateRangeInput: ({ onFrom, onTo }: { onFrom: (v: string) => void; onTo: (v: string) => void }) => (
    <>
      <button type="button" onClick={() => onFrom("2026-10-01")}>başlangıç-seç</button>
      <button type="button" onClick={() => onTo("2026-10-29")}>bitiş-seç</button>
    </>
  ),
}));

const listDeliveryNotes = vi.fn();
const requeueScan = vi.fn();
vi.mock("../service", () => ({
  INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge",
  listDeliveryNotes: (...a: unknown[]) => listDeliveryNotes(...a),
  requeueScan: (...a: unknown[]) => requeueScan(...a),
  createManualNote: vi.fn(),
  createUploadNote: vi.fn(),
  uploadScan: vi.fn(),
  getReaderStatus: vi.fn(() => new Promise(() => {})),
}));

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const file = (name: string, head: number[], size = 64) => {
  const b = new Uint8Array(size);
  b.set(head);
  b[size - 1] = name.length;
  return new File([b], name);
};
function codec(width: number, height: number) {
  const toJpeg = vi.fn(async (_b: Blob, w: number, h: number) => new Blob([new Uint8Array([...JPEG, w & 255, h & 255])], { type: "image/jpeg" }));
  const c: ImageCodec = { size: async () => ({ width, height }), toJpeg };
  return { c, toJpeg };
}
const page = (sha: string, over: Partial<UploadPage> = {}): UploadPage => ({
  name: `${sha}.jpg`, mimeType: "image/jpeg", base64: "AAAA", sha256: sha, sizeBytes: 3, width: 10, height: 10, resized: false, ...over,
});
const scan = (o: Partial<DocumentScanInfo>): DocumentScanInfo => ({
  id: "s1", noteId: "n1", pageNo: 1, regionNo: null, mimeType: "image/jpeg", sizeBytes: 100, status: "READ", attempts: 1, ...o,
});
const err = (status: number) => new AxiosError("x", "E", undefined, undefined, { status, data: {} } as AxiosResponse);

beforeEach(() => {
  listDeliveryNotes.mockReset().mockResolvedValue({ items: [], nextCursor: null, summary: { DRAFT: 0, APPROVING: 0, APPROVED: 0, PARTIAL: 0, CANCELLED: 0, total: 0 } });
  requeueScan.mockReset().mockResolvedValue({});
});

describe("hazırlık", () => {
  it("büyük JPEG (4000×3000) → uzun kenar 2600, JPEG 0,8", async () => {
    const { c, toJpeg } = codec(4000, 3000);
    const r = await prepareFile(file("buyuk.jpg", JPEG), c);
    expect(toJpeg).toHaveBeenCalledWith(expect.anything(), 2600, 1950, 0.8);
    expect(r.kind === "ok" && r.page.resized && Math.max(r.page.width!, r.page.height!) <= 2600).toBe(true);
  });
  it("küçük dosya dokunulmaz (bayt ve özet aynı)", async () => {
    const { c, toJpeg } = codec(1600, 1200);
    const f = file("kucuk.jpg", JPEG);
    const r = await prepareFile(f, c);
    expect(toJpeg).not.toHaveBeenCalled();
    expect(r.kind === "ok" && r.page.sha256 === (await sha256Hex(await readBytes(f)))).toBe(true);
    expect(fitLongEdge(2600, 100).scaled).toBe(false);
  });
  it("PDF küçültülmez; tanınmayan tür reddedilir", async () => {
    const { c, toJpeg } = codec(1, 1);
    const pdf = await prepareFile(file("a.pdf", [0x25, 0x50, 0x44, 0x46]), c);
    expect(pdf.kind === "ok" && pdf.page.mimeType === "application/pdf").toBe(true);
    expect(toJpeg).not.toHaveBeenCalled();
    expect((await prepareFile(file("a.exe", [0x4d, 0x5a]), c)).kind).toBe("unsupported");
  });
  it("aynı dosya iki kez → listede 1", () => {
    const m = mergePages([page("a")], [page("a"), page("b"), page("b")]);
    expect(m.pages.map((p) => p.sha256)).toEqual(["a", "b"]);
    expect(m.duplicates).toHaveLength(2);
  });
});

describe("gönderim", () => {
  const attempt = () => ({ token: vi.fn(() => "tok-1"), onFailure: vi.fn(), onSuccess: vi.fn() });
  it("sha256 isteğe girer; sayfa numarası sıradan", async () => {
    const api = { createDraftNote: vi.fn(async (_b: unknown) => ({ id: "n1", noteNo: "GB-1" })), uploadScan: vi.fn(async (_b: unknown) => ({ duplicate: false })) };
    await submitUpload(api, { pages: [page("a"), page("b")], ownerCustomerId: "o", senderDocNo: "D1", firstPageNo: 1 }, attempt());
    expect(api.createDraftNote).toHaveBeenCalledWith({ clientToken: "tok-1", sourceKind: "MANUAL", ownerCustomerId: "o", senderDocNo: "D1" });
    expect(api.uploadScan.mock.calls.map((c) => c[0])).toEqual([
      { contentBase64: "AAAA", noteId: "n1", pageNo: 1, sha256: "a" },
      { contentBase64: "AAAA", noteId: "n1", pageNo: 2, sha256: "b" },
    ]);
  });
  it("yarıda kalan gönderimin tekrarı ikinci başlık AÇMAZ, yüklenen sayfayı atlar", async () => {
    let fail = true;
    const api = {
      createDraftNote: vi.fn(async () => ({ id: "n1", noteNo: "GB-1" })),
      uploadScan: vi.fn(async (b: { sha256: string }) => {
        if (b.sha256 === "b" && fail) { fail = false; throw err(503); }
        return { duplicate: false };
      }),
    };
    const input = { pages: [page("a"), page("b")], ownerCustomerId: null, senderDocNo: null, firstPageNo: 1 };
    const a = attempt();
    const e = await submitUpload(api, input, a).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UploadError);
    const r = await submitUpload(api, input, a, (e as UploadError).progress);
    expect(api.createDraftNote).toHaveBeenCalledTimes(1);
    expect(api.uploadScan.mock.calls.map((c) => c[0].sha256)).toEqual(["a", "b", "b"]);
    expect(r.note.id).toBe("n1");
    expect(a.onSuccess).toHaveBeenCalledTimes(1);
  });
  it("sayfa ekle: taslak hazır → başlık çağrısı yok; sıradaki pageNo", async () => {
    const api = { createDraftNote: vi.fn(), uploadScan: vi.fn(async () => ({ duplicate: false })) };
    await submitUpload(api, { pages: [page("c")], ownerCustomerId: null, senderDocNo: null, firstPageNo: nextPageNo([{ pageNo: 1 }, { pageNo: 2 }]) }, attempt(), { note: { id: "n9", noteNo: "GB-9" }, uploaded: new Set() });
    expect(api.createDraftNote).not.toHaveBeenCalled();
    expect(api.uploadScan).toHaveBeenCalledWith(expect.objectContaining({ noteId: "n9", pageNo: 3 }));
  });
  it("sayfa tavanı: son sayfa 99'u aşarsa uyarı (sunucu .max(99) ikizi)", () => {
    expect(pageLimitError(98, 2)).toBeNull();
    expect(pageLimitError(98, 3)).toMatch(/en çok 99 sayfa/);
  });
});

describe("ekranlar", () => {
  it("PDF seçilince 'PDF otomatik okunmaz' notu", async () => {
    renderWithProviders(<UploadDialog open onOpenChange={() => {}} target={{ kind: "new" }} onDone={() => {}} />);
    fireEvent.change(screen.getByTestId("upload-file-input"), { target: { files: [file("irsaliye.pdf", [0x25, 0x50, 0x44, 0x46])] } });
    expect(await screen.findByTestId("upload-pdf-note")).toHaveTextContent("PDF otomatik okunmaz");
    expect(screen.getByText("irsaliye.pdf")).toBeInTheDocument();
  });
  it("READ_FAILED bandı + Yeniden okut → okut ucu", async () => {
    const onRequeued = vi.fn();
    renderWithProviders(<ScanReadBanner scans={[scan({ status: "READ_FAILED", attempts: 3 })]} canRequeue onRequeued={onRequeued} />);
    expect(screen.getByTestId("scan-read-failed")).toHaveTextContent("üç denemede");
    await userEvent.click(screen.getByRole("button", { name: /Yeniden okut/ }));
    await waitFor(() => expect(requeueScan).toHaveBeenCalledWith("s1"));
    expect(onRequeued).toHaveBeenCalled();
  });
  it("PDF taraması başarısızlık bandı değil not; okunuyor bilgisi; READ band yok", () => {
    renderWithProviders(
      <ScanReadBanner scans={[scan({ id: "p", mimeType: "application/pdf", status: "READ_FAILED", attempts: 0 }), scan({ id: "q", pageNo: 2, status: "PENDING" }), scan({ id: "r", pageNo: 3 })]} canRequeue onRequeued={() => {}} />,
    );
    expect(screen.getByTestId("scan-pdf-note")).toHaveTextContent("PDF otomatik okunmaz");
    expect(screen.queryByTestId("scan-read-failed")).toBeNull();
    expect(screen.getAllByTestId("scan-reading")).toHaveLength(1);
    expect(scanFailCode({ mimeType: "image/png", attempts: 1 })).toBe("UNREADABLE");
  });
  it("tarih süzgeci isteğe parametre olarak gider", async () => {
    renderWithProviders(<IncomingDocumentsPage />);
    await waitFor(() => expect(listDeliveryNotes).toHaveBeenCalled());
    await userEvent.click(screen.getByText("başlangıç-seç"));
    await userEvent.click(screen.getByText("bitiş-seç"));
    await waitFor(() => expect(listDeliveryNotes).toHaveBeenLastCalledWith(expect.objectContaining({ from: "2026-10-01", to: "2026-10-29" })));
  });
});
