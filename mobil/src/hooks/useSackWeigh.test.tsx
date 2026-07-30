import type { ReactNode } from "react";
import { renderHook, act, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Mock'lar (import'lardan ÖNCE tanımlanmalı) ────────────────────────────────
const mockWeighSack = jest.fn();
const mockSetSackNotes = jest.fn();
jest.mock("../services/packing.service", () => ({
  packingService: {
    weighSack: (...a: unknown[]) => mockWeighSack(...a),
    setSackNotes: (...a: unknown[]) => mockSetSackNotes(...a),
  },
}));

let mockPeripheralRows: unknown[] = [];
jest.mock("./useMachinePeripherals", () => ({
  useMachinePeripherals: () => mockPeripheralRows,
  primaryScaleFor: (rows: unknown[]) => rows[0] ?? null,
}));

let mockReadImpl: () => Promise<string> = async () => "";
let mockDecodeImpl: (raw: string) => number | null = () => null;
let mockIoSupported = true;
jest.mock("./usePeripheralIO", () => ({
  buildIoFromPeripheral: () => ({
    supported: mockIoSupported,
    transport: mockIoSupported ? { read: () => mockReadImpl() } : null,
    codec: mockIoSupported ? { decode: (raw: string) => mockDecodeImpl(raw) } : null,
  }),
}));

jest.mock("../services/hal/btClassic.transport", () => ({
  isBonded: jest.fn(async () => true),
  pairByMac: jest.fn(async () => undefined),
}));

const mockToast = jest.fn();
jest.mock("react-native-toast-message", () => ({ __esModule: true, default: { show: (a: unknown) => mockToast(a) } }));
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: "s", Error: "e", Warning: "w" },
}));

import { useSackWeigh } from "./useSackWeigh";

// =============================================================================
// Tek dokunuş çuval tartısı — korunan davranışlar:
//   1. Kantar TANIMSIZ → weighSack HİÇ çağrılmaz (sessiz sahte değer yok)
//   2. Okuma BAŞARISIZ / değer <= 0 → weighSack HİÇ çağrılmaz
//   3. Başarılı okuma → weighSack okunan kg ile ÇAĞRILIR (modal yok, tek dokunuş)
//   4. Meşgulken ikinci dokunuş YENİ İSTEK AÇMAZ (BT tek soket)
//   5. simulate cihaz → kaydeder AMA toast'ta SİMÜLASYON uyarısı verir
//   6. Elle giriş (saveManual) doğrudan verilen kg'yi yazar
// =============================================================================

const SCALE = {
  connectionType: "BLUETOOTH_SPP",
  kind: "SCALE",
  address: "00:11:22:33:44:55",
  readMode: "POLL",
  pollCommand: "P",
  terminator: "\r\n",
  timeoutMs: 2500,
  identifyPattern: null,
  simulate: false,
  role: "PRIMARY",
};

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function setup(onSaved = jest.fn()) {
  const r = renderHook(() => useSackWeigh(onSaved), { wrapper });
  return { ...r, onSaved };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPeripheralRows = [SCALE];
  mockIoSupported = true;
  mockReadImpl = async () => "42.5";
  mockDecodeImpl = () => 42.5;
  mockWeighSack.mockResolvedValue({ success: true, data: {} });
});

describe("useSackWeigh — tek dokunuş tartı", () => {
  it("1) kantar tanımsızsa weighSack HİÇ çağrılmaz + Türkçe hata", async () => {
    mockPeripheralRows = [];
    const { result } = setup();
    await act(async () => {
      await result.current.weigh({ id: "s1", label: "CV1" });
    });
    expect(mockWeighSack).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ text1: "Kantar tanımlı değil" }));
    expect(result.current.hasScale).toBe(false);
  });

  it("2a) okuma hata verirse weighSack HİÇ çağrılmaz", async () => {
    mockReadImpl = async () => {
      throw new Error("timeout");
    };
    const { result } = setup();
    await act(async () => {
      await result.current.weigh({ id: "s1", label: "CV1" });
    });
    expect(mockWeighSack).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ text1: "Kantar okunamadı" }));
  });

  it("2b) değer <= 0 ise weighSack HİÇ çağrılmaz (sıfır tartı kaydedilmez)", async () => {
    mockDecodeImpl = () => 0;
    const { result } = setup();
    await act(async () => {
      await result.current.weigh({ id: "s1", label: "CV1" });
    });
    expect(mockWeighSack).not.toHaveBeenCalled();
  });

  it("2c) bu derlemede desteklenmiyorsa weighSack HİÇ çağrılmaz", async () => {
    mockIoSupported = false;
    const { result } = setup();
    await act(async () => {
      await result.current.weigh({ id: "s1", label: "CV1" });
    });
    expect(mockWeighSack).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ text1: "Kantar okunamıyor" }));
  });

  it("3) başarılı okuma → okunan kg DOĞRUDAN kaydedilir + onSaved (source=SCALE)", async () => {
    const { result, onSaved } = setup();
    await act(async () => {
      await result.current.weigh({ id: "s1", label: "CV1" });
    });
    // `source: 'SCALE'` beyanı ZORUNLU: backend simüle kantar korumasının girdisi.
    expect(mockWeighSack).toHaveBeenCalledWith("s1", { weightKg: 42.5, source: "SCALE" });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("4) meşgulken ikinci dokunuş YENİ İSTEK AÇMAZ (BT tek soket)", async () => {
    let release: (v: string) => void = () => {};
    mockReadImpl = () => new Promise<string>((res) => { release = res; });
    const { result } = setup();

    // İlk dokunuş: okuma askıda kalır.
    let first: Promise<void>;
    act(() => {
      first = result.current.weigh({ id: "s1", label: "CV1" });
    });
    // İkinci dokunuş meşgulken → sessizce yok sayılır.
    await act(async () => {
      await result.current.weigh({ id: "s2", label: "CV2" });
    });
    expect(mockWeighSack).not.toHaveBeenCalled();

    await act(async () => {
      release("42.5");
      await first!;
    });
    // Yalnız İLK çuval kaydedildi.
    expect(mockWeighSack).toHaveBeenCalledTimes(1);
    expect(mockWeighSack).toHaveBeenCalledWith("s1", { weightKg: 42.5, source: "SCALE" });
  });

  it("5) simulate cihazda değeri SIMULATED olarak BEYAN eder (backend reddeder)", async () => {
    // ⚠️ SÖZLEŞME DEĞİŞTİ (2026-07-30): eskiden bu test "simüle değer kaydedilir,
    // yalnız toast uyarır" davranışını sabitliyordu. Çuval kg'si sevk irsaliyesine ve
    // çeki listesine basıldığı için (müşteri/gümrük belgesi) uydurma değerin canlı
    // veriye girmesi kabul edilemez. İstemci artık `source: 'SIMULATED'` BEYAN eder;
    // backend `shipping.simulatedWeightEnabled` kapalıyken (default) 400 döner ve
    // Türkçe mesajı `saveMut.onError` gösterir. Demo/eğitim kurulumu bayrağı açar.
    mockPeripheralRows = [{ ...SCALE, simulate: true }];
    const { result } = setup();
    await act(async () => {
      await result.current.weigh({ id: "s1", label: "CV1" });
    });
    expect(mockWeighSack).toHaveBeenCalledWith("s1", { weightKg: expect.any(Number), source: "SIMULATED" });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ text1: expect.stringContaining("SİMÜLASYON") }),
    );
  });

  it("6) saveManual verilen kg'yi yazar (kantara hiç gitmez, source=MANUAL)", async () => {
    mockReadImpl = async () => {
      throw new Error("kantar kapalı");
    };
    const { result } = setup();
    let ok = false;
    await act(async () => {
      ok = await result.current.saveManual({ id: "s1", label: "CV1" }, 17.25);
    });
    expect(ok).toBe(true);
    // MANUAL, simüle korumasından MUAF — kantarsız/arızalı durumun kaçış yolu.
    expect(mockWeighSack).toHaveBeenCalledWith("s1", { weightKg: 17.25, source: "MANUAL" });
  });

  it("7) kantar okuması sürerken saveManual İKİNCİ yazma yapmaz (D10)", async () => {
    // ⚖ tuşları `busy` ile pasifleşiyor ama ⋮ → "Elle kg gir" yolu ona bağlı DEĞİLDİ:
    // okuma sürerken elle giriş aynı çuvala ikinci weighSack atıyor, son yazan
    // kazanıyor ve hangi değerin (kantar mı elle mi) kaldığı belirsizleşiyordu.
    let release: (v: string) => void = () => {};
    mockReadImpl = () => new Promise<string>((res) => { release = res; });
    const { result } = setup();

    let first: Promise<void>;
    act(() => {
      first = result.current.weigh({ id: "s1", label: "CV1" });
    });
    let ok = true;
    await act(async () => {
      ok = await result.current.saveManual({ id: "s1", label: "CV1" }, 99.9);
    });
    expect(ok).toBe(false);
    expect(mockWeighSack).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ text1: expect.stringContaining("Kantar okuması sürüyor") }),
    );

    await act(async () => {
      release("42.5");
      await first!;
    });
    // Yalnız kantar okuması yazıldı; elle giriş hiç gitmedi.
    expect(mockWeighSack).toHaveBeenCalledTimes(1);
    expect(mockWeighSack).toHaveBeenCalledWith("s1", { weightKg: 42.5, source: "SCALE" });
  });
});
