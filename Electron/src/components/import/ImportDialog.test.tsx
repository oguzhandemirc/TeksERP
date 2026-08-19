import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ImportDialog } from "./ImportDialog";
import type { ImportPreviewResult, ImportTemplateSpec } from "@/services/importService";

// =============================================================================
// SİHİRBAZ DAVRANIŞ BEKÇİSİ
// =============================================================================
// Buradaki üç kontrol NEGATİF SONDAdır ve özelliğin en pahalı hatalarını tutar:
//   • tuş başına önizleme atılmaması (10.000 satırlık tam dosya turu)
//   • yaratılan kaydın hücreye ADIYLA yazılmaması (tek kelimelik değerde
//     çalışıp ilk sayı içeren adda bozulan sınıf)
//   • aynı değer için ikinci yaratma isteği atılmaması (409 → "hata" sanılır)

const preview = vi.fn();
const apply = vi.fn();
const template = vi.fn();
const exportData = vi.fn();
const colorCreate = vi.fn();
let permissions: string[] = [];

vi.mock("@/services/importService", () => ({
  importService: {
    template: (...a: unknown[]) => template(...a),
    preview: (...a: unknown[]) => preview(...a),
    apply: (...a: unknown[]) => apply(...a),
    exportData: (...a: unknown[]) => exportData(...a),
  },
}));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: (p: string) => permissions.includes(p),
    hasAnyPermission: (ps: string[]) => ps.some((p) => permissions.includes(p)),
    hasAllPermissions: (ps: string[]) => ps.every((p) => permissions.includes(p)),
    isAdmin: false,
  }),
}));
vi.mock("@/pages/Colors/service", () => ({
  colorService: { create: (...a: unknown[]) => colorCreate(...a) },
}));
// Benzer-ad uyarısı ayrı testli; burada gürültü yapmasın.
vi.mock("@/components/forms/SimilarNamesWarning", () => ({
  SimilarNamesWarning: () => null,
}));
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn(), info: vi.fn() },
}));

const SPEC: ImportTemplateSpec = {
  entity: "productRecipe",
  label: "İş Emri Şablonları",
  keyColumns: ["code"],
  notes: [],
  columns: [
    { key: "code", label: "Şablon Kodu", type: "text" },
    { key: "name", label: "Şablon Adı", type: "text", required: true },
    { key: "colorCode", label: "Renk Kodu", type: "lookup", lookup: { entity: "color", by: "code" } },
  ],
};

/** Renk bulunamadı hatası taşıyan önizleme yanıtı. */
const previewWithMissingColor = (rowNos: number[]): ImportPreviewResult => ({
  entity: "productRecipe",
  unknownColumns: [],
  summary: { total: rowNos.length, create: 0, update: 0, skip: 0, error: rowNos.length, warning: 0 },
  rows: rowNos.map((rowNo) => ({
    rowNo,
    action: "ERROR" as const,
    warnings: [],
    errors: [
      {
        column: "colorCode",
        message: "'MAVI' ile eşleşen renk bulunamadı (kod ya da tam ad yazın).",
        fix: { kind: "CREATE_LOOKUP" as const, entity: "color", value: "MAVI" },
      },
    ],
  })),
});

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ImportDialog open entity="productRecipe" onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

/** Dosya adımını atlayıp önizlemeye geç: yapıştırma + "İşle" + "Önizle". */
async function gotoPreview(text: string) {
  renderDialog();
  // ⚠️ Bekleme noktası ŞABLON YÜKLENDİKTEN sonra çıkan bir şey olmalı.
  // `/Şablonu indir/` diyalog AÇIKLAMASINDAKİ "Şablonu indirin"e de uyuyor ve
  // sorgu çözülmeden testi ilerletiyordu (ölçüldü: gövde hâlâ Skeleton'dı).
  const pasteToggle = await screen.findByText(/Excel'den yapıştır/);
  fireEvent.click(pasteToggle);
  fireEvent.change(screen.getByPlaceholderText(/Excel'de hücreleri seçip/), { target: { value: text } });
  fireEvent.click(screen.getByText(/^İşle/));
  await waitFor(() => expect(screen.getByText(/^Önizle$/)).toBeTruthy());
  fireEvent.click(screen.getByText(/^Önizle$/));
  await waitFor(() => expect(preview).toHaveBeenCalled());
}

const PASTE = "Şablon Kodu\tŞablon Adı\tRenk Kodu\nR1\tBİR\tMAVI\nR2\tİKİ\tMAVI\n";

beforeEach(() => {
  vi.clearAllMocks();
  permissions = ["property:write"];
  template.mockResolvedValue({ data: SPEC });
  preview.mockResolvedValue({ data: previewWithMissingColor([2, 3]) });
  colorCreate.mockResolvedValue({ data: { id: "c1", code: "RNK9", name: "MAVİ NORMALİZE" } });
});

describe("düzenleme → bayatlık", () => {
  it("hücre düzenlenince UYGULA pasifleşir ve bayat bandı çıkar", async () => {
    await gotoPreview(PASTE);
    // İki satır da MAVI taşıyor — ilkini düzenliyoruz.
    const input = (await screen.findAllByDisplayValue("MAVI"))[0]!;
    fireEvent.change(input, { target: { value: "KIRMIZI" } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByText(/artık güncel değil/)).toBeTruthy());
    expect(screen.getByText("Uygula").closest("button")).toBeDisabled();
  });

  it("NEGATİF SONDA: tuş başına önizleme atılmaz — yalnız açık düğmeyle", async () => {
    await gotoPreview(PASTE);
    const callsAfterFirstPreview = preview.mock.calls.length;
    // İki satır da MAVI taşıyor — ilkini düzenliyoruz.
    const input = (await screen.findAllByDisplayValue("MAVI"))[0]!;
    for (const v of ["M", "MA", "MAV", "MAVİ", "MAVİX", "MAVİXX"]) {
      fireEvent.change(input, { target: { value: v } });
    }
    fireEvent.blur(input);
    // Blur bile önizleme ATMAZ — 10.000 satırda her düzeltme tam dosya turu olurdu.
    expect(preview.mock.calls.length).toBe(callsAfterFirstPreview);
    fireEvent.click(screen.getByText("Yeniden önizle"));
    await waitFor(() => expect(preview.mock.calls.length).toBe(callsAfterFirstPreview + 1));
  });
});

describe("eksik kaydı yarat", () => {
  it("ipucu VARSA düğme çizilir", async () => {
    await gotoPreview(PASTE);
    // Rol tabanlı isim: JSX metni düğümlere bölündüğü için düz metin eşleşmesi kırılgan.
    expect(await screen.findAllByRole("button", { name: /adıyla renk oluştur/ })).not.toHaveLength(0);
  });

  it("ipucu YOKSA düğme ÇİZİLMEZ (eski sunucu / belirsiz-pasif hata)", async () => {
    const noFix = previewWithMissingColor([2]);
    noFix.rows[0]!.errors[0]!.fix = undefined;
    preview.mockResolvedValue({ data: noFix });
    await gotoPreview(PASTE);
    expect(screen.queryByRole("button", { name: /adıyla renk oluştur/ })).toBeNull();
  });

  it("YETKİ yoksa düğme yerine SEBEP yazılır", async () => {
    permissions = [];
    await gotoPreview(PASTE);
    expect(screen.queryByRole("button", { name: /adıyla renk oluştur/ })).toBeNull();
    expect(screen.getAllByText(/property:write/).length).toBeGreaterThan(0);
  });

  it("yaratıldığında hücreye KOD yazılır ve AYNI değerli TÜM satırlar güncellenir", async () => {
    await gotoPreview(PASTE);
    fireEvent.click((await screen.findAllByRole("button", { name: /adıyla renk oluştur/ }))[0]!);
    fireEvent.click(screen.getByText("Ekle"));
    await waitFor(() => expect(colorCreate).toHaveBeenCalled());

    // İki satır da kodu almalı (kayıt artık global olarak var).
    await waitFor(() => expect(screen.getAllByDisplayValue("RNK9")).toHaveLength(2));
    // Makbuz satır sayısını söylüyor — sayı olmadan toplu düzenleme görünmez olur.
    expect(String(toastSuccess.mock.calls[0]?.[0])).toMatch(/RNK9.*2 satır/);
  });

  it("NEGATİF SONDA: yaratılan AD hiçbir hücreye yazılmaz", async () => {
    await gotoPreview(PASTE);
    fireEvent.click((await screen.findAllByRole("button", { name: /adıyla renk oluştur/ }))[0]!);
    fireEvent.click(screen.getByText("Ekle"));
    await waitFor(() => expect(screen.getAllByDisplayValue("RNK9")).toHaveLength(2));
    // Servis adı normalize eder ("beyaz 055" → "055 BEYAZ") ve lookup FARKLI
    // katlama kullanır; adla yazsaydık yeniden önizleme yine eşleşmezdi.
    expect(screen.queryByDisplayValue("MAVİ NORMALİZE")).toBeNull();
  });

  it("NEGATİF SONDA: aynı değer için İKİNCİ yaratma isteği atılmaz", async () => {
    await gotoPreview(PASTE);
    fireEvent.click((await screen.findAllByRole("button", { name: /adıyla renk oluştur/ }))[0]!);
    fireEvent.click(screen.getByText("Ekle"));
    await waitFor(() => expect(colorCreate).toHaveBeenCalledTimes(1));
    // Diğer satırın düğmesi bastırılmalı — canlı kalsaydı ikinci tık 409 verir
    // ve kullanıcı bunu hata sanardı.
    expect(screen.queryByRole("button", { name: /adıyla renk oluştur/ })).toBeNull();
    expect(screen.getAllByText(/RNK9 oluşturuldu/).length).toBeGreaterThan(0);
  });
});
