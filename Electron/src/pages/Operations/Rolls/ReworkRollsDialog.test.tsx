import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * YENİDEN ÜRETİME AL — "bitmiş kumaş tekrar iş emrine bağlanabilir mi?" (2026-08-25).
 *
 * Backend bunu 2026'dan beri destekliyordu (`quick-start` STOCK/WAREHOUSE/A1_STOCK
 * kabul eder) ama HİÇBİR istemci kullanamıyordu: masaüstünde ekran yoktu, tablet
 * ise okutmada `status !== 'STOCK'` diye eliyordu. Sahada 980 topun 4'ü iki iş
 * emrinden geçmiş ve dördü de HAM top — akış hiç kullanılmamış.
 *
 * Bu bekçi üç şeyi kilitler:
 *   ① seçenekler backend sözleşmesiyle aynı gövdeye çevriliyor,
 *   ② ÖLÜ ETİKET uyarısı DAR koşulda çıkıyor (fasonla başlayan rota + etiketli top)
 *     — fasona gitmeyen rotada çıkarsa uyarı gürültüye döner ve okunmaz olur,
 *   ③ backend'in reddedeceği durumlar (farklı kumaş / çuvaldaki top) İSTEK
 *     ATILMADAN söyleniyor.
 */

const quickStart = vi.fn().mockResolvedValue({
  data: {
    workOrder: { workOrderNumber: "IE2508260001" },
    attached: 1,
    errors: [],
    dispatch: { id: "d1", dispatchNo: "FS250826001" },
    batch: { id: "b1", batchNumber: "P12" },
  },
});

vi.mock("@/pages/Operations/WorkOrders/service", () => ({
  workOrderService: { quickStart: (...a: unknown[]) => quickStart(...a) },
}));

const station = (over: Record<string, unknown>) => ({
  id: "st",
  code: "X",
  name: "İstasyon",
  type: "INTERNAL",
  kind: "OTHER",
  defaultCategoryId: null,
  ...over,
});

let routeSteps: unknown[] = [];
vi.mock("@/pages/Routes/service", () => ({
  routeService: {
    getAll: () =>
      Promise.resolve({
        data: [{ id: "r1", name: "Test Rota", isActive: true, steps: routeSteps }],
      }),
  },
}));

vi.mock("@/pages/Subcontractors/service", () => ({
  subcontractorService: {
    getAll: () => Promise.resolve({ data: [{ id: "f1", name: "BOYER" }] }),
  },
}));

vi.mock("@/hooks/useFoldValues", () => ({
  useFoldValues: () => ({ values: [{ code: "2-KAT", name: "2 Kat" }], isEmpty: false }),
}));

vi.mock("@/components/forms/color-picker/ColorPickerModal", () => ({
  ColorPickerModal: () => <div data-testid="color-picker" />,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ReworkRollsDialog } from "./ReworkRollsDialog";

const roll = (over: Record<string, unknown> = {}) =>
  ({
    id: "R1",
    barcode: "T240826F0035",
    currentQty: 70,
    width: 250,
    item: { id: "i1", name: "PATOS" },
    color: { name: "MAVİ" },
    labelPrintedAt: "2026-08-24T16:32:00Z",
    ...over,
  }) as never;

function renderDialog(rolls: unknown[], mode?: "rework" | "start") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ReworkRollsDialog open onOpenChange={() => {}} mode={mode} rolls={rolls as never} />
    </QueryClientProvider>,
  );
}

const FASON_ROUTE = [
  {
    sequence: 1,
    requiredCategoryId: null,
    station: station({
      name: "Boyahane",
      type: "EXTERNAL",
      defaultCategoryId: "c",
      defaultCategory: { id: "c", code: "BOYA", name: "Boya", appliesColor: true },
    }),
  },
  { sequence: 2, station: station({ name: "Kurşun + KK2", kind: "PROCESS_QC" }) },
];
const IC_ROUTE = [{ sequence: 1, station: station({ name: "Kurşun + KK2", kind: "PROCESS_QC" }) }];

/**
 * Rotayı seç. ⚠️ Önce SEÇENEĞİN doğmasını bekler: `<select>` en baştan var
 * (placeholder ile) ama rota listesi async gelir; beklemeden `change` atmak
 * var olmayan bir değeri yazmaya çalışır ve SESSİZCE hiçbir şey yapmaz.
 */
async function selectRoute() {
  await screen.findByRole("option", { name: "Test Rota" });
  const [routeSelect] = screen.getAllByRole("combobox");
  fireEvent.change(routeSelect!, { target: { value: "r1" } });
}

beforeEach(() => {
  quickStart.mockClear();
  routeSteps = FASON_ROUTE;
});

describe("ReworkRollsDialog", () => {
  it("fasonla başlayan rota + etiketli top → ÖLÜ ETİKET uyarısı ve barkod listesi", async () => {
    renderDialog([roll()]);
    await selectRoute();
    await screen.findByText(/etiketi\s+geçersizleşecek/i);
    await screen.findByText(/kimliğini/i);
    // Barkod hem uyarı bloğunda hem alttaki top listesinde geçer — uyarının
    // KENDİ satırını arıyoruz (operatör depoda hangi kâğıdı arayacağını
    // uyarıdan okumalı, listeyi ayrıca taramak zorunda kalmamalı).
    expect(screen.getAllByText(/T240826F0035/).length).toBeGreaterThanOrEqual(2);
  });

  it("fasona gitmeyen rotada uyarı ÇIKMAZ (dar koşul — gürültü olmasın)", async () => {
    routeSteps = IC_ROUTE;
    renderDialog([roll()]);
    await selectRoute();
    await screen.findByText(/Kurşun \+ KK2/);
    expect(screen.queryByText(/geçersizleşecek/i)).toBeNull();
  });

  it("etiketsiz topta uyarı ÇIKMAZ", async () => {
    renderDialog([roll({ labelPrintedAt: null })]);
    await selectRoute();
    // Rota adı artık hem adım şeridinde hem "Fason Firma (Boyahane)" etiketinde
    // geçiyor — rotanın YÜKLENDİĞİNİ firma seçicisinin varlığından anlıyoruz.
    // Rotanın YÜKLENDİĞİNİ firma seçeneğinin doğmasından anlıyoruz (rota adı
    // hem adım şeridinde hem firma etiketinde geçtiği için ona bakılamaz).
    await screen.findByRole("option", { name: "BOYER" });
    expect(screen.queryByText(/geçersizleşecek/i)).toBeNull();
  });

  it("farklı kumaş → istek ATILMADAN engellenir", async () => {
    renderDialog([roll(), roll({ id: "R2", barcode: "T2", item: { id: "i2", name: "MAVİ" } })]);
    await selectRoute();
    await screen.findByText(/tek iş emri tek kumaş/i);
    expect(quickStart).not.toHaveBeenCalled();
  });

  it("çuvaldaki top → istek ATILMADAN engellenir", async () => {
    renderDialog([roll({ sackId: "s1" })]);
    await selectRoute();
    await screen.findByText(/çuvalda\/sevkiyatta olan top/i);
    expect(quickStart).not.toHaveBeenCalled();
  });

  it("FİRMA SEÇİLMEDEN sevk vaat edilmez (sessiz no-op yasağı)", async () => {
    // Sahadaki iki rotanın da adımında planlı firma YOK. Firma olmadan backend
    // sevki atlar; anahtarı açık göstermek operatöre olmayan bir çeki listesi
    // vaat ederdi — 2026-08-25'te ölçülüp düzeltilen sınıf.
    renderDialog([roll()]);
    await selectRoute();
    await screen.findByText(/Firma seçilmedi — sevk yapılamaz/);
    fireEvent.click(await screen.findByRole("button", { name: /^İş emri aç$/ }));
    await waitFor(() => expect(quickStart).toHaveBeenCalledTimes(1));
    const body = quickStart.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.dispatchFirstStep).toBe(false);
    expect(body.stepPlanning).toBeUndefined();
  });

  it("firma seçilince: sevk açılır ve firma stepPlanning ile gider", async () => {
    renderDialog([roll()]);
    await selectRoute();
    const firmSelect = await screen.findByRole("option", { name: "BOYER" });
    fireEvent.change(firmSelect.closest("select")!, { target: { value: "f1" } });
    fireEvent.click(await screen.findByRole("button", { name: /İş emri aç ve fasona gönder/ }));
    await waitFor(() => expect(quickStart).toHaveBeenCalledTimes(1));
    const body = quickStart.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.rollBarcodes).toEqual(["T240826F0035"]);
    expect(body.routeTemplateId).toBe("r1");
    expect(body.dispatchFirstStep).toBe(true);
    expect(body.stepPlanning).toEqual([
      { sequence: 1, requiredCategoryId: "c", plannedSubcontractorId: "f1" },
    ]);
    // İdempotency anahtarı ZORUNLU: zaman aşımı sonrası tekrar basış mükerrer
    // iş emri + refakat kartı doğurmasın.
    expect(typeof body.clientToken).toBe("string");
  });
});

/**
 * İKİ MOD, TEK MOTOR (2026-08-26).
 *
 * Diyalog artık üç sekmeden açılıyor: Bitmiş Depo ("yeniden" — top bir tur
 * görmüş) ile Ham Stok / Yarı Mamul ("ilk kez giriyor"). Ayrı bir diyalog
 * açmak payload'ı, engel kurallarını, fason firma seçimini ve ölü etiket
 * uyarısını İKİZLERDİ; onun yerine yalnız başlık/ikon/toast metni moda bağlı.
 *
 * Bu bekçinin işi tam olarak bu ayrımı korumak: metin ayrışsın, DAVRANIŞ
 * ayrışmasın. Metin sızarsa ham stoktaki operatör "yeniden" kelimesini görüp
 * yanlış topu seçtiğini sanır.
 */
describe("ReworkRollsDialog — mod (yeniden ↔ ilk kez)", () => {
  it("varsayılan mod 'yeniden' der (Bitmiş Depo davranışı korunuyor)", async () => {
    renderDialog([roll()]);
    expect(await screen.findByText(/Yeniden Üretime Al/)).toBeTruthy();
  });

  it("start modunda 'yeniden' kelimesi HİÇ geçmez", async () => {
    renderDialog([roll()], "start");
    expect(await screen.findByText(/Üretime Al — 1 top/)).toBeTruthy();
    expect(screen.queryByText(/Yeniden Üretime Al/)).toBeNull();
  });

  it("mod PAYLOAD'ı değiştirmez — iki modda da aynı gövde gider", async () => {
    const bodies: Record<string, unknown>[] = [];
    for (const mode of ["rework", "start"] as const) {
      quickStart.mockClear();
      const { unmount } = renderDialog([roll({ labelPrintedAt: null })], mode);
      await selectRoute();
      fireEvent.click(screen.getByRole("button", { name: /İş emri aç/ }));
      await waitFor(() => expect(quickStart).toHaveBeenCalledTimes(1));
      const b = { ...(quickStart.mock.calls[0]![0] as Record<string, unknown>) };
      // clientToken oturum başına üretilir — modun işi değil, karşılaştırmadan çıkar.
      delete b.clientToken;
      bodies.push(b);
      unmount();
    }
    expect(bodies[0]).toEqual(bodies[1]);
  });

  it("start modunda da ÖLÜ ETİKET uyarısı çıkar (koşul moda değil rotaya bağlı)", async () => {
    // Ham stoktaki etiketli top da fasona giderse kimliğini kaybeder — uyarının
    // gerekçesi "bitmiş olmak" değil, "fasona gitmek".
    renderDialog([roll()], "start");
    await selectRoute();
    expect(await screen.findByText(/ölü etiket|kimliğini kaybeder/i)).toBeTruthy();
  });

  it("barkodsuz seçim istek ATILMADAN engellenir", async () => {
    // `quick-start` gövdesi barkod taşır; hepsi barkodsuzsa istek 0 top bağlar
    // ve hiçbir şey söylemez. Ham stokta açık kumaş bu sekmeye düşebilir.
    renderDialog([roll({ barcode: null, labelPrintedAt: null })], "start");
    await selectRoute();
    expect(await screen.findByText(/hiçbirinde barkod yok/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /İş emri aç/ }));
    await waitFor(() => expect(quickStart).not.toHaveBeenCalled());
  });
});
