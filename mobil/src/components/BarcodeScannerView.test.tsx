import { act, fireEvent } from "@testing-library/react-native";

import { BarcodeScannerView } from "./BarcodeScannerView";
import { renderWithPaper } from "../test/render";
import { useDeviceSettingsStore } from "../store/deviceSettingsStore";

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

// =============================================================================
// Kamera yönü — "en son ne kullandıysam" (cihaz tercihi)
// =============================================================================
// Tarayıcı her açılışta arka kameraya sıfırlanıyordu; sabit montajlı / ekranı
// operatöre dönük tablette bu, her okutmada bir flip demekti. Tercih CİHAZDA
// yaşar (deviceSettingsStore) — ama `initialFacing` ile ZORLANMIŞ bağlamda
// (kilit ekranı) ne okunur ne yazılır: oradaki tek bir flip, fabrikanın geri
// kalan tüm okutma ekranlarını sessizce çevirirdi.
describe("BarcodeScannerView — kamera yönü tercihi", () => {
  const facingOf = (getByTestId: (id: string) => { props: Record<string, unknown> }) =>
    getByTestId("camera-view").props.facing as string;

  beforeEach(() => {
    useDeviceSettingsStore.setState({ cameraFacing: "back", isLoaded: true });
  });

  it("§10 zorlama yokken cihazda kayıtlı yönle açılır", () => {
    useDeviceSettingsStore.setState({ cameraFacing: "front" });
    const { getByTestId } = renderWithPaper(
      <BarcodeScannerView active onScan={jest.fn()} />,
    );
    expect(facingOf(getByTestId)).toBe("front");
  });

  it("§11 flip tuşu yönü çevirir VE cihaza yazar", () => {
    const { getByTestId, getByLabelText } = renderWithPaper(
      <BarcodeScannerView active onScan={jest.fn()} />,
    );
    expect(facingOf(getByTestId)).toBe("back");
    fireEvent.press(getByLabelText("Ön/arka kamera değiştir"));
    expect(facingOf(getByTestId)).toBe("front");
    expect(useDeviceSettingsStore.getState().cameraFacing).toBe("front");
  });

  it("§12 tercih diskten GEÇ gelirse yön yine de uygulanır (hidrasyon yarışı)", () => {
    // RootNavigator ayarları asenkron yükler; kilit ekranındaki kart okutma
    // tarayıcısı ondan önce açılabilir. Bu dal olmasaydı tercih "bazen çalışan"
    // bir özellik olurdu.
    const { getByTestId } = renderWithPaper(
      <BarcodeScannerView active onScan={jest.fn()} />,
    );
    expect(facingOf(getByTestId)).toBe("back");
    act(() => {
      useDeviceSettingsStore.setState({ cameraFacing: "front" });
    });
    expect(facingOf(getByTestId)).toBe("front");
  });

  it("§13 operatör elle çevirdiyse geç gelen tercih onu EZMEZ", () => {
    const { getByTestId, getByLabelText } = renderWithPaper(
      <BarcodeScannerView active onScan={jest.fn()} />,
    );
    fireEvent.press(getByLabelText("Ön/arka kamera değiştir")); // back → front
    act(() => {
      // Disk hidrasyonu geç geldi ve 'back' diyor — ama operatör az önce çevirdi.
      useDeviceSettingsStore.setState({ cameraFacing: "back" });
    });
    expect(facingOf(getByTestId)).toBe("front");
  });

  it("§14 ZORLANMIŞ yön kaydı OKUMAZ — bağlam kazanır (kilit ekranı)", () => {
    useDeviceSettingsStore.setState({ cameraFacing: "back" });
    const { getByTestId } = renderWithPaper(
      <BarcodeScannerView active onScan={jest.fn()} initialFacing="front" />,
    );
    expect(facingOf(getByTestId)).toBe("front");
  });

  it("§15 ZORLANMIŞ bağlamdaki flip cihaz tercihini YAZMAZ", () => {
    // ⚠️ Kayıt zorlanan yönle AYNI başlatılır (ikisi de 'front'): farklı
    // başlatılsaydı sızan yazım tam da mevcut değeri yazar ve kontrol
    // vakumen yeşil kalırdı (ilk yazımda tam bu oldu — ölçüldü).
    useDeviceSettingsStore.setState({ cameraFacing: "front" });
    const { getByTestId, getByLabelText } = renderWithPaper(
      <BarcodeScannerView active onScan={jest.fn()} initialFacing="front" />,
    );
    fireEvent.press(getByLabelText("Ön/arka kamera değiştir"));
    // Ekranda yön döner (tuş çalışır)…
    expect(facingOf(getByTestId)).toBe("back");
    // …ama fabrikanın geri kalan okutma ekranları bundan ETKİLENMEZ.
    expect(useDeviceSettingsStore.getState().cameraFacing).toBe("front");
  });
});
