import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_FACTORY_TIMEZONE,
  applyServerFactoryTimezone,
  factoryDateTimeFormat,
  factoryDayEndIso,
  factoryDayKey,
  factoryDayStart,
  factoryDayStartIso,
  factoryTimezoneAt,
  factoryWallTimeToDate,
  fmtFactoryDateTime,
  getFactoryTimezonePeriods,
  setFactoryTimezone,
  setFactoryTimezonePeriods,
} from "./factory-time";

// Saat dilimi DÖNEMLERİ (kullanıcı kararı 2026-09-30): her an KENDİ anındaki dilimle basılır; yeni dönem geçmiş
// kayıtları kaydırmaz. Vektörler üç istemcide (Electron · mobil · patron/uygulama) BİREBİR aynıdır ve backend
// `time.ts` ile eşdeğerliği Teks-Erp/scripts/test_saat_dilimi_donemleri.ts ölçer.
const E_BERLIN = "2026-09-30T22:00:00.000Z"; // Berlin'de 1 Ekim 00:00 = İstanbul'da 1 Ekim 01:00
const PAST = "2026-09-01T12:00:00Z";

afterEach(() => {
  setFactoryTimezone(DEFAULT_FACTORY_TIMEZONE);
});

describe("factory-time — saat dilimi dönemleri", () => {
  it("⭐ geçmiş kayıt değişmez: dönem eklenince E'den önceki anlar eski dilimde kalır", () => {
    const before = [fmtFactoryDateTime(PAST), factoryDayKey(PAST), fmtFactoryDateTime("2026-09-30T21:30:00Z")];
    expect(setFactoryTimezonePeriods([{ validFrom: E_BERLIN, timeZone: "Europe/Berlin" }], "Europe/Istanbul")).toBe(true);
    expect([fmtFactoryDateTime(PAST), factoryDayKey(PAST), fmtFactoryDateTime("2026-09-30T21:30:00Z")]).toEqual(before);
    expect(before).toEqual(["01.09.2026 15:00", "2026-09-01", "01.10.2026 00:30"]);
    // E'den sonraki kayıt yeni dilimde:
    expect(fmtFactoryDateTime("2026-09-30T22:30:00Z")).toBe("01.10.2026 00:30");
    expect(factoryTimezoneAt("2026-09-30T21:59:59.999Z")).toBe("Europe/Istanbul");
    expect(factoryTimezoneAt(E_BERLIN)).toBe("Europe/Berlin");
    expect(getFactoryTimezonePeriods()).toEqual([{ validFrom: E_BERLIN, timeZone: "Europe/Berlin" }]);
  });

  it("⭐ geçiş günü bölünmez: İstanbul → Berlin günü 25 saat, Berlin → İstanbul günü 23 saat", () => {
    setFactoryTimezonePeriods([{ validFrom: E_BERLIN, timeZone: "Europe/Berlin" }], "Europe/Istanbul");
    expect(factoryDayStartIso("2026-10-01")).toBe("2026-09-30T21:00:00.000Z");
    expect(factoryDayEndIso("2026-10-01")).toBe("2026-10-01T21:59:59.999Z");
    expect(factoryDayEndIso("2026-09-30")).toBe("2026-09-30T20:59:59.999Z");
    expect(factoryDayStart("2026-09-30T22:30:00Z").toISOString()).toBe("2026-09-30T21:00:00.000Z");
    // Aynı duvar saati iki dönemde varsa erkeni:
    expect(factoryWallTimeToDate("2026-10-01", "00:30")?.toISOString()).toBe("2026-09-30T21:30:00.000Z");
    setFactoryTimezonePeriods([{ validFrom: "2026-09-30T21:00:00.000Z", timeZone: "Europe/Istanbul" }], "Europe/Berlin");
    expect(factoryDayStartIso("2026-09-30")).toBe("2026-09-29T22:00:00.000Z");
    expect(factoryDayEndIso("2026-09-30")).toBe("2026-09-30T20:59:59.999Z");
    expect(factoryDayStartIso("2026-10-01")).toBe("2026-09-30T21:00:00.000Z");
  });

  it("İstanbul → New York: yürürlük gününün İstanbul parçası da o güne sayılır (31 saat)", () => {
    setFactoryTimezonePeriods([{ validFrom: "2026-10-01T04:00:00.000Z", timeZone: "America/New_York" }], "Europe/Istanbul");
    expect(factoryDayStartIso("2026-10-01")).toBe("2026-09-30T21:00:00.000Z");
    expect(factoryDayEndIso("2026-10-01")).toBe("2026-10-02T03:59:59.999Z");
    expect(fmtFactoryDateTime("2026-10-01T03:00:00Z")).toBe("01.10.2026 06:00");
    expect(fmtFactoryDateTime("2026-10-01T05:00:00Z")).toBe("01.10.2026 01:00");
  });

  it("bozuk liste bütünüyle reddedilir, son geçerli durum kalır; dönemsiz yanıt tek dilimdir", () => {
    setFactoryTimezonePeriods([{ validFrom: E_BERLIN, timeZone: "Europe/Berlin" }], "Europe/Istanbul");
    expect(setFactoryTimezonePeriods([{ validFrom: "yarın", timeZone: "Europe/Paris" }])).toBe(false);
    expect(setFactoryTimezonePeriods([{ validFrom: E_BERLIN, timeZone: "Mars/Olympus" }])).toBe(false);
    expect(getFactoryTimezonePeriods()).toEqual([{ validFrom: E_BERLIN, timeZone: "Europe/Berlin" }]);
    expect(applyServerFactoryTimezone({ factoryTimezone: "Europe/Berlin" })).toBe(true);
    expect(getFactoryTimezonePeriods()).toEqual([]);
    expect(fmtFactoryDateTime(PAST)).toBe("01.09.2026 14:00");
    expect(applyServerFactoryTimezone({ factoryTimezone: "Europe/Istanbul", factoryTimezoneBase: "Europe/Istanbul", factoryTimezonePeriods: [] })).toBe(true);
    expect(fmtFactoryDateTime(PAST)).toBe("01.09.2026 15:00");
  });

  it("biçimleyici nesnesi her anı kendi dönemindeki dilimle basar", () => {
    setFactoryTimezonePeriods([{ validFrom: E_BERLIN, timeZone: "Europe/Berlin" }], "Europe/Istanbul");
    const fmt = factoryDateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    expect(fmt.format(new Date("2026-09-30T21:30:00Z"))).toBe("00:30");
    expect(fmt.format(new Date("2026-09-30T22:30:00Z"))).toBe("00:30");
    expect(fmt.format(new Date("2026-09-30T20:30:00Z"))).toBe("23:30");
  });
});
