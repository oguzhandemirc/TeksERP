// Bekçi (izlenebilirlik A3): süzgeç → `GET /api/print-jobs` parametresi. Gün çipi FABRİKA
// gününden anahtar üretir (UTC/yerel gün DEĞİL). Sonda: `dayRange` bugünü
// `now.toISOString().slice(0,10)` ile kursa → 4 kırmızı (ölçüldü 2026-10-24).
import { describe, expect, it } from "vitest";
import { DEFAULT_FACTORY_TIMEZONE, getFactoryTimezone } from "@/lib/factory-time";
import { dayRange, fromSearchParams, printHistoryHref, toQueryParams, toSearchParams, weekStartKey } from "./print-history-query";

// 22:30Z = fabrika (İstanbul, +03) saatiyle ERTESİ günün 01:30'u — UTC günü ile fabrika günü ayrışır.
const NOW = new Date("2026-10-24T22:30:00.000Z");

describe("yazdırma geçmişi süzgeci", () => {
  it("zemin: fabrika dilimi varsayılan (İstanbul)", () => {
    expect(getFactoryTimezone()).toBe(DEFAULT_FACTORY_TIMEZONE);
  });

  it("Bugün = fabrika günü (UTC günü değil)", () => {
    expect(dayRange({ gun: "bugun" }, NOW)).toEqual({ gunBas: "2026-10-25", gunBit: "2026-10-25" });
  });

  it("Dün = bir önceki fabrika günü", () => {
    expect(dayRange({ gun: "dun" }, NOW)).toEqual({ gunBas: "2026-10-24", gunBit: "2026-10-24" });
  });

  it("Bu hafta = Pazartesi → bugün (fabrika günü)", () => {
    expect(weekStartKey("2026-10-25")).toBe("2026-10-19"); // Pazar
    expect(weekStartKey("2026-10-19")).toBe("2026-10-19"); // Pazartesi
    expect(dayRange({ gun: "hafta" }, NOW)).toEqual({ gunBas: "2026-10-19", gunBit: "2026-10-25" });
  });

  it("Tarih aralığı yalnız geçerli anahtarı taşır; Tümü sınırsız", () => {
    expect(dayRange({ gun: "aralik", gunBas: "2026-10-01", gunBit: "bozuk" }, NOW)).toEqual({ gunBas: "2026-10-01" });
    expect(dayRange({ gun: "tumu" }, NOW)).toEqual({});
  });

  it("yazıcı: UUID → peripheralDeviceId, çıplak ad → printerName", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(toQueryParams({ gun: "tumu", printer: id }, NOW)).toEqual({ peripheralDeviceId: id });
    expect(toQueryParams({ gun: "tumu", printer: "Sevkiyat Argox" }, NOW)).toEqual({ printerName: "Sevkiyat Argox" });
  });

  it("bütün süzgeçler backend parametre adlarıyla gider", () => {
    const p = toQueryParams(
      {
        gun: "bugun",
        userId: "u",
        deviceRefId: "d",
        subjectKind: "ETIKET_TOP",
        status: "HATA",
        outputKind: "PDF",
        source: "TABLET",
        subjectId: "s",
      },
      NOW,
    );
    expect(p).toEqual({
      gunBas: "2026-10-25",
      gunBit: "2026-10-25",
      userId: "u",
      deviceRefId: "d",
      subjectKind: "ETIKET_TOP",
      status: "HATA",
      outputKind: "PDF",
      source: "TABLET",
      subjectId: "s",
    });
  });

  it("URL: çıplak açılış Bugün; derin bağlantı (kayıt/bildirim) zaman sınırı koymaz", () => {
    expect(fromSearchParams(new URLSearchParams("")).gun).toBe("bugun");
    expect(fromSearchParams(new URLSearchParams("subjectId=abc")).gun).toBe("tumu");
    const bildirim = fromSearchParams(new URLSearchParams("printer=Argox&status=HATA"));
    expect(bildirim).toMatchObject({ gun: "tumu", printer: "Argox", status: "HATA" });
    expect(fromSearchParams(new URLSearchParams("gunBas=2026-10-01")).gun).toBe("aralik");
    expect(fromSearchParams(new URLSearchParams("gun=uydurma")).gun).toBe("bugun");
  });

  it("URL gidiş-dönüş kayıpsız; kayıt bağlantısı ?subjectId= taşır", () => {
    const f = { gun: "aralik" as const, gunBas: "2026-10-01", gunBit: "2026-10-05", printer: "Argox", status: "HATA" as const };
    expect(fromSearchParams(toSearchParams(f))).toMatchObject(f);
    expect(toSearchParams({ gun: "bugun" }).toString()).toBe("");
    const href = printHistoryHref("abc-1");
    expect(href).toBe("/system/print-history?subjectId=abc-1");
    expect(fromSearchParams(new URLSearchParams(href.split("?")[1])).subjectId).toBe("abc-1");
  });
});
