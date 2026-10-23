// Kit v2: durum rozeti (4 ton + sözlük, bilinmeyen ham), segment seçimi, KPI erişilebilirlik etiketi, tema tercihi.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { INBOX_STATUSES, NOTIFICATION_STATUSES, REPORT_STATUSES, type AccountStatus } from "../src/api/wire";
import { STATUS_DICT, statusEntry } from "../src/lib/labels";
import { KpiCard, kpiAccessibilityLabel } from "../src/ui/KpiCard";
import { ListRow } from "../src/ui/ListRow";
import { Tabs } from "../src/ui/kit";
import { SegmentedControl } from "../src/ui/SegmentedControl";
import { StatusBadge } from "../src/ui/StatusBadge";
import { THEME_KEY, ThemeProvider, resolveScheme, useTokens } from "../src/ui/theme-context";
import { dark, light } from "../src/ui/tokens";

describe("StatusBadge + sözlük", () => {
  it("4 durum tonu: etiket ve erişilebilirlik metni", () => {
    for (const kind of ["iyi", "uyari", "kritik", "bilgi"] as const) {
      render(<StatusBadge kind={kind} label={`L-${kind}`} testID={`r-${kind}`} />);
      expect(screen.getByText(`L-${kind}`)).toBeTruthy();
      expect(screen.getByLabelText(`Durum: L-${kind}`)).toBeTruthy();
    }
  });
  it("teldeki her durum değeri sözlükte, Türkçe etiketle (ham enum ekrana çıkmaz)", () => {
    const accounts: AccountStatus[] = ["DAVETLI", "AKTIF", "KILITLI", "PASIF"];
    for (const v of [...INBOX_STATUSES, ...REPORT_STATUSES, ...NOTIFICATION_STATUSES, ...accounts]) {
      expect(STATUS_DICT[v]).toBeDefined();
      expect(statusEntry(v).label).not.toBe(v);
    }
  });
  it("tonlar: ret/hata/kilit kritik, işlendi/hazır/aktif iyi, bekliyor uyarı", () => {
    expect(["REDDEDILDI", "HATA", "KILITLI"].map((v) => statusEntry(v).tone)).toEqual(["kritik", "kritik", "kritik"]);
    expect(["ISLENDI", "HAZIR", "AKTIF"].map((v) => statusEntry(v).tone)).toEqual(["iyi", "iyi", "iyi"]);
    expect(statusEntry("BEKLIYOR").tone).toBe("uyari");
  });
  it("bilinmeyen değer ham döner (bilgi tonu)", () => {
    render(<StatusBadge value="YENI_DURUM" />);
    expect(screen.getByText("YENI_DURUM")).toBeTruthy();
    expect(statusEntry("YENI_DURUM").tone).toBe("bilgi");
    render(<StatusBadge value="REDDEDILDI" />);
    expect(screen.getByText("Reddedildi")).toBeTruthy();
  });
});

describe("SegmentedControl", () => {
  const items = [{ key: "bugun", label: "Bugün" }, { key: "hafta", label: "Hafta" }, { key: "ay", label: "Ay" }] as const;
  it("dokunulan parça seçilir; seçili parçaya dokunmak tetiklemez", () => {
    const fn = jest.fn();
    render(<SegmentedControl items={items} value="bugun" onChange={fn} />);
    expect(screen.getByTestId("segment-bugun").props.accessibilityState).toEqual({ selected: true });
    fireEvent.press(screen.getByTestId("segment-bugun"));
    expect(fn).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("segment-ay"));
    expect(fn).toHaveBeenCalledWith("ay");
  });
  it("kit Tabs aynı denetimi `sekme-` testID'leriyle çizer; 5+ seçenek kaydırılır", () => {
    const fn = jest.fn();
    const five = ["a", "b", "c", "d", "e"].map((k) => ({ key: k, label: k.toUpperCase() }));
    render(<Tabs items={five} value="a" onChange={fn} />);
    fireEvent.press(screen.getByTestId("sekme-e"));
    expect(fn).toHaveBeenCalledWith("e");
  });
});

describe("KpiCard", () => {
  it("ekran okuyucu tek etiket duyar: etiket, değer+birim, eğilim, durum", () => {
    render(
      <KpiCard label="Açık sipariş" value="12" unit="adet" domain="siparisler" trend={{ text: "+3 düne göre", direction: "up", tone: "uyari" }} status={{ kind: "kritik", label: "2 gecikmiş" }} spark={[1, 3, 2, 5]} testID="kpi" />,
    );
    expect(screen.getByLabelText("Açık sipariş: 12 adet, +3 düne göre, 2 gecikmiş")).toBeTruthy();
    expect(kpiAccessibilityLabel({ label: "Stok", value: "4.200" })).toBe("Stok: 4.200");
  });
  it("dokunulabilir KPI düğme rolündedir", () => {
    const fn = jest.fn();
    render(<KpiCard label="Sevk" value="3" domain="sevkiyat" onPress={fn} testID="kpi-sevk" />);
    fireEvent.press(screen.getByTestId("kpi-sevk"));
    expect(fn).toHaveBeenCalled();
  });
});

describe("KpiCard yan değerler + ListRow Posta düzeni", () => {
  it("KPI etiketi açıklama ve yan değerleri de okur", () => {
    render(<KpiCard label="Bugün sevk" value="1.200" unit="m" caption="4 top · brüt" lines={[{ label: "Bu ay", value: "23.120 m" }]} domain="sevkiyat" testID="kpi-yan" />);
    expect(screen.getByTestId("kpi-yan").props.accessibilityLabel).toBe("Bugün sevk: 1.200 m, 4 top · brüt, Bu ay 23.120 m");
  });
  it("ListRow `lines` alt satırları tam genişlikte basar; etiket başlık, değer, satırlar", () => {
    render(<ListRow title="İE-12" value="400 m" lines={["Boya · plan 30.10.2026", "200 / 400 m üretildi"]} domain="uretim" testID="satir" />);
    expect(screen.getByText("200 / 400 m üretildi")).toBeTruthy();
    expect(screen.getByTestId("satir").props.accessibilityLabel).toBe("İE-12, 400 m, Boya · plan 30.10.2026, 200 / 400 m üretildi");
  });
});

describe("tema", () => {
  function Probe() {
    const t = useTokens();
    return <Text testID="sema">{t.scheme}</Text>;
  }
  it("tercih: sistem sistemi izler, açık/koyu sabitler", () => {
    expect(resolveScheme("sistem", "dark")).toBe("dark");
    expect(resolveScheme("sistem", null)).toBe("light");
    expect(resolveScheme("acik", "dark")).toBe("light");
    expect(resolveScheme("koyu", "light")).toBe("dark");
  });
  it("sağlayıcısız açık tema; saklı 'koyu' tercihi depodan okunur", async () => {
    render(<Probe />);
    expect(screen.getByTestId("sema").props.children).toBe(light.scheme);
    const store = { get: jest.fn(async (k: string) => (k === THEME_KEY ? "koyu" : null)), set: jest.fn(async () => undefined) };
    render(<ThemeProvider store={store}><Probe /></ThemeProvider>);
    await act(async () => undefined);
    expect(screen.getAllByTestId("sema").at(-1)!.props.children).toBe(dark.scheme);
  });
});
