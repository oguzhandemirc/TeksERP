// =============================================================================
// MASTER VERİ — KİMLİK TEKİLLİĞİ TRIPWIRE'I
// =============================================================================
// Koşum: npx tsx scripts/test_master_data_kimlik_tekilligi.ts
//
// Kullanıcı kuralı (2026-09-17): *"master veri sektör standardında olmalı; ilk
// fason tablosunda düşünemedik, geriye dönüp böyle problem yaşamayalım."*
// Beş kapı `docs/standart/MASTER-VERI-TASARIMI.md`te; bu bekçi onlardan MEKANİK
// ölçülebilen üçünü ölçer ([MV-01] · [MV-02] · [MV-04]).
//
// TEK SORU: *aynı gerçek nesne iki master tabloda yaşıyor mu — ya da yaşayacağı
// bir şema DOĞUYOR mu?*
//
// ⚠️ ÜÇ SONUÇ, İKİ DEĞİL: uyumlu · ihlal · ÖLÇÜLEMEDİ. Bir kolun zemini yoksa
// (boş tablo, silinmiş çapa belgesi) o kol "temiz" DEĞİL beyanlı ⏭'dir —
// "araç yok" ile "araç uyumlu"yu aynı satıra düşürmek, kapının çözdüğünden
// büyük bir arıza üretir.
//
// ⚠️ ① DB'Lİ, ②③ STATİK. ① fixture'da 0 verir ve bu "saha temiz" DEMEZ: hedefin
// ADI her koşumda basılır.
// =============================================================================
import fs from "fs";
import path from "path";

import prisma, { pool } from "../src/lib/prisma";
import { atlamaDefteri } from "./lib/atlama";
import { fixtureHedefEngeli, hedefDbAdi } from "./lib/hedef-db-kapisi";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
const ATLAMA = atlamaDefteri((mesaj) => check(mesaj, false));
const kollar = new Map<string, "uyumlu" | "ihlal" | "olculemedi">();

const SEMA = path.resolve(__dirname, "../prisma/schema.prisma");
const CAPA_BELGESI = path.resolve(__dirname, "../../docs/standart/MASTER-VERI-TASARIMI.md");

/**
 * MASTER MODEL ÖLÇÜTÜ: `nameFold` taşıyan model. Bu bir tercih değil ÖLÇÜM —
 * katlanmış ad gölgesi yalnız "gerçek dünyada bir nesneye karşılık gelen ve
 * ADIYLA aranan" tablolara eklendi. Hareket/defter tabloları onu taşımaz.
 * ⇒ Listeyi ELLE yazmak, yeni bir master tablonun sessizce kapsam dışı
 *   kalması demekti (bu depoda elle yazılmış ilişki listesi bir kez ısırdı).
 */
interface Model { ad: string; govde: string; master: boolean }

function modelleriOku(): Model[] {
  const metin = fs.readFileSync(SEMA, "utf-8");
  const out: Model[] = [];
  for (const m of metin.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    out.push({ ad: m[1], govde: m[2], master: /^\s+nameFold\s/m.test(m[2]) });
  }
  return out;
}

async function main(): Promise<void> {
  console.log("=== MASTER VERİ — KİMLİK TEKİLLİĞİ ===\n");
  const fixtureMi = fixtureHedefEngeli() === null;
  console.log(`🎯 Hedef: ${hedefDbAdi()}${fixtureMi ? "  (fixture — saha hükmü DEĞİL)" : "  (fixture kalıbı dışı — kurulum kopyası olabilir)"}\n`);
  const modeller = modelleriOku();

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("§1 — [MV-04] AYNI NESNE İKİ TABLODA (DB)");
  // ═══════════════════════════════════════════════════════════════════════════
  // Tekillik TEK TABLO içinde ölçülüyor (`@@unique([nameFold])`, birleştirme
  // delegate'i tek model) ⇒ cari ↔ fason ad çakışması HİÇBİR kapıdan geçmiyordu.
  //
  // ⚠️ İKİ MUAFİYET, İKİSİ DE BEYANLI:
  //   · BAĞLI ÇİFT (`subcontractors.customerId`) — bağ zaten TEK kimlik demektir;
  //     rol modelinin ürettiği normal durum budur, ihlal saymak göçün kendi
  //     sonucunu ihlal saymaktır.
  //   · TOMBSTONE (`mergedIntoId`) — birleştirilmiş kayıt adını taşımaya devam
  //     eder; kısıtlar onu zaten dışarıda bırakıyor (`name_fold_unique_live`).
  const [kartlar, profiller] = await Promise.all([
    prisma.customer.findMany({
      where: { mergedIntoId: null },
      select: { id: true, code: true, name: true, nameFold: true, taxNumber: true },
    }),
    prisma.subcontractor.findMany({
      where: { mergedIntoId: null },
      select: { id: true, code: true, name: true, nameFold: true, taxNumber: true, customerId: true },
    }),
  ]);
  const kartFold = new Map<string, { code: string; id: string }>();
  for (const k of kartlar) if (k.nameFold) kartFold.set(k.nameFold, { code: k.code, id: k.id });
  const normVergi = (v: string | null): string | null => {
    const t = (v ?? "").replace(/\s/g, "");
    return t.length > 0 ? t : null;
  };
  const kartVergi = new Map<string, { code: string; id: string }>();
  for (const k of kartlar) { const v = normVergi(k.taxNumber); if (v) kartVergi.set(v, { code: k.code, id: k.id }); }

  const adCakisan: string[] = [];
  const vergiCakisan: string[] = [];
  for (const p of profiller) {
    if (p.nameFold) {
      const esles = kartFold.get(p.nameFold);
      // Bağlı çift MUAF: bağ zaten tek kimliktir.
      if (esles && p.customerId !== esles.id) adCakisan.push(`${p.code} ↔ ${esles.code} ("${p.name}")`);
    }
    const v = normVergi(p.taxNumber);
    if (v) {
      const esles = kartVergi.get(v);
      if (esles && p.customerId !== esles.id) vergiCakisan.push(`${p.code} ↔ ${esles.code} (VKN ${v})`);
    }
  }
  // ⚠️ KÖRLÜK ZEMİNİ: iki tablodan biri BOŞSA çakışma zaten imkânsızdır ve
  // yeşil, ölçümün değil boşluğun sonucudur.
  if (kartlar.length === 0 || profiller.length === 0) {
    kollar.set("①", "olculemedi");
    ATLAMA.atla("① aynı nesne iki tabloda",
      `ÖLÇÜLEMEDİ: karşılaştırılacak popülasyon yok (${kartlar.length} cari kartı · ${profiller.length} fason profili)`, 2);
  } else {
    kollar.set("①", adCakisan.length + vergiCakisan.length === 0 ? "uyumlu" : "ihlal");
    check("①a BAĞSIZ ad çakışması YOK (`nameFold`, tombstone hariç)", adCakisan.length === 0,
      adCakisan.length === 0 ? `${kartlar.length} kart × ${profiller.length} profil` : adCakisan.slice(0, 5).join(" · "));
    check("①b BAĞSIZ vergi no çakışması YOK", vergiCakisan.length === 0,
      vergiCakisan.length === 0 ? `${kartVergi.size} kartta VKN var` : vergiCakisan.slice(0, 5).join(" · "));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n§2 — [MV-02] XOR'LU ÇİFT-TARAF BAĞI YENİ MODELDE DOĞMASIN (ŞEMA)");
  // ═══════════════════════════════════════════════════════════════════════════
  // Bir satırı İKİ AYRI MASTER KİMLİĞE XOR ile bağlamak, "aynı firma iki
  // kimlik" hatasının şemadaki imzasıdır: `CariAccount` `customerId` XOR
  // `subcontractorId` iki CHECK'le korunuyordu ve aynı firmanın borcu iki
  // satırda görünebiliyordu.
  //
  // ⚠️ HER XOR İHLAL DEĞİLDİR ve ad eşlemek (`_xor`) bunu ayırt EDEMEZ:
  // `cash_txn_account_xor` kasa ile bankayı ayırır — ikisi aynı gerçek nesne
  // OLAMAZ. "İki master tablo birbirine FK ile bağlanabiliyor mu" ölçütü de
  // ÇOK GENİŞ ÇIKTI (ölçüldü 2026-09-17, bu bekçinin ilk taslağı koşuldu:
  // 10 sahte pozitif — makine↔istasyon, şube↔müşteri, aynı tabloya iki FK…):
  // HİYERARŞİ de bir FK'dır.
  //
  // AYIRT EDEN İMZA: iki master tablo arasında **1:1 KİMLİK BAĞI** —
  // opsiyonel ve `@unique` bir FK. "Bu profil O karttır" cümlesi ancak böyle
  // kurulur; hiyerarşi FK'sı (bir istasyonda N makine) `@unique` DEĞİLDİR.
  // Bugün şemada TEK böyle bağ var: `Subcontractor.customerId → Customer`.
  // ⇒ *Bir tripwire'ın değeri bulduklarında değil, ELEDİKLERİNDE ölçülür;
  //   10'da 10 sahte pozitif veren bir kol ilk sıkışmada susturulur.*
  const masterAdlari = new Set(modeller.filter((m) => m.master).map((m) => m.ad));
  const alanTipi = (govde: string, alan: string): { tip: string; opsiyonel: boolean } | null => {
    const base = alan.replace(/Id$/, "");
    const m = new RegExp(`^\\s{2}${base}\\s+(\\w+)(\\??)\\s`, "m").exec(govde);
    return m ? { tip: m[1], opsiyonel: m[2] === "?" } : null;
  };
  /** İki master tabloyu "aynı nesne olabilir" yapan 1:1 kimlik bağları. */
  const kimlikBaglari: Array<{ kaynak: string; hedef: string; alan: string }> = [];
  for (const m of modeller) {
    if (!m.master) continue;
    for (const r of m.govde.matchAll(/@relation\([^)]*fields:\s*\[(\w+)\][^)]*\)/g)) {
      const alan = r[1];
      const t = alanTipi(m.govde, alan);
      if (!t || !masterAdlari.has(t.tip) || !t.opsiyonel) continue;
      const skaler = new RegExp(`^\\s{2}${alan}\\s+String\\??\\s*([^\\n]*)`, "m").exec(m.govde);
      if (skaler && /@unique/.test(skaler[1])) kimlikBaglari.push({ kaynak: m.ad, hedef: t.tip, alan });
    }
  }
  /**
   * BEYANLI KİMLİK BAĞLARI. Böyle bir bağın VARLIĞI tek başına ihlal değildir —
   * rol modelinin ürettiği çözüm tam olarak budur (kimlik kartta, operasyon
   * profilde, [MV-03]). Ama yeni bir tanesi BEYANSIZ doğarsa, "aynı nesne iki
   * tabloda" tasarımı bir kez daha kurulmuş demektir.
   */
  const KIMLIK_BAGI_BEYANLARI = new Map<string, string>([
    ["Subcontractor.customerId → Customer",
     "rol modelinin ÇÖZÜMÜ: kimlik kartta, fason OPERASYONU profilde ([MV-03]) — 12 operasyon ilişkisi yeniden yazılmadı"],
  ]);
  const bagAnahtari = (b: { kaynak: string; hedef: string; alan: string }): string =>
    `${b.kaynak}.${b.alan} → ${b.hedef}`;
  const beyansizBag = kimlikBaglari.map(bagAnahtari).filter((k) => !KIMLIK_BAGI_BEYANLARI.has(k));
  const oluBagBeyani = [...KIMLIK_BAGI_BEYANLARI.keys()].filter((k) => !kimlikBaglari.map(bagAnahtari).includes(k));

  // KİMLİK ÇİFTİ İMZASI: BAŞKA bir model, kimlik bağının İKİ UCUNA birden
  // opsiyonel FK taşıyorsa, o satırın karşı tarafı aynı firmanın İKİ AYRI
  // kimliğinden biri olabiliyor demektir.
  //
  // ⚠️ ALAN ÇİFTİ düzeyinde ölçülür, model düzeyinde DEĞİL: `WarpBeam` üç FK
  // taşıyor ve çiftlerin sınıfı AYNI DEĞİL (biri gerçek XOR borcu, öteki iki
  // ayrı rol ekseni). Model düzeyinde tek satır basmak, ikisini tek beyanla
  // örtüp borcu görünmez kılardı.
  const kimlikCiftleri: string[] = [];
  for (const m of modeller) {
    const opsMaster: Array<{ alan: string; tip: string }> = [];
    for (const r of m.govde.matchAll(/@relation\([^)]*fields:\s*\[(\w+)\][^)]*\)/g)) {
      const t = alanTipi(m.govde, r[1]);
      if (t && masterAdlari.has(t.tip) && t.opsiyonel) opsMaster.push({ alan: r[1], tip: t.tip });
    }
    for (const b of kimlikBaglari) {
      if (m.ad === b.kaynak) continue;
      for (const a of opsMaster.filter((x) => x.tip === b.hedef)) {
        for (const c of opsMaster.filter((x) => x.tip === b.kaynak)) {
          kimlikCiftleri.push(`${m.ad}: ${a.alan}(${a.tip}) ↔ ${c.alan}(${c.tip})`);
        }
      }
    }
  }
  /**
   * BEYANLI KİMLİK ÇİFTLERİ — her satır bir SINIF iddiasıdır:
   *   · `borç`   = gerçek MV-02 ihlali, kaldırılması planlanmış (nereden takip
   *                edileceği yazılır);
   *   · `iki-rol` = iki AYRI eksen, aynı satırda BİRLİKTE dolu olabilir; aynı
   *                nesnenin iki kimliği DEĞİL.
   * Sınıfı yazmadan şemaya yeni bir çift eklemek KIRMIZIDIR: ayrımı yapan
   * cümle, şemayı yazanın kafasında kalırsa kimse ölçemez.
   */
  const KIMLIK_CIFTI_BEYANLARI = new Map<string, string>([
    ["CariAccount: customerId(Customer) ↔ subcontractorId(Subcontractor)",
     "borç — aynı firmanın borcu iki satırda görünebiliyordu; göç hesapları karta topluyor, kaldırma fazı `subcontractorId`yi düşürecek (IS-ORTAGI-ROL-MODELI.md §7.2)"],
    ["WarpBeam: supplierId(Customer) ↔ subcontractorId(Subcontractor)",
     "borç — `PURCHASED` leventte 'TAM BİRİ' XOR'u; satın alınan levent bir TEDARİKÇİDEN ya da fason devereciden gelir ve ikisi AYNI firma olabilir. Rol modeli indikten sonra tek kimliğe (kart + roller) çekilmeli"],
    ["WarpBeam: ownerCustomerId(Customer) ↔ subcontractorId(Subcontractor)",
     "iki-rol — `ownerCustomer` EMANET SAHİBİ, `subcontractor` İŞLEYEN taraf; ikisi aynı satırda BİRLİKTE dolu olabilir ve aynı nesnenin iki kimliği DEĞİLDİR"],
  ]);
  const teklesenCiftler = [...new Set(kimlikCiftleri)];
  const beyansizCift = teklesenCiftler.filter((k) => !KIMLIK_CIFTI_BEYANLARI.has(k));
  const oluCiftBeyani = [...KIMLIK_CIFTI_BEYANLARI.keys()].filter((k) => !teklesenCiftler.includes(k));
  kollar.set("②", beyansizCift.length === 0 && beyansizBag.length === 0 ? "uyumlu" : "ihlal");
  check("②a YENİ 1:1 kimlik bağı BEYANSIZ doğmamış", beyansizBag.length === 0,
    beyansizBag.join(" · ") || `${kimlikBaglari.length} bağ, hepsi beyanlı`);
  check("②b YENİ çift-master kimlik bağı BEYANSIZ doğmamış", beyansizCift.length === 0,
    beyansizCift.join(" · ") || `${teklesenCiftler.length} çift, hepsi sınıflandırılmış`);
  // İKİ YÖNLÜ: borç kapandığında beyan satırı da düşmeli — yoksa muafiyet
  // listesi zamanla "neden burada olduğu bilinmeyen satırlar"a döner.
  check("②c ÖLÜ beyan yok (listede olup şemada olmayan bağ/çift)",
    oluCiftBeyani.length === 0 && oluBagBeyani.length === 0,
    [...oluCiftBeyani, ...oluBagBeyani].join(" · ") || "temiz");
  // ⚠️ KÖRLÜK ZEMİNİ: ölçüt hiçbir şey bulamıyorsa arama BOZUK olabilir —
  // bugünkü BİLİNEN bağı ve çifti görmek, aracın çalıştığının kanıtıdır.
  check("②z körlük zemini: bilinen bağ VE çift GÖRÜLÜYOR (arama çalışıyor)",
    kimlikBaglari.map(bagAnahtari).includes("Subcontractor.customerId → Customer") &&
      teklesenCiftler.includes("CariAccount: customerId(Customer) ↔ subcontractorId(Subcontractor)"),
    `${kimlikBaglari.length} bağ · ${teklesenCiftler.length} çift`);
  // AÇIK BORÇ SAYISI raporlanır: kol yeşilken bile kaç MV-02 borcu taşıdığımız
  // görünsün — "beyanlı" ile "çözülmüş" aynı şey değildir.
  const borclar = teklesenCiftler.filter((k) => (KIMLIK_CIFTI_BEYANLARI.get(k) ?? "").startsWith("borç"));
  console.log(`   ℹ️  açık MV-02 borcu: ${borclar.length} — ${borclar.join(" · ") || "yok"}`);

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n§3 — [MV-01] TEK SEÇİMLİ 'TÜR' ENUM'U BEYANSIZ DOĞMASIN (ŞEMA)");
  // ═══════════════════════════════════════════════════════════════════════════
  // `CompanyType` tam olarak bu sınıftı: bir firma aynı anda hem müşteri hem
  // tedarikçi OLABİLİYORDU, ama enum "ikisi birden" diyemiyordu ve `BOTH`
  // değeri eklenerek yamanmıştı — rol modeli onu üç bayrakla değiştirdi.
  // ⇒ Master modele tek seçimli bir TÜR ekseni eklemek, "bu nesne aynı anda
  //   ikisi OLAMAZ" cümlesinin ÖLÇÜLDÜĞÜNÜ iddia eder. Beyan o iddiadır.
  const TUR_ALANI = /^(type|kind)$|(Type|Kind)$/;
  const enumlar = new Set([...fs.readFileSync(SEMA, "utf-8").matchAll(/^enum\s+(\w+)\s*\{/gm)].map((m) => m[1]));
  const turEksenleri: string[] = [];
  for (const m of modeller) {
    if (!m.master) continue;
    for (const f of m.govde.matchAll(/^\s{2}(\w+)\s+(\w+)\??\s/gm)) {
      const [, alan, tip] = f;
      if (enumlar.has(tip) && TUR_ALANI.test(alan)) turEksenleri.push(`${m.ad}.${alan}: ${tip}`);
    }
  }
  /**
   * BEYANLI TÜR EKSENLERİ — her satır "bu nesne aynı anda ikisi OLAMAZ"
   * cümlesinin ÖLÇÜLDÜĞÜNÜ söyler. Yeni bir satır eklemek, o ölçümü yapmış
   * olmayı gerektirir; listeye eklemeden şemaya yazmak KIRMIZIDIR.
   */
  const TUR_BEYANLARI = new Map<string, string>([
    ["Station.type: StationType", "istasyonun ÜRETİM rolü — bir istasyon aynı anda iki rota adımı türü olamaz"],
    ["Station.kind: StationKind", "istasyonun YETENEK ekseni (kalite istasyonu vb.); `type` ile boğaz-ikiz, ikisi birlikte değişir"],
    ["PeripheralDevice.kind: PeripheralKind", "donanım türü — bir yazıcı aynı anda barkod okuyucu DEĞİLDİR"],
    ["PeripheralDevice.connectionType: ConnectionType", "fiziksel bağlantı — tek kablo tek yol"],
    ["PeripheralDevice.mediaType: PrinterMediaType", "yüklü medya — aynı anda tek rulo takılı"],
    ["Item.itemType: ItemType", "malzeme sınıfı — ham/yarı mamul/mamul aynı anda olunmaz"],
    ["FabricProperty.valueType: FabricPropertyValueType", "değerin BİÇİMİ (metin/sayı/liste), nesnenin rolü değil"],
    ["LabelTemplate.kind: LabelKind", "şablonun bastığı belge türü"],
    ["Customer.type: CompanyType",
     "⚠️ BU VAKANIN KENDİSİ — artık TÜRETİLMİŞ alandır (üç rol bayrağı tek kaynak, `resolveCompanyType`) ve kaldırma fazında düşecek (IS-ORTAGI-ROL-MODELI.md §7.2)"],
  ]);
  const beyansizTur = turEksenleri.filter((t) => !TUR_BEYANLARI.has(t));
  const oluTurBeyani = [...TUR_BEYANLARI.keys()].filter((k) => !turEksenleri.includes(k));

  // ⚠️ ÇAPA BELGESİ OLMADAN BU KOL ÖLÇÜLEMEZ: beyanların dayandığı kural
  // metni silinirse liste "ne olduğu bilinmeyen satırlar"a döner ve kol
  // kuralsız bir allowlist'i onaylamış olur.
  const capaVar = fs.existsSync(CAPA_BELGESI) && /\[MV-01\]/.test(fs.readFileSync(CAPA_BELGESI, "utf-8"));
  if (!capaVar) {
    kollar.set("③", "olculemedi");
    ATLAMA.atla("③ tek seçimli tür ekseni",
      "ÖLÇÜLEMEDİ: `docs/standart/MASTER-VERI-TASARIMI.md` [MV-01] çapası YOK — beyanların dayanağı okunamıyor", 3);
  } else {
    kollar.set("③", beyansizTur.length === 0 && oluTurBeyani.length === 0 ? "uyumlu" : "ihlal");
    check("③a master modeldeki HER tür ekseni BEYANLI", beyansizTur.length === 0,
      beyansizTur.join(" · ") || `${turEksenleri.length} eksen, hepsi beyanlı`);
    check("③b ÖLÜ tür beyanı yok (listede olup şemada olmayan)", oluTurBeyani.length === 0,
      oluTurBeyani.join(" · ") || "temiz");
    check("③z körlük zemini: çapa belgesi okunuyor ve tür ekseni BULUNUYOR",
      turEksenleri.length > 0, `${turEksenleri.length} eksen · ${modeller.filter((m) => m.master).length} master model`);
  }

  // ── HÜKÜM ────────────────────────────────────────────────────────────────
  const ihlal = [...kollar].filter(([, v]) => v === "ihlal").map(([k]) => k);
  const olculemedi = [...kollar].filter(([, v]) => v === "olculemedi").map(([k]) => k);
  console.log(`\n${"═".repeat(64)}`);
  if (ihlal.length > 0) console.log(`MASTER VERİ KİMLİĞİ: İHLAL — kol(lar): ${ihlal.join(", ")}`);
  else if (olculemedi.length > 0) console.log(`MASTER VERİ KİMLİĞİ: ÖLÇÜLEMEDİ — açık kol(lar): ${olculemedi.join(", ")} (diğerleri uyumlu)`);
  else console.log("MASTER VERİ KİMLİĞİ: TEMİZ — üç kol da uyumlu");
  if (fixtureMi) console.log("⚠️ §1'in hükmü FIXTURE hedefe aittir; saha kararı kurulum kopyasında koşularak verilir.");
  console.log("═".repeat(64));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
}

main()
  .catch((e) => { console.error("\n💥 ÇÖKTÜ:", e); fail++; })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
    process.exit(fail > 0 ? 1 : 0);
  });
