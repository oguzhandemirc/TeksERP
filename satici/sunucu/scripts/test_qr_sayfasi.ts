// =============================================================================
// BEKÇİ — /q SAYFASI (telefon): çok parçalı QR (TKLQ1) + tarayıcı QR kodlayıcısı + akış
// =============================================================================
// Koşum: npx tsx scripts/run-all-tests.ts qr_sayfasi   (DB'ye DOKUNMAZ; koşucu hedef kapısı yine ister)
//
// NE ÖLÇER (sayfanın satır içi betiği Node `vm`inde, sahte DOM ile):
//   §1 tarayıcı kütüphanesi TS eşiyle (`src/http/qr-parca.ts`, fabrika aynası) BİREBİR: SHA-256,
//      bölme (aynı parçalar), çapraz birleştirme (JS böl → TS birleştir ve tersi), kurcalama reddi.
//   §2 QR matrisi altın özetlerle (üç sürüm: 3 · 19 · 24; qrcodegen çıktısıyla ve CoreImage
//      çözümlemesiyle karşılaştırılarak bir kez ölçüldü) + yapı (boyut, konum desenleri).
//   §3 sayfa gövdesi: tek betik, kalmış `${` yok, CSP başlıkları değişmedi.
//   §4 ⭐ akış: tek zarf → /v1/cevrimdisi POST; üç istek parçası üç ayrı açılışta birikir, üçüncüde
//      BİRLEŞİK zarf gönderilir ve depo silinir; yanıt parçalı QR olarak çizilir, metin kopyalanabilir.
// ⭐ KALICI SONDA ✓K: eşdeğerlik denetçisi hedef boyu bozulmuş kütüphaneyi, altın denetçisi tek
//   modülü değişmiş matrisi yakalar; doğru girdide susarlar.
// =============================================================================
import { createHash, randomBytes } from "node:crypto";
import vm from "node:vm";
import { QR_PAGE_LIB_JS } from "../src/http/qr-page-lib";
import { QR_PAGE_MATRIX_JS } from "../src/http/qr-page-matrix";
import { qrPage, qrPageHtml } from "../src/http/qr-page";
import { joinQrParts, sha256Hex, splitIntoQrParts } from "../src/http/qr-parca";
import type { Request, Response } from "express";
import { sayfayiAc } from "./lib/qr-sayfa-dom";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

interface Lib {
  sha256Hex(s: string): string;
  split(s: string): string[] | null;
  add(state: unknown, raw: string): { kind: string; text?: string; state?: unknown };
  qrMatrix(s: string): boolean[][];
}

function kutuphane(js = QR_PAGE_LIB_JS): Lib {
  const ctx: Record<string, unknown> = {};
  vm.createContext(ctx);
  vm.runInContext(`${js}\n${QR_PAGE_MATRIX_JS}\nthis.TKLQ = TKLQ;`, ctx);
  return ctx.TKLQ as Lib;
}

const ORNEKLER: string[] = (() => {
  const out = ["a", "ğüşıöç İ", "x\ud800y", `${"a".repeat(999)}😀${"b".repeat(1500)}`, "q".repeat(6000), "q".repeat(6001)];
  for (const n of [55, 56, 64, 1000, 1001, 2000, 3074, 4700]) out.push(`{"v":1,"x":"${"a|b".repeat(n)}"}`.slice(0, n));
  for (let i = 0; i < 60; i++) out.push(randomBytes(Math.floor(Math.random() * 5000) + 1).toString("latin1"));
  return out;
})();

/** Eşdeğerlik denetçisi: sapan örneklerin kısa listesi (boş = eşdeğer). */
function esdegerlik(lib: Lib): string[] {
  const sapan: string[] = [];
  for (const s of ORNEKLER) {
    const ad = JSON.stringify(s.slice(0, 10));
    if (lib.sha256Hex(s) !== sha256Hex(s)) sapan.push(`sha ${ad}`);
    const js = lib.split(s);
    const ts = splitIntoQrParts(s);
    if (JSON.stringify(js) !== JSON.stringify(ts)) sapan.push(`böl ${ad}`);
    if (js && joinQrParts([...js].reverse()) !== s) sapan.push(`JS→TS ${ad}`);
    if (ts) {
      let st: unknown = null;
      let son: { kind: string; text?: string; state?: unknown } = { kind: "yok" };
      for (const p of [...ts].reverse()) {
        son = lib.add(st, p);
        st = son.state ?? st;
      }
      if (son.kind !== "tamam" || son.text !== s) sapan.push(`TS→JS ${ad}`);
    }
  }
  return sapan;
}

function kutuphaneEsdegerligi(): void {
  console.log("§1 — tarayıcı kütüphanesi ↔ TS eşi");
  const sapan = esdegerlik(kutuphane());
  check(`§1a SHA · bölme · çapraz birleştirme birebir (${ORNEKLER.length} örnek)`, sapan.length === 0, sapan.slice(0, 4).join(" | "));
  const lib = kutuphane();
  const node = ORNEKLER.slice(0, 20).filter((s) => lib.sha256Hex(s) !== createHash("sha256").update(s, "utf8").digest("hex"));
  check("§1b tarayıcı SHA-256 = Node crypto", node.length === 0);
  const p = lib.split("k".repeat(2500)) ?? [];
  check("§1c kurcalanmış parça reddedilir", lib.add(null, (p[0] ?? "").replace(/k$/, "K")).kind === "gecersiz");
}

const bitler = (m: boolean[][]): string => m.map((r) => r.map((b) => (b ? "1" : "0")).join("")).join("\n");
const ozet = (m: boolean[][]): string => createHash("sha256").update(bitler(m)).digest("hex");
const ALTIN: readonly { girdi: string; boyut: number; ozet: string }[] = [
  { girdi: 'TKLQ1|1/1|00000000|00000000|{"v":1}', boyut: 29, ozet: "63395503562899de907adfc4d456d73b5d94edebdaca1778cfabcb291b953c02" },
  { girdi: `TKLQ1|2/4|deadbeef|01234567|${"A".repeat(760)}`, boyut: 93, ozet: "e99641eb5c9a91731c5b2c1172b978747bd72c62cbe5188dd8fb0a2b9ac7dbc8" },
  { girdi: `https://lisans.etkiliyazilim.com/q#${"x".repeat(1100)}`, boyut: 113, ozet: "cf52f602f57610f52cd46c87a48fd58152454c08adef6af8cf49aa7bdeeb9b67" },
];

function altinSapma(uret: (s: string) => boolean[][]): string[] {
  return ALTIN.filter((a) => {
    const m = uret(a.girdi);
    return m.length !== a.boyut || ozet(m) !== a.ozet;
  }).map((a) => `${a.boyut}`);
}

function konumDeseni(m: boolean[][], x: number, y: number): boolean {
  for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
    const halka = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
    if ((m[y + dy]?.[x + dx] ?? false) !== (halka !== 2)) return false;
  }
  return true;
}

function qrMatrisi(): void {
  console.log("\n§2 — QR matrisi");
  const lib = kutuphane();
  const sapan = altinSapma((s) => lib.qrMatrix(s));
  check("§2a altın özetler (sürüm 3 · 19 · 24)", sapan.length === 0, sapan.join(","));
  const m = lib.qrMatrix(ALTIN[2]?.girdi ?? "");
  const n = m.length;
  check("§2b üç köşede konum deseni", konumDeseni(m, 0, 0) && konumDeseni(m, n - 7, 0) && konumDeseni(m, 0, n - 7));
  let hata = "";
  try {
    lib.qrMatrix("z".repeat(3000));
  } catch (e) {
    hata = String(e);
  }
  check("§2c sürüm 40'a sığmayan veri açık hatayla reddedilir", hata.includes("çok uzun"));
}

function sayfaGovdesi(): void {
  console.log("\n§3 — sayfa gövdesi");
  const html = qrPageHtml();
  check("§3a tek betik; kütüphane + matris + akış gömülü", (html.match(/<script>/g) ?? []).length === 1 && html.includes("var TKLQ") && html.includes("TKLQ.qrMatrix =") && html.includes('"/v1/cevrimdisi"'));
  check("§3b çözülmemiş şablon parçası yok", !html.includes("${"));
  const basliklar: Record<string, string> = {};
  const res = { set: (h: Record<string, string>) => Object.assign(basliklar, h), status: () => res, send: () => res } as unknown as Response;
  qrPage({} as Request, res);
  const csp = basliklar["Content-Security-Policy"] ?? "";
  check("§3c CSP dar kaldı (dış kaynak yok, yalnız kendi köke bağlantı)", csp.startsWith("default-src 'none'") && csp.includes("connect-src 'self'") && basliklar["Cache-Control"] === "no-store");
}

async function akis(): Promise<void> {
  console.log("\n§4 — sayfa akışı (sahte DOM)");
  const yanitMetni = JSON.stringify({ v: 1, hak: `h.${"H".repeat(1400)}.s`, kira: `k.${"K".repeat(1500)}.s`, indirmeBelirtecleri: [], sunucuSaati: "2026-09-29T10:00:00.000Z" });
  const tek = await sayfayiAc({ hash: "eyJabc", depo: new Map(), fetchYaniti: { ok: true, text: yanitMetni } });
  check("§4a tek zarf → POST /v1/cevrimdisi {v:1, zarf} (eski panel QR'ı da çalışır)", tek.fetchler.length === 1 && tek.fetchler[0]?.url === "/v1/cevrimdisi" && tek.fetchler[0]?.body.zarf === "eyJabc" && tek.fetchler[0]?.body.v === 1);
  const beklenenParca = splitIntoQrParts(yanitMetni) ?? [];
  check(
    "§4b ⭐ yanıt çok parçalı QR: ilk parça çizili, sıra bilgisi, gezinme düğmeleri, metin kopyalanabilir",
    beklenenParca.length > 1 && tek.qrSvgSayisi === 1 && tek.qrYolu.startsWith("M") && tek.qrBilgi.startsWith(`QR 1 / ${beklenenParca.length}`) && !tek.araclarGizli && tek.yanit === yanitMetni,
    `${tek.qrBilgi} · ${beklenenParca.length} parça`,
  );
  check("§4c 'Metni kopyala' yanıtı AYNEN panoya yazar", (await tek.kopyala()) === yanitMetni);

  const zarf = randomBytes(2000).toString("base64url");
  const parcalar = splitIntoQrParts(zarf) ?? [];
  const depo = new Map<string, string>();
  const acilislar = [];
  for (const p of [parcalar[1], parcalar[0], parcalar[2]]) acilislar.push(await sayfayiAc({ hash: encodeURIComponent(p ?? ""), depo }));
  check(
    "§4d ⭐ istek parçaları ayrı açılışlarda birikir; eksikken ağa çıkılmaz, sıradaki istenir",
    parcalar.length === 3 && acilislar[0]?.fetchler.length === 0 && acilislar[1]?.fetchler.length === 0 && /İstek parçası 2 \/ 3 alındı.*eksik: 3/.test(acilislar[1]?.durum ?? ""),
    acilislar[1]?.durum,
  );
  check("§4e son parçada BİRLEŞİK zarf gönderilir, yerel depo temizlenir", acilislar[2]?.fetchler[0]?.body.zarf === zarf && depo.size === 0);
  const bozukDepo = new Map<string, string>();
  const bozuk = await sayfayiAc({ hash: encodeURIComponent((parcalar[0] ?? "").slice(0, -2) + "zz"), depo: bozukDepo });
  check("§4f kurcalanmış parça gönderilmez, depoya yazılmaz", bozuk.fetchler.length === 0 && bozukDepo.size === 0 && bozuk.durum.includes("parçası değil"));
  const red = await sayfayiAc({ hash: "eyJabc", depo: new Map(), fetchYaniti: { ok: false, text: JSON.stringify({ success: false, message: "İstek süresi dolmuş.", details: { code: "ISTEK_ZAMAN" } }) } });
  check("§4g satıcı reddi: sebep cümlesi gösterilir, QR çizilmez", red.durum === "Sunucu isteği reddetti: İstek süresi dolmuş." && red.qrSvgSayisi === 0);
}

function sondalar(): void {
  console.log("\n§5 — kalıcı sondalar (✓K)");
  const bozukLib = kutuphane(QR_PAGE_LIB_JS.replace("TARGET = 1000", "TARGET = 999"));
  check("✓K1 eşdeğerlik denetçisi hedef boyu bozulmuş kütüphaneyi yakalar", esdegerlik(bozukLib).length > 0);
  const lib = kutuphane();
  const tekModul = (s: string): boolean[][] => {
    const m = lib.qrMatrix(s);
    const satir = m[10];
    if (satir) satir[10] = !satir[10];
    return m;
  };
  check("✓K2 altın denetçisi tek modülü değişmiş matrisi yakalar", altinSapma(tekModul).length === ALTIN.length);
  check("✓K3 doğru girdide ikisi de susar", esdegerlik(lib).length === 0 && altinSapma((s) => lib.qrMatrix(s)).length === 0);
}

async function main(): Promise<void> {
  console.log("=== /q sayfası — çok parçalı QR ===");
  kutuphaneEsdegerligi();
  qrMatrisi();
  sayfaGovdesi();
  await akis();
  sondalar();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(() => process.exit(fail > 0 ? 1 : 0));
