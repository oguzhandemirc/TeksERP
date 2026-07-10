import { fireEvent, render } from "@testing-library/react-native";
import ScannerEntryBar from "./ScannerEntryBar";
import { renderWithPaper } from "../test/render";

// ScannerEntryBar barkod/refakat kartı giriş bandının ortak satırı — saha
// operatörünün her okutma ekranında gördüğü bileşen. manualMode prop'u explicit
// verilince store'a (useDeviceSettingsStore) bağlı kalmadan modu zorlayabiliyoruz.

describe("ScannerEntryBar — manualMode (Kamera arızalı: elle giriş)", () => {
  it("input + kamera + liste butonlarını gösterir", () => {
    const { getByPlaceholderText, getByLabelText } = renderWithPaper(
      <ScannerEntryBar
        manualMode
        value=""
        onChangeText={() => {}}
        placeholder="Barkod gir"
        onScan={() => {}}
        onList={() => {}}
      />,
    );
    expect(getByPlaceholderText("Barkod gir")).toBeTruthy();
    expect(getByLabelText("Kamera ile okut")).toBeTruthy();
    expect(getByLabelText("Listeden seç")).toBeTruthy();
  });

  it("input değişimi onChangeText'i tetikler", () => {
    const onChangeText = jest.fn();
    const { getByPlaceholderText } = renderWithPaper(
      <ScannerEntryBar
        manualMode
        value=""
        onChangeText={onChangeText}
        placeholder="Barkod gir"
      />,
    );
    fireEvent.changeText(getByPlaceholderText("Barkod gir"), "TEKS-1");
    expect(onChangeText).toHaveBeenCalledWith("TEKS-1");
  });

  it("kamera ikonuna basış onScan'i tetikler", () => {
    const onScan = jest.fn();
    const { getByLabelText } = renderWithPaper(
      <ScannerEntryBar manualMode value="" onChangeText={() => {}} onScan={onScan} />,
    );
    fireEvent.press(getByLabelText("Kamera ile okut"));
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("onList verilmezse liste butonu render edilmez", () => {
    const { queryByLabelText } = renderWithPaper(
      <ScannerEntryBar manualMode value="" onChangeText={() => {}} onScan={() => {}} />,
    );
    expect(queryByLabelText("Listeden seç")).toBeNull();
  });

  it("dolu değer + onResolve → submit'te onResolve tetiklenir", () => {
    const onResolve = jest.fn();
    const { getByPlaceholderText } = renderWithPaper(
      <ScannerEntryBar
        manualMode
        value="TEKS-99"
        onChangeText={() => {}}
        placeholder="Barkod gir"
        onResolve={onResolve}
      />,
    );
    fireEvent(getByPlaceholderText("Barkod gir"), "submitEditing");
    expect(onResolve).toHaveBeenCalledTimes(1);
  });
});

describe("ScannerEntryBar — kamera-only (default CTA)", () => {
  it("büyük 'Kamera ile Okut' CTA + liste ikonu render eder", () => {
    const { getByText, getByLabelText } = renderWithPaper(
      <ScannerEntryBar
        manualMode={false}
        value=""
        onChangeText={() => {}}
        onScan={() => {}}
        onList={() => {}}
      />,
    );
    expect(getByText("Kamera ile Okut")).toBeTruthy();
    expect(getByLabelText("Listeden seç")).toBeTruthy();
  });

  it("scanCtaLabel override edilebilir", () => {
    const { getByText } = renderWithPaper(
      <ScannerEntryBar
        manualMode={false}
        value=""
        onChangeText={() => {}}
        onScan={() => {}}
        scanCtaLabel="Kartı Okut"
      />,
    );
    expect(getByText("Kartı Okut")).toBeTruthy();
  });

  it("CTA'ya basış onScan'i tetikler", () => {
    const onScan = jest.fn();
    const { getByText } = renderWithPaper(
      <ScannerEntryBar
        manualMode={false}
        value=""
        onChangeText={() => {}}
        onScan={onScan}
      />,
    );
    fireEvent.press(getByText("Kamera ile Okut"));
    expect(onScan).toHaveBeenCalledTimes(1);
  });
});

describe("ScannerEntryBar — compactCta (parent kendi tasarımını çizer)", () => {
  it("manualMode=false + compactCta → hiçbir şey render edilmez (null)", () => {
    // null yolu Paper bileşeni kullanmaz → sarmalayıcısız render; kök null olmalı
    // (PaperProvider sarmalı kendi View'ını ekleyip null'ı maskelerdi — Pager testi
    // ile aynı kalıp).
    const { toJSON } = render(
      <ScannerEntryBar
        manualMode={false}
        compactCta
        value=""
        onChangeText={() => {}}
        onScan={() => {}}
      />,
    );
    expect(toJSON()).toBeNull();
  });

  it("manualMode=true ise compactCta'ya rağmen input bandı görünür", () => {
    const { getByPlaceholderText } = renderWithPaper(
      <ScannerEntryBar
        manualMode
        compactCta
        value=""
        onChangeText={() => {}}
        placeholder="Barkod gir"
      />,
    );
    expect(getByPlaceholderText("Barkod gir")).toBeTruthy();
  });
});

describe("ScannerEntryBar — HID okutması aktivite sayılır (idle kilit regresyonu)", () => {
  // HID okuyucu sistem klavyesidir: dokunma responder'ına girmez, kök trackTouch
  // göremez. Input'a gelen her karakter/submit recordActivity ile damgalanmalı —
  // yalnız okutarak çalışan operatör 10. dakikada iş ortasında kilitlenmesin.
  const { getLastActivity } = jest.requireActual<
    typeof import("../store/lockStore")
  >("../store/lockStore");

  afterEach(() => jest.restoreAllMocks());

  it("input'a yazılan karakter (HID keystroke) son-aktivite damgasını tazeler", () => {
    const T = 7_777_777_777;
    jest.spyOn(Date, "now").mockReturnValue(T);
    const { getByPlaceholderText } = renderWithPaper(
      <ScannerEntryBar manualMode value="" onChangeText={() => {}} placeholder="Barkod gir" />,
    );
    fireEvent.changeText(getByPlaceholderText("Barkod gir"), "TEKS-1");
    expect(getLastActivity()).toBe(T);
  });

  it("submit (HID Enter) de damgayı tazeler ve onResolve'u çağırır", () => {
    const T = 8_888_888_888;
    jest.spyOn(Date, "now").mockReturnValue(T);
    const onResolve = jest.fn();
    const { getByPlaceholderText } = renderWithPaper(
      <ScannerEntryBar
        manualMode
        value="TEKS-1"
        onChangeText={() => {}}
        onResolve={onResolve}
        placeholder="Barkod gir"
      />,
    );
    fireEvent(getByPlaceholderText("Barkod gir"), "submitEditing");
    expect(onResolve).toHaveBeenCalled();
    expect(getLastActivity()).toBe(T);
  });
});
