import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { LocationCell } from "./LocationCell";
import {
  LOCATION_CARD_MAX_ROWS,
  locationText,
  locationView,
  needsFasonTag,
  stationsForLocationFilter,
  type WorkOrderLocation,
  type WorkOrderLocationStation,
} from "./location";

const st = (ad: string, topSayisi: number, extra: Partial<WorkOrderLocationStation> = {}): WorkOrderLocationStation => ({
  istasyonId: `id-${ad}`,
  ad,
  tur: "PROCESS_QC",
  dis: false,
  topSayisi,
  metre: topSayisi * 50,
  fasondaTop: 0,
  fasoncular: [],
  ...extra,
});
const konum = (sinif: WorkOrderLocation["sinif"], istasyonlar: WorkOrderLocationStation[]): WorkOrderLocation => ({
  sinif,
  canliTop: istasyonlar.reduce((s, e) => s + e.topSayisi, 0),
  istasyonlar,
});
const boya = st("Boyahane", 8, { tur: "SUBCONTRACTOR", dis: true, fasondaTop: 8, fasoncular: ["Renk Boya A.Ş."] });

describe("locationView (saf görünüm modeli)", () => {
  it("eski backend (konum yok) → unknown; iptal iş emri canlısız → cancelled", () => {
    expect(locationView(undefined, "IN_PROGRESS").kind).toBe("unknown");
    expect(locationView(konum("BITTI", []), "CANCELLED").kind).toBe("cancelled");
  });
  it("BITTI: COMPLETED 'Tamamlandı', IN_PROGRESS 'Üretim bitti'", () => {
    expect(locationView(konum("BITTI", []), "COMPLETED")).toMatchObject({ kind: "done", label: "Tamamlandı" });
    expect(locationView(konum("BITTI", []), "IN_PROGRESS")).toMatchObject({ kind: "done", label: "Üretim bitti" });
  });
  it("bölünmüş: birincil en kalabalık (sunucu sırası), +N = diğer istasyon sayısı, kart en çok 5 satır", () => {
    const list = ["A", "B", "C", "D", "E", "F", "G"].map((n, i) => st(n, 10 - i));
    const v = locationView(konum("BOLUNMUS", list), "IN_PROGRESS");
    if (v.kind !== "stations") throw new Error("stations bekleniyordu");
    expect(v.primary.ad).toBe("A");
    expect(v.extra).toBe(6);
    expect(v.rows).toHaveLength(LOCATION_CARD_MAX_ROWS);
    expect(v.hiddenCount).toBe(2);
  });
  it("fasonda: çip fasoncu adını taşır; fasoncu bilinmiyorsa istasyon adı", () => {
    const v = locationView(konum("FASONDA", [boya]), "IN_PROGRESS");
    expect(v).toMatchObject({ kind: "stations", fason: true, primaryLabel: "Renk Boya A.Ş." });
    const v2 = locationView(konum("FASONDA", [{ ...boya, fasoncular: [] }]), "IN_PROGRESS");
    expect(v2).toMatchObject({ primaryLabel: "Boyahane" });
  });
  it("dışa aktarma metni istasyon dökümüdür", () => {
    expect(locationText(konum("BOLUNMUS", [st("Kurşun", 12), boya]), "IN_PROGRESS")).toBe("Kurşun 12 top, Boyahane 8 top");
    expect(locationText(konum("BASLAMADI", []), "PLANNED")).toBe("Başlamadı");
  });
});

describe("stationsForLocationFilter", () => {
  it("pasif + tezgah/devere + rota adımı olamayan (allowAsWorkOrderStep=false) düşer; sıra KK1 → fason → Kurşun → Tambur → Sevkiyat", () => {
    const mk = (name: string, kind: string, type: "INTERNAL" | "EXTERNAL" = "INTERNAL", isActive = true, allowAsWorkOrderStep = true) =>
      ({ id: name, name, kind, type, isActive, allowAsWorkOrderStep }) as Parameters<typeof stationsForLocationFilter>[0][number];
    const out = stationsForLocationFilter([
      mk("Sevkiyat", "SHIPPING"),
      mk("KK1 Girişi", "RAW_QC", "INTERNAL", true, false),
      mk("Tambur", "TAMBUR"),
      mk("Zımpara", "SUBCONTRACTOR", "EXTERNAL"),
      mk("Tezgah", "WEAVING"),
      mk("Eski", "PROCESS_QC", "INTERNAL", false),
      mk("Kurşun", "PROCESS_QC"),
      mk("Boyahane", "SUBCONTRACTOR", "EXTERNAL"),
      mk("KK1", "RAW_QC"),
      mk("Devere", "WARPING"),
    ]).map((s) => s.name);
    expect(out).toEqual(["KK1", "Boyahane", "Zımpara", "Kurşun", "Tambur", "Sevkiyat"]);
  });
});

describe("needsFasonTag", () => {
  it("ad zaten 'Fason' diyorsa ek etiket yok; iç istasyona hiç yok", () => {
    expect(needsFasonTag({ type: "EXTERNAL", name: "Boyahane (Fason)" })).toBe(false);
    expect(needsFasonTag({ type: "EXTERNAL", name: "Boyahane" })).toBe(true);
    expect(needsFasonTag({ type: "INTERNAL", name: "Kurşun" })).toBe(false);
  });
});

describe("LocationCell", () => {
  it("tek istasyon: yalnız çip, rozet yok", () => {
    renderWithProviders(<LocationCell konum={konum("TEK_ISTASYON", [st("Kurşun", 4)])} status="IN_PROGRESS" />);
    expect(screen.getByText("Kurşun")).toBeInTheDocument();
    expect(screen.queryByText(/^\+\d/)).toBeNull();
  });
  it("Başlamadı soluk metin; eski backend '—'", () => {
    const { unmount } = renderWithProviders(<LocationCell konum={konum("BASLAMADI", [])} status="PLANNED" />);
    expect(screen.getByText("Başlamadı")).toBeInTheDocument();
    unmount();
    renderWithProviders(<LocationCell konum={undefined} status="IN_PROGRESS" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
  it("bölünmüş: çip + '+2'; tıklayınca kart istasyon satırlarını basar, satır tıklaması tetiklenmez", async () => {
    const rowClick = vi.fn();
    renderWithProviders(
      <div onClick={rowClick}>
        <LocationCell konum={konum("BOLUNMUS", [st("Kurşun", 12), boya, st("Tambur", 3, { tur: "TAMBUR" })])} status="IN_PROGRESS" />
      </div>,
    );
    expect(screen.getByText("+2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Konum dağılımını göster" }));
    const card = await screen.findByTestId("location-card");
    expect(within(card).getByText("23 top · 3 istasyon")).toBeInTheDocument();
    expect(within(card).getByText("12 top")).toBeInTheDocument();
    expect(within(card).getByText("(Renk Boya A.Ş.)")).toBeInTheDocument();
    expect(within(card).getByText("3 top")).toBeInTheDocument();
    expect(rowClick).not.toHaveBeenCalled();
  });
});
