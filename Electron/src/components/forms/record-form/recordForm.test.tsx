// =============================================================================
// BEKÇİ — Seçicide Yeni · Düzenle · Örnek al (GENEL UI 2026-11-25)
// ① yazma izniyle üç eylem görünür; izin yokken HİÇBİRİ çizilmez
// ② Örnek al: form kimliksiz + tekil alanlar boş/öneri; YALNIZ create; update (PATCH) YOK; kaynak bayt bayt aynı
// ③ paylaşılan/bilinmeyen kayıtta Düzenle formu açmaz → "Kart ekranında aç" / "Örnek alarak yeni aç"; update YOK
// ④ yalnız bu yere ait kayıtta (isExclusive) Düzenle update çağırır
// ⑤ Yeni: create → yeni kayıt seçili gelir
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { JwtPayload } from "@/types/auth";
import type { CrudService } from "@/services/crudService";
import { EntityPickerModal } from "../entity-picker/EntityPickerModal";
import type { RecordFormRenderParams, RecordFormSpec } from "./types";

interface Row { id: string; code: string; name: string; meta: { tags: string[] } }

const SOURCE: Row = { id: "r1", code: "K-001", name: "Mavi Kart", meta: { tags: ["a"] } };
const SNAPSHOT = JSON.stringify(SOURCE);
const create = vi.fn();
const update = vi.fn();
const openTab = vi.fn();
vi.mock("@/store/tabs", () => ({ useTabsStore: { getState: () => ({ openTab }) } }));

const service = {
  listCursor: () => Promise.resolve({ success: true, data: [SOURCE], pagination: { nextCursor: null, hasMore: false, limit: 50, totalEstimate: 1 } }),
  getById: () => Promise.resolve({ success: true, data: SOURCE }),
  create: (...a: unknown[]) => create(...a),
  update: (...a: unknown[]) => update(...a),
} as unknown as CrudService<Row>;

/** Kasıtlı "kötü" form: kaynağı/taslağı olduğu gibi yayar (id dahil) — kapının yine de update'e gitmediğini kanıtlar. */
function FakeForm(p: RecordFormRenderParams<Row>) {
  const src = (p.initial ?? p.draft ?? {}) as Partial<Row>;
  const [name, setName] = useState(src.name ?? "");
  if (!p.open) return null;
  return (
    <div role="dialog" aria-label={`form-${p.mode}`}>
      <input aria-label="Kod" defaultValue={src.code ?? ""} readOnly />
      <input aria-label="Ad" value={name} onChange={(e) => setName(e.target.value)} />
      <button type="button" onClick={() => void p.onSubmit({ ...(src as Row), id: "r1", name })}>Kaydet</button>
    </div>
  );
}

const spec = (over: Partial<RecordFormSpec<Row>> = {}): RecordFormSpec<Row> => ({
  entityName: "Kart",
  service: service as unknown as RecordFormSpec<Row>["service"],
  writePermission: "item:write",
  invalidateKeys: ["t"],
  templateRule: { clear: ["code"], suggestCopy: ["name"] },
  cardPath: (r) => `/definitions/kart?search=${r.code}`,
  renderForm: (p) => <FakeForm key={`${p.mode}-${p.open}`} {...p} />,
  ...over,
});

const login = (permissions: string[]) =>
  useAuthStore.setState({ user: { userId: "u1", username: "k", permissions } as unknown as JwtPayload });

const renderPicker = (s: RecordFormSpec<Row>, onChange = vi.fn()) => {
  renderWithProviders(
    <EntityPickerModal<Row> value={null} onChange={onChange} service={service} queryKey="t" getLabel={(r) => r.name} title="Kart seç" placeholder="Kart seç" recordForm={s} />,
  );
  return onChange;
};
const openPicker = async () => {
  await userEvent.click(screen.getByRole("button", { name: /Kart seç/ }));
  await screen.findByText("Mavi Kart");
};

beforeEach(() => {
  create.mockReset().mockResolvedValue({ success: true, data: { ...SOURCE, id: "new-1", name: "Yeni" } });
  update.mockReset().mockResolvedValue({ success: true, data: SOURCE });
  openTab.mockReset();
  login(["item:write"]);
});

describe("Seçicide kayıt formu", () => {
  it("⭐ ① izinle Yeni + Düzenle + Örnek al görünür; izin yokken hiçbiri", async () => {
    renderPicker(spec());
    await openPicker();
    expect(screen.getByRole("button", { name: /Yeni kart ekle/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mavi Kart — düzenle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mavi Kart — örnek al/ })).toBeInTheDocument();
  });

  it("⭐ ① yazma izni yoksa üç düğme de çizilmez", async () => {
    login(["item:read"]);
    renderPicker(spec());
    await openPicker();
    expect(screen.queryByRole("button", { name: /Yeni kart ekle/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /düzenle/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /örnek al/ })).toBeNull();
  });

  it("⭐ ② Örnek al: kimliksiz taslak, YALNIZ create, update YOK, kaynak bayt bayt aynı, yeni kayıt seçili", async () => {
    const onChange = renderPicker(spec({ isExclusive: () => true }));
    await openPicker();
    await userEvent.click(screen.getByRole("button", { name: /Mavi Kart — örnek al/ }));
    const form = await screen.findByRole("dialog", { name: "form-template" });
    expect(within(form).getByLabelText("Kod")).toHaveValue("");
    expect(within(form).getByLabelText("Ad")).toHaveValue("Mavi Kart (kopya)");
    await userEvent.click(within(form).getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(update).not.toHaveBeenCalled();
    const body = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).not.toHaveProperty("id");
    expect(body.name).toBe("Mavi Kart (kopya)");
    expect(JSON.stringify(SOURCE)).toBe(SNAPSHOT);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("new-1", expect.objectContaining({ id: "new-1" })));
  });

  it("⭐ ③ paylaşılan kayıtta Düzenle formu açmaz: Kart ekranında aç / Örnek alarak yeni aç; update YOK", async () => {
    renderPicker(spec());
    await openPicker();
    await userEvent.click(screen.getByRole("button", { name: "Mavi Kart — düzenle" }));
    expect(screen.queryByRole("dialog", { name: "form-edit" })).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: /Kart ekranında aç/ }));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith("/definitions/kart?search=K-001", { forceNew: true }));
    await userEvent.click(screen.getByRole("button", { name: "Mavi Kart — düzenle" }));
    await userEvent.click(await screen.findByRole("button", { name: /Örnek alarak yeni aç/ }));
    const form = await screen.findByRole("dialog", { name: "form-template" });
    await userEvent.click(within(form).getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(update).not.toHaveBeenCalled();
  });

  it("⭐ ④ yalnız bu yere ait kayıtta Düzenle update(id) çağırır", async () => {
    renderPicker(spec({ isExclusive: () => true }));
    await openPicker();
    await userEvent.click(screen.getByRole("button", { name: "Mavi Kart — düzenle" }));
    const form = await screen.findByRole("dialog", { name: "form-edit" });
    await userEvent.clear(within(form).getByLabelText("Ad"));
    await userEvent.type(within(form).getByLabelText("Ad"), "Lacivert");
    await userEvent.click(within(form).getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("r1", expect.objectContaining({ name: "Lacivert" })));
    expect(create).not.toHaveBeenCalled();
  });

  it("⭐ ⑤ Yeni: create → yeni kayıt seçili gelir", async () => {
    const onChange = renderPicker(spec());
    await openPicker();
    await userEvent.click(screen.getByRole("button", { name: /Yeni kart ekle/i }));
    const form = await screen.findByRole("dialog", { name: "form-create" });
    await userEvent.type(within(form).getByLabelText("Ad"), "Yeni");
    await userEvent.click(within(form).getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("new-1", expect.objectContaining({ id: "new-1" })));
    expect(update).not.toHaveBeenCalled();
  });
});
