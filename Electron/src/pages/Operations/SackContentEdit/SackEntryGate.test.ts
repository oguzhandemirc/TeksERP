// =============================================================================
// Bekçi: Paketleme/Çuvallar GİRİŞ KAPISI (2026-09-04)
//   §1 Kapı yalnız "çıplak" girişte çizilir — hedefle açılan ekranda ÇİZİLMEZ
//      (scan-anywhere seed'i kaybolmasın: kapı öne konsaydı `useScanSeed`
//      SacksListView mount olana kadar koşmazdı).
//   §2 Kapı seçimi URL süzgecine doğru çevrilir; müşterisiz kovası sentinel'e.
//   §3 Kapının YERLEŞİM sözleşmesi (saha turu düzeltmeleri) — METİN TARAR:
//      tek geri yüzeyi · sola dayalı karolar · karo içinde açıklama YOK ·
//      ekranda yönlendirme metni YOK · adım DIŞARIDAN sürülür.
//   §4 Cari listesi kararı KALICI: kapı cari KATALOĞU değil, "çuvalı olan cari".
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { customerFilterValue, shouldShowEntryGate } from "./SackEntryGate";
import { CUSTOMERLESS_FILTER_VALUE } from "./types";

const gateSource = readFileSync(resolve(__dirname, "./SackEntryGate.tsx"), "utf-8");
const pageSource = readFileSync(resolve(__dirname, "./SackContentEditPage.tsx"), "utf-8");

const sp = (q = "") => new URLSearchParams(q);

describe("shouldShowEntryGate — §1", () => {
  it("çıplak giriş → kapı çizilir", () => {
    expect(shouldShowEntryGate(null, sp())).toBe(true);
    expect(shouldShowEntryGate({}, sp())).toBe(true);
    // Filtre OLMAYAN URL anahtarları kapıyı kapatmaz (sıralama/sayfa boyu).
    expect(shouldShowEntryGate(null, sp("sortBy=sackNo&pageSize=50"))).toBe(true);
  });

  it("⭐ scan-anywhere seed'i varsa kapı ÇİZİLMEZ (üç anahtarın hepsi)", () => {
    expect(shouldShowEntryGate({ scanCode: "CV2509040001" }, sp())).toBe(false);
    expect(shouldShowEntryGate({ focusBarcode: "R123" }, sp())).toBe(false);
    expect(shouldShowEntryGate({ scanCodeDispatched: "CV1" }, sp())).toBe(false);
  });

  it("seed anahtarı string DEĞİLSE kapı kapanmaz (boş state ile aynı)", () => {
    expect(shouldShowEntryGate({ scanCode: 42 }, sp())).toBe(true);
    expect(shouldShowEntryGate({ scanCode: null }, sp())).toBe(true);
  });

  it("arama ya da herhangi bir filtre ile açılan ekranda kapı ÇİZİLMEZ", () => {
    expect(shouldShowEntryGate(null, sp("search=CV2509"))).toBe(false);
    expect(shouldShowEntryGate(null, sp("filter%5BcustomerId%5D=none"))).toBe(false);
    expect(shouldShowEntryGate(null, sp("filter%5Bscope%5D=DISPATCHED"))).toBe(false);
  });
});

describe("customerFilterValue — §2", () => {
  it("gerçek cari → id", () => {
    expect(
      customerFilterValue({ customerId: "abc", name: "X", code: null, sackCount: 1 }),
    ).toBe("abc");
  });

  it("⭐ müşterisiz kova → sentinel (küme sessizce kaybolmaz)", () => {
    expect(
      customerFilterValue({ customerId: null, name: "Müşterisiz (genel stok)", code: null, sackCount: 4 }),
    ).toBe(CUSTOMERLESS_FILTER_VALUE);
    expect(CUSTOMERLESS_FILTER_VALUE).toBe("none");
  });
});

// =============================================================================
// §3 YERLEŞİM SÖZLEŞMESİ — bilinçli METİN sondası
// -----------------------------------------------------------------------------
// Bu kurallar render edilmiş DOM'da değil KAYNAKTA yaşıyor: hepsi "şu öğe
// EKRANDA OLMAYACAK" biçiminde ve DOM sondası ancak yeniden eklenen öğenin
// metnini bilirsek yakalar. Metin taraması, geri gelen düzeni ADIYLA yakalar.
// =============================================================================
describe("giriş kapısı yerleşimi — §3", () => {
  it("⭐ kapının İÇİNDE ikinci bir geri düğmesi YOK (tek geri yüzeyi: PageHeader oku)", () => {
    // Saha turu: ekranda iki geri tuşu görünüyordu (üstte PageHeader oku, altta
    // kapının kendi "Geri" düğmesi). Alttaki kaldırıldı.
    expect(gateSource).not.toMatch(/ArrowLeft/);
    expect(gateSource).not.toMatch(/>\s*Geri\s*</);
  });

  it("⭐ adım DIŞARIDAN sürülür — sayfa 'customers' adımında PageHeader'a onBack verir", () => {
    // Adım kapının kendi state'i olsaydı üstteki ok onu geri alamazdı; kapı da
    // kendi düğmesini geri koymak zorunda kalırdı (iki geri tuşu geri gelirdi).
    expect(gateSource).toMatch(/step:\s*SackGateStep/);
    expect(gateSource).not.toMatch(/useState<"choice"/);
    expect(pageSource).toMatch(/onBack=\{gateStep === "customers"/);
  });

  it("⭐ karolar SOLA DAYALI (kap ortalanmıyor)", () => {
    // Yalnız SEÇİM adımının KAP className'i ölçülür — ikon chip'i kendi içinde
    // `justify-center` taşır ve dosya geneline bakan sonda onu yanlışlıkla yakalar.
    const wrapper = gateSource.match(/step === "choice"[\s\S]*?className="([^"]+)"/)?.[1] ?? "";
    expect(wrapper).toContain("grid");
    expect(wrapper).not.toMatch(/justify-center|items-center|mx-auto/);
  });

  it("⭐ karo İÇİNDE açıklama metni YOK (HubCard kuralı: yalnız başlık)", () => {
    // `GateCard` props'unda `description` olsaydı metin geri gelirdi.
    expect(gateSource).not.toMatch(/description/);
  });

  it("⭐ ekranda 'nasıl devam edelim' türü yönlendirme metni YOK", () => {
    expect(gateSource).not.toMatch(/Nasıl devam/i);
    expect(gateSource).not.toMatch(/ne yapmak istersiniz/i);
    // Karo başlıkları dışında serbest anlatım cümlesi kalmadı: iki karo, iki başlık.
    expect(gateSource.match(/title="/g)?.length).toBe(2);
  });

  it("repodaki karo dilini kullanıyor (Card + gradient + tonlu ikon chip'i)", () => {
    expect(gateSource).toMatch(/from "@\/components\/ui\/card"/);
    expect(gateSource).toMatch(/bg-gradient-to-br from-primary\/5/);
    expect(gateSource).toMatch(/rounded-xl bg-current\/10/);
  });
});

describe("cari listesi kararı — §4", () => {
  it("⭐ kapı 'çuvalı olan cari' ucunu çağırır — cari KATALOĞUNU değil", () => {
    // KESİN KARAR (ölçüm: 43 aktif cariden 4'ünün depoda çuvalı var; katalog
    // konsaydı 39 seçenek "sonuç yok" verirdi). Gerekçe dosyanın başında yazılı;
    // bu sonda kararın sessizce geri çevrilmesini engeller.
    expect(gateSource).toMatch(/listSackCustomers/);
    expect(gateSource).not.toMatch(/customerService/);
    expect(gateSource).toMatch(/GERİ ÇEVİRME/);
  });
});
