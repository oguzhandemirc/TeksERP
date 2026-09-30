import { afterEach, describe, expect, it } from "@jest/globals";
import {
  DEFAULT_FACTORY_TIMEZONE,
  calendarDayZone,
  calendarLocaleDateString,
  fmtCalendarDay,
  formatCalendarDay,
  factoryBackWindowIso,
  factoryDayDiff,
  factoryDayEndIso,
  factoryDayKey,
  factoryDayStartIso,
  factoryDateTimeFormat,
  factoryLocaleDateString,
  factoryLocaleString,
  factoryLocaleTimeString,
  fmtDayKey,
  fmtFactoryStamp,
  formatFactory,
  fromFactoryDateTimeInput,
  getFactoryTimezone,
  setFactoryTimezone,
  toFactoryDateTimeInput,
} from "../src/lib/factory-time";

// Fabrika dilimi çıktısı istemcinin süreç diliminden BAĞIMSIZ olmalı. Jest ortamı süreç içi TZ değişimini
// Date'e yansıtmaz: bağımsızlık bu dosyayı TZ=UTC ve TZ=America/New_York ile ayrı koşarak ölçülür.
const PROCESS_ZONES = ["UTC", "America/New_York", "Asia/Tokyo"];
const ORIGINAL_TZ = process.env.TZ;
const AT = new Date("2026-09-30T21:30:05Z"); // İstanbul'da 1 Ekim 00:30:05, New York'ta 30 Eylül 17:30:05

function eachProcessZone(fn: () => void): void {
  for (const tz of PROCESS_ZONES) {
    process.env.TZ = tz;
    fn();
  }
}

afterEach(() => {
  setFactoryTimezone(DEFAULT_FACTORY_TIMEZONE);
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("factory-time — varsayılan dilim (Europe/Istanbul = bugünkü çıktı)", () => {
  it("drop-in'ler yerleşik toLocale*String + İstanbul ile birebir aynı", () => {
    eachProcessZone(() => {
      expect(factoryLocaleString(AT, "tr-TR")).toBe(AT.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }));
      expect(factoryLocaleString(AT, "tr-TR")).toBe("01.10.2026 00:30:05");
      expect(factoryLocaleDateString(AT, "tr-TR")).toBe("01.10.2026");
      expect(factoryLocaleTimeString(AT, "tr-TR", { hour: "2-digit", minute: "2-digit" })).toBe("00:30");
      expect(factoryLocaleString(AT, "tr-TR", { dateStyle: "short", timeStyle: "short" })).toBe(
        AT.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" }),
      );
      expect(factoryDateTimeFormat("tr-TR", { day: "2-digit", month: "short" }).format(AT)).toBe(
        AT.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", timeZone: "Europe/Istanbul" }),
      );
    });
  });

  it("kalıp biçimleri ve gün anahtarı", () => {
    eachProcessZone(() => {
      expect(fmtFactoryStamp(AT)).toBe("01.10.2026 00:30:05");
      expect(formatFactory(AT, "dd.MM.yyyy HH:mm")).toBe("01.10.2026 00:30");
      expect(formatFactory(AT, "d MMMM yyyy · EEEE")).toBe("1 Ekim 2026 · Perşembe");
      expect(formatFactory(AT, "dd MMM yy")).toBe("01 Eki 26");
      expect(factoryDayKey(AT)).toBe("2026-10-01");
      expect(toFactoryDateTimeInput(AT)).toBe("2026-10-01T00:30");
    });
  });

  it("gün sınırları ve takvim farkı fabrika gününe göre", () => {
    eachProcessZone(() => {
      expect(factoryDayStartIso("2026-10-01")).toBe("2026-09-30T21:00:00.000Z");
      expect(factoryDayEndIso("2026-10-01")).toBe("2026-10-01T20:59:59.999Z");
      expect(fromFactoryDateTimeInput("2026-10-01T00:30")?.toISOString()).toBe("2026-09-30T21:30:00.000Z");
      expect(factoryDayDiff(AT, new Date("2026-09-30T20:59:00Z"))).toBe(1);
      expect(factoryBackWindowIso(7, AT)).toEqual({
        dateFrom: "2026-09-23T21:00:00.000Z",
        dateTo: "2026-10-01T20:59:59.999Z",
      });
    });
  });

  it("boş/geçersiz girdi: kalıpta fallback, drop-in'de yerleşik davranış", () => {
    expect(formatFactory(null, "dd.MM.yyyy")).toBe("—");
    expect(formatFactory("bozuk", "dd.MM.yyyy", "")).toBe("");
    expect(factoryLocaleString("bozuk", "tr-TR")).toBe("Invalid Date");
    expect(fmtDayKey("2026-10-01")).toBe("01.10.2026");
    expect(fmtDayKey(null)).toBe("—");
  });
});

describe("factory-time — seçilen dilim", () => {
  it("America/New_York seçilince bütün biçimler o dilimden (DST dahil)", () => {
    expect(setFactoryTimezone("America/New_York")).toBe(true);
    expect(getFactoryTimezone()).toBe("America/New_York");
    eachProcessZone(() => {
      expect(fmtFactoryStamp(AT)).toBe("30.09.2026 17:30:05");
      expect(factoryLocaleString(AT, "tr-TR")).toBe(AT.toLocaleString("tr-TR", { timeZone: "America/New_York" }));
      expect(factoryDayKey(AT)).toBe("2026-09-30");
      expect(factoryDayStartIso("2026-09-30")).toBe("2026-09-30T04:00:00.000Z");
      expect(factoryDayStartIso("2026-12-01")).toBe("2026-12-01T05:00:00.000Z");
    });
  });

  it("geçersiz dilim yok sayılır — son geçerli dilim kalır (fail-closed)", () => {
    expect(setFactoryTimezone("Mars/Olympus")).toBe(false);
    expect(setFactoryTimezone("Europe/Istanbul'; DROP")).toBe(false);
    expect(setFactoryTimezone(undefined)).toBe(false);
    expect(getFactoryTimezone()).toBe(DEFAULT_FACTORY_TIMEZONE);
  });
});

describe("factory-time — takvim günü alanı (vade · termin; şık 6 kararı b)", () => {
  const DUE = "2026-09-30T00:00:00.000Z"; // "YYYY-MM-DD" / @db.Date saklaması
  const DERIVED = "2026-10-30T22:30:00.000Z"; // düzenleme anından türetilmiş vade (AN)
  it("⭐ UTC'nin batısındaki dilimde takvim günü bir gün KAYMAZ; AN alanı fabrika diliminde", () => {
    expect(setFactoryTimezone("America/New_York")).toBe(true);
    eachProcessZone(() => {
      expect(fmtCalendarDay(DUE)).toBe("30.09.2026");
      expect(calendarLocaleDateString(DUE, "tr-TR")).toBe("30.09.2026");
      expect(formatCalendarDay(DUE, "dd.MM.yy")).toBe("30.09.26");
      expect(formatFactory(DUE, "dd.MM.yyyy")).toBe("29.09.2026");
      expect(fmtCalendarDay("2026-09-30T02:00:00.000Z")).toBe("29.09.2026");
    });
  });
  it("türetilmiş vade (gece yarısı olmayan an) fabrika gününe düşer; varsayılan dilimde bugünkü çıktı", () => {
    eachProcessZone(() => {
      expect(calendarDayZone(DUE)).toBe("UTC");
      expect(calendarDayZone(DERIVED)).toBe(DEFAULT_FACTORY_TIMEZONE);
      expect(fmtCalendarDay(DERIVED)).toBe("31.10.2026");
      expect(fmtCalendarDay(DUE)).toBe(formatFactory(DUE, "dd.MM.yyyy"));
      expect(fmtCalendarDay(null)).toBe("—");
      expect(fmtCalendarDay("bozuk", "")).toBe("");
    });
  });
});
