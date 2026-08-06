import { act, fireEvent } from "@testing-library/react-native";

import { BarcodeScannerView } from "./BarcodeScannerView";
import { renderWithPaper } from "../test/render";

// =============================================================================
// Dokunarak okut (trigger="tap") — 2026-08-05 saha bulgusunun bekçisi.
// =============================================================================
// Vaka: Hızlı İş Emri'nde operatör telefonu top yığınının üzerinde gezdirirken
// kadraja giren KOMŞU topların barkodları da otomatik okunup iş emrine
// ekleniyordu. Çözüm "okuyup onay sormak" DEĞİL, gezinme sırasında taramayı
// tamamen KAPATMAK: silahsızken `onBarcodeScanned` CameraView'e hiç bağlanmaz.
//
// Bu testin ölçtüğü şey tam olarak o bağ. Guard (`busy || !live`) kaldırılırsa
// §1 ve §3 kırmızı verir — doğrulandı.
// =============================================================================

// @expo/vector-icons → expo-font → expo-asset zinciri testte kurulu değil
// (yalnız ikon çizimi için). Basit bir View yeterli.
jest.mock("@expo/vector-icons", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  const Icon = (props: Record<string, unknown>) => React.createElement(View, props);
  return { MaterialCommunityIcons: Icon, Ionicons: Icon, MaterialIcons: Icon };
});

jest.mock("expo-camera", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return {
    CameraView: (props: Record<string, unknown>) =>
      React.createElement(View, { ...props, testID: "camera-view" }),
    useCameraPermissions: () => [
      { granted: true, canAskAgain: true, status: "granted" },
      jest.fn(),
    ],
  };
});

jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

type ScanHandler = ((r: { data: string }) => void) | undefined;

describe("BarcodeScannerView — dokunarak okut", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  const renderTap = (onScan = jest.fn()) => {
    const r = renderWithPaper(
      <BarcodeScannerView active onScan={onScan} trigger="tap" continuous />,
    );
    const handler = (): ScanHandler =>
      r.getByTestId("camera-view").props.onBarcodeScanned as ScanHandler;
    return { ...r, onScan, handler };
  };

  it("§1 açılışta SİLAHSIZ — tarayıcı kameraya hiç bağlanmaz", () => {
    const { handler, getByLabelText } = renderTap();
    // Asıl kural: gezdirirken kadrajdan geçen komşu top İŞLENEMEZ, çünkü
    // işleyecek bir handler yoktur ("okuyup atmak" değil, okumamak).
    expect(handler()).toBeUndefined();
    expect(getByLabelText("Topu okut")).toBeTruthy();
  });

  it("§2 OKUT'a basınca silahlanır ve tek top okur", () => {
    const { handler, getByLabelText, onScan } = renderTap();
    fireEvent.press(getByLabelText("Topu okut"));
    expect(handler()).toBeDefined();

    act(() => handler()?.({ data: "TOP-1" }));
    act(() => jest.advanceTimersByTime(200)); // onScan 180ms sonra çağrılır
    expect(onScan).toHaveBeenCalledWith("TOP-1");
  });

  it("§3 okumadan SONRA kendiliğinden yeniden silahlanmaz", () => {
    const { handler, getByLabelText, onScan } = renderTap();
    fireEvent.press(getByLabelText("Topu okut"));
    act(() => handler()?.({ data: "TOP-1" }));
    act(() => jest.advanceTimersByTime(200));

    // Sürekli mod (continuous) burada YALNIZ "modal açık kalsın" demektir;
    // 1,4 sn'lik otomatik rearm tap modunda KOŞMAMALI — koşsaydı sorun aynı
    // genişlikte bir pencereyle geri gelirdi.
    act(() => jest.advanceTimersByTime(5000));
    expect(handler()).toBeUndefined();
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("§4 silahlanma penceresi dolunca kendiliğinden kapanır", () => {
    const { handler, getByLabelText } = renderTap();
    fireEvent.press(getByLabelText("Topu okut"));
    expect(handler()).toBeDefined();
    act(() => jest.advanceTimersByTime(9000)); // TAP_ARM_MS = 8000
    expect(handler()).toBeUndefined();
  });

  it("§5 İPTAL silahsız bırakır", () => {
    const { handler, getByLabelText } = renderTap();
    fireEvent.press(getByLabelText("Topu okut"));
    expect(handler()).toBeDefined();
    fireEvent.press(getByLabelText("Okumayı iptal et"));
    expect(handler()).toBeUndefined();
  });

  it("§6 auto mod (varsayılan) DEĞİŞMEDİ — açılışta bağlı, OKUT tuşu yok", () => {
    // KK1 / Tambur / Paketleme / Kartela ekranları bu daldan geçiyor; tap modu
    // onlara sızarsa saha sessizce "kamera okumuyor" der. (Fason Sevk top
    // tarayıcısı 2026-08-06'da bilinçli olarak tap moduna geçti.)
    const onScan = jest.fn();
    const { getByTestId, queryByLabelText } = renderWithPaper(
      <BarcodeScannerView active onScan={onScan} continuous />,
    );
    expect(getByTestId("camera-view").props.onBarcodeScanned).toBeDefined();
    expect(queryByLabelText("Topu okut")).toBeNull();
  });
});

// =============================================================================
// Merkez bildirim (flash) — 2026-08-06 saha geri bildirimi.
// =============================================================================
// Vaka: mükerrer okumada tek görsel iz ALTTAKİ şeritte yanıp sönen satırdı.
// Operatörün gözü kadrajın içinde olduğu için şeridi görmüyor, "okumadı" sanıp
// tekrar okutuyordu. Bildirim tam da bakılan yere basılır.
// =============================================================================
describe("BarcodeScannerView — merkez bildirim", () => {
  it("§7 bildirim verilince kadrajın ortasına basılır (başlık + detay)", () => {
    const { getByText, getByTestId } = renderWithPaper(
      <BarcodeScannerView
        active
        onScan={jest.fn()}
        flash={{ kind: "duplicate", title: "ZATEN OKUTULDU", detail: "T2508260001", seq: 1 }}
      />,
    );
    expect(getByTestId("scan-flash")).toBeTruthy();
    expect(getByText("ZATEN OKUTULDU")).toBeTruthy();
    expect(getByText("T2508260001")).toBeTruthy();
  });

  it("§8 bildirim yokken hiç çizilmez — bugünkü çıktı birebir korunur", () => {
    const { queryByTestId } = renderWithPaper(
      <BarcodeScannerView active onScan={jest.fn()} />,
    );
    expect(queryByTestId("scan-flash")).toBeNull();
  });

  it("§9 bildirim varken yakalama onayı (yeşil tik) BASTIRILIR", () => {
    // İki zıt işaret aynı anda görünürse operatör topu eklenmiş sanar: yeşil tik
    // yalnız "kod yakalandı" der, sonucu söyleyen taraf çağırandır.
    const flash = { kind: "duplicate" as const, title: "ZATEN OKUTULDU", seq: 1 };
    const { rerender, queryByTestId, getByLabelText, getByTestId } = renderWithPaper(
      <BarcodeScannerView active onScan={jest.fn()} trigger="tap" continuous />,
    );
    fireEvent.press(getByLabelText("Topu okut"));
    const handler = () =>
      getByTestId("camera-view").props.onBarcodeScanned as ScanHandler;
    act(() => handler()?.({ data: "T2508260001" }));
    // Yakalama anı: bildirim yokken yeşil tik var (bugünkü davranış).
    expect(queryByTestId("scan-success-check")).toBeTruthy();

    // Çağıran "mükerrer" kararını verince tik yerini bildirime bırakır.
    rerender(
      <BarcodeScannerView active onScan={jest.fn()} trigger="tap" continuous flash={flash} />,
    );
    expect(queryByTestId("scan-success-check")).toBeNull();
    expect(queryByTestId("scan-flash")).toBeTruthy();
  });
});
