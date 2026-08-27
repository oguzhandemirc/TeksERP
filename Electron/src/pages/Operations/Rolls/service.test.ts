import { describe, it, expect, vi, beforeEach } from "vitest";
import apiClient from "@/services/apiClient";
import {
  rollService,
  ROLL_STATUS_TABS,
  buildRollForceFilters,
  rollTabDefaultSortBy,
  type RollStatusTabKey,
} from "./service";
import { ROLL_TABS } from "./tabs-config";

// apiClient'i mock'la — fason özet ucunun URL sözleşmesini doğrula.
vi.mock("@/services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;

describe("rollService — fasonda özet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({
      data: {
        success: true,
        data: { total: { rollCount: 0, totalQty: 0 }, byCategory: [], bySubcontractor: [] },
      },
    });
  });

  it("getSubcontractorSummary → GET /api/rolls/subcontractor-summary", async () => {
    await rollService.getSubcontractorSummary();
    expect(mockGet).toHaveBeenCalledWith("/api/rolls/subcontractor-summary");
  });

  it("getSubcontractorSummary ApiResponse.data'yı döndürür", async () => {
    const payload = {
      total: { rollCount: 3, totalQty: 250 },
      byCategory: [{ categoryId: "c1", name: "Boyahane", rollCount: 3, totalQty: 250 }],
      bySubcontractor: [
        {
          subcontractorId: "s1",
          name: "ABC Boya",
          code: "ABC",
          rollCount: 3,
          totalQty: 250,
          oldestDispatchedAt: "2026-07-01T09:00:00.000Z",
          oldestDays: 28,
        },
      ],
    };
    mockGet.mockResolvedValue({ data: { success: true, data: payload } });
    const res = await rollService.getSubcontractorSummary();
    expect(res.data).toEqual(payload);
  });

  it("null grupları (Bilinmiyor) sözleşmeye uyar — subcontractorId/categoryId null", async () => {
    const payload = {
      total: { rollCount: 1, totalQty: 42 },
      byCategory: [{ categoryId: null, name: "Bilinmiyor", rollCount: 1, totalQty: 42 }],
      bySubcontractor: [
        {
          subcontractorId: null,
          name: "Bilinmiyor",
          code: null,
          rollCount: 1,
          totalQty: 42,
          oldestDispatchedAt: null,
          oldestDays: null,
        },
      ],
    };
    mockGet.mockResolvedValue({ data: { success: true, data: payload } });
    const res = await rollService.getSubcontractorSummary();
    const firm = res.data.bySubcontractor[0];
    const cat = res.data.byCategory[0];
    expect(firm?.subcontractorId).toBeNull();
    expect(firm?.oldestDays).toBeNull();
    expect(cat?.categoryId).toBeNull();
  });
});

describe("ARŞİV statü kümesi — 'iptal ettim, nerede?' regresyon kilidi", () => {
  /**
   * 2026-08-25 saha bulgusu: iptal edilen top HİÇBİR yüzeyde görünmüyordu.
   * Envanter sekmeleri ölü statüleri listelemez ve arşiv yalnız dört
   * "tüketilmiş" statüyü taşıyordu → "soft delete, kayıt korunur" sözü veri
   * düzeyinde tutuluyor ama kayda ULAŞMANIN YOLU YOKTU. Barkodla aramak da çare
   * değil: iptal edilen topların bir kısmı barkodsuz açık kumaştır.
   */
  const archive = ROLL_STATUS_TABS.ARCHIVE.split(",");

  it("iptal ve fire ARŞİVDE görünür", () => {
    expect(archive).toContain("CANCELLED");
    expect(archive).toContain("SCRAP");
  });

  it("dört tüketilmiş statü korunuyor (ekleme, değiştirme değildi)", () => {
    for (const s of [
      "RETURNED_FROM_SUBCONTRACTOR",
      "TAMBUR_CONSUMED",
      "SUBCONTRACTOR_CONSUMED",
      "KARTELA_CONSUMED",
    ]) {
      expect(archive).toContain(s);
    }
  });

  it("arşiv CANLI statü taşımaz (STOCK/WAREHOUSE arşiv değildir)", () => {
    // Arşiv sayfası salt-okunur; canlı bir statü sızarsa operatör oradan
    // düzenlenemeyen bir topa bakar ve "sistem bozuk" der.
    for (const s of ["STOCK", "WAREHOUSE", "A1_STOCK", "IN_PRODUCTION", "SHIPPED"]) {
      expect(archive).not.toContain(s);
    }
  });
});

/**
 * SEKME ↔ KAPSAM HİZASI (2026-08-26) — bu bekçi daha önce YOKTU ve gerçek bir açıktı.
 *
 * `ROLL_TABS`'a yeni bir sekme eklenip `buildRollForceFilters`'a dal yazılmayı
 * unutulursa TypeScript SUSAR: fonksiyon fallback'e düşer, `STATUS_GROUPS.<key>`
 * null olduğu için boş filtre döner ve sekme kapsamsız bir liste gösterir.
 * Yani en tehlikeli hatayı derleyici görmüyordu.
 */
describe("sekme → kapsam hizası", () => {
  const tabs = ROLL_TABS.filter((t) => t.key !== "KANBAN");

  it("her sekme (KANBAN hariç) daraltıcı bir kapsam gönderir", () => {
    for (const t of tabs) {
      const f = buildRollForceFilters(t.key as RollStatusTabKey);
      const narrows =
        "rollScope" in f || "currentStepKind" in f || typeof f.status === "string";
      expect(narrows, `${t.key} sekmesi kapsamsız — filtresiz liste döner`).toBe(true);
    }
  });

  it("körlük zemini: sekme listesi boşalırsa test kendini yeşil sanmasın", () => {
    expect(tabs.length).toBeGreaterThanOrEqual(8);
  });

  it("Ham Stok ile Yarı Mamul AYRI kapsam kullanır", () => {
    // Aynı kapsamı paylaşsalardı iki sekme aynı listeyi gösterir ve ayırmanın
    // tamamı sessizce boşa düşerdi (metraj toplamları da ayrışmazdı).
    const raw = buildRollForceFilters("RAW_STOCK");
    const semi = buildRollForceFilters("SEMI_FINISHED");
    expect(raw.rollScope).toBe("RAW_STOCK_PURE");
    expect(semi.rollScope).toBe("SEMI_FINISHED");
    expect(raw.rollScope).not.toBe(semi.rollScope);
  });

  it("Ham Stok BİRLEŞİK kapsamı (RAW_STOCK) KULLANMAZ", () => {
    // `RAW_STOCK` ham + yarı mamulün birleşimidir ve mobil Hızlı İş Emri top
    // seçicisi onu kullanır. Masaüstü Ham Stok sekmesi ona dönerse yarı mamul
    // yeniden ham kumaşın arasına karışır — bu paketin geri alınması demektir.
    expect(buildRollForceFilters("RAW_STOCK").rollScope).not.toBe("RAW_STOCK");
  });

  it("giriş sekmeleri createdAt, diğerleri updatedAt ile sıralanır", () => {
    expect(rollTabDefaultSortBy("RAW_STOCK")).toBe("createdAt");
    expect(rollTabDefaultSortBy("SEMI_FINISHED")).toBe("createdAt");
    expect(rollTabDefaultSortBy("FINISHED_STOCK")).toBe("updatedAt");
  });
});
