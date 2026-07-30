import { describe, it, expect } from "vitest";
import { evaluateAlerts, type HealthResponse } from "./serverHealth";

/** Sağlıklı taban — her test yalnız ilgilendiği alanı ezer. */
const base = (over: Partial<HealthResponse> = {}): HealthResponse =>
  ({
    api: "UP",
    db: "UP",
    version: "2.0.0",
    uptimeSec: 3600,
    dbSizeBytes: 44_000_000,
    dbConnections: 26,
    cacheHitPct: 99.9,
    dbBlockedCount: 0,
    lastBackup: { name: "tekserp_x.dump", time: new Date().toISOString() },
    auditWriteFailures: 0,
    poolMax: 30,
    poolTotalCount: 3,
    poolIdleCount: 3,
    poolWaitingCount: 0,
    poolWaitingMax: 0,
    poolConnectsTotal: 3,
    poolAcquireTimeouts: 0,
    lastPoolTimeoutAt: null,
    lastPoolTimeoutError: null,
    cpuCores: 8,
    procRssBytes: 200_000_000,
    procHeapUsedBytes: 100_000_000,
    procHeapTotalBytes: 150_000_000,
    procCpuPct: 5,
    sysCpuPct: 20,
    sysTotalMemBytes: 16_000_000_000,
    sysFreeMemBytes: 8_000_000_000,
    sysUsedMemBytes: 8_000_000_000,
    eventLoopLagMs: 5,
    diskTotalBytes: 500_000_000_000,
    diskFreeBytes: 300_000_000_000,
    diskUsedPct: 40,
    activeUsers: 3,
    activeDevices: 2,
    ...over,
  }) as HealthResponse;

const msgs = (d: HealthResponse): string[] => evaluateAlerts(d).map((a) => a.message);
const poolAlerts = (d: HealthResponse) => evaluateAlerts(d).filter((a) => a.message.includes("havuz"));

describe("evaluateAlerts — bağlantı havuzu", () => {
  it("sağlıklı tabanda havuz alarmı YOK", () => {
    expect(poolAlerts(base())).toHaveLength(0);
  });

  // REGRESYON KİLİDİ (2026-07-30 ölçümüyle bulundu): doygunluk TOPLAM bağlantıyla
  // ölçülürse, havuz bilinçli olarak sıcak tutulduğu için (idleTimeoutMillis 10dk)
  // boot patlaması sonrası total=24/30 = %80 KALICI yanlış alarm üretir. Gerçek
  // baskı MEŞGUL bağlantıdır (total − idle).
  it("SICAK havuz (24 bağlantı, hepsi idle) alarm ÜRETMEZ — eşik meşgule bakar", () => {
    const d = base({ poolTotalCount: 24, poolIdleCount: 24, poolConnectsTotal: 24 });
    expect(poolAlerts(d)).toHaveLength(0);
  });

  it("meşgul %80'e ulaşınca uyarır", () => {
    const d = base({ poolTotalCount: 26, poolIdleCount: 2 }); // meşgul 24/30 = %80
    const a = poolAlerts(d);
    expect(a).toHaveLength(1);
    expect(a[0]?.level).toBe("warn");
    expect(a[0]?.message).toContain("24/30 meşgul");
  });

  it("meşgul %95'e ulaşınca kritik", () => {
    const d = base({ poolTotalCount: 29, poolIdleCount: 0 }); // meşgul 29/30 = %96.7
    expect(poolAlerts(d)[0]?.level).toBe("crit");
  });

  it("bekleyen istek varsa uyarır, 5+ ise kritik", () => {
    expect(evaluateAlerts(base({ poolWaitingCount: 1 })).find((a) => a.message.includes("bekliyor"))?.level).toBe("warn");
    expect(evaluateAlerts(base({ poolWaitingCount: 5 })).find((a) => a.message.includes("bekliyor"))?.level).toBe("crit");
  });

  it("kümülatif zaman aşımı >0 uyarır, 10+ kritik (gözlenen taban 5 günde 2)", () => {
    const one = evaluateAlerts(base({ poolAcquireTimeouts: 1 })).find((a) => a.message.includes("zaman aşımına"));
    expect(one?.level).toBe("warn");
    expect(one?.message).toContain("1 kez");
    expect(
      evaluateAlerts(base({ poolAcquireTimeouts: 10 })).find((a) => a.message.includes("zaman aşımına"))?.level,
    ).toBe("crit");
  });

  it("havuz alanları eksik (eski backend) → havuz alarmı ÜRETMEZ, çökmez", () => {
    // Sürüm kayması: yeni Electron + eski backend. Alanlar undefined gelir.
    const d = base();
    delete (d as Partial<HealthResponse>).poolMax;
    delete (d as Partial<HealthResponse>).poolTotalCount;
    delete (d as Partial<HealthResponse>).poolIdleCount;
    delete (d as Partial<HealthResponse>).poolWaitingCount;
    delete (d as Partial<HealthResponse>).poolAcquireTimeouts;
    expect(() => evaluateAlerts(d)).not.toThrow();
    expect(poolAlerts(d)).toHaveLength(0);
  });

  it("mevcut alarmları bozmadı (db DOWN + kritikler önce sıralanıyor)", () => {
    const d = base({ db: "DOWN", poolWaitingCount: 1 });
    const all = evaluateAlerts(d);
    expect(msgs(d)).toContain("Veritabanı bağlantısı yok.");
    expect(all[0]?.level).toBe("crit"); // kritikler başta
  });
});
