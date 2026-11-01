// HEIC yükleme + sürükle-bırak: HEIC sihirli baytı kabul (çözücüye gitmez, yer tutucu), boş MIME'lı `.heic` uzantıyla
// aday, desteklenmeyen tür TEK uyarı, bırakma alanı sürüklemede vurgulanır, liste sayfasına bırakma modalı açar.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { detectScanMime, HEIC_MIME, isAcceptedFile, prepareFile, splitAcceptedFiles, UPLOAD_ACCEPT, type ImageCodec } from "../uploadPrep";
import { UploadDialog } from "../UploadDialog";
import { IncomingDocumentsPage } from "../GelenBelgelerPage";

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
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => p.startsWith("gelen-belge:"), isAdmin: false }) }));
const toastWarning = vi.fn();
vi.mock("sonner", () => ({ toast: { warning: (...a: unknown[]) => toastWarning(...a), success: vi.fn(), error: vi.fn() } }));
const listDeliveryNotes = vi.fn();
vi.mock("../service", () => ({
  INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge",
  listDeliveryNotes: (...a: unknown[]) => listDeliveryNotes(...a),
  requeueScan: vi.fn(),
  createManualNote: vi.fn(),
  createUploadNote: vi.fn(),
  uploadScan: vi.fn(),
  previewBulkDelete: vi.fn(),
  bulkDeleteNotes: vi.fn(),
  getReaderStatus: vi.fn(() => new Promise(() => {})),
}));

const ftyp = (brand: string) => [0, 0, 0, 0x18, ...Array.from("ftyp" + brand, (c) => c.charCodeAt(0))];
const file = (name: string, head: number[], type = "", size = 64) => {
  const b = new Uint8Array(size);
  b.set(head);
  b[size - 1] = name.length;
  return new File([b], name, { type });
};
const HEIC = ftyp("heic");
/** Drag olayının dataTransfer'i (jsdom'da yok). */
const dt = (files: File[]) => ({ dataTransfer: { types: ["Files"], files, dropEffect: "none" } });

beforeEach(() => {
  toastWarning.mockReset();
  listDeliveryNotes.mockReset().mockResolvedValue({ items: [], nextCursor: null, summary: { DRAFT: 0, APPROVING: 0, APPROVED: 0, PARTIAL: 0, CANCELLED: 0, total: 0 } });
});

describe("HEIC tanıma", () => {
  it("ftyp heic/heix/mif1 → HEIC; avif/isom → değil", () => {
    for (const b of ["heic", "heix", "mif1", "msf1"]) expect(detectScanMime(new Uint8Array([...ftyp(b), 0, 0]))).toBe(HEIC_MIME);
    expect(detectScanMime(new Uint8Array([...ftyp("avif"), 0, 0]))).toBeNull();
    expect(detectScanMime(new Uint8Array([...ftyp("isom"), 0, 0]))).toBeNull();
  });
  it("HEIC çözücüye gitmez, baytı dokunulmadan gider (boy yok)", async () => {
    const c: ImageCodec = { size: vi.fn(), toJpeg: vi.fn() };
    const r = await prepareFile(file("IMG_0001.HEIC", HEIC), c);
    expect(r.kind === "ok" && r.page.mimeType === HEIC_MIME && r.page.width === null && !r.page.resized).toBe(true);
    expect(c.size).not.toHaveBeenCalled();
    expect(c.toJpeg).not.toHaveBeenCalled();
  });
  it("boş MIME'lı .heic/.heif uzantıyla aday; accept uzantıları taşır; .docx reddedilir", () => {
    expect(isAcceptedFile({ name: "IMG_0001.HEIC", type: "" })).toBe(true);
    expect(isAcceptedFile({ name: "foto.heif", type: "" })).toBe(true);
    expect(isAcceptedFile({ name: "adsiz", type: "image/heic" })).toBe(true);
    expect(isAcceptedFile({ name: "rapor.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toBe(false);
    for (const t of [".heic", ".heif", "image/heic", "image/heif"]) expect(UPLOAD_ACCEPT.split(",")).toContain(t);
  });
  it("reddedilenler TEK uyarıda toplanır", () => {
    const r = splitAcceptedFiles([{ name: "a.docx", type: "" }, { name: "b.zip", type: "" }, { name: "c.jpg", type: "image/jpeg" }]);
    expect(r.accepted.map((f) => f.name)).toEqual(["c.jpg"]);
    expect(r.notice).toMatch(/a\.docx, b\.zip/);
    expect(r.notice).toMatch(/JPEG, PNG, HEIC ya da PDF/);
    expect(splitAcceptedFiles([{ name: "c.jpg", type: "" }]).notice).toBeNull();
  });
});

describe("yükleme modalı", () => {
  const dialog = () => renderWithProviders(<UploadDialog open onOpenChange={() => {}} target={{ kind: "new" }} onDone={() => {}} />);

  it("seçilen HEIC listede yer tutucuyla görünür", async () => {
    dialog();
    fireEvent.change(screen.getByTestId("upload-file-input"), { target: { files: [file("IMG_0001.HEIC", HEIC)] } });
    expect(await screen.findByTestId("upload-heic-note")).toHaveTextContent("HEIC — yüklenince JPEG'e çevrilir");
    expect(screen.getByText("IMG_0001.HEIC")).toBeInTheDocument();
  });
  it("bırakma alanı sürüklemede vurgulanır, ayrılınca söner", () => {
    dialog();
    const zone = screen.getByTestId("upload-drop-zone");
    expect(zone).toHaveAttribute("data-active", "false");
    fireEvent.dragEnter(zone, dt([]));
    expect(zone).toHaveAttribute("data-active", "true");
    fireEvent.dragLeave(zone, dt([]));
    expect(zone).toHaveAttribute("data-active", "false");
  });
  it("bırakılan HEIC + PDF listeye girer; desteklenmeyen tek uyarı verir", async () => {
    dialog();
    const zone = screen.getByTestId("upload-drop-zone");
    fireEvent.dragEnter(zone, dt([]));
    fireEvent.drop(zone, dt([file("IMG_0001.HEIC", HEIC), file("irsaliye.pdf", [0x25, 0x50, 0x44, 0x46], "application/pdf"), file("not.docx", [0x50, 0x4b, 3, 4]), file("x.zip", [0x50, 0x4b, 3, 4])]));
    expect(await screen.findByText("IMG_0001.HEIC")).toBeInTheDocument();
    expect(screen.getByText("irsaliye.pdf")).toBeInTheDocument();
    expect(screen.getAllByText(/Desteklenmeyen dosya türü/)).toHaveLength(1);
    expect(screen.getByText(/not\.docx, x\.zip/)).toBeInTheDocument();
    expect(screen.getByTestId("upload-drop-zone")).toHaveAttribute("data-active", "false");
  });
});

describe("liste sayfasına bırakma", () => {
  it("dosya bırakınca yükleme modalı o dosyalarla açılır", async () => {
    renderWithProviders(<IncomingDocumentsPage />);
    const pageEl = screen.getByTestId("incoming-documents-page");
    fireEvent.dragEnter(pageEl, dt([]));
    expect(screen.getByTestId("page-drop-overlay")).toBeInTheDocument();
    fireEvent.drop(pageEl, dt([file("IMG_0002.HEIC", HEIC)]));
    expect(screen.queryByTestId("page-drop-overlay")).toBeNull();
    expect(await screen.findByText("IMG_0002.HEIC")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Belge yükle" })).toBeInTheDocument();
    expect(toastWarning).not.toHaveBeenCalled();
  });
  it("yalnız desteklenmeyen tür → modal açılmaz, tek uyarı", async () => {
    renderWithProviders(<IncomingDocumentsPage />);
    fireEvent.drop(screen.getByTestId("incoming-documents-page"), dt([file("a.docx", [0x50, 0x4b]), file("b.exe", [0x4d, 0x5a])]));
    await waitFor(() => expect(toastWarning).toHaveBeenCalledTimes(1));
    expect(String(toastWarning.mock.calls[0]?.[0])).toMatch(/a\.docx, b\.exe/);
    expect(screen.queryByRole("heading", { name: "Belge yükle" })).toBeNull();
  });
});
