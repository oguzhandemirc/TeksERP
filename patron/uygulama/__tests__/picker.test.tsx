import { act, fireEvent, render, screen } from "@testing-library/react-native";

const mockList = jest.fn();
const mockCache = { load: jest.fn(async (_k: string, f: () => Promise<unknown>) => ({ data: await f(), offline: false, savedAt: "" })) };
const mockSession = { api: { list: mockList }, cache: mockCache, markOnline: jest.fn() };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));

// mock'lar kurulduktan SONRA yüklenir.
const { Picker } = require("../src/ui/Picker") as typeof import("../src/ui/Picker");

const sayfa = (ad: string) => ({ kayitlar: [{ id: "11111111-1111-4111-8111-111111111111", kayit: { ad, kod: "C-1" }, surum: "x" }], sonraki: null });

async function bekle(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await act(async () => undefined);
}

describe("seçici — sunucu araması", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockList.mockReset();
    mockList.mockImplementation(async () => sayfa("SUNUCUNUN DÖNDÜĞÜ"));
  });
  afterEach(() => jest.useRealTimers());

  it("dokununca doğrudan modal: arama kutusu + tek süzgeç, varsayılan süzgeç sunucuya gider", async () => {
    const onChange = jest.fn();
    render(<Picker label="Cari" projection="cari-kart" value={null} onChange={onChange} testID="cari-sec" />);
    fireEvent.press(screen.getByTestId("cari-sec"));
    await bekle(0);
    expect(screen.getByTestId("secici-ara")).toBeTruthy();
    expect(screen.getByText("Rol: Müşteri ▾")).toBeTruthy();
    expect(mockList).toHaveBeenLastCalledWith("cari-kart", expect.objectContaining({ suzgec: "MUSTERI", ara: undefined }));
  });

  it("⭐ terim bekleme sonrası SUNUCUYA gider; istemci listeyi süzmez", async () => {
    render(<Picker label="Cari" projection="cari-kart" value={null} onChange={jest.fn()} testID="cari-sec" />);
    fireEvent.press(screen.getByTestId("cari-sec"));
    await bekle(0);
    mockList.mockClear();
    fireEvent.changeText(screen.getByTestId("secici-ara"), " çağ");
    fireEvent.changeText(screen.getByTestId("secici-ara"), " çağrı ");
    await bekle(100);
    expect(mockList).not.toHaveBeenCalled(); // her tuşta istek yok
    await bekle(300);
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenLastCalledWith("cari-kart", expect.objectContaining({ ara: "çağrı", suzgec: "MUSTERI" }));
    // Sunucu terimle eşleşmeyen adı döndürse de gösterilir: süzme istemcide YAPILMAZ.
    expect(screen.getByText("SUNUCUNUN DÖNDÜĞÜ")).toBeTruthy();
  });

  it("süzgeç değişince yeniden sorulur; Tümü süzgeci kaldırır; seçim başlığı iletir", async () => {
    const onChange = jest.fn();
    render(<Picker label="Cari" projection="cari-kart" value={null} onChange={onChange} testID="cari-sec" />);
    fireEvent.press(screen.getByTestId("cari-sec"));
    await bekle(0);
    fireEvent.press(screen.getByTestId("secici-suzgec"));
    fireEvent.press(screen.getByTestId("secici-suzgec-TEDARIKCI"));
    await bekle(0);
    expect(mockList).toHaveBeenLastCalledWith("cari-kart", expect.objectContaining({ suzgec: "TEDARIKCI" }));
    fireEvent.press(screen.getByTestId("secici-suzgec"));
    fireEvent.press(screen.getByTestId("secici-suzgec-tumu"));
    await bekle(0);
    expect(mockList).toHaveBeenLastCalledWith("cari-kart", expect.objectContaining({ suzgec: undefined }));
    fireEvent.press(screen.getByTestId("kayit-11111111-1111-4111-8111-111111111111"));
    expect(onChange).toHaveBeenCalledWith({ id: "11111111-1111-4111-8111-111111111111", title: "SUNUCUNUN DÖNDÜĞÜ" });
  });

  it("arama beyanı olmayan listede arama kutusu yok", async () => {
    render(<Picker label="Depo" projection="depo" value={null} onChange={jest.fn()} testID="depo-sec" />);
    fireEvent.press(screen.getByTestId("depo-sec"));
    await bekle(0);
    expect(screen.queryByTestId("secici-ara")).toBeNull();
    expect(mockList).toHaveBeenLastCalledWith("depo", expect.objectContaining({ ara: undefined, suzgec: undefined }));
  });
});
