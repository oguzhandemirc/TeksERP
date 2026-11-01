// İnceleme bulgusu: silme sonrası tazeleme silinen belgenin detayını YENİDEN ÇEKMEMELİ (404 toast'ı);
// 409'da (başka oturum onayladı) detay tazelenmeli. Negatif sonda: refetchType "none" yerine düz
// `invalidateQueries({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY] })` (refetch'li) konunca §1 kırmızı; onError kaldırılınca §2 kırmızı.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DeleteDraftNoteAction } from "../DeleteDraftNoteAction";
import { INCOMING_DOCUMENT_QUERY_KEY } from "../service";

const apiDelete = vi.fn((_url: string) => Promise.resolve({ data: { data: { id: "n1", noteNo: "GB-0001" } } }));
vi.mock("@/services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: (url: string) => apiDelete(url) },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const note = { id: "n1", noteNo: "GB-0001", status: "DRAFT" as const, lines: [], scans: [] };
const detailFn = vi.fn(() => Promise.resolve(note));
const listFn = vi.fn(() => Promise.resolve([]));

function Detail() {
  useQuery({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "detail", "n1"], queryFn: detailFn });
  useQuery({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "list", {}], queryFn: listFn });
  return <DeleteDraftNoteAction note={note} listPath="/liste" />;
}

function List() {
  useQuery({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "list", {}], queryFn: listFn });
  return <div>liste-sayfasi</div>;
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/detay"]}>
        <Routes>
          <Route path="/detay" element={<Detail />} />
          <Route path="/liste" element={<List />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}

async function confirmDelete() {
  await waitFor(() => expect(detailFn).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByTestId("note-delete-draft"));
  fireEvent.click(await screen.findByRole("button", { name: "Sil" }));
}

describe("taslak silme — önbellek tazeleme", () => {
  beforeEach(() => {
    apiDelete.mockClear();
    detailFn.mockClear();
    listFn.mockClear();
  });

  it("§1 başarı: listeye döner, silinen belgenin detayı yeniden çekilmez ve önbellekten düşer; liste tazelenir", async () => {
    const qc = setup();
    await confirmDelete();
    expect(await screen.findByText("liste-sayfasi")).toBeInTheDocument();
    // Liste bayat işaretlendi; liste sayfası bağlanınca yeniden çeker (ilk + bağlanış = 2).
    await waitFor(() => expect(listFn).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(detailFn).toHaveBeenCalledTimes(1);
    expect(qc.getQueryData([INCOMING_DOCUMENT_QUERY_KEY, "detail", "n1"])).toBeUndefined();
  });

  it("§2 409: detay tazelenir (yeni durum görünsün)", async () => {
    apiDelete.mockImplementationOnce(() => Promise.reject(Object.assign(new Error("409"), { response: { status: 409 } })));
    setup();
    await confirmDelete();
    await waitFor(() => expect(detailFn).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("liste-sayfasi")).toBeNull();
  });
});
