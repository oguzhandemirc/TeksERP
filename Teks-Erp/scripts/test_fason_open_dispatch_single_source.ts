// =============================================================================
// FASON "AÇIK + OUTSTANDING SEVK" TEK-KAYNAK BEKÇİSİ
//
// ── NEDEN DOĞDU (2026-08-21 denetim bulgusu, SESSİZ yanlış liste) ────────────
// Bir fason sevkin hâlâ "mal dışarıda" sayılması DÖRT koşulun birlikte
// sağlanmasıdır:
//     cancelledAt: null · directShippedAt: null ·
//     items.some: { remainderClosedAt: null,
//                   receiptItems: { none: { isPartial: false,
//                                           receipt: { cancelledAt: null } } } }
// Bu koşulun `src/` içinde 22 ELLE YAZILMIŞ kopyası vardı ve DÖRDÜ eksikti
// (`directShippedAt` ve/veya `receipt.cancelledAt` süzgeci yok):
//     workorder.service (liste süzgeci + WO iptali) · traveler-card.service ·
//     workorder-fason-quick.service
// İki sessiz yanlış üretiyorlardı:
//   • Kabul iptali (LIFO) sonrası yeniden outstanding olmuş sevk "KAPALI"
//     sanılıyordu → WO fason-sevk listesinde gizlenmiyor, kart uyarı vermiyor,
//     hızlı-fason önizlemesi grubu göstermiyordu.
//   • Tam doğrudan-sevk (DSK) sonrası sevk sonsuza dek "AÇIK" sanılıyordu →
//     WO listeden gizli kalıyor, iptalde boşuna `cancelBulk`'a veriliyordu.
//
// Koşul artık TEK KAYNAKTA: `src/services/helpers/fason-open-dispatch.helper.ts`
// (`OPEN_OUTSTANDING` / `OUTSTANDING_ITEM` / `outstandingItemOfOpenDispatch`).
// Bu bekçi, kopyanın GERİ GELMESİNİ derleme değil GELİŞTİRME anında yakalar.
//
// ── İKİ KONTROL ──────────────────────────────────────────────────────────────
//   A) KOPYA ZİNCİRİ — herhangi bir nesne literalinde
//      `receiptItems` → `none` → `isPartial` zinciri geçiyorsa İHLAL.
//      Tek muaf dosya helper'ın kendisidir ve muafiyet İKİ YÖNLÜDÜR: helper'da
//      kalıp BULUNAMAZSA da test düşer (tek kaynak boşaldı → kimse görmez).
//   B) ELLE YENİDEN YAZIM — `directShippedAt` süzgeci düşmüş sevk where'i.
//      (A) kopyayı, (B) "kısaltılmış" yeniden yazımı yakalar; ikisi ayrı arıza
//      modudur (2026-08-21 bulgusunda ikisi de vardı).
//      MODEL AYIRICI `remainderClosedAt`: bu kolon YALNIZ
//      `SubcontractorDispatchItem`'da vardır. Onsuz bir "cancelledAt + items.some"
//      kalıbı `SubcontractorReceipt`, `KartelaDispatch` ya da "bu adımda hiç sevk
//      yapıldı mı" (geri-alma guard'ı — orada doğrudan-sevk edilmiş sevk de
//      SAYILMALIDIR) sorgusu olabilir; ayırıcı olmadan bekçi dört yanlış pozitif
//      üretiyordu ve düzeltmeleri gerçek bir davranış değişikliği olurdu.
//      İki alt kural:
//        B1 sevk-düzeyi : `cancelledAt` + `items.some.remainderClosedAt` var,
//                         `directShippedAt` YOK.
//        B2 kalem-düzeyi: `remainderClosedAt` + `dispatch: { cancelledAt … }` var,
//                         `dispatch.directShippedAt` YOK.
//      Nesne (ya da alt ağacı) `OPEN_OUTSTANDING` / `OUTSTANDING_ITEM` /
//      `outstandingItemOfOpenDispatch` referansı taşıyorsa TEMİZDİR.
//
// Tarama TypeScript AST ile yapılır (regex değil): TS yorumlarındaki örnekler
// ve string içindeki metinler sayılmaz.
//
// DB'siz, salt-okunur, hızlı. Koşum:
//   npx tsx scripts/test_fason_open_dispatch_single_source.ts
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const KOK = path.resolve(__dirname, "..");
const TARANAN_DIZIN = "src";

/** Koşulun TEK KAYNAĞI — (A) kontrolünün yegâne muafı. */
const MUAF_DOSYA = "src/services/helpers/fason-open-dispatch.helper.ts";

/** Nesneyi (B) kontrolünden çıkaran semboller — tek kaynağı kullanan kod temizdir. */
const TEK_KAYNAK_SEMBOLLER = new Set([
  "OPEN_OUTSTANDING",
  "OUTSTANDING_ITEM",
  "outstandingItemOfOpenDispatch",
]);

// Tarayıcının gerçekten "bir şeye baktığını" doğrulayan zeminler. Bir refactor
// (dizin taşınması / şema bölünmesi) tarayıcıyı boşa düşürürse aşağıdaki
// kontroller SIFIR kod üzerinde vakumen yeşil kalırdı. Değerler bugünkü
// gerçeğin (~240 dosya, ~10 bin nesne literali) çok altında; amaç eşik
// tutturmak değil "hiç bakmıyor" halini yakalamak.
const ASGARI_DOSYA = 80;
const ASGARI_NESNE = 2000;

type Bulgu = {
  dosya: string;
  satir: number;
  metin: string;
};

type TaramaSonucu = {
  /** (A) `receiptItems → none → isPartial` zinciri geçen yerler. */
  kopyalar: Bulgu[];
  /** (B) dispatch-benzeri where'de `directShippedAt` eksik. */
  eksikDsk: Bulgu[];
  /** Taranan nesne literali sayısı (körlük zemini). */
  nesneSayisi: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// AST yardımcıları
// ─────────────────────────────────────────────────────────────────────────────

/** Özelliğin değeri LİTERAL `null` mı (ör. `remainderClosedAt: null`)? */
function ozellikNull(obj: ts.ObjectLiteralExpression, ad: string): boolean {
  const deger = ozellik(obj, ad);
  return deger !== null && deger.kind === ts.SyntaxKind.NullKeyword;
}

/** `x as const`, `(x)`, `x satisfies T` sarmalarını soyar. */
function soy(node: ts.Expression): ts.Expression {
  let n = node;
  for (;;) {
    if (ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isParenthesizedExpression(n)) {
      n = n.expression;
      continue;
    }
    return n;
  }
}

/** Nesne literalinde verilen adlı property'nin değeri (yoksa null). */
function ozellik(obj: ts.ObjectLiteralExpression, ad: string): ts.Expression | null {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const ad2 = ts.isIdentifier(p.name)
      ? p.name.text
      : ts.isStringLiteral(p.name)
        ? p.name.text
        : null;
    if (ad2 === ad) return soy(p.initializer);
  }
  return null;
}

/** Nesne literalinde verilen adlı property VAR MI (değerine bakmadan)? */
function ozellikVar(obj: ts.ObjectLiteralExpression, ad: string): boolean {
  return ozellik(obj, ad) !== null;
}

/** Alt ağaçta tek-kaynak sembollerinden biri geçiyor mu? */
function tekKaynakKullaniyor(node: ts.Node): boolean {
  let bulundu = false;
  const gez = (n: ts.Node): void => {
    if (bulundu) return;
    if (ts.isIdentifier(n) && TEK_KAYNAK_SEMBOLLER.has(n.text)) {
      bulundu = true;
      return;
    }
    ts.forEachChild(n, gez);
  };
  gez(node);
  return bulundu;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tek dosyayı tara. Kaynak metin DIŞARIDAN verilir → öz-sınama aynı fonksiyonu
// sentetik kaynakla çalıştırabilir.
// ─────────────────────────────────────────────────────────────────────────────
function dosyaTara(goreliAd: string, kaynak: string): TaramaSonucu {
  const sf = ts.createSourceFile(goreliAd, kaynak, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const kopyalar: Bulgu[] = [];
  const eksikDsk: Bulgu[] = [];
  let nesneSayisi = 0;

  const bulguYap = (node: ts.Node): Bulgu => {
    const satir = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const baslangic = sf.getPositionOfLineAndCharacter(satir - 1, 0);
    let son = kaynak.indexOf("\n", baslangic);
    if (son === -1) son = kaynak.length;
    return { dosya: goreliAd, satir, metin: kaynak.slice(baslangic, son).trim() };
  };

  const gez = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      nesneSayisi++;

      // (A) `receiptItems: { none: { isPartial: ... } }`
      const receiptItems = ozellik(node, "receiptItems");
      if (receiptItems && ts.isObjectLiteralExpression(receiptItems)) {
        const none = ozellik(receiptItems, "none");
        if (none && ts.isObjectLiteralExpression(none) && ozellikVar(none, "isPartial")) {
          kopyalar.push(bulguYap(node));
        }
      }

      // ⚠️ `remainderClosedAt: { not: null }` KAPANMIŞ kalem aramasıdır (kalan
      // kapamasının GERİ ALINMASI); outstanding yüklemi değildir ve doğrudan-sevk
      // süzgeci ORADA YANLIŞ OLUR (damgalı sevkte meşru kapama geri alınamazdı).
      // Bu yüzden B kuralı yalnız `remainderClosedAt: null` yazımını arar.
      // (B1) sevk-düzeyi: `cancelledAt` + `items.some.remainderClosedAt`,
      //      `directShippedAt` YOK.
      if (ozellikVar(node, "cancelledAt") && !ozellikVar(node, "directShippedAt")) {
        const items = ozellik(node, "items");
        const some = items && ts.isObjectLiteralExpression(items) ? ozellik(items, "some") : null;
        if (
          some &&
          ts.isObjectLiteralExpression(some) &&
          ozellikNull(some, "remainderClosedAt") &&
          !tekKaynakKullaniyor(node)
        ) {
          eksikDsk.push(bulguYap(node));
        }
      }

      // (B2) kalem-düzeyi: `remainderClosedAt` + `dispatch: { cancelledAt … }`,
      //      `dispatch.directShippedAt` YOK.
      if (ozellikNull(node, "remainderClosedAt")) {
        const dispatch = ozellik(node, "dispatch");
        if (
          dispatch &&
          ts.isObjectLiteralExpression(dispatch) &&
          ozellikVar(dispatch, "cancelledAt") &&
          !ozellikVar(dispatch, "directShippedAt") &&
          !tekKaynakKullaniyor(node)
        ) {
          eksikDsk.push(bulguYap(node));
        }
      }
    }
    ts.forEachChild(node, gez);
  };
  ts.forEachChild(sf, gez);

  return { kopyalar, eksikDsk, nesneSayisi };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) ÖZ-SINAMA (POZİTİF KONTROL) — tarayıcı gerçekten kırmızı verebiliyor mu?
//    Bekçinin en tehlikeli hali "hiçbir şey bulamayan bekçi"dir.
// ─────────────────────────────────────────────────────────────────────────────
function ozSinama(): void {
  console.log("\n── 1) Öz-sınama (tarayıcı doğru mu?) ──");

  const vakalar: Array<{
    ad: string;
    kaynak: string;
    kopya: number;
    eksik: number;
  }> = [
    {
      ad: "TEMİZ — tek kaynağı spread eden where",
      kaynak: `const w = { workOrderId, ...OPEN_OUTSTANDING };
const v = { rollId, ...outstandingItemOfOpenDispatch({ stepId }) };`,
      kopya: 0,
      eksik: 0,
    },
    {
      ad: "KOPYA — elle yazılmış receiptItems→none→isPartial zinciri YAKALANIR",
      kaynak: `const w = {
  cancelledAt: null,
  directShippedAt: null,
  items: { some: { remainderClosedAt: null, receiptItems: { none: { isPartial: false, receipt: { cancelledAt: null } } } } },
};`,
      kopya: 1,
      eksik: 0,
    },
    {
      ad: "B-negatif — KAPANMIŞ kalem araması (`remainderClosedAt: { not: null }`) YAKALANMAZ",
      kaynak: `const w = { rollId, remainderClosedAt: { not: null }, dispatch: { stepId, cancelledAt: null } };`,
      kopya: 0,
      eksik: 0,
    },
    {
      ad: "B1 — cancelledAt + items.some.remainderClosedAt, directShippedAt YOK → YAKALANIR",
      kaynak: `const w = { workOrderId, cancelledAt: null, items: { some: { remainderClosedAt: null } } };`,
      kopya: 0,
      eksik: 1,
    },
    {
      ad: "B2 — kalem-düzeyi dispatch.cancelledAt var, directShippedAt YOK → YAKALANIR",
      kaynak: `const w = { rollId, remainderClosedAt: null, dispatch: { stepId, cancelledAt: null } };`,
      kopya: 0,
      eksik: 1,
    },
    {
      ad: "MODEL AYIRICI — remainderClosedAt YOKSA sayılmaz (receipt/kartela/geri-alma guard'ı)",
      kaynak: `const a = { stepId, cancelledAt: null, items: { some: { rollId } } };
const b = { subcontractorId, cancelledAt: null, items: { some: { rollId, receiptItems: { none: {} } } } };`,
      kopya: 0,
      eksik: 0,
    },
    {
      ad: "YORUM/STRING İÇİ — sayılmaz (AST taraması, regex değil)",
      kaynak: `// receiptItems: { none: { isPartial: false } }
/* cancelledAt: null, items: { some: { remainderClosedAt: null } } */
const s = "receiptItems: { none: { isPartial: false } }";`,
      kopya: 0,
      eksik: 0,
    },
  ];

  for (const v of vakalar) {
    const s = dosyaTara("ozsinama.ts", v.kaynak);
    const ok = s.kopyalar.length === v.kopya && s.eksikDsk.length === v.eksik;
    check(
      v.ad,
      ok,
      ok ? "" : `kopya=${s.kopyalar.length}(bkl ${v.kopya}) eksik=${s.eksikDsk.length}(bkl ${v.eksik})`,
    );
  }

  // Muaf dosyanın ŞEKLİ de sınanır: içinde kalıp olan bir dosya (A)'yı tetikler,
  // muafiyet ise dosya adına göre uygulanır (aşağıdaki gerçek tarama).
  const muafSekli = dosyaTara(
    MUAF_DOSYA,
    `export const OUTSTANDING_ITEM = { remainderClosedAt: null, receiptItems: { none: { isPartial: false, receipt: { cancelledAt: null } } } };`,
  );
  check("MUAF ŞEKLİ — helper kalıbı tarayıcıya görünüyor", muafSekli.kopyalar.length === 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// (C) KALAN-KAPAMA DURUM BAYRAĞININ HAM SQL İKİZLERİ — ALLOWLIST
// ─────────────────────────────────────────────────────────────────────────────
// `remainderClosedAt` bir DURUM bayrağıdır ve "kalem kapandı mı" sorusunun ham SQL
// yazımları TEK TEK bilinmek zorundadır: Prisma tarafı helper'dan okur, ham SQL
// okumaz. Yeni bir ham SQL kopyası eklenirse (yeni rapor, yeni script) bu bekçi
// kırmızı verir — kopya yasak değil, GÖRÜNMEZ kopya yasak.
const REMAINDER_HAM_SQL_MUAF = new Set([
  "scripts/consistency-check-derived.sql",
  "src/services/helpers/subcontract-scorecard-query.helper.ts",
  "src/services/inventory.service.ts",
  "scripts/test_consistency_derived.ts",
  // Teşhis script'i (canlıda `--salt-okuma` ile koşar) — kural değil ÖLÇÜM yazar.
  "scripts/olcum_scorecard_kismi_dogrudan_sevk.ts",
]);

function remainderHamSqlTara(): { muaflarda: string[]; kacaklar: string[] } {
  const kokDizinler = ["src", "scripts"];
  const muaflarda: string[] = [];
  const kacaklar: string[] = [];
  const gez = (dizin: string): void => {
    for (const girdi of fs.readdirSync(dizin, { withFileTypes: true })) {
      const tam = path.join(dizin, girdi.name);
      if (girdi.isDirectory()) {
        gez(tam);
        continue;
      }
      if (!girdi.name.endsWith(".ts") && !girdi.name.endsWith(".sql")) continue;
      const rel = goreli(tam);
      const metin = fs.readFileSync(tam, "utf8");
      if (!/"remainderClosedAt"\s+IS/.test(metin)) continue;
      if (REMAINDER_HAM_SQL_MUAF.has(rel)) muaflarda.push(rel);
      else kacaklar.push(rel);
    }
  };
  for (const d of kokDizinler) gez(path.join(KOK, d));
  return { muaflarda, kacaklar };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) Gerçek tarama
// ─────────────────────────────────────────────────────────────────────────────
function tsDosyalari(dizin: string): string[] {
  const cikti: string[] = [];
  for (const girdi of fs.readdirSync(dizin, { withFileTypes: true })) {
    const tam = path.join(dizin, girdi.name);
    if (girdi.isDirectory()) cikti.push(...tsDosyalari(tam));
    else if (girdi.name.endsWith(".ts") && !girdi.name.endsWith(".d.ts")) cikti.push(tam);
  }
  return cikti.sort();
}

function goreli(mutlakYol: string): string {
  return path.relative(KOK, mutlakYol).split(path.sep).join("/");
}

function main(): void {
  ozSinama();

  console.log("\n── 2) Kaynak tarama ──");
  const mutlak = path.join(KOK, TARANAN_DIZIN);
  if (!fs.existsSync(mutlak)) {
    check(`taranacak dizin mevcut: ${TARANAN_DIZIN}`, false, "dizin YOK");
    ozet();
    return;
  }
  const dosyalar = tsDosyalari(mutlak);

  const kopyalar: Bulgu[] = [];
  const eksikDsk: Bulgu[] = [];
  let nesneSayisi = 0;
  let muafKalipSayisi = 0;
  let muafDosyaGoruldu = false;

  for (const dosya of dosyalar) {
    const ad = goreli(dosya);
    const s = dosyaTara(ad, fs.readFileSync(dosya, "utf8"));
    nesneSayisi += s.nesneSayisi;
    if (ad === MUAF_DOSYA) {
      muafDosyaGoruldu = true;
      muafKalipSayisi = s.kopyalar.length;
      // Muaf dosyada (B) de aranmaz: tanımın kendisi orada yaşar.
      continue;
    }
    kopyalar.push(...s.kopyalar);
    eksikDsk.push(...s.eksikDsk);
  }

  // Körlük zemini — "ihlal bulunamadı" ile "hiçbir şeye bakılmadı" aynı yeşile
  // çıkmasın.
  check(`körlük zemini: taranan dosya ≥ ${ASGARI_DOSYA}`, dosyalar.length >= ASGARI_DOSYA, `${dosyalar.length} dosya`);
  check(
    `körlük zemini: taranan nesne literali ≥ ${ASGARI_NESNE}`,
    nesneSayisi >= ASGARI_NESNE,
    `${nesneSayisi} nesne`,
  );

  // MUAFİYET İKİ YÖNLÜ — tek kaynak dosyası var mı ve kalıbı taşıyor mu?
  check(`tek kaynak dosyası mevcut: ${MUAF_DOSYA}`, muafDosyaGoruldu);
  check(
    "tek kaynak kalıbı TAŞIYOR (ölü muaf değil)",
    muafKalipSayisi >= 1,
    `${muafKalipSayisi} kalıp`,
  );

  if (kopyalar.length > 0) {
    console.log("\n  KOPYA ZİNCİRİ (receiptItems → none → isPartial):");
    for (const b of kopyalar) console.log(`    ${b.dosya}:${b.satir}  ${b.metin.slice(0, 110)}`);
  }
  check(
    "(A) koşulun elle yazılmış kopyası YOK",
    kopyalar.length === 0,
    kopyalar.length === 0 ? "" : `${kopyalar.length} kopya — helper'dan import et`,
  );

  if (eksikDsk.length > 0) {
    console.log("\n  EKSİK `directShippedAt` (dispatch-benzeri where):");
    for (const b of eksikDsk) console.log(`    ${b.dosya}:${b.satir}  ${b.metin.slice(0, 110)}`);
  }
  check(
    "(B) `directShippedAt` süzgeci düşmüş yeniden yazım YOK",
    eksikDsk.length === 0,
    eksikDsk.length === 0 ? "" : `${eksikDsk.length} yer`,
  );

  ozet();
}

function ozet(): void {
  remainderIkizKontrolu();

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

// (C) çağrıları — muafiyet İKİ YÖNLÜ: muaf dosya kalıbı kaybettiyse de kırmızı.
function remainderIkizKontrolu(): void {
  const { muaflarda, kacaklar } = remainderHamSqlTara();
  check(
    "(C) ham SQL `remainderClosedAt IS` yazımı yalnız bilinen dosyalarda",
    kacaklar.length === 0,
    kacaklar.length ? `KAÇAK: ${kacaklar.join(", ")}` : `${muaflarda.length} muaf dosyada`,
  );
  check(
    "(C) körlük zemini — muaf dosyalar kalıbı hâlâ taşıyor",
    muaflarda.length >= 3,
    `bulunan: ${muaflarda.join(", ") || "(yok)"}`,
  );
}

main();
