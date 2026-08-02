import { describe, expect, it } from "vitest";
import {
  kursunDagitimTileVisible,
  kursunQueueTileVisible,
  operationsTiles,
  type KursunTileVisibility,
  type OperationsVisibilityContext,
} from "./tile-config";
import { commandSections } from "@/components/layout/command-entries";

/**
 * İki kurşun ekranının görünürlük doğruluk tablosu.
 *
 * Kural (kullanıcı kararı, 2026-08-02) — ikisi de "işi kaldıysa durur, bitince
 * kendiliğinden kaybolur":
 *   • Kurşun Sırası   ⇔ !flagEnabled || tabletRegimeCount > 0
 *   • Kurşun Dağıtım  ⇔  flagEnabled || pendingAssignmentCount > 0
 *
 * Aynı yüklemleri hem hub karosu hem Kurşun Sırası ROUTE kapısı çağırır; burada
 * yüklemler doğrudan test edilir ve AYRICA karoların gerçekten bu yüklemlere
 * bağlandığı doğrulanır (kural doğru ama karoya bağlanmamışsa özellik ölüdür).
 */

function ctx(over: Partial<KursunTileVisibility> = {}): KursunTileVisibility {
  return {
    kursunBypassEnabled: false,
    kursunPendingAssignmentCount: 0,
    kursunTabletRegimeCount: 0,
    ...over,
  };
}

describe("kursunQueueTileVisible (Kurşun Sırası)", () => {
  it("bayrak KAPALI → her hâlükârda görünür (normal tabletli akış)", () => {
    expect(kursunQueueTileVisible(ctx())).toBe(true);
    expect(kursunQueueTileVisible(ctx({ kursunTabletRegimeCount: 4 }))).toBe(true);
  });

  it("bayrak AÇIK ama tablet rejiminde iş VAR → görünür (önceliklendirme körleşmesin)", () => {
    expect(
      kursunQueueTileVisible(
        ctx({ kursunBypassEnabled: true, kursunTabletRegimeCount: 1 }),
      ),
    ).toBe(true);
  });

  it("bayrak AÇIK + tablet rejiminde iş YOK → gizlenir (sırayı okuyan kalmadı)", () => {
    expect(kursunQueueTileVisible(ctx({ kursunBypassEnabled: true }))).toBe(false);
  });

  it("bekleyen dağıtım sayısı bu kararı ETKİLEMEZ (yanlış sayaca bağlanma sigortası)", () => {
    expect(
      kursunQueueTileVisible(
        ctx({ kursunBypassEnabled: true, kursunPendingAssignmentCount: 9 }),
      ),
    ).toBe(false);
  });
});

describe("kursunDagitimTileVisible (Kurşun Dağıtım)", () => {
  it("bayrak AÇIK → her hâlükârda görünür (yeni dağıtım yapılabilir)", () => {
    expect(kursunDagitimTileVisible(ctx({ kursunBypassEnabled: true }))).toBe(true);
  });

  it("bayrak KAPALI ama bekleyen dağıtım VAR → görünür (iş bitirilebilsin)", () => {
    expect(kursunDagitimTileVisible(ctx({ kursunPendingAssignmentCount: 1 }))).toBe(true);
  });

  it("bayrak KAPALI + bekleyen dağıtım YOK → gizlenir", () => {
    expect(kursunDagitimTileVisible(ctx())).toBe(false);
  });

  it("tablet rejimi sayacı bu kararı ETKİLEMEZ (yanlış sayaca bağlanma sigortası)", () => {
    expect(kursunDagitimTileVisible(ctx({ kursunTabletRegimeCount: 9 }))).toBe(false);
  });
});

describe("karo bağlantıları", () => {
  const tile = (key: string) => operationsTiles.find((t) => t.key === key);

  it("kurşun karoları doğru yükleme bağlı", () => {
    expect(tile("kursun-queue")?.visibleWhen).toBe(kursunQueueTileVisible);
    expect(tile("kursun-dagitim")?.visibleWhen).toBe(kursunDagitimTileVisible);
  });

  it("Sevk Kapısı yalnız sevk onayı bayrağına bağlı (davranış korundu)", () => {
    const predicate = tile("sack-store")?.visibleWhen;
    const full = (over: Partial<OperationsVisibilityContext>): OperationsVisibilityContext => ({
      ...ctx(),
      shipmentConfirmationEnabled: false,
      ...over,
    });
    expect(predicate?.(full({ shipmentConfirmationEnabled: true }))).toBe(true);
    expect(predicate?.(full({}))).toBe(false);
  });

  it("koşulsuz karolar yüklem TAŞIMAZ (her zaman görünür — izin filtresi ayrı)", () => {
    const conditional = operationsTiles.filter((t) => t.visibleWhen).map((t) => t.key);
    expect(conditional.sort()).toEqual(["kursun-dagitim", "kursun-queue", "sack-store"]);
  });
});

/**
 * ÜÇÜNCÜ GİRİŞ KAPISI: komut paleti. Hub karosu gizlenirken palet girişi kalırsa
 * kural çelişir — "Kurşun Sırası"nda bu somut bir hataydı: route kapısı da aynı
 * koşulu uyguladığı için paletten seçen kullanıcı sayfa yerine hub'a atılıyordu.
 * Bağ AYNI fonksiyon nesnesi üzerinden kurulur (kopyalanmış ikinci bir kural,
 * ilkinden zamanla ayrışırdı).
 */
describe("komut paleti — karo yüklemi taşınıyor", () => {
  const opsEntries =
    commandSections.find((s) => s.heading === "Operasyon")?.entries ?? [];

  it("Operasyon bölümü karolarla aynı sayıda giriş üretir", () => {
    expect(opsEntries).toHaveLength(operationsTiles.length);
  });

  it("her operasyon girişi karosunun yüklemini AYNEN taşır", () => {
    for (const tile of operationsTiles) {
      const entry = opsEntries.find((e) => e.key === `ops:${tile.key}`);
      expect(entry, `ops:${tile.key} palet girişi yok`).toBeDefined();
      expect(entry?.visibleWhen).toBe(tile.visibleWhen);
    }
  });

  it("kurşun girişleri paletten de gizlenir (bayrak açık + iş yok)", () => {
    const full: OperationsVisibilityContext = {
      ...ctx({ kursunBypassEnabled: true }),
      shipmentConfirmationEnabled: false,
    };
    const queue = opsEntries.find((e) => e.key === "ops:kursun-queue");
    const dagitim = opsEntries.find((e) => e.key === "ops:kursun-dagitim");
    expect(queue?.visibleWhen?.(full)).toBe(false);
    expect(dagitim?.visibleWhen?.(full)).toBe(true);
  });
});
