// =============================================================================
// STOK SAYIMI SAF KATMANI — BEKÇİ
// =============================================================================
// Bu ekranın "Tamamla" tuşu GERİ ALINAMAZ: eksik işaretli her top `CANCELLED`
// olur, iplik farkı deftere işler, belge donar. Dolayısıyla buradaki kuralların
// hepsi yıkıcı bir işlemin doğruluk tablosudur:
//
//   ① SAYILMAYAN SATIR EKSİK DEĞİLDİR (`found === null`). Karışırsa yarım
//      bırakılmış bir sayım deponun sayılmamış kısmını kayıttan düşürür.
//   ② KAPSAM DIŞI, EKSİK'TEN ÖNCE gelir (satır `found=false` taşır ama
//      İŞLENMEZ) ve `missing` listesinden DÜŞÜLÜR — yoksa onay ekranı hem
//      satırı iki kez sayar hem metrajı şişirir.
//   ③ ZAMAN KİPİ: taslakta "düşülecek", tamamlanmışta "düşüldü". Donmuş belge
//      geçmiş zaman basar; ekranın taslakta aynısını basması YALANDIR.
//   ④ FAZLA/YABANCI BARKOD SESSİZCE EKLENMEZ (`unknown`) — sayım defteri
//      kısaltır, genişletmez.
//   ⑤ SAYILAN MİKTARDA 0 GEÇERLİ, NEGATİF DEĞİL; "1.250" belirsizdir ve
//      REDDEDİLİR (bin kat hata riski).
//
// NEGATİF SONDA — "kırmızı verebiliyor mu" KANITLANDI (2026-08-15, 4 sonda; her
// sondadan sonra dosya `shasum` ile birebir geri yüklendi):
//   ① `completionScope` sayılmamış satırı da `missing`e yazdı → 6 kontrol düştü
//   ② `rollLineState` kapsam-dışı dalı `found===false`ın ARKASINA alındı → 4 düştü
//   ③ `rollStateLabel` kipi sabitlendi ("düşüldü")             → 2 düştü
//   ④ `scanMatch` bilinmeyen kodu ilk satıra eşledi            → 3 düştü
// Bu dosyayı değiştirirsen aynı dördünü TEKRARLA — kırmızı verdiği kanıtlanmamış
// bekçi, bekçi değil süstür.
// =============================================================================
import { describe, expect, it } from "vitest";
import type { StockCountLine } from "./service";
import {
  COUNTABLE_ROLL_STATUSES,
  EMPTY_ROLL_VIEW,
  EMPTY_STOCK_COUNT_FILTERS,
  MAX_MISSING,
  addQty,
  buildListQuery,
  cancelBlockReason,
  completeBlockReason,
  completeButtonLabel,
  completionScope,
  countProgress,
  countedQtyHint,
  filterRollLines,
  parseCountedQty,
  predictedOutOfScope,
  rollLineState,
  rollStateLabel,
  scanMatch,
  stockCountEmptyMessage,
  subtractQty,
  yarnLineState,
  yarnStateLabel,
} from "./stockCountRules";

// -----------------------------------------------------------------------------
// FİXTURE — backend `findById` select'inin şekli (Decimal alanlar STRING gelir)
// -----------------------------------------------------------------------------
let seq = 0;
function rollLine(
  over: Partial<StockCountLine> & { barcode?: string | null; status?: string } = {},
): StockCountLine {
  const { status, ...rest } = over;
  // ⚠️ `barcode: null` AÇIKÇA verilmiş olabilir (barkodsuz açık kumaş) — `??`
  // ile varsayılana düşürmek o vakayı fixture düzeyinde imkânsız yapardı.
  const barcode = "barcode" in over ? (over.barcode ?? null) : `TOP${seq + 1}`;
  delete (rest as { barcode?: unknown }).barcode;
  return {
    id: `line-${++seq}`,
    kind: "ROLL",
    expectedQty: "100",
    countedQty: null,
    found: null,
    notes: null,
    outOfScopeReason: null,
    roll: {
      id: `roll-${seq}`,
      barcode,
      status: status ?? "WAREHOUSE",
      width: "150",
      item: { name: "Süprem" },
      color: { name: "Siyah" },
    },
    item: null,
    ...rest,
  };
}

function yarnLine(over: Partial<StockCountLine> = {}): StockCountLine {
  return {
    id: `line-${++seq}`,
    kind: "YARN",
    expectedQty: "500",
    countedQty: null,
    found: null,
    notes: null,
    outOfScopeReason: null,
    roll: null,
    item: { id: `item-${seq}`, code: "IP-01", name: "30/1 Penye" },
    ...over,
  };
}

// -----------------------------------------------------------------------------
describe("satır durumu", () => {
  it("üç durumlu `found`: true/false/null ayrı sonuçlar verir", () => {
    expect(rollLineState({ found: true, outOfScopeReason: null })).toBe("FOUND");
    expect(rollLineState({ found: false, outOfScopeReason: null })).toBe("MISSING");
    expect(rollLineState({ found: null, outOfScopeReason: null })).toBe("UNCOUNTED");
  });

  it("⭐ KAPSAM DIŞI, EKSİK'TEN ÖNCE gelir (satır `found=false` taşısa bile)", () => {
    // Backend belge builder'ı aynı sırayı uyguluyor. Ters olsaydı ekran
    // "kayıttan düşüldü" derken donmuş kâğıt "kapsam dışı" derdi.
    expect(rollLineState({ found: false, outOfScopeReason: "Bu sırada sevk edildi" })).toBe(
      "OUT_OF_SCOPE",
    );
  });

  it("iplik: sayılmadı ≠ tuttu ≠ fark var; kapsam dışı yine önce", () => {
    expect(yarnLineState({ countedQty: null, expectedQty: "500", outOfScopeReason: null })).toBe("UNCOUNTED");
    expect(yarnLineState({ countedQty: "500", expectedQty: "500", outOfScopeReason: null })).toBe("MATCH");
    expect(yarnLineState({ countedQty: "480", expectedQty: "500", outOfScopeReason: null })).toBe("APPLIED");
    expect(yarnLineState({ countedQty: "480", expectedQty: "500", outOfScopeReason: "Bakiye değişti" })).toBe(
      "OUT_OF_SCOPE",
    );
  });

  it("iplik: “500” ile “500.00” AYNI değerdir (ondalık gösterim fark üretmez)", () => {
    expect(yarnLineState({ countedQty: "500.00", expectedQty: "500", outOfScopeReason: null })).toBe("MATCH");
  });
});

describe("⭐ zaman kipi — taslakta “düşülecek”, tamamlanmışta “düşüldü”", () => {
  it("taslak sayım GEÇMİŞ ZAMAN kullanmaz (henüz hiçbir şey olmadı)", () => {
    const label = rollStateLabel("MISSING", "DRAFT");
    expect(label).toContain("düşülecek");
    expect(label).not.toContain("düşüldü");
  });

  it("tamamlanmış sayım geçmiş zaman kullanır (fark fişi yazıldı)", () => {
    expect(rollStateLabel("MISSING", "COMPLETED")).toContain("düşüldü");
  });

  it("iplik farkında da aynı kip ayrımı var", () => {
    expect(yarnStateLabel("APPLIED", "DRAFT")).toContain("uygulanacak");
    expect(yarnStateLabel("APPLIED", "COMPLETED")).toContain("uygulandı");
  });

  it("kipten bağımsız durumlar sabit kalır", () => {
    expect(rollStateLabel("FOUND", "DRAFT")).toBe(rollStateLabel("FOUND", "COMPLETED"));
    expect(rollStateLabel("UNCOUNTED", "DRAFT")).toBe("Sayılmadı");
  });
});

describe("miktar aritmetiği", () => {
  it("kayan nokta artefaktı üretmez (0,3 − 0,1 = 0,2)", () => {
    expect(subtractQty("0.3", "0.1")).toBe(0.2);
    expect(subtractQty(0.3, 0.1)).toBe(0.2);
  });

  it("toplama da ölçekli — 0,1 + 0,2 = 0,3", () => {
    expect(addQty(0.1, 0.2)).toBe(0.3);
  });

  it("eksi fark (eksik çıktı) korunur", () => {
    expect(subtractQty("480.5", "500")).toBe(-19.5);
  });
});

describe("kapsam dışı öngörüsü", () => {
  it("sayılabilir statüde engel YOK", () => {
    for (const s of COUNTABLE_ROLL_STATUSES) {
      expect(predictedOutOfScope(rollLine({ status: s })), s).toBeNull();
    }
  });

  it("sevk / iptal / fire ve üretim statüleri SOMUT sebeple işaretlenir", () => {
    expect(predictedOutOfScope(rollLine({ status: "SHIPPED" }))).toContain("sevk");
    expect(predictedOutOfScope(rollLine({ status: "CANCELLED" }))).toContain("düşülmüş");
    expect(predictedOutOfScope(rollLine({ status: "SCRAP" }))).toContain("düşülmüş");
    expect(predictedOutOfScope(rollLine({ status: "IN_PRODUCTION" }))).toContain("IN_PRODUCTION");
  });

  it("backend kümesi aynalı — üç statü (fason dönüşü BİLEREK dışarıda)", () => {
    expect([...COUNTABLE_ROLL_STATUSES]).toEqual(["STOCK", "WAREHOUSE", "A1_STOCK"]);
    expect(predictedOutOfScope(rollLine({ status: "RETURNED_FROM_SUBCONTRACTOR" }))).not.toBeNull();
  });
});

describe("okutma", () => {
  const lines = [
    rollLine({ barcode: "R-001" }),
    rollLine({ barcode: "R-002", found: true }),
    rollLine({ barcode: "R-003", found: false }),
    rollLine({ barcode: null }), // barkodsuz açık kumaş
    yarnLine(),
  ];

  it("boşluk ve harf büyüklüğü elenir", () => {
    expect(scanMatch(lines, "  r-001 ")).toEqual({ kind: "found", line: lines[0] });
  });

  it("zaten bulundu / eksik işaretli satır AYRI sonuç verir", () => {
    expect(scanMatch(lines, "R-002").kind).toBe("already");
    // Eksik işaretlenmişken okutulan top RAFTA ÇIKMIŞTIR → işaret geri alınır.
    expect(scanMatch(lines, "R-003").kind).toBe("revived");
  });

  it("⭐ listede olmayan barkod SESSİZCE EKLENMEZ — “bilinmiyor” döner", () => {
    // Fazla/yabancı top sayımla düzeltilmez (plan kararı): sessiz oto-ekleme
    // gerçek hatayı (yanlış rafa konmuş / transfer edilmemiş mal) örterdi.
    expect(scanMatch(lines, "R-999")).toEqual({ kind: "unknown", code: "R-999" });
  });

  it("⭐ BOŞ kod barkodsuz satırı eşleştirmez (aksi halde rastgele top işaretlenir)", () => {
    expect(scanMatch(lines, "   ")).toEqual({ kind: "empty" });
  });

  it("iplik satırı barkodla eşleşmez", () => {
    expect(scanMatch([yarnLine()], "IP-01").kind).toBe("unknown");
  });
});

describe("ilerleyiş sayaçları", () => {
  it("top ve iplik AYRI sayılır (kg metreye toplanmaz)", () => {
    const p = countProgress([
      rollLine({ found: true }),
      rollLine({ found: false }),
      rollLine(),
      yarnLine({ countedQty: "500" }),
      yarnLine(),
    ]);
    expect(p).toEqual({
      rollTotal: 3, rollFound: 1, rollMissing: 1, rollUncounted: 1,
      yarnTotal: 2, yarnCounted: 1, yarnUncounted: 1,
    });
  });
});

describe("satır süzgeci", () => {
  const lines = [
    rollLine({ barcode: "R-100" }),
    rollLine({ barcode: "R-200", found: true }),
    rollLine({ barcode: null }), // barkodsuz açık kumaş
    yarnLine(),
  ];

  it("yalnız top satırları döner (iplik ayrı tabloda)", () => {
    expect(filterRollLines(lines, EMPTY_ROLL_VIEW)).toHaveLength(3);
  });

  it("“sayılmayanlar” süzgeci işaretli satırları eler", () => {
    const out = filterRollLines(lines, { ...EMPTY_ROLL_VIEW, onlyUncounted: true });
    expect(out.map((l) => l.roll?.barcode)).toEqual(["R-100", null]);
  });

  it("⭐ arama BARKOD **ve** ÜRÜN/RENK üzerinde çalışır (barkodsuz satır bulunabilsin)", () => {
    expect(filterRollLines(lines, { ...EMPTY_ROLL_VIEW, search: "r-2" })).toHaveLength(1);
    // Barkodsuz satır yalnız barkodla aransaydı HİÇ bulunamazdı.
    expect(filterRollLines(lines, { ...EMPTY_ROLL_VIEW, search: "süprem" })).toHaveLength(3);
  });
});

describe("⭐ fark kapsamı (yıkıcı onayın içeriği)", () => {
  it("SAYILMAYAN satır eksik SAYILMAZ — ayrı sayaçta durur", () => {
    // Bu özelliğin yapabileceği en yıkıcı hata: yarım sayımın tamamlanması
    // sayılmamış her topu kayıttan düşürürdü.
    const s = completionScope([rollLine(), rollLine(), rollLine({ found: false })]);
    expect(s.missing).toHaveLength(1);
    expect(s.uncountedRolls).toBe(2);
  });

  it("iptal edilecek her top SOMUT kimliğiyle döner (barkod + metraj)", () => {
    const line = rollLine({ barcode: "R-77", expectedQty: "140.5" });
    const s = completionScope([line]);
    expect(s.missing).toHaveLength(0); // henüz işaretsiz
    line.found = false;
    const s2 = completionScope([line]);
    expect(s2.missing[0]).toMatchObject({ barcode: "R-77", qty: 140.5, label: "Süprem · Siyah" });
    expect(s2.missingMeters).toBe(140.5);
  });

  it("⭐ KAPSAM DIŞI aday `missing`ten DÜŞER ve metrajı şişirmez", () => {
    const s = completionScope([
      rollLine({ found: false, expectedQty: "100" }),
      rollLine({ found: false, expectedQty: "60", status: "SHIPPED" }),
    ]);
    expect(s.missing).toHaveLength(1);
    expect(s.missingMeters).toBe(100); // 160 DEĞİL
    expect(s.outOfScope).toHaveLength(1);
    expect(s.outOfScope[0]?.reason).toContain("sevk");
  });

  it("kapsam dışı öngörüsü YALNIZ eksik işaretlilere sorulur", () => {
    // Sevk edilmiş ama "bulundu" işaretli satır tamamlamada zaten işlenmez;
    // uyarı basmak kullanıcıyı olmayan bir sorunu araştırmaya gönderirdi.
    const s = completionScope([rollLine({ found: true, status: "SHIPPED" })]);
    expect(s.outOfScope).toHaveLength(0);
    expect(s.foundRolls).toBe(1);
  });

  it("iplik farkı: yalnız SAYILAN ve SIFIRDAN FARKLI satırlar", () => {
    const s = completionScope([
      yarnLine({ expectedQty: "500", countedQty: "480" }),
      yarnLine({ expectedQty: "500", countedQty: "500" }), // tuttu → yazılmaz
      yarnLine({ expectedQty: "500" }), // sayılmadı → dokunulmaz
    ]);
    expect(s.yarnDiffs).toHaveLength(1);
    expect(s.yarnDiffs[0]).toMatchObject({ expectedKg: 500, countedKg: 480, diffKg: -20 });
    expect(s.uncountedYarn).toBe(1);
  });

  it("“0 saydım” ile “saymadım” FARKLIDIR — 0 gerçek bir farktır", () => {
    const s = completionScope([yarnLine({ expectedQty: "120", countedQty: "0" })]);
    expect(s.yarnDiffs[0]?.diffKg).toBe(-120);
    expect(s.uncountedYarn).toBe(0);
  });

  it("dokunulmamış sayım `touched=false`, tek işaret yeter", () => {
    expect(completionScope([rollLine(), yarnLine()]).touched).toBe(false);
    expect(completionScope([rollLine({ found: true })]).touched).toBe(true);
    expect(completionScope([yarnLine({ countedQty: "0" })]).touched).toBe(true);
  });
});

describe("tamamlama engeli", () => {
  const clean = completionScope([rollLine({ found: true })]);

  it("taslak + işaretli sayımda engel YOK", () => {
    expect(completeBlockReason("DRAFT", clean, 1)).toBeNull();
  });

  it("tamamlanmış/iptal edilmiş sayım yeniden tamamlanamaz", () => {
    expect(completeBlockReason("COMPLETED", clean, 1)).toContain("yeniden tamamlanamaz");
    expect(completeBlockReason("CANCELLED", clean, 1)).toContain("yeniden tamamlanamaz");
  });

  it("üst sınır aşılırsa backend'e HİÇ GİTMEDEN sebebi söyler", () => {
    const many = completionScope(
      Array.from({ length: MAX_MISSING + 1 }, () => rollLine({ found: false })),
    );
    const reason = completeBlockReason("DRAFT", many, MAX_MISSING + 1);
    expect(reason).toContain(String(MAX_MISSING));
    expect(reason).toContain("araştırın");
  });

  it("⭐ sınır BACKEND'İN SAYDIĞI kümeyle ölçülür: kapsam dışı adayları da eksik işaretidir", () => {
    // Somut arıza (2026-08-15 çapraz incelemesi): 201 top eksik işaretli,
    // 2'si bu arada sevk edilmiş. Panel `scope.missing` (199) ile ölçseydi
    // düğmeyi AÇAR, backend `found === false` olan 201 satırı sayıp 400
    // dönerdi — dosyanın kendi "GÖNDERMEDEN söyler" sözleşmesi tam da bu
    // durumda çökerdi.
    const mixed = completionScope([
      ...Array.from({ length: MAX_MISSING - 1 }, () => rollLine({ found: false })),
      rollLine({ found: false, status: "SHIPPED" }),
      rollLine({ found: false, status: "SHIPPED" }),
    ]);
    expect(mixed.missing).toHaveLength(MAX_MISSING - 1); // ekran listesi kısaldı
    expect(mixed.outOfScope).toHaveLength(2);
    const reason = completeBlockReason("DRAFT", mixed, MAX_MISSING + 1);
    expect(reason).toContain(String(MAX_MISSING + 1)); // backend'in sayacağı sayı
    expect(reason).toContain("araştırın");
  });

  it("sınırın ALTINDA kalan karışık sayımda engel YOK (sınır gereksiz yere kapatmıyor)", () => {
    const ok = completionScope([
      ...Array.from({ length: MAX_MISSING - 2 }, () => rollLine({ found: false })),
      rollLine({ found: false, status: "SHIPPED" }),
    ]);
    expect(completeBlockReason("DRAFT", ok, MAX_MISSING - 1)).toBeNull();
  });

  it("⭐ hiç dokunulmamış sayım tamamlanamaz (terminal işlem kazayla kapanmasın)", () => {
    const untouched = completionScope([rollLine(), rollLine()]);
    expect(completeBlockReason("DRAFT", untouched, 2)).toContain("Hiçbir satır işaretlenmedi");
  });

  it("GERÇEKTEN BOŞ depoda kural devreye girmez (işaretlenecek satır yok)", () => {
    expect(completeBlockReason("DRAFT", completionScope([]), 0)).toBeNull();
  });
});

describe("onay düğmesinin metni", () => {
  it("yaptığı işi ADIYLA söyler (jenerik “Onayla” değil)", () => {
    const s = completionScope([
      rollLine({ found: false }),
      rollLine({ found: false }),
      yarnLine({ expectedQty: "500", countedQty: "480" }),
    ]);
    expect(completeButtonLabel(s)).toBe("2 topu düş · 1 iplik farkını yaz ve tamamla");
  });

  it("fark yoksa bunu SÖYLER (aynı görünürde iki farklı sonuç olmaz)", () => {
    expect(completeButtonLabel(completionScope([rollLine({ found: true })]))).toBe("Farksız tamamla");
  });
});

describe("iptal engeli", () => {
  it("taslak iptal edilebilir", () => {
    expect(cancelBlockReason("DRAFT")).toBeNull();
  });
  it("tamamlanmış sayım iptal EDİLEMEZ ve çıkış yolu söylenir", () => {
    const r = cancelBlockReason("COMPLETED");
    expect(r).toContain("iptal edilemez");
    expect(r).toContain("ters düzeltme");
  });
  it("zaten iptal edilmiş sayımda tekrar denenmez", () => {
    expect(cancelBlockReason("CANCELLED")).toContain("zaten iptal");
  });
});

describe("⭐ sayılan miktar girdisi", () => {
  it("SIFIR GEÇERLİDİR — “saydım, hiç kalmamış” sayımın en sık cevabı", () => {
    expect(parseCountedQty("0")).toEqual({ value: 0, wire: "0" });
    expect(countedQtyHint("0")).toBeNull();
  });

  it("NEGATİF reddedilir (eksi bakiye defterin durumu, sayımın sonucu değil)", () => {
    expect(parseCountedQty("-5")).toBeNull();
  });

  it("virgül ondalıktır; ağa NOKTALI string gider", () => {
    expect(parseCountedQty("1250,5")).toEqual({ value: 1250.5, wire: "1250.5" });
  });

  it("BELİRSİZ “1.250” reddedilir ve sebebi biçim olarak söylenir", () => {
    expect(parseCountedQty("1.250")).toBeNull();
    expect(countedQtyHint("1.250")).toContain("Binlik ayracı");
    // "sıfırdan büyük olsun" demek YANLIŞ olurdu — değer zaten öyle.
    expect(countedQtyHint("1.250")).not.toContain("0 veya daha büyük");
  });

  it("üç haneden kısa ondalık (1.25) GEÇERLİDİR", () => {
    expect(parseCountedQty("1.25")?.value).toBe(1.25);
  });

  it("boş girdi ipucu üretmez (form açılır açılmaz kırmızı cümle basılmaz)", () => {
    expect(countedQtyHint("")).toBeNull();
    expect(parseCountedQty("")).toBeNull();
  });
});

describe("süzgeç → sorgu", () => {
  it("boş süzgeçte TEK parametre gitmez", () => {
    expect(buildListQuery(EMPTY_STOCK_COUNT_FILTERS)).toEqual({
      warehouseId: undefined, status: undefined, from: undefined, to: undefined, search: undefined,
    });
  });

  it("gün sınırı İSTEMCİNİN yerel günüdür (00:00 ↔ 23:59:59.999)", () => {
    const q = buildListQuery({ ...EMPTY_STOCK_COUNT_FILTERS, from: "2026-08-01", to: "2026-08-15" });
    expect(new Date(q.from!).getHours()).toBe(0);
    expect(new Date(q.to!).getHours()).toBe(23);
    expect(new Date(q.to!).getMilliseconds()).toBe(999);
  });

  it("bozuk/boş tarih “bir tarihe” çevrilmez", () => {
    expect(buildListQuery({ ...EMPTY_STOCK_COUNT_FILTERS, from: "2026-02-31" }).from).toBeUndefined();
  });

  it("arama kırpılır", () => {
    expect(buildListQuery({ ...EMPTY_STOCK_COUNT_FILTERS, search: "  SAY15  " }).search).toBe("SAY15");
  });
});

describe("boş liste mesajı", () => {
  it("süzgeçliyken “hiç sayım yok” DEMEZ", () => {
    const msg = stockCountEmptyMessage({ ...EMPTY_STOCK_COUNT_FILTERS, status: "COMPLETED" });
    expect(msg).not.toContain("Henüz stok sayımı yapılmamış");
    expect(msg).toContain("Filtreleri temizleyip");
  });

  it("süzgeçsizken kayıt yokluğunu söyleyebilir + ilk adımı gösterir", () => {
    const msg = stockCountEmptyMessage(EMPTY_STOCK_COUNT_FILTERS);
    expect(msg).toContain("Henüz stok sayımı yapılmamış");
    expect(msg).toContain("hiçbir deftere yazmaz");
  });
});
