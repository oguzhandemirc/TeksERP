// =============================================================================
// BEKÇİ — Kasa Hareketleri saf katmanı + ekran sözleşmeleri (F3)
// =============================================================================
// Altı kural kilitlenir; altısı da ekranda SESSİZCE bozulabilen türden:
//
//   1. SÜZGEÇ → SORGU: boş değer hiç gitmez · gün sınırı yerel 00:00/23:59:59.999
//      (`Cheques/dates` tek kaynak; boş tarih **1 Ocak 1900** tuzağı) · hesap
//      XOR `cashAccountParams`tan geçer. Bozulursa liste sessizce YANLIŞ süzülür.
//   2. TUTAR AYRIŞTIRMA: virgül ondalıktır (TR klavye) ama `1.250` BELİRSİZDİR
//      ve tahmin edilmez — düz `Number` onu 1,25 yapar, yani 1250 TL'lik masraf
//      **bin kat** yanlış kaydedilir. Ret sebebi de ayrışır (biçim ≠ sıfır).
//   3. VİRMAN ENGELLERİ: farklı para birimi bir KUR İŞLEMİDİR ve GÖNDERİLMEDEN
//      durdurulur; aynı hesap ve pasif hesap da öyle. Yüklem düşerse kullanıcı
//      formu doldurup ham 400 yer.
//   4. İPTAL KAPSAMI: yıkıcı onay etkilenen HER kaydı yazar. En sessiz tuzak
//      `null === null` — virman OLMAYAN bir fişte kapsam, listedeki BÜTÜN
//      carisiz fişleri "iptal edilecek" diye sayardı.
//   5. HATA YÜZEYİ BORCU: yazma uçları `suppressErrorToast` ile gider, yani
//      hata alanını çizmeyi unutan diyalog SESSİZ BAŞARISIZLIK üretir. Kaynak
//      taramasıyla mekanik olarak kilitlenir.
//   6. KARO ↔ ROUTE HİZASI: ayrışırsa kullanıcı kartı görür, tıklar, /forbidden.
//
// NEGATİF SONDA (2026-08-14 — ALTI sonda; her biri boz → ölç → geri yükle TEK
// komut zincirinde koşuldu ve dosya `shasum -c` ile birebir geri yüklendi.
// Yeni dosyalarda `git checkout` ÇALIŞMAZ (untracked) → `cp` yedeği; geri-alma
// zincirin kendisinde durur, "aklımda" değil):
//   • `cancelScope`in `if (!group)` erken dönüşü SİLİNDİ → 1 kırmızı
//     (carisiz fişin kapsamı listedeki tüm carisiz fişlere şişti).
//   • `transferBlockReason`de `!==` → `===` → 3 kırmızı.
//   • `buildListQuery`de `dayStartIso/dayEndIso` yerine ham metin → 2 kırmızı.
//   • `CashTxnCancelDialog`ta `{error && (` → `{null && (` → 1 kırmızı (§5).
//   • Karodaki `to` yolu kaydırıldı → 2 kırmızı (§6 + komut paleti bekçisi).
//   • `parseAmount`ın `THOUSANDS_LOOKING` seddi silindi → 2 kırmızı
//     (`"1.250"` sessizce 1,25 olarak kabul edildi).
// =============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENTRY_KIND_DIRECTION,
  KIND_LABEL,
  amountHint,
  buildListQuery,
  cancelScope,
  entryBlockReason,
  parseAmount,
  transferBlockReason,
  transferReady,
  withSign,
  type AccountLike,
  type CashTxnFilterState,
} from "./cashTxnRules";
import type { CashTxnRow } from "./service";

const ACC = (over: Partial<AccountLike> = {}): AccountLike => ({
  kind: "CASH_BOX",
  id: "kasa-1",
  code: "KS001",
  name: "Merkez Kasa",
  currency: "TRY",
  isActive: true,
  ...over,
});

const ROW = (over: Partial<CashTxnRow> = {}): CashTxnRow => ({
  id: "r1",
  docNo: "KH1408260001",
  kind: "EXPENSE",
  direction: "OUT",
  status: "ACTIVE",
  currency: "TRY",
  amount: 100,
  txnDate: "2026-08-14T00:00:00.000Z",
  category: null,
  description: null,
  reference: null,
  transferGroupId: null,
  cashBox: { id: "kasa-1", name: "Merkez Kasa" },
  bankAccount: null,
  ...over,
});

const FILTERS = (over: Partial<CashTxnFilterState> = {}): CashTxnFilterState => ({
  account: null,
  kind: "",
  status: "",
  search: "",
  from: "",
  to: "",
  ...over,
});

// -----------------------------------------------------------------------------
describe("§1 buildListQuery — süzgeç sözleşmesi", () => {
  it("boş süzgeçte HİÇBİR değer taşımaz (boş string göndermez)", () => {
    const q = buildListQuery(FILTERS());
    for (const [key, value] of Object.entries(q)) {
      expect(value, `${key} boş string olarak gidiyor`).toBeUndefined();
    }
  });

  it("hesap XOR — daima TEK anahtar (cashAccountParams tek kaynak)", () => {
    const cash = buildListQuery(FILTERS({ account: { kind: "CASH_BOX", id: "k1" } }));
    expect(cash.cashBoxId).toBe("k1");
    expect("bankAccountId" in cash).toBe(false);

    const bank = buildListQuery(FILTERS({ account: { kind: "BANK_ACCOUNT", id: "b1" } }));
    expect(bank.bankAccountId).toBe("b1");
    expect("cashBoxId" in bank).toBe(false);
  });

  it("tarih YEREL gün sınırına çevrilir — ham 'YYYY-MM-DD' GİTMEZ", () => {
    const q = buildListQuery(FILTERS({ from: "2026-03-15", to: "2026-03-15" }));
    // Ham metin gitseydi backend onu UTC gece yarısı sayardı; negatif ofsetli
    // makinede gün BİR GERİ kayar ve o günün kayıtları listede görünmezdi.
    expect(q.from).not.toBe("2026-03-15");
    const from = new Date(q.from as string);
    const to = new Date(q.to as string);
    expect(from.getFullYear()).toBe(2026);
    expect(from.getMonth()).toBe(2);
    expect(from.getDate()).toBe(15);
    expect(from.getHours()).toBe(0);
    expect(to.getHours()).toBe(23);
    expect(to.getMinutes()).toBe(59);
    // Aralık gerçekten TÜM günü kapsıyor mu (24 saate 1 ms kala).
    expect(to.getTime() - from.getTime()).toBe(86_400_000 - 1);
  });

  it("boş/bozuk tarih parametreyi HİÇ üretmez (1900 tuzağı)", () => {
    const q = buildListQuery(FILTERS({ from: "", to: "15/03/2026" }));
    expect(q.from).toBeUndefined();
    expect(q.to).toBeUndefined();
  });

  it("arama kırpılır, yalnız boşluktan ibaretse gönderilmez", () => {
    expect(buildListQuery(FILTERS({ search: "  kira  " })).search).toBe("kira");
    expect(buildListQuery(FILTERS({ search: "   " })).search).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
describe("§2 parseAmount — tutar", () => {
  it("virgüllü giriş kabul edilir, ağa NOKTALI gider", () => {
    expect(parseAmount("1234,50")).toEqual({ value: 1234.5, wire: "1234.50" });
    expect(parseAmount("1250")).toEqual({ value: 1250, wire: "1250" });
    // Nokta ondalık olarak da meşrudur — üç haneden AZ ise belirsizlik yok.
    expect(parseAmount("1.25")?.value).toBe(1.25);
  });

  it("sıfır, negatif, boş ve metin reddedilir", () => {
    for (const bad of ["", "0", "0,00", "-5", "abc", "   "]) {
      expect(parseAmount(bad), `${bad} kabul edildi`).toBeNull();
    }
  });

  it("BİNLİK AYRACI TAHMİN EDİLMEZ — reddedilir (bin kat hata sınıfı)", () => {
    // `Number("1.250")` = 1.25: operatörün 1250 TL'lik masrafı 1,25 TL olarak
    // kaydedilirdi; hata yok, log yok. Belirsiz girdi kabul EDİLMEZ.
    expect(parseAmount("1.250")).toBeNull();
    expect(parseAmount("12.500")).toBeNull();
    expect(parseAmount("1.250,00")).toBeNull();
  });

  it("ret SEBEBİ ayrışır — biçim hatasına 'sıfırdan büyük girin' denmez", () => {
    expect(amountHint("")).toBeNull();
    expect(amountHint("1250,50")).toBeNull();
    expect(amountHint("1.250,00")).toContain("Binlik");
    expect(amountHint("1.250")).toContain("Binlik");
    expect(amountHint("0")).toBe("Sıfırdan büyük bir tutar girin.");
  });
});

// -----------------------------------------------------------------------------
describe("§3 virman engelleri", () => {
  it("eksik seçim bir ENGEL DEĞİLDİR (form açılışında kırmızı cümle basılmaz)", () => {
    expect(transferBlockReason(null, null)).toBeNull();
    expect(transferBlockReason(ACC(), null)).toBeNull();
    // Ama gönderilebilir de değildir.
    expect(transferReady(ACC(), null, "100", "2026-03-15")).toBe(false);
  });

  it("FARKLI PARA BİRİMİ — sebep gönderilmeden yazılır ve iki birimi de adlandırır", () => {
    const reason = transferBlockReason(ACC(), ACC({ kind: "BANK_ACCOUNT", id: "b1", name: "Ziraat", currency: "USD" }));
    expect(reason).toBeTruthy();
    expect(reason).toContain("TRY");
    expect(reason).toContain("USD");
    expect(transferReady(ACC(), ACC({ kind: "BANK_ACCOUNT", id: "b1", currency: "USD" }), "100", "2026-03-15")).toBe(false);
  });

  it("aynı hesap reddedilir; TÜR anahtarın parçası (aynı uuid farklı tabloda meşrudur)", () => {
    expect(transferBlockReason(ACC(), ACC())).toContain("aynı olamaz");
    // Aynı uuid ama biri kasa biri banka → FARKLI hesaplardır, engel yok.
    expect(transferBlockReason(ACC({ id: "ayni" }), ACC({ kind: "BANK_ACCOUNT", id: "ayni" }))).toBeNull();
  });

  it("pasif hesap adıyla engellenir (backend 400'ünün ekran ikizi)", () => {
    const reason = transferBlockReason(ACC(), ACC({ id: "b1", name: "Kapalı Kasa", isActive: false }));
    expect(reason).toContain("Kapalı Kasa");
    expect(reason).toContain("PASİF");
  });

  it("uygun çift + geçerli tutar/tarih → gönderilebilir", () => {
    expect(transferReady(ACC(), ACC({ id: "kasa-2" }), "1000", "2026-03-15")).toBe(true);
    // Tarih temizlenirse gönderilemez ("bugün" sessizce VARSAYILMAZ).
    expect(transferReady(ACC(), ACC({ id: "kasa-2" }), "1000", "")).toBe(false);
  });
});

// -----------------------------------------------------------------------------
describe("§3b fiş engelleri ve yön önizlemesi", () => {
  it("pasif hesapta fiş kesilemez", () => {
    expect(entryBlockReason(ACC({ isActive: false }))).toContain("PASİF");
    expect(entryBlockReason(ACC())).toBeNull();
    expect(entryBlockReason(null)).toBeNull();
  });

  it("AÇILIŞ bakiyeyi ARTIRIR (IN) — masraf azaltır", () => {
    // Backend KIND_DIRECTION aynası; ters yazılırsa form "azalacak" der,
    // kayıt bakiyeyi artırır ve operatör rakama güvenmeyi bırakır.
    expect(ENTRY_KIND_DIRECTION.OPENING).toBe("IN");
    expect(ENTRY_KIND_DIRECTION.INCOME).toBe("IN");
    expect(ENTRY_KIND_DIRECTION.EXPENSE).toBe("OUT");
  });

  it("işaret her zaman basılır — renk tek başına ayrım değildir", () => {
    expect(withSign("IN", "100,00 ₺")).toBe("+100,00 ₺");
    expect(withSign("OUT", "100,00 ₺")).toBe("−100,00 ₺");
  });

  it("virmanın iki bacağı AYRI etiketlidir (tek 'virman' seçeneği tek bacağı süzerdi)", () => {
    expect(KIND_LABEL.TRANSFER_OUT).not.toBe(KIND_LABEL.TRANSFER_IN);
  });
});

// -----------------------------------------------------------------------------
describe("§4 cancelScope — yıkıcı onayın kapsamı", () => {
  const expense = ROW({ id: "e1", docNo: "KH-E1" });
  const otherExpense = ROW({ id: "e2", docNo: "KH-E2" });
  const legOut = ROW({ id: "t-out", docNo: "KH-002", kind: "TRANSFER_OUT", direction: "OUT", transferGroupId: "g1" });
  const legIn = ROW({ id: "t-in", docNo: "KH-003", kind: "TRANSFER_IN", direction: "IN", transferGroupId: "g1" });
  const foreignLeg = ROW({ id: "x-out", docNo: "KH-009", kind: "TRANSFER_OUT", direction: "OUT", transferGroupId: "g2" });

  it("VİRMAN OLMAYAN fişin kapsamı YALNIZ KENDİSİDİR (null === null tuzağı)", () => {
    // `r.transferGroupId === target.transferGroupId` ile kurulmuş bir kapsam
    // burada iki fişi de yakalar ve onay ekranı ilgisiz bir kaydı da
    // "iptal edilecek" diye yazardı.
    const s = cancelScope([expense, otherExpense, legOut, legIn], expense);
    expect(s.legs.map((r) => r.id)).toEqual(["e1"]);
    expect(s.isTransfer).toBe(false);
    expect(s.missingLeg).toBe(false);
  });

  it("virmanda İKİ bacak da listelenir — çıkan önce", () => {
    const s = cancelScope([legIn, expense, legOut], legIn);
    expect(s.isTransfer).toBe(true);
    expect(s.legs.map((r) => r.id)).toEqual(["t-out", "t-in"]);
    expect(s.missingLeg).toBe(false);
  });

  it("BAŞKA grubun bacağı kapsama sızmaz", () => {
    const s = cancelScope([legOut, legIn, foreignLeg], legOut);
    expect(s.legs.map((r) => r.id).sort()).toEqual(["t-in", "t-out"]);
  });

  it("karşı bacak sayfada yoksa GİZLENMEZ, işaretlenir", () => {
    const s = cancelScope([legOut, expense], legOut);
    expect(s.legs.map((r) => r.id)).toEqual(["t-out"]);
    expect(s.isTransfer).toBe(true);
    expect(s.missingLeg).toBe(true);
  });

  it("hedef listede olmasa bile kapsamda yer alır (sayfa değişmiş olabilir)", () => {
    const s = cancelScope([legIn], legOut);
    expect(s.legs.map((r) => r.id)).toEqual(["t-out", "t-in"]);
  });
});

// -----------------------------------------------------------------------------
// §5/§6 — KAYNAK TARAMASI. Bileşen davranışı burada ölçülmez; ölçülen şey
// SÖZLEŞMENİN DOSYADA DURUP DURMADIĞIdır (`command-entries.test.ts` deseni:
// kaynak metni okunur, modül import EDİLMEZ).
const read = (rel: string) => {
  const src = readFileSync(resolve(__dirname, rel), "utf8");
  // Körlük zemini: yol tutuyor ama dosya boşsa/kırpıldıysa her kontrol
  // "ihlal yok" diye YEŞİL kalırdı.
  expect(src.length, `${rel} beklenenden kısa — tarama körleşmiş olabilir`).toBeGreaterThan(800);
  return src;
};

describe("§5 hata yüzeyi borcu — suppressErrorToast'ın karşılığı", () => {
  const WRITE_DIALOGS = ["CashTxnFormDialog.tsx", "CashTransferDialog.tsx", "CashTxnCancelDialog.tsx"];

  it("üç yazma ucu da toast'ı bastırır (aksi hâlde mesaj iki kez basılır)", () => {
    const src = read("./service.ts");
    expect(src.match(/suppressErrorToast: true/g)?.length).toBe(3);
    for (const fn of ["createCashTxn", "transferCash", "cancelCashTxn"]) {
      expect(src, `${fn} yok`).toContain(`export async function ${fn}`);
    }
  });

  it("yazma ucunu çağıran HER diyalog kendi hata alanını çizer", () => {
    for (const file of WRITE_DIALOGS) {
      const src = read(`./${file}`);
      expect(src, `${file}: cashTxnErrorText kullanılmıyor`).toContain("cashTxnErrorText");
      expect(src, `${file}: onError hatayı duruma yazmıyor`).toMatch(/onError:\s*\(e\)\s*=>\s*setError\(/);
      expect(src, `${file}: hata ekranda BASILMIYOR — sessiz başarısızlık`).toMatch(/\{error &&/);
    }
  });

  it("diyaloglar iş sürerken kapanmaz (mesajın basılacağı yüzey kaybolmasın)", () => {
    for (const file of WRITE_DIALOGS) {
      expect(read(`./${file}`), `${file}: pending sırasında kapanma guard'ı yok`).toMatch(
        /if \(!o && \w+\.isPending\) return;/,
      );
    }
  });
});

describe("§6 karo ↔ route hizası", () => {
  const TO = "/finance/cash-transactions";

  it("karo ve route AYNI izni taşır", () => {
    const tiles = read("../tile-config.ts");
    expect(tiles).toContain(`to: "${TO}"`);

    const routes = readFileSync(resolve(__dirname, "../../../routes/content-routes.tsx"), "utf8");
    const at = routes.indexOf(`path: "finance/cash-transactions"`);
    expect(at, "route kaydı yok — karo tıklanınca 404/boş sekme").toBeGreaterThan(-1);
    // Karodaki `permissionAny: ["finance:read"]` ile birebir aynı olmalı.
    expect(routes.slice(at, at + 300)).toContain('requirePermission="finance:read"');
    expect(routes.slice(at, at + 300)).toContain("<CashTransactionsPage />");
  });
});
