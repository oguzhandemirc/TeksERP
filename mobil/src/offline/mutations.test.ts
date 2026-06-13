// Offline istasyon mutation'larının SAF mantığı — saha riski en yüksek katman.
//
// Burada test edilen, üretimde operatörün gördüğü GERÇEK config'tir:
// registerStationMutationDefaults() ile kaydedilen retry / retryDelay /
// networkMode değerlerini queryClient.getMutationDefaults() ile geri okuyup
// doğruluyoruz (config'i kopyalamıyoruz — kayıt edilen fonksiyonun ta kendisi).
//
// Servisler mock'lanır: mutations.ts → service → api.ts (axios) zincirini
// testte çekmemek için. Asıl ilgilendiğimiz retry/pause mantığı bu mock'lardan
// bağımsız.

// --- Servis mock'ları (import zinciri native/axios çekmesin) -----------------
// registerStationMutationDefaults bu service'leri import eder; mutationFn'leri
// kayıtta sarmalanır. Burada yalnız var olmaları yeter — pause/resume testi
// kendi inline mutationFn'ini kullanır (modül mock'una bağlı kalmaz).
jest.mock("../services/kursunQc.service", () => ({
  kursunQcService: {
    completeQc2: jest.fn(),
    reportError: jest.fn(),
    deleteError: jest.fn(),
    finishStep: jest.fn(),
  },
}));
jest.mock("../services/roll.service", () => ({
  rollService: {
    kursunFinish: jest.fn(),
    createInitialEntry: jest.fn(),
    scrap: jest.fn(),
  },
}));
jest.mock("../services/tambur.service", () => ({
  tamburService: { finalizeOpenFabric: jest.fn() },
}));
jest.mock("../services/subcontractor.service", () => ({
  subcontractorService: { dispatch: jest.fn(), receive: jest.fn() },
}));
jest.mock("../services/kartela.service", () => ({
  kartelaService: { dispatch: jest.fn(), receive: jest.fn() },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { onlineManager, MutationObserver } from "@tanstack/react-query";
import {
  registerStationMutationDefaults,
  STATION_MUT,
} from "./mutations";
import {
  queryClient,
  asyncStoragePersister,
  PERSIST_BUSTER,
} from "./queryClient";

type RetryFn = (failureCount: number, error: unknown) => boolean;
type DelayFn = (attempt: number) => number;

const ALL_KEYS = Object.values(STATION_MUT);

beforeAll(() => {
  registerStationMutationDefaults();
});

afterEach(() => {
  onlineManager.setOnline(true);
  jest.clearAllMocks();
});

const defaultsFor = (key: readonly unknown[]) =>
  queryClient.getMutationDefaults(key as unknown as readonly unknown[]);

describe("OFFLINE_AWARE retry (kaydedilen gerçek config)", () => {
  // QC2_COMPLETE temsilci — tüm key'ler aynı OFFLINE_AWARE spread'ini paylaşır.
  const retry = () => defaultsFor(STATION_MUT.QC2_COMPLETE).retry as RetryFn;

  it("401 (oturum doldu) ASLA retry edilmez — ilk denemede düş", () => {
    expect(retry()(0, { status: 401 })).toBe(false);
  });

  it("deterministik 4xx (400/403/404/409) fail-fast", () => {
    for (const status of [400, 403, 404, 409, 422, 499]) {
      expect(retry()(0, { status })).toBe(false);
    }
  });

  it("5xx (geçici sunucu hatası) retry edilir — failureCount<3", () => {
    expect(retry()(0, { status: 500 })).toBe(true);
    expect(retry()(1, { status: 503 })).toBe(true);
    expect(retry()(2, { status: 500 })).toBe(true);
  });

  it("5xx 3 denemeden sonra durur (sonsuz retry yok)", () => {
    expect(retry()(3, { status: 500 })).toBe(false);
    expect(retry()(10, { status: 500 })).toBe(false);
  });

  it("status'suz hata (ağ kopması / status undefined) retry edilir", () => {
    // error.status yok → 4xx fail-fast guard'ına takılmaz, failureCount<3 kuralı.
    expect(retry()(0, null)).toBe(true);
    expect(retry()(0, new Error("Network Error"))).toBe(true);
    expect(retry()(3, new Error("Network Error"))).toBe(false);
  });
});

describe("OFFLINE_AWARE retryDelay (üstel backoff, 30sn tavan)", () => {
  const delay = () => defaultsFor(STATION_MUT.QC2_COMPLETE).retryDelay as DelayFn;

  it("üstel artar: 1s, 2s, 4s ...", () => {
    expect(delay()(0)).toBe(1000);
    expect(delay()(1)).toBe(2000);
    expect(delay()(2)).toBe(4000);
  });

  it("30sn'de tavanlanır (geç denemelerde patlamaz)", () => {
    expect(delay()(10)).toBe(30_000);
    expect(delay()(100)).toBe(30_000);
  });
});

describe("istasyon mutation kayıt bütünlüğü", () => {
  it("HER istasyon key'i kayıtlı + networkMode='online' (offline'da pause)", () => {
    expect(ALL_KEYS.length).toBeGreaterThanOrEqual(12);
    for (const key of ALL_KEYS) {
      const d = defaultsFor(key);
      expect(typeof d.mutationFn).toBe("function");
      // networkMode 'online' = offline'da paused; 'always' (queryClient default)
      // burada explicit override edilmiş olmalı, yoksa offline'da pause OLMAZ.
      expect(d.networkMode).toBe("online");
      expect(typeof d.retry).toBe("function");
      expect(typeof d.retryDelay).toBe("function");
    }
  });

  it("tüm key'ler ['station', ...] namespace'inde (usePendingStationOps filtresi)", () => {
    for (const key of ALL_KEYS) expect(key[0]).toBe("station");
  });

  it("queryClient genel mutation default'u 'always' (offline-aware OLMAYANLAR fail-fast)", () => {
    // Offline-aware olmayan mutation'lar offline'da pause OLMAMALI (loading
    // sonsuza takılmasın) — bu yüzden global default 'always'.
    expect(
      queryClient.getDefaultOptions().mutations?.networkMode,
    ).toBe("always");
  });
});

describe("offline pause → online resume (gerçek networkMode + retry)", () => {
  // Paylaşılan queryClient'ı App.tsx'teki Provider gibi mount ediyoruz —
  // online→resumePausedMutations köprüsü mount listener'ı ile kurulur.
  // MutationObserver = ekran component'lerinin useMutation ile yaptığının
  // altındaki public sınıf.
  //
  // mutationFn'i INLINE veriyoruz (modül service mock'una bağlı değil): jest-expo
  // ortamında kayıtlı default'un kapattığı service mock referansı testler arası
  // null'lanıp resume'da "is not a function" veriyordu. networkMode/retry/
  // retryDelay ise GERÇEK kayıtlı OFFLINE_AWARE config'ten alınır — pause/resume
  // davranışını yöneten asıl ayarlar bunlar; mutationFn yalnız "çağrıldı mı"
  // sondası.
  beforeAll(() => queryClient.mount());
  afterAll(() => {
    queryClient.getMutationCache().clear();
    queryClient.unmount();
  });

  it("offline'da paused (mutationFn çağrılmaz) → online resume (1 kez, doğru vars)", async () => {
    type Vars = { rollId: string };
    const reg = defaultsFor(STATION_MUT.QC2_COMPLETE);
    const localFn = jest.fn(async (v: Vars) => ({ ok: true, v }));
    const vars: Vars = { rollId: "r2" };

    onlineManager.setOnline(false);
    const obs = new MutationObserver<{ ok: boolean; v: Vars }, Error, Vars>(
      queryClient,
      {
        mutationKey: STATION_MUT.QC2_COMPLETE as unknown as unknown[],
        mutationFn: localFn,
        networkMode: reg.networkMode, // GERÇEK kayıtlı: 'online' → offline'da pause
        retry: reg.retry, // GERÇEK kayıtlı OFFLINE_AWARE retry
        retryDelay: reg.retryDelay,
      },
    );
    const unsub = obs.subscribe(() => {}); // component'in useMutation aboneliği
    const p = obs.mutate(vars);
    await Promise.resolve();

    // OFFLINE: kuyruğa alındı, paused, mutationFn ÇAĞRILMADI.
    expect(obs.getCurrentResult().isPaused).toBe(true);
    expect(localFn).not.toHaveBeenCalled();

    // ONLINE: resume paused mutation'ı çalıştırmalı.
    onlineManager.setOnline(true);
    await queryClient.resumePausedMutations();
    await p;

    expect(localFn).toHaveBeenCalledTimes(1);
    // mutationFn (vars, context) ile çağrılır — ilk argüman bizim vars olmalı.
    expect(localFn.mock.calls[0][0]).toEqual(vars);
    unsub();
  });
});

describe("AsyncStorage persist (app restart'ta paused kuyruk kalır)", () => {
  it("persister cache'i PERSIST_BUSTER ile AsyncStorage'a yazar", async () => {
    await asyncStoragePersister.persistClient({
      buster: PERSIST_BUSTER,
      timestamp: Date.now(),
      clientState: { mutations: [], queries: [] },
    });
    // queryClient.ts'teki key sabiti — persist edilen blob orada okunabilir olmalı.
    const raw = await AsyncStorage.getItem("TEKSERP_RQ_CACHE_V1");
    expect(raw).toBeTruthy();
    const restored = await asyncStoragePersister.restoreClient();
    expect(restored?.buster).toBe(PERSIST_BUSTER);
  });
});
