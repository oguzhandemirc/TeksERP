// =============================================================================
// BEKÇİ — mal kabul başarı cümlesi (B5)
// =============================================================================
// ⭐ HEDEF SEKME C2 BAYRAĞINDAN TÜRETİLİR. Sabitlenirse ("Bitmiş Depo") ham stok
//    fişini kaydeden depocu doğru sekmede BOŞ listeye bakar ve malı ikinci kez
//    girmeye kalkar — cümlenin var oluş sebebi tam olarak buydu.
// ⭐⭐ SEKME ADI REJİMDEN ÇÖZÜLÜR, BU DOSYADA DA SABİT YAZILMAZ. İlk yazımında
//    bekçi `toBe("Bitmiş Depo")` diyordu ve YANLIŞ olanı kilitliyordu: Mal
//    Kabul yalnız ticaret kurulumunda çıkıyor, orada `finance.enabled` AÇIK ve
//    Envanter şeridi o sekmeleri "Yeni Giren" / "Depo" diye çiziyor. Yani bekçi
//    "tek kaynak" diye ikinci bir kopyayı onaylıyordu. Beklentiler artık
//    `tabs-regime`den (şeridin de okuduğu yer) ÜRETİLİR — etiket bir gün
//    değişirse cümle ile şerit birlikte değişir, ayrışamazlar.
// ⭐ "0 TOP" CÜMLESİ KURULMAZ: olmayan malı arattırmak, hiç bir şey dememekten
//    kötüdür (yalnız-iplik fişte de aynı kural).
// ⭐ TUTULAMAYACAK SÖZ VERİLMEZ: cümle "fasona sevk edilebilir" demez — Fason
//    Sevk yüzeyi `workorder:*` arkasında ve ham stok fişi açabilen tek rol
//    (WEB_TRADE) o izni taşımıyor.
// =============================================================================
import { describe, it, expect } from "vitest";
import { receiptShelfTab, receiptSuccessText } from "./receiptFeedback";
import { resolveRollTabs } from "@/pages/Operations/Rolls/tabs-regime";

/** Şeridin GERÇEKTEN çizdiği ad — beklentinin tek meşru kaynağı. */
const stripLabel = (key: "RAW_STOCK" | "FINISHED_STOCK", financeEnabled: boolean): string => {
  const tab = resolveRollTabs(true, financeEnabled).find((t) => t.key === key);
  if (!tab) throw new Error(`Sekme şeritte yok: ${key}`);
  return tab.label;
};

describe("receiptSuccessText", () => {
  it("⭐ normal fişte bitmiş depo sekmesi söylenir (fabrika adlandırması)", () => {
    const t = receiptSuccessText({
      receiptNo: "MK1508260001",
      rollCount: 3,
      yarnLineCount: 0,
      rawStockEntry: false,
      financeEnabled: false,
    });
    expect(t).toContain("MK1508260001");
    expect(t).toContain("3 top");
    expect(t).toContain(stripLabel("FINISHED_STOCK", false));
    expect(t).not.toContain(stripLabel("RAW_STOCK", false));
  });

  it("⭐ HAM STOK fişinde ham stok sekmesi söylenir (C2 bağı)", () => {
    const t = receiptSuccessText({
      receiptNo: "MK1508260002",
      rollCount: 3,
      yarnLineCount: 0,
      rawStockEntry: true,
      financeEnabled: false,
    });
    expect(t).toContain(stripLabel("RAW_STOCK", false));
    expect(t).not.toContain(stripLabel("FINISHED_STOCK", false));
    // Neden orada olduğunu da söyler — "yanlış sekme" şüphesi doğmasın.
    expect(t).toMatch(/işlenecek mal/);
  });

  it("⭐⭐ TİCARET REJİMİNDE ŞERİTTEKİ ADI söyler (ekranda olmayan sekmeye göndermez)", () => {
    // Körlük zemini: iki rejimde etiketler GERÇEKTEN farklı olmalı — aynı
    // olsalardı bu testin ölçtüğü şey yok olurdu ve sessizce yeşil kalırdı.
    expect(stripLabel("FINISHED_STOCK", true)).not.toBe(stripLabel("FINISHED_STOCK", false));
    expect(stripLabel("RAW_STOCK", true)).not.toBe(stripLabel("RAW_STOCK", false));

    const bitmis = receiptSuccessText({
      receiptNo: "MK1508260010",
      rollCount: 2,
      yarnLineCount: 0,
      rawStockEntry: false,
      financeEnabled: true,
    });
    expect(bitmis).toContain(stripLabel("FINISHED_STOCK", true));
    // Ve fabrika adını BASMAZ: ticaret kullanıcısı "Bitmiş Depo" diye bir sekme
    // arayıp bulamıyordu — düzeltilen saha vakası tam buydu.
    expect(bitmis).not.toContain(stripLabel("FINISHED_STOCK", false));

    const ham = receiptSuccessText({
      receiptNo: "MK1508260011",
      rollCount: 2,
      yarnLineCount: 0,
      rawStockEntry: true,
      financeEnabled: true,
    });
    expect(ham).toContain(stripLabel("RAW_STOCK", true));
    expect(ham).not.toContain(stripLabel("RAW_STOCK", false));
  });

  it("⭐ top yoksa top cümlesi HİÇ kurulmaz (yalnız-iplik fiş)", () => {
    const t = receiptSuccessText({
      receiptNo: "MK1508260003",
      rollCount: 0,
      yarnLineCount: 2,
      rawStockEntry: false,
      financeEnabled: false,
    });
    expect(t).not.toContain("top");
    expect(t).toContain("2 iplik satırı");
    expect(t).toContain("İplik Stoku");
  });

  it("kumaş + iplik birlikte: iki hedef de yazılır", () => {
    const t = receiptSuccessText({
      receiptNo: "MK1",
      rollCount: 4,
      yarnLineCount: 1,
      rawStockEntry: true,
      financeEnabled: false,
    });
    expect(t).toContain("4 top");
    expect(t).toContain(stripLabel("RAW_STOCK", false));
    expect(t).toContain("1 iplik satırı");
  });

  it("boş fişte yalnız belge cümlesi kalır (kap olarak açılan fiş meşru)", () => {
    expect(
      receiptSuccessText({
        receiptNo: "MK9",
        rollCount: 0,
        yarnLineCount: 0,
        rawStockEntry: false,
        financeEnabled: false,
      }),
    ).toBe("MK9 oluşturuldu.");
  });

  it("fiş numarası gelmezse cümle yine kurulur (yanıt şekli değişse de bozulmaz)", () => {
    const t = receiptSuccessText({
      rollCount: 1,
      yarnLineCount: 0,
      rawStockEntry: false,
      financeEnabled: false,
    });
    expect(t).toContain("Mal kabul fişi oluşturuldu.");
    expect(t).toContain("1 top");
  });

  it("⭐ tutulamayacak süreç vaadi basılmaz (fason sevk yüzeyi bu rolde yok)", () => {
    const t = receiptSuccessText({
      receiptNo: "MK2",
      rollCount: 1,
      yarnLineCount: 0,
      rawStockEntry: true,
      financeEnabled: true,
    });
    expect(t).not.toMatch(/fason/i);
  });

  it("sekme adı tek kaynaktan (şeridin çizdiği adın AYNISI, iki rejimde de)", () => {
    for (const financeEnabled of [false, true]) {
      expect(receiptShelfTab(true, financeEnabled)).toBe(stripLabel("RAW_STOCK", financeEnabled));
      expect(receiptShelfTab(false, financeEnabled)).toBe(stripLabel("FINISHED_STOCK", financeEnabled));
    }
  });
});
