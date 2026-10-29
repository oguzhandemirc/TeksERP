// H6b: hizmet kalemi eşlemesi — seçici yalnız SERVICE listeler, değer satırı seçimi gövdeye
// `values[].serviceItemId` olarak gider, boşaltma null, dokunulmayan eşleme gövdede YOK
// (H6 sözleşmesi: alan yoksa korunur), önizleme sırası değer → özellik → ana bayrak.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { FabricProperty } from "./types";
import type { FabricPropertyFormValues } from "./schema";

const getAll = vi.fn();
vi.mock("@/pages/Items/service", () => ({ itemService: { getAll: (...a: unknown[]) => getAll(...a) } }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));
vi.mock("@/components/forms/SimilarNamesWarning", () => ({ SimilarNamesWarning: () => null }));
vi.mock("@/components/forms/PropertyStationsField", () => ({ PropertyStationsField: () => null }));

const { FabricPropertyFormDialog } = await import("./FabricPropertyFormDialog");
const { buildFabricPropertyPayload } = await import("./payload");
const { resolveServiceHint, serviceHintText } = await import("./serviceMapping");

const K1 = { id: "s1", code: "KURSUN-K1", name: "Kurşun ≤30 g/m", itemType: "SERVICE", isActive: true };
const K2 = { id: "s2", code: "KURSUN-K2", name: "Kurşun 30–60", itemType: "SERVICE", isActive: true };

const prop = (p: Partial<FabricProperty> & Pick<FabricProperty, "id" | "name" | "valueType">): FabricProperty => ({
  code: p.id.toUpperCase(),
  category: null,
  description: null,
  color: null,
  sortOrder: 10,
  isActive: true,
  createdAt: "",
  updatedAt: "",
  variantOfPropertyId: null,
  serviceItemId: null,
  stationCapabilities: [{ stationId: "st1", station: { id: "st1", code: "KRS", name: "Kurşun", isActive: true } }],
  ...p,
});

const FLAG = prop({ id: "kursun", name: "Kurşunlu", valueType: "FLAG", serviceItemId: "s1" });
const GRAMAJ = prop({
  id: "gramaj",
  name: "Kurşun gramajı",
  valueType: "CHOICE",
  variantOfPropertyId: "kursun",
  values: [
    { id: "v1", code: "G25", name: "25 g/m", sortOrder: 10, isActive: true, serviceItemId: null },
    { id: "v2", code: "G45", name: "45 g/m", sortOrder: 20, isActive: true, serviceItemId: "s2" },
  ],
});

function renderForm(initial: FabricProperty | null) {
  let sent: Partial<FabricProperty> | null = null;
  const onSubmit = vi.fn((v: FabricPropertyFormValues) => {
    sent = buildFabricPropertyPayload(v, initial, 99);
  });
  renderWithProviders(
    <FabricPropertyFormDialog open onOpenChange={() => {}} initial={initial} onSubmit={onSubmit} allProperties={[FLAG, GRAMAJ]} />,
  );
  return { onSubmit, body: () => sent as unknown as Record<string, unknown> & { values?: Record<string, unknown>[] } };
}

beforeEach(() => {
  getAll.mockReset();
  getAll.mockResolvedValue({ data: [K1, K2], pagination: { total: 2 } });
});

describe("H6b hizmet kalemi seçicisi + gövde", () => {
  it("⭐ seçici yalnız aktif SERVICE kalemlerini ister ve listeler (doğrudan modal)", async () => {
    renderForm(GRAMAJ);
    await waitFor(() => expect(getAll).toHaveBeenCalled());
    expect(getAll.mock.calls[0]![0]).toMatchObject({ filters: { isActive: "true", itemType: "SERVICE" } });
    await userEvent.click(await screen.findByRole("button", { name: "Özelliğin hizmet kalemi" }));
    const dlg = await screen.findByRole("dialog", { name: "Hizmet kalemi" });
    const options = within(dlg).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Eşleme yok", "KURSUN-K1 — Kurşun ≤30 g/m", "KURSUN-K2 — Kurşun 30–60"]);
  });

  it("⭐ değer satırında seçim → values[].serviceItemId; dokunulmayan satır ve özellik alanı gövdede YOK", async () => {
    const { body } = renderForm(GRAMAJ);
    await userEvent.click(await screen.findByRole("button", { name: "G25 hizmet kalemi" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "Hizmet kalemi" })).getByRole("option", { name: /KURSUN-K1/ }));
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(body()).not.toBeNull());
    const values = body().values!;
    expect(values.find((v) => v.code === "G25")).toMatchObject({ serviceItemId: "s1" });
    expect("serviceItemId" in values.find((v) => v.code === "G45")!).toBe(false);
    expect("serviceItemId" in body()).toBe(false);
  });

  it("⭐ boşaltma null gönderir", async () => {
    const { body } = renderForm(GRAMAJ);
    await userEvent.click(await screen.findByRole("button", { name: "G45 hizmet kalemi" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "Hizmet kalemi" })).getByRole("option", { name: "Özelliğin kalemine düşer" }));
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(body()).not.toBeNull());
    expect(body().values!.find((v) => v.code === "G45")).toMatchObject({ serviceItemId: null });
  });

  it("⭐ eşlemeye dokunmayan kaydetme: gövdede hiçbir serviceItemId yok (mevcut eşleme korunur)", async () => {
    const { body } = renderForm(GRAMAJ);
    await screen.findByRole("button", { name: "G25 hizmet kalemi" });
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(body()).not.toBeNull());
    expect(JSON.stringify(body())).not.toContain("serviceItemId");
  });

  it("⭐ bayrak özelliğinde özellik düzeyi boşaltma → serviceItemId: null; yeni kayıtta seçim yoksa alan yok", () => {
    const base = { name: "Kurşunlu", category: "", description: "", color: "", stationIds: ["st1"], variantOfPropertyId: null, isActive: true };
    const cleared = buildFabricPropertyPayload({ ...base, valueType: "FLAG", serviceItemId: null, values: [] }, FLAG, 1);
    expect(cleared).toMatchObject({ serviceItemId: null });
    const fresh = buildFabricPropertyPayload({ ...base, valueType: "FLAG", serviceItemId: null, values: [] }, null, 1);
    expect("serviceItemId" in fresh).toBe(false);
  });

  it("⭐ önizleme ipucu sırası: değer → özellik → ana bayrak → yok", async () => {
    const items = [K1, K2];
    const parent = { name: "Kurşunlu", serviceItemId: "s1" };
    expect(resolveServiceHint("s2", "s1", parent)).toMatchObject({ source: "VALUE", serviceItemId: "s2" });
    expect(resolveServiceHint(null, "s2", parent)).toMatchObject({ source: "PROPERTY", serviceItemId: "s2" });
    expect(resolveServiceHint(null, null, parent)).toMatchObject({ source: "PARENT_FLAG", serviceItemId: "s1" });
    expect(resolveServiceHint(null, null, { name: "X", serviceItemId: null }).source).toBe("NONE");
    expect(serviceHintText(resolveServiceHint(null, null, parent), items)).toBe(
      'Kurşunda bu gramaj KURSUN-K1 — Kurşun ≤30 g/m olarak faturalanır (ana bayrak "Kurşunlu" eşlemesi).',
    );
    renderForm(GRAMAJ);
    await screen.findByRole("button", { name: "G25 hizmet kalemi" });
    await waitFor(() => expect(screen.getAllByTestId("service-hint").map((h) => h.textContent)).toEqual([
      'Kurşunda bu gramaj KURSUN-K1 — Kurşun ≤30 g/m olarak faturalanır (ana bayrak "Kurşunlu" eşlemesi).',
      "Kurşunda bu gramaj KURSUN-K2 — Kurşun 30–60 olarak faturalanır (kendi eşlemesi).",
    ]));
  });

  it("hizmet kalemi yoksa ve eşleme yoksa bölüm çizilmez (bugünkü form)", async () => {
    getAll.mockResolvedValue({ data: [], pagination: { total: 0 } });
    renderForm(prop({ id: "kat", name: "Kat", valueType: "CHOICE", values: [{ id: "k", code: "TUP", name: "Tüp", sortOrder: 1, isActive: true }] }));
    await waitFor(() => expect(getAll).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Özelliğin hizmet kalemi" })).toBeNull();
    expect(screen.queryByTestId("service-hint")).toBeNull();
  });
});
