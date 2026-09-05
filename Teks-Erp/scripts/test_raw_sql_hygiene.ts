// =============================================================================
// HAM SQL SAAT HİJYENİ BEKÇİSİ — `$queryRaw`/`$executeRaw` içinde ÇIPLAK
// `NOW()` / `CURRENT_TIMESTAMP` var mı?
//
// ── NEDEN DOĞDU (2026-08-01 denetim bulgusu, SESSİZ veri bozulması) ──────────
// O gün şemadaki tarih kolonlarının neredeyse tamamı `timestamp WITHOUT time
// zone` idi. Prisma bu kolonlara HER ZAMAN UTC yazar; Postgres'in `NOW()` /
// `CURRENT_TIMESTAMP` fonksiyonu ise `timestamptz` üretir ve tz'siz bir kolona
// atanırken oturumun `TimeZone` ayarına (sahada `Europe/Istanbul`) göre YEREL
// saate düşürülür.
//
// Sonuç: AYNI KOLONDA iki farklı saat. Dev DB'de ölçüldü —
//   roll_movements.enteredAt max = 01:25  (Prisma yazdı, UTC)
//   roll_movements.exitedAt  max = 04:25  (raw NOW() yazdı, yerel, +3 saat)
// `AVG(EXTRACT(EPOCH FROM (exitedAt - enteredAt)))` ile hesaplanan istasyon
// süresi raw yolla kapanan her harekette +10800 sn şişti. Hata yok, log yok.
//
// ── BUGÜNKÜ GERÇEK — KUTUP DEĞİŞTİ, DİKKAT ──────────────────────────────────
// ⚠️ Yukarıdaki teşhis TARİHSELDİR. `20260801040000_timestamptz_conversion` ile
//    183 kolon `timestamptz` oldu (şemada 192 alan; tek istisna `@db.Date` olan
//    `EndpointLatencyDaily.day`). Bugün DURUM TERSİNE DÖNDÜ:
//
//      • ÇIPLAK `now()` / `CURRENT_TIMESTAMP` artık KOŞULSUZ DOĞRUDUR.
//        timestamptz mutlak an saklar; oturum saat dilimi yalnız gösterimi
//        etkiler. TERCİH EDİLEN YAZIM BUDUR.
//
//      • `(now() AT TIME ZONE 'UTC')` — eski "doğru kullanım" — bugün yalnız
//        KİMLİK DÖNÜŞÜMÜDÜR ve doğruluğu OTURUM SAAT DİLİMİNE bağlar:
//        `timestamptz → timestamp → timestamptz` turunda ikinci çevrim oturum
//        tz'sinde yorumlanır. UTC oturumda sapma 0 (ölçüldü), Istanbul
//        oturumunda −3 saat. Yani artık KIRILGAN OLAN TARAF BU. Yeni kod bunu
//        YAZMASIN; kalan 10 yazma noktası (`SET "exitedAt" = ...`) temizlenmeyi
//        bekleyen tarihsel artıktır.
//
//    Bu dosya yine de ÇIPLAK `NOW()`'ı işaretler ve gerekçe ister. Sebebi artık
//    "yanlış olabilir" değil, TUTARLILIK: her ham zaman fonksiyonu kullanımının
//    yanında hangi kolona yazdığının ve neden doğru olduğunun YAZILI olması.
//    Kolon tipini SQL metninden çıkaramayan bir bekçi için ulaşılabilir en iyi
//    garanti budur. Asıl yapısal güvence `test_timestamptz_contract.ts`tedir.
//
// ── KAPSAM ───────────────────────────────────────────────────────────────────
// `src/` altındaki tüm `.ts`. Tarama TypeScript AST ile yapılır (regex değil):
// yalnız ham SQL taşıyan şablon/argümanların İÇİ okunur. Bu sayede
//   • TS yorumlarındaki "NOW()" örnekleri sayılmaz,
//   • `${new Date(Date.now())}` gibi interpolasyonlar sayılmaz (SQL değil, TS),
//   • SQL yorumlarındaki (`--`, `/* */`) açıklamalar sayılmaz.
//
// KAPSAM DIŞI OLANLAR — sessiz boşluk kalmasın diye açıkça yazılıyor:
//   • `scripts/` — oradaki iki kullanım (`bench_audit_summary.ts`,
//     `scale_report.ts`) dev-only sentetik veri/analiz üretir, canlı iş verisine
//     yazmaz. Genişletmek istersen TARANAN_DIZINLER'e "scripts" ekle.
//   • `prisma/migrations/*.sql` — uygulanmış migration IMMUTABLE'dır (CLAUDE.md),
//     düzeltilemez. YENİ migration yazarken çıplak `now()` kullan (kolonlar
//     timestamptz).
//   • KOLON VARSAYILANLARI — artık RİSK DEĞİL. Eskiden ~90 tz'siz kolonun
//     `DEFAULT CURRENT_TIMESTAMP` değeri tetiklenirse YEREL saat yazardı; bu
//     yüzden "ham INSERT'te zaman kolonunu atlama" bir tuzaktı. timestamptz
//     dönüşümüyle o delik KAPANDI: default tetiklense de doğru mutlak anı yazar.
//
// ── MUAFİYET ─────────────────────────────────────────────────────────────────
// Hedef kolon `timestamptz` ise `NOW()` DOĞRUDUR — ki dönüşümden sonra bu artık
// İSTİSNA DEĞİL KURALDIR (bizim kolonlarımızın tamamı + pg katalog görünümleri,
// örn. `pg_stat_activity.query_start`). İşaret bir "kaçamak" değil, kararın
// yazıya dökülmesidir. SQL'in içine gerekçeli işaret koy — aynı satıra ya da
// hemen ÜSTÜNDEKİ salt-yorum bloğunun herhangi bir satırına:
//     -- tz-ok: <neden doğru olduğunun kısa gerekçesi>
// Gerekçesiz `-- tz-ok` KABUL EDİLMEZ (test düşer): muafiyet sessiz olmasın.
// Muafların TAMAMI her koşumda listelenir.
//
// ⚠️ SQL şablonu bir JS template literal'dır: içine yazdığın Türkçe açıklamada
// BACKTICK ve `${` KULLANMA — şablonu ortasından böler (tsc yakalar ama sebebi
// "Cannot find name 'timestamp'" gibi alakasız görünür).
//
// Salt-okunur: DB'ye hiç bağlanmaz, fixture yaratmaz, ortam verisine bağlı değil.
// Koşum: npx tsx scripts/test_raw_sql_hygiene.ts
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

let pass = 0,
  fail = 0,
  warn = 0;

function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}
function warnLine(msg: string): void {
  warn++;
  console.log(`⚠️  ${msg}`);
}

const KOK = path.resolve(__dirname, "..");
const TARANAN_DIZINLER = ["src"];

// ─────────────────────────────────────────────────────────────────────────────
// AYAR: ham SQL taşıyan tag'ler (etiketli şablon: tag`...SQL...`).
// Prisma'nın hepsi bu adlarla çağrılır; `Prisma.sql` / `sql` parça birleştirici.
// Yeni bir sarmalayıcı eklenirse buraya yaz — yoksa tarayıcı orayı GÖRMEZ.
// ─────────────────────────────────────────────────────────────────────────────
const SQL_ETIKETLERI = new Set([
  "$queryRaw",
  "$executeRaw",
  "$queryRawTyped",
  "sql",
  "join", // Prisma.join(...) parça birleştirici — şablon olarak da kullanılabilir
]);

// AYAR: ham SQL'i STRING ARGÜMAN olarak alan çağrılar (etiketli şablon değil).
const SQL_FONKSIYONLARI = new Set([
  "$queryRawUnsafe",
  "$executeRawUnsafe",
  "raw", // Prisma.raw("...")
]);

// Tarayıcının gerçekten "bir şeye baktığını" doğrulayan zeminler. Bir refactor
// (dizin taşınması, sarmalayıcı yeniden adlandırması) tarayıcıyı boşa düşürürse
// aşağıdaki kontrollerin hepsi SIFIR kod üzerinde vakumen yeşil kalırdı.
// Değerler bugünkü gerçeğin (~230 dosya, ~90 SQL bölgesi) çok altında; amaç
// eşik tutturmak değil, "hiç bakmıyor" halini yakalamak.
const ASGARI_DOSYA = 80;
const ASGARI_SQL_BOLGESI = 40;

/** Yasak/şüpheli zaman fonksiyonları — hepsi `timestamptz` (ya da yerel) üretir. */
const ZAMAN_TOKEN_RE =
  /\bnow\s*\(\s*\)|\bcurrent_timestamp\b|\blocaltimestamp\b|\blocaltime\b|\bcurrent_date\b|\bcurrent_time\b|\btransaction_timestamp\s*\(\s*\)|\bstatement_timestamp\s*\(\s*\)|\bclock_timestamp\s*\(\s*\)/gi;

/** Token'ın hemen ardından gelen açık dönüşüm: `AT TIME ZONE 'UTC'`. */
const AT_TIME_ZONE_RE = /^\s*AT\s+TIME\s+ZONE\s+('([^']*)'|"([^"]*)"|(\w+))/i;

/** SQL yorumundaki muafiyet işareti: `-- tz-ok: gerekçe` */
const MUAF_RE = /tz-ok\s*:?([^\n]*)/i;

type Bulgu = {
  dosya: string; // repo köküne göreli
  satir: number;
  token: string;
  satirMetni: string;
};

type MuafKayit = Bulgu & { gerekce: string };

type TaramaSonucu = {
  ihlaller: Bulgu[];
  muaflar: MuafKayit[];
  gerekcesizMuaflar: Bulgu[];
  aciklamali: Bulgu[]; // `AT TIME ZONE '<UTC olmayan>'` — bilinçli ama dikkat
  utcDuzeltmeSayisi: number; // `AT TIME ZONE 'UTC'` kullanımları
  bolgeSayisi: number; // bulunan ham SQL parçası sayısı
};

// ─────────────────────────────────────────────────────────────────────────────
// 1) AST → ham SQL bölgeleri
//    Bölge = kaynak metindeki [start, end) aralığı. Konumları KORUYORUZ ki
//    bulguların satır numarası gerçek dosya satırıyla birebir aynı olsun.
// ─────────────────────────────────────────────────────────────────────────────
type Bolge = { start: number; end: number };

function sablonBolgeleri(sf: ts.SourceFile, t: ts.Node, cikti: Bolge[]): void {
  // `\`...\`` — tek parça
  if (ts.isNoSubstitutionTemplateLiteral(t) || ts.isStringLiteral(t)) {
    cikti.push({ start: t.getStart(sf) + 1, end: t.getEnd() - 1 });
    return;
  }
  // `\`... ${x} ...\`` — head + her span'in literal'i.
  // Konum aritmetiği: head/middle `${` ile biter (2 karakter), tail backtick ile
  // (1). Baştaki backtick/`}` her zaman 1 karakter. `${...}` aralıkları BİLEREK
  // dışarıda bırakılır — orası TS ifadesi, SQL değil (`Date.now()` yanılması).
  if (ts.isTemplateExpression(t)) {
    cikti.push({ start: t.head.getStart(sf) + 1, end: t.head.getEnd() - 2 });
    for (const span of t.templateSpans) {
      const lit = span.literal;
      const kuyrukMu = lit.kind === ts.SyntaxKind.TemplateTail;
      cikti.push({ start: lit.getStart(sf) + 1, end: lit.getEnd() - (kuyrukMu ? 1 : 2) });
    }
  }
}

/** Çağrı/etiket adını çözer: `tx.$executeRaw` → "$executeRaw", `sql` → "sql". */
function tagAdi(ifade: ts.Expression): string | null {
  if (ts.isIdentifier(ifade)) return ifade.text;
  if (ts.isPropertyAccessExpression(ifade)) return ifade.name.text;
  return null;
}

function sqlBolgeleri(sf: ts.SourceFile): Bolge[] {
  const cikti: Bolge[] = [];
  const gez = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node)) {
      const ad = tagAdi(node.tag);
      if (ad && SQL_ETIKETLERI.has(ad)) sablonBolgeleri(sf, node.template, cikti);
    } else if (ts.isCallExpression(node)) {
      const ad = tagAdi(node.expression);
      if (ad && SQL_FONKSIYONLARI.has(ad)) {
        for (const arg of node.arguments) sablonBolgeleri(sf, arg, cikti);
      }
    }
    ts.forEachChild(node, gez);
  };
  ts.forEachChild(sf, gez);
  return cikti;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) Maskeleme — SQL dışında kalan HER ŞEY boşluğa çevrilir, satır sonları
//    korunur. Böylece offset'ler değişmez ve satır numarası doğru kalır.
// ─────────────────────────────────────────────────────────────────────────────
function maskele(kaynak: string, bolgeler: Bolge[]): string {
  const buf: string[] = new Array<string>(kaynak.length);
  for (let i = 0; i < kaynak.length; i++) {
    const c = kaynak[i]!;
    buf[i] = c === "\n" || c === "\r" ? c : " ";
  }
  for (const b of bolgeler) {
    const son = Math.min(b.end, kaynak.length);
    for (let i = Math.max(0, b.start); i < son; i++) buf[i] = kaynak[i]!;
  }
  return buf.join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) SQL yorumlarını ayıkla + `-- tz-ok` işaretlerini topla.
//
//    Yorumlar TARAMA DIŞI kalmalı: düzeltmelerin yanına yazdığımız Türkçe
//    açıklamalar ("çıplak NOW() yerel saat yazar") aksi halde ihlal sanılırdı.
//    Tek tırnaklı diziler de atlanır (içindeki `--` yorum değildir). Dizi
//    durumu satır sonunda SIFIRLANIR: kaynakta tek başına kalmış bir tırnak
//    (`${x}'` deseninin maskelenmiş yarısı) tüm dosyayı yutmasın.
// ─────────────────────────────────────────────────────────────────────────────
type YorumKaydi = { pos: number; metin: string };

function yorumlariAyikla(metin: string): { temiz: string; yorumlar: YorumKaydi[] } {
  const buf = metin.split("");
  const yorumlar: YorumKaydi[] = [];
  let i = 0;
  let diziIcinde = false;

  const bosalt = (bas: number, son: number): void => {
    for (let k = bas; k < son; k++) if (buf[k] !== "\n" && buf[k] !== "\r") buf[k] = " ";
  };

  while (i < metin.length) {
    const c = metin[i]!;
    if (c === "\n") {
      diziIcinde = false;
      i++;
      continue;
    }
    if (diziIcinde) {
      if (c === "'") diziIcinde = metin[i + 1] === "'" ? ((i += 1), true) : false;
      i++;
      continue;
    }
    if (c === "'") {
      diziIcinde = true;
      i++;
      continue;
    }
    if (c === "-" && metin[i + 1] === "-") {
      let son = metin.indexOf("\n", i);
      if (son === -1) son = metin.length;
      yorumlar.push({ pos: i, metin: metin.slice(i + 2, son) });
      bosalt(i, son);
      i = son;
      continue;
    }
    if (c === "/" && metin[i + 1] === "*") {
      // PG blok yorumları İÇ İÇE geçebilir — derinlik say.
      let derinlik = 1;
      let j = i + 2;
      while (j < metin.length && derinlik > 0) {
        if (metin[j] === "/" && metin[j + 1] === "*") {
          derinlik++;
          j += 2;
        } else if (metin[j] === "*" && metin[j + 1] === "/") {
          derinlik--;
          j += 2;
        } else j++;
      }
      yorumlar.push({ pos: i, metin: metin.slice(i + 2, Math.max(i + 2, j - 2)) });
      bosalt(i, j);
      i = j;
      continue;
    }
    i++;
  }
  return { temiz: buf.join(""), yorumlar };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) Tek dosyayı tara. Kaynak metin DIŞARIDAN verilir → öz-sınama (aşağıda)
//    aynı fonksiyonu sentetik kaynakla çalıştırabilir.
// ─────────────────────────────────────────────────────────────────────────────
function dosyaTara(goreliAd: string, kaynak: string): TaramaSonucu {
  const sf = ts.createSourceFile(goreliAd, kaynak, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const bolgeler = sqlBolgeleri(sf);
  const maskeli = maskele(kaynak, bolgeler);
  const { temiz, yorumlar } = yorumlariAyikla(maskeli);

  const satirNo = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const satirMetni = (pos: number): string => {
    const l = sf.getLineAndCharacterOfPosition(pos).line;
    const baslangic = sf.getPositionOfLineAndCharacter(l, 0);
    let son = kaynak.indexOf("\n", baslangic);
    if (son === -1) son = kaynak.length;
    return kaynak.slice(baslangic, son).trim();
  };

  // `-- tz-ok: gerekçe` işaretleri → satır → gerekçe.
  const muafSatirlar = new Map<number, string>();
  const gerekcesizSatirlar = new Set<number>();
  const yorumSatirlari = new Set<number>();
  for (const y of yorumlar) {
    const satir = satirNo(y.pos);
    yorumSatirlari.add(satir);
    const m = MUAF_RE.exec(y.metin);
    if (!m) continue;
    const gerekce = (m[1] ?? "").trim();
    if (gerekce.length === 0) gerekcesizSatirlar.add(satir);
    else muafSatirlar.set(satir, gerekce);
  }

  // Ayıklanmış metinde SALT-YORUM satırları tamamen boşalmış olur — muafiyet
  // araması yukarı doğru YALNIZ bu satırlar boyunca yürür. Böylece işaret ister
  // ihlalin sonuna, ister hemen üstündeki çok satırlı açıklama bloğunun
  // herhangi bir satırına yazılabilir; ama iki ayrı SQL ifadesi arasından
  // "sızarak" beklenmedik bir satırı muaf kılamaz.
  const temizSatirlari = temiz.split("\n");
  const saltYorumSatiri = (satir: number): boolean =>
    yorumSatirlari.has(satir) && (temizSatirlari[satir - 1] ?? "").trim() === "";

  /** Verilen ihlal satırı için geçerli muafiyeti bulur. */
  const muafiyetAra = (satir: number): { gerekce: string } | "gerekcesiz" | null => {
    const kendi = muafSatirlar.get(satir);
    if (kendi) return { gerekce: kendi };
    if (gerekcesizSatirlar.has(satir)) return "gerekcesiz";
    for (let l = satir - 1; l >= 1 && saltYorumSatiri(l); l--) {
      const g = muafSatirlar.get(l);
      if (g) return { gerekce: g };
      if (gerekcesizSatirlar.has(l)) return "gerekcesiz";
    }
    return null;
  };

  const ihlaller: Bulgu[] = [];
  const muaflar: MuafKayit[] = [];
  const gerekcesizMuaflar: Bulgu[] = [];
  const aciklamali: Bulgu[] = [];
  let utcDuzeltmeSayisi = 0;

  ZAMAN_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ZAMAN_TOKEN_RE.exec(temiz)) !== null) {
    const pos = m.index;
    const satir = satirNo(pos);
    const bulgu: Bulgu = { dosya: goreliAd, satir, token: m[0], satirMetni: satirMetni(pos) };

    // (a) Açık dönüşüm var mı? `now() AT TIME ZONE 'UTC'` → TARİHSEL yazım.
    //     Bugün kimlik dönüşümü (kolonlar timestamptz) — yanlış değil ama
    //     doğruluğu oturum tz'sine bağlıyor. Yeni kod çıplak now() yazmalı.
    const kalan = temiz.slice(pos + m[0].length);
    const tz = AT_TIME_ZONE_RE.exec(kalan);
    if (tz) {
      const zone = (tz[2] ?? tz[3] ?? tz[4] ?? "").toUpperCase();
      if (zone === "UTC") utcDuzeltmeSayisi++;
      else aciklamali.push(bulgu);
      continue;
    }

    // (b) Gerekçeli muafiyet (aynı satır ya da üstteki salt-yorum bloğu).
    const muafiyet = muafiyetAra(satir);
    if (muafiyet === "gerekcesiz") {
      gerekcesizMuaflar.push(bulgu);
      continue;
    }
    if (muafiyet) {
      muaflar.push({ ...bulgu, gerekce: muafiyet.gerekce });
      continue;
    }

    ihlaller.push(bulgu);
  }

  return {
    ihlaller,
    muaflar,
    gerekcesizMuaflar,
    aciklamali,
    utcDuzeltmeSayisi,
    bolgeSayisi: bolgeler.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5) Öz-sınama (POZİTİF KONTROL) — tarayıcı gerçekten kırmızı verebiliyor mu?
//    Bekçinin en tehlikeli hali "hiçbir şey bulamayan bekçi"dir; bu blok her
//    koşumda tarayıcıyı bilinen girdilerle sınar.
// ─────────────────────────────────────────────────────────────────────────────
function ozSinama(): void {
  console.log("\n── 1) Öz-sınama (tarayıcı doğru mu?) ──");

  const vakalar: Array<{ ad: string; kaynak: string; beklenenIhlal: number; ekBeklenti?: (s: TaramaSonucu) => boolean }> = [
    {
      ad: "çıplak NOW() → YAKALANIR",
      kaynak: 'await tx.$executeRaw`UPDATE t SET "exitedAt" = NOW() WHERE id = 1`;',
      beklenenIhlal: 1,
    },
    {
      ad: "çıplak CURRENT_TIMESTAMP → YAKALANIR",
      kaynak: 'await prisma.$queryRaw`SELECT * FROM t WHERE a < CURRENT_TIMESTAMP`;',
      beklenenIhlal: 1,
    },
    {
      ad: "now() AT TIME ZONE 'UTC' → TEMİZ",
      kaynak: "await tx.$executeRaw`UPDATE t SET x = (now() AT TIME ZONE 'UTC')`;",
      beklenenIhlal: 0,
      ekBeklenti: (s) => s.utcDuzeltmeSayisi === 1,
    },
    {
      ad: "SQL yorumundaki NOW() → TEMİZ (düzeltme açıklamaları ihlal sayılmaz)",
      kaynak:
        "await tx.$executeRaw`\n  -- çıplak NOW() yerel saat yazar, kullanma\n  UPDATE t SET x = (now() AT TIME ZONE 'UTC')`;",
      beklenenIhlal: 0,
    },
    {
      ad: "${} içindeki Date.now() → TEMİZ (TS ifadesi, SQL değil)",
      kaynak: "await tx.$executeRaw`UPDATE t SET x = ${new Date(Date.now())} WHERE id = 1`;",
      beklenenIhlal: 0,
    },
    {
      ad: "TS yorumundaki NOW() → TEMİZ (ham SQL bölgesi değil)",
      kaynak: "// eskiden NOW() kullanılırdı\nconst x = 1;",
      beklenenIhlal: 0,
    },
    {
      ad: "gerekçeli `-- tz-ok:` → MUAF (ihlal değil, listelenir)",
      kaynak:
        'await prisma.$queryRaw`SELECT now() - query_start FROM pg_stat_activity -- tz-ok: kolon timestamptz`;',
      beklenenIhlal: 0,
      ekBeklenti: (s) => s.muaflar.length === 1,
    },
    {
      ad: "gerekçesiz `-- tz-ok` → SESSİZ MUAFİYET YOK (ayrı listede, test düşer)",
      kaynak: "await prisma.$queryRaw`SELECT NOW() -- tz-ok`;",
      beklenenIhlal: 0,
      ekBeklenti: (s) => s.gerekcesizMuaflar.length === 1,
    },
    {
      ad: "çok satırlı yorum bloğunun ÜST satırındaki `-- tz-ok:` → MUAF",
      kaynak:
        "await prisma.$queryRaw`\n  -- tz-ok: kolon timestamptz\n  -- (ikinci açıklama satırı)\n  SELECT NOW() - query_start FROM pg_stat_activity`;",
      beklenenIhlal: 0,
      ekBeklenti: (s) => s.muaflar.length === 1,
    },
    {
      ad: "muafiyet SQL SATIRINI AŞMAZ (araya kod girerse sızmaz)",
      kaynak:
        "await prisma.$queryRaw`\n  -- tz-ok: kolon timestamptz\n  SELECT 1\n  UNION SELECT extract(epoch FROM NOW())`;",
      beklenenIhlal: 1,
    },
    {
      ad: "ham SQL taşımayan şablon → TEMİZ (yalnız SQL etiketleri taranır)",
      kaynak: "const q = `SELECT NOW()`;",
      beklenenIhlal: 0,
      ekBeklenti: (s) => s.bolgeSayisi === 0,
    },
    {
      ad: "$queryRawUnsafe string argümanı → TARANIR",
      kaynak: 'await prisma.$queryRawUnsafe("SELECT NOW()");',
      beklenenIhlal: 1,
    },
  ];

  for (const v of vakalar) {
    const s = dosyaTara("ozsinama.ts", v.kaynak);
    const ok = s.ihlaller.length === v.beklenenIhlal && (v.ekBeklenti ? v.ekBeklenti(s) : true);
    check(v.ad, ok, ok ? "" : `ihlal=${s.ihlaller.length} (beklenen ${v.beklenenIhlal})`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6) Gerçek tarama
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
  const dosyalar: string[] = [];
  for (const d of TARANAN_DIZINLER) {
    const mutlak = path.join(KOK, d);
    if (!fs.existsSync(mutlak)) {
      check(`taranacak dizin mevcut: ${d}`, false, "dizin YOK — TARANAN_DIZINLER'i güncelle");
      continue;
    }
    dosyalar.push(...tsDosyalari(mutlak));
  }

  const ihlaller: Bulgu[] = [];
  const muaflar: MuafKayit[] = [];
  const gerekcesizMuaflar: Bulgu[] = [];
  const aciklamali: Bulgu[] = [];
  let bolgeSayisi = 0;
  let utcDuzeltmeSayisi = 0;

  for (const dosya of dosyalar) {
    const s = dosyaTara(goreli(dosya), fs.readFileSync(dosya, "utf8"));
    ihlaller.push(...s.ihlaller);
    muaflar.push(...s.muaflar);
    gerekcesizMuaflar.push(...s.gerekcesizMuaflar);
    aciklamali.push(...s.aciklamali);
    bolgeSayisi += s.bolgeSayisi;
    utcDuzeltmeSayisi += s.utcDuzeltmeSayisi;
  }

  check(
    "taranacak dosyalar bulundu",
    dosyalar.length >= ASGARI_DOSYA,
    `${dosyalar.length} dosya (asgari ${ASGARI_DOSYA})`,
  );
  check(
    "ham SQL bölgeleri ayrıştırıldı",
    bolgeSayisi >= ASGARI_SQL_BOLGESI,
    `${bolgeSayisi} SQL parçası (asgari ${ASGARI_SQL_BOLGESI})` +
      (bolgeSayisi < ASGARI_SQL_BOLGESI
        ? " — sarmalayıcı adı değişmiş olabilir, SQL_ETIKETLERI/SQL_FONKSIYONLARI'nı güncelle"
        : ""),
  );
  // ⚠️ 2026-09-05: BU ZEMİN KALDIRILDI, tam da başlığın öngördüğü sebeple.
  // Eski zemin "repoda `AT TIME ZONE 'UTC'` yazımı görülüyor mu" diye soruyordu ve
  // amacı tarayıcının SQL'i gerçekten okuduğunu kanıtlamaktı. O gün geldi: 11
  // tarihsel yazma noktasının hepsi düz `now()` + gerekçeli `-- tz-ok:` işaretine
  // çevrildi (kolon timestamptz, oturum tz UTC; eşdeğerlik DB'de ölçüldü). Sayaç
  // artık 0 ve zemin YALNIZCA kendi kendini tatmin eder olurdu.
  // Tarayıcı canlılığının zemini yukarıdaki "ham SQL bölgeleri ayrıştırıldı"
  // kontrolüdür (ASGARI_SQL_BOLGESI) — o hâlâ gerçek bir körlük ölçüsüdür.
  check(
    "tarihsel `AT TIME ZONE 'UTC'` yazımı KALMADI",
    utcDuzeltmeSayisi === 0,
    utcDuzeltmeSayisi === 0
      ? "0 (11 nokta 2026-09-05'te temizlendi)"
      : `${utcDuzeltmeSayisi} yer — yeni kod bu sarmalı YAZMAZ (kolonlar timestamptz)`,
  );

  console.log("\n── 3) Çıplak NOW() / CURRENT_TIMESTAMP ──");
  check(
    "ham SQL'de çıplak zaman fonksiyonu YOK",
    ihlaller.length === 0,
    ihlaller.length === 0 ? "temiz" : `${ihlaller.length} ihlal`,
  );
  if (ihlaller.length > 0) {
    console.log("\n   İHLALLER (geliştiriciye):");
    for (const b of ihlaller) {
      console.log(`     • ${b.dosya}:${b.satir}  →  ${b.token}`);
      console.log(`         ${b.satirMetni}`);
    }
    console.log(
      "\n   YAPILACAK:\n" +
        "     a) Kolon `timestamptz` ise (şemadaki 315 DateTime alanının 311'i öyle;\n" +
        "        muaf olan 4'ü `@db.Date`) → düz `now()` DOĞRUDUR; SQL'in içine\n" +
        "        gerekçeli işaret koy:\n" +
        "     b) Kolon gerçekten tz'siz ise (dış tablo, geçici sonuç kümesi) → önce\n" +
        "        kolonu timestamptz'e taşımayı değerlendir; taşınamıyorsa gerekçeyi yaz:\n" +
        "        `-- tz-ok: <neden doğru>` (aynı satır ya da bir üst satır).\n" +
        "     Kolon tipini DOĞRULA:\n" +
        "        SELECT column_name, data_type FROM information_schema.columns\n" +
        "         WHERE table_name = '<tablo>' AND data_type LIKE 'timestamp%';\n" +
        "   NEDEN ÖNEMLİ: kolon tipini SQL metninden okuyamayız. İşaret, o satırı yazan\n" +
        "   kişinin kolon tipini DOĞRULADIĞININ kaydıdır — sessiz varsayım bırakmaz.\n" +
        "   Yapısal güvence `test_timestamptz_contract.ts`tedir (kolonlar timestamptz).",
    );
  }

  // Gerekçesiz muafiyet = sessiz susturma. Kabul etmiyoruz.
  check(
    "her `-- tz-ok` işareti gerekçeli",
    gerekcesizMuaflar.length === 0,
    gerekcesizMuaflar.length === 0 ? "" : `${gerekcesizMuaflar.length} gerekçesiz`,
  );
  for (const b of gerekcesizMuaflar) {
    console.log(
      `     • ${b.dosya}:${b.satir} → \`-- tz-ok\` var ama gerekçe yok. ` +
        "`-- tz-ok: <neden doğru>` yaz.",
    );
  }

  // ── Muafların TAM LİSTESİ — sessiz muafiyet olmasın ──
  console.log("\n── 4) Muaflar (bilinçli istisnalar) ──");
  if (muaflar.length === 0) {
    console.log("   ℹ️  Muaf yok — ham SQL'de zaman fonksiyonu ya doğru ya hiç kullanılmıyor.");
  } else {
    for (const b of muaflar) {
      console.log(`   • ${b.dosya}:${b.satir}  ${b.token}  → ${b.gerekce}`);
    }
    console.log(`   Toplam ${muaflar.length} muafiyet.`);
  }

  if (aciklamali.length > 0) {
    warnLine(
      `UTC OLMAYAN açık dönüşüm (${aciklamali.length}) — bilinçli ama iş verisine ` +
        "yazılıyorsa Prisma'nın UTC'siyle çakışır:",
    );
    for (const b of aciklamali) console.log(`     • ${b.dosya}:${b.satir}  ${b.satirMetni}`);
  }
}

try {
  main();
} catch (e) {
  console.error("HATA:", e);
  fail++;
}
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${warn > 0 ? `, ${warn} uyarı` : ""} ===`);
if (fail > 0) {
  console.log(
    "\nDÜŞTÜYSE: kural CLAUDE.md → Operasyonel Bakım O-11. Tek cümlelik özet:\n" +
      "ham SQL'de zamanı `(now() AT TIME ZONE 'UTC')` ile al — şemadaki tarih\n" +
      "kolonları `timestamp` (tz'siz) ve Prisma onlara UTC yazar.",
  );
}
process.exit(fail > 0 ? 1 : 0);
