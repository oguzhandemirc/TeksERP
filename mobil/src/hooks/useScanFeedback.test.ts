import { act, renderHook } from "@testing-library/react-native";

import { useScanFeedback } from "./useScanFeedback";
import { signalScan } from "../services/scanFeedback";

// =============================================================================
// Okutmanın GÖRSEL geri bildirimi — tek kaynak.
// =============================================================================
// Saha vakaları: (a) mükerrer okuma yalnız alttaki şeritte yanıp sönüyordu,
// kadraja bakan operatör göremiyordu; (b) aynı olay Hızlı İş Emri'nde şeritle,
// Fason Sevk'te kaybolan bir toast'la anlatılıyordu. Bu hook ikisini de tek
// yerde karara bağlar — ses/titreşimi de kendisi çağırır (çağıran ayrıca
// çağırırsa çift bip olur).
// =============================================================================

jest.mock("../services/scanFeedback", () => ({ signalScan: jest.fn() }));

const signalMock = signalScan as jest.MockedFunction<typeof signalScan>;

describe("useScanFeedback", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    signalMock.mockClear();
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("§1 mükerrer — merkez bildirim + şerit vurgusu + 'duplicate' sinyali", () => {
    const { result } = renderHook(() => useScanFeedback());
    act(() => result.current.flashDuplicate("T2508260001"));

    // Ekranın ORTASINA basılan bildirim: operatörün baktığı yer.
    expect(result.current.flash).toMatchObject({
      kind: "duplicate",
      title: "ZATEN OKUTULDU",
      detail: "T2508260001",
    });
    // Şeritteki satır vurgusu da korunur — ikisi aynı olayın iki süresi.
    expect(result.current.duplicateBarcode).toBe("T2508260001");
    expect(signalMock).toHaveBeenCalledWith("duplicate");
  });

  it("§2 bildirim kendiliğinden kapanır (kadraj kalıcı olarak kapanmaz)", () => {
    const { result } = renderHook(() => useScanFeedback());
    act(() => result.current.flashDuplicate("T2508260001"));
    act(() => jest.advanceTimersByTime(3000));
    expect(result.current.flash).toBeNull();
    expect(result.current.duplicateBarcode).toBeNull();
  });

  it("§3 AYNI barkod tekrar okutulunca bildirim yeniden doğar (seq artar)", () => {
    // Giriş animasyonunu yeniden oynatan şey nesnenin YENİ olmasıdır; `seq` bunu
    // değer düzeyinde de garantiler (aynı barkodun ikinci okutmasında alanların
    // hepsi birebir aynı olurdu). Değer aynı kalırsa bildirimi değere göre
    // sadeleştiren/memolayan bir tüketici ekranda hiçbir şey göstermez — tam da
    // düzeltilen "okumadı sandım" hatası.
    const { result } = renderHook(() => useScanFeedback());
    act(() => result.current.flashDuplicate("T2508260001"));
    const first = result.current.flash;
    act(() => jest.advanceTimersByTime(200));
    act(() => result.current.flashDuplicate("T2508260001"));
    const second = result.current.flash;

    expect(second).not.toBe(first);
    expect(second?.seq).toBeGreaterThan(first?.seq ?? 0);
    expect(signalMock).toHaveBeenCalledTimes(2);
  });

  it("§4 ret — bildirim SEBEBİ taşır ve şerit satırı bildirimden UZUN yaşar", () => {
    // İki süre bilinçli farklı: bildirim kadraja bakan göz için (1-2 sn), şerit
    // topu bırakıp dönen operatör için (~10 sn) — "neden almadı" sorusunun
    // cevabı ekranda kalmalı.
    const { result } = renderHook(() => useScanFeedback());
    act(() => result.current.pushRejects([{ barcode: "T99", reason: "Stokta değil" }]));

    expect(result.current.flash).toMatchObject({ kind: "reject", title: "EKLENMEDİ" });
    expect(result.current.flash?.detail).toContain("Stokta değil");
    expect(signalMock).toHaveBeenCalledWith("reject");

    act(() => jest.advanceTimersByTime(3000));
    expect(result.current.flash).toBeNull();
    expect(result.current.rejects).toHaveLength(1); // sebep hâlâ ekranda

    act(() => jest.advanceTimersByTime(8000));
    expect(result.current.rejects).toHaveLength(0);
  });

  it("§5 her ret satırı KENDİ ömrünü sayar", () => {
    // Tek ortak zamanlayıcı, arka arkaya gelen retlerden ilkinin süresi
    // dolduğunda hepsini birden silerdi.
    const { result } = renderHook(() => useScanFeedback());
    act(() => result.current.pushRejects([{ barcode: "T1", reason: "Bulunamadı" }]));
    act(() => jest.advanceTimersByTime(6000));
    act(() => result.current.pushRejects([{ barcode: "T2", reason: "Farklı ürün" }]));
    act(() => jest.advanceTimersByTime(5000));

    // İlkinin ömrü doldu, ikincisininki dolmadı.
    expect(result.current.rejects.map((r) => r.barcode)).toEqual(["T2"]);
  });

  it("§6 reset — yeni akışın üstünde eski ret satırı asılı kalmaz", () => {
    const { result } = renderHook(() => useScanFeedback());
    act(() => result.current.pushRejects([{ barcode: "T1", reason: "Bulunamadı" }]));
    act(() => result.current.reset());
    expect(result.current.rejects).toHaveLength(0);
    expect(result.current.flash).toBeNull();
    expect(result.current.duplicateBarcode).toBeNull();
  });
});
