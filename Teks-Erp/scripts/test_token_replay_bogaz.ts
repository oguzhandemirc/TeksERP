// =============================================================================
// Bekçi: TOKEN REPLAY TEK BOĞAZ — her clientToken yolu `tokenReplay`dan geçer ya da beyanlıdır (DB'siz, AST)
// Çalıştır: npx tsx scripts/test_token_replay_bogaz.ts
// =============================================================================
// NEDEN: kilitsiz token ön-okuması + kazananın yazdığını okuyan iş kuralı, aynı denemenin ikinci kopyasına
// replay yerine 4xx döndürür ve istemci yeni token'la İKİNCİ kaydı açar (`TOKEN-REPLAY-KILIDI.md` §1). Çare tek
// boğaz: `tokenReplay` (4. durum + gövde kapısı ZORUNLU; kip çağrı yerinde). Beyan: `scripts/lib/token-replay-beyan.ts`.
//   §1 token yazan/okuyan her birim beyanlı (politika ve politikanın okuyucusu kendiliğinden) — beyansız yeni yol kırmızı.
//   §2 ölü beyan satırı yok.
//   §3 kip doğrulaması: giriş birimi kipini çağırır (R `run` · K `inTx` · K′ `behindLock`); K'de `inTx` tx'in İLK await'i.
//   §4 her `tokenReplay({…})` literali find · alive · identity · collision · respond taşır; identity ≥1 alanlı dizi.
//   §5 muaf sınıfı KAPALI kümeden; ON_KONTROL_OKUYUCUSU yanıt üretemez (okuma yalnız `clientToken`ı seçer, boğaz yok).
//   §6 borç CIRCIR (yalnız düşer — iki yönlü, `circir-kolu`).
// =============================================================================
import * as path from "node:path";
import * as ts from "typescript";
import { atlamaDefteri } from "./lib/atlama";
import { curumeKolu } from "./lib/circir-kolu";
import { MUAF_SINIFLARI, TOKEN_YOLLARI, type Kip } from "./lib/token-replay-beyan";
import { tokenBirimleri, type TokenBirimi } from "./lib/token-yazim-tarama";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
const ATLAMA = atlamaDefteri((mesaj) => check(mesaj, false));

/** Boğaza henüz girmemiş (borç) birim sayısı — YALNIZ DÜŞER; sabiti entegratör trende düşürür. */
const BORC_TABANI = 5; // D5b sonu (2026-09-26): D5 11 → 5 (levent planı · dokuma işi · fason dokuma kabulü · top indirme)

const KOK = path.resolve(__dirname, "..");
const KIP_CAGRISI: Record<Kip, string> = { R: "run", K: "inTx", "K′": "behindLock" };

/** Birimdeki `$transaction(async (tx) => …)` geri çağrılarının ilk await ifadesi `inTx` mi? */
function inTxIlkAwaitMi(b: TokenBirimi): boolean {
  let bulundu = false;
  let hepsiIlk = true;
  const ara = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "$transaction") {
      const fn = n.arguments[0];
      if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && fn.getText().includes(".inTx(")) {
        bulundu = true;
        let ilk: ts.AwaitExpression | null = null;
        const awaitBul = (k: ts.Node) => {
          if (ilk) return;
          if (ts.isAwaitExpression(k)) ilk = k;
          else ts.forEachChild(k, awaitBul);
        };
        ts.forEachChild(fn.body, awaitBul);
        if (!ilk || !(ilk as ts.AwaitExpression).getText().includes(".inTx(")) hepsiIlk = false;
      }
    }
    ts.forEachChild(n, ara);
  };
  ara(b.dugum);
  return bulundu && hepsiIlk;
}

function main(): void {
  console.log("=== Token replay — tek boğaz (AST) ===\n");
  const tarama = tokenBirimleri(KOK);
  const politikaBirimleri = tarama.token.filter((b) => b.cagrilar.some((c) => c.ad === "tokenReplay"));
  const tumPolitikaBirimleri = [...tarama.hepsi.values()].filter((b) => b.cagrilar.some((c) => c.ad === "tokenReplay"));
  const politikaCagrilari = new Set(tumPolitikaBirimleri.flatMap((b) => b.cagrilar.map((c) => `${b.anahtar.split("::")[0]}::${c.ad}`)));
  const otomatik = (b: TokenBirimi) => politikaBirimleri.includes(b) || politikaCagrilari.has(b.anahtar);

  console.log("§1 Beyan");
  const beyansiz = tarama.token.filter((b) => !(b.anahtar in TOKEN_YOLLARI) && !otomatik(b)).map((b) => `${b.anahtar} (yazım ${b.yazimSatirlari.join(",") || "-"} · okuma ${b.okumalar.join(",") || "-"})`);
  check("⭐ token yazan/okuyan her birim beyanlı ya da boğaz politikası", beyansiz.length === 0, beyansiz.join(" · "));
  check("tarama kör değil (≥ 40 token birimi)", tarama.token.length >= 40, `${tarama.token.length} birim`);

  console.log("§2 Ölü beyan");
  const bulunan = new Set(tarama.token.map((b) => b.anahtar));
  const olu = Object.keys(TOKEN_YOLLARI).filter((k) => !bulunan.has(k));
  check("beyan listesinde ölü satır yok", olu.length === 0, olu.join(" · "));

  console.log("§3 Kip");
  const kipHatasi: string[] = [];
  let kipSayisi = 0;
  for (const [birim, yol] of Object.entries(TOKEN_YOLLARI)) {
    if (!("giris" in yol)) continue;
    for (const [giris, kip] of Object.entries(yol.giris)) {
      kipSayisi++;
      const g = tarama.hepsi.get(giris);
      if (!g) {
        kipHatasi.push(`${birim}: giriş birimi yok (${giris})`);
        continue;
      }
      if (!g.cagrilar.some((c) => c.ad === KIP_CAGRISI[kip])) kipHatasi.push(`${giris}: ${kip} beyanlı ama .${KIP_CAGRISI[kip]}( yok`);
      if (kip === "K" && !inTxIlkAwaitMi(g)) kipHatasi.push(`${giris}: K'de inTx tx'in ilk await'i değil`);
    }
  }
  check("⭐ her giriş birimi beyan ettiği kipi çağırır; K'de inTx tx'in ilk await'i", kipHatasi.length === 0, kipHatasi.join(" · "));
  check("kip beyanı kör değil (≥ 20 giriş)", kipSayisi >= 20, `${kipSayisi} giriş`);

  console.log("§4 Politika literali");
  const ZORUNLU = ["find", "alive", "identity", "collision", "respond"];
  const politikaHatasi: string[] = [];
  for (const p of tarama.politikalar) {
    if (!p.literal) {
      politikaHatasi.push(`${p.yer}: nesne literali değil (alanlar ölçülemez)`);
      continue;
    }
    const alanlar = new Map(p.literal.properties.filter(ts.isPropertyAssignment).map((a) => [a.name.getText(), a.initializer]));
    const eksik = ZORUNLU.filter((z) => !alanlar.has(z));
    if (eksik.length) politikaHatasi.push(`${p.yer}: eksik ${eksik.join(",")}`);
    const idn = alanlar.get("identity");
    if (idn && (ts.isArrowFunction(idn) || ts.isFunctionExpression(idn))) {
      const diziler: ts.ArrayLiteralExpression[] = [];
      if (ts.isArrayLiteralExpression(idn.body)) diziler.push(idn.body);
      else if (ts.isParenthesizedExpression(idn.body) && ts.isArrayLiteralExpression(idn.body.expression)) diziler.push(idn.body.expression);
      else {
        const don = (k: ts.Node) => {
          if (ts.isReturnStatement(k) && k.expression && ts.isArrayLiteralExpression(k.expression)) diziler.push(k.expression);
          if (!ts.isArrowFunction(k) && !ts.isFunctionExpression(k)) ts.forEachChild(k, don);
        };
        ts.forEachChild(idn.body, don);
      }
      const bos = diziler.length === 0 || diziler.some((d) => !d.elements.some((e) => !ts.isSpreadElement(e)));
      if (bos) politikaHatasi.push(`${p.yer}: identity en az bir sabit alanlı dizi döndürmüyor`);
    } else if (idn) {
      politikaHatasi.push(`${p.yer}: identity satır içi fonksiyon değil (ölçülemez)`);
    }
  }
  check("⭐ her tokenReplay literali beş alanı taşır; gövde kapısı (identity) boş değil", politikaHatasi.length === 0, politikaHatasi.join(" · "));
  check("politika taraması kör değil (≥ 18 politika)", tarama.politikalar.length >= 18, `${tarama.politikalar.length} politika`);

  console.log("§5 Muaf sınıfı");
  const muafHatasi = Object.entries(TOKEN_YOLLARI).filter(([, y]) => "muaf" in y && !(y.muaf in MUAF_SINIFLARI)).map(([k]) => k);
  check("muaf satırları kapalı sınıf kümesinden", muafHatasi.length === 0, muafHatasi.join(" · "));
  // ON_KONTROL_OKUYUCUSU dar tanımı: token okuması YALNIZ `clientToken`ı seçer (kayıt içeriği hiçbir yola akamaz) ve
  // birim boğaz çağırmaz — yanıt üretemeyen okuyucu olduğu yapıdan ölçülür.
  const onKontrol = Object.entries(TOKEN_YOLLARI).filter(([, y]) => "muaf" in y && y.muaf === "ON_KONTROL_OKUYUCUSU").map(([k]) => k);
  const onKontrolHatasi = onKontrol.flatMap((k) => {
    const b = tarama.hepsi.get(k);
    if (!b) return [`${k}: birim yok`];
    if (b.cagrilar.some((c) => c.ad === "tokenReplay")) return [`${k}: boğaz çağırıyor (yanıt üretebilir)`];
    const hatalar: string[] = [];
    let okuma = 0;
    const gez = (n: ts.Node) => {
      if (ts.isObjectLiteralExpression(n)) {
        const alan = (ad: string) => n.properties.find((pr): pr is ts.PropertyAssignment => ts.isPropertyAssignment(pr) && pr.name.getText() === ad);
        const where = alan("where");
        if (where && ts.isObjectLiteralExpression(where.initializer) && where.initializer.properties.some((pr) => pr.name?.getText() === "clientToken")) {
          okuma++;
          const sel = alan("select");
          const secilen = sel && ts.isObjectLiteralExpression(sel.initializer) ? sel.initializer.properties.map((pr) => pr.name?.getText() ?? "?") : null;
          if (!secilen || secilen.length !== 1 || secilen[0] !== "clientToken") hatalar.push(`${k}: token okuması yalnız clientToken seçmiyor (${secilen?.join(",") ?? "select yok"})`);
        }
      }
      ts.forEachChild(n, gez);
    };
    gez(b.dugum);
    return okuma === 0 ? [`${k}: token okuması bulunamadı (ölü sınıf satırı)`] : hatalar;
  });
  check("⭐ ON_KONTROL_OKUYUCUSU yanıt üretemez: okuma yalnız clientToken'ı seçer, boğaz çağrısı yok", onKontrolHatasi.length === 0, onKontrolHatasi.join(" · "));

  console.log("§6 Borç cırcırı");
  const borc = Object.values(TOKEN_YOLLARI).filter((y) => "borc" in y).length;
  check("⭐ boğaz dışı (borç) birim ARTMADI", borc <= BORC_TABANI, `gerçek ${borc} · taban ${BORC_TABANI}`);
  curumeKolu(check, ATLAMA.atla, "borç tabanı ÇÜRÜMEDİ (boğaza taşınan yol listeden düştü)", borc, BORC_TABANI);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
