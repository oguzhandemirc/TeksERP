// =============================================================================
// ÇOK PARÇALI QR (TKLQ1) AYNASI — `Teks-Erp/src/lib/license/qr-parca.ts` TEK KAYNAKTIR; panel
// (Electron), tablet (mobil) ve satıcı sunucusu aynı dosyayı BAYT-EŞİT taşır. Ayna bozulursa bir
// uç parçayı başka özetle böler, öteki "bozuk okuma" sanıp reddeder — hata sahada, çevrimdışı
// yenilemenin tam ortasında çıkar. Emsal: `test_mobil_enum_aynasi`, `test_lisans_protokol_aynasi`.
//
// ÖLÇÜM: §1 dört kopyanın sha256'sı birebir (eksik kopya KIRMIZI — yokluk "eşit" sayılmaz).
//   §2 işlev (kaynak üzerinde): saf SHA-256 Node `crypto` ile birebir (UTF-8, eşsiz vekil, blok
//   sınırları) · böl → karışık sırayla birleştir = aynı metin · 1…4 parça, parça başına tavan ·
//   kurcalanmış parça / karışık küme / eksik parça → null · tavanı aşan metin → null.
// ⭐ KALICI SONDA ✓K (her koşumda): karşılaştırıcı içerik farkını ve eksik aynayı yakalar, özdeşte
//   susar; SHA kâhini bozuk bir özet işlevini yakalar.
// Düzeltme: değişiklik ÖNCE kaynakta, sonra `cp -p Teks-Erp/src/lib/license/qr-parca.ts <ayna>`.
// Koşum: npx tsx scripts/test_lisans_qr_parca_aynasi.ts   (DB GEREKMEZ)
// =============================================================================
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  QR_PART_MAX_CHARS,
  QR_PART_MAX_COUNT,
  addQrPart,
  joinQrParts,
  parseQrPart,
  sha256Hex,
  splitIntoQrParts,
} from "../src/lib/license/qr-parca";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const KOK = path.resolve(__dirname, "..", "..");
const KAYNAK = "Teks-Erp/src/lib/license/qr-parca.ts";
const AYNALAR = ["Electron/src/lib/license/qr-parca.ts", "mobil/src/lib/qr-parca.ts", "satici/sunucu/src/http/qr-parca.ts"];

const ozet = (p: string): string | null =>
  existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : null;

/** Ayna farkı: null = eşit; aksi hâlde sebep. */
export function aynaFarki(kaynak: string | null, ayna: string | null): string | null {
  if (kaynak === null) return "kaynak yok";
  if (ayna === null) return "ayna yok";
  return kaynak === ayna ? null : "içerik farklı";
}

function aynalar(): void {
  console.log("§1 — bayt-eşit ayna");
  const k = ozet(path.join(KOK, KAYNAK));
  check(`§1a kaynak var: ${KAYNAK}`, k !== null);
  for (const a of AYNALAR) {
    const fark = aynaFarki(k, ozet(path.join(KOK, a)));
    check(`§1b ${a} kaynakla bayt-eşit`, fark === null, fark ?? "");
  }
}

function nodeSha(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function shaKahini(fn: (s: string) => string): string[] {
  const ornek = ["", "a", "abc", "ğüşıöç İ", "😀", "x\ud800y", "\udc00", "x".repeat(55), "x".repeat(56), "x".repeat(64), "x".repeat(119)];
  for (let i = 0; i < 200; i++) ornek.push(randomBytes(Math.floor(Math.random() * 3000)).toString("latin1"));
  return ornek.filter((s) => fn(s) !== nodeSha(s)).map((s) => JSON.stringify(s.slice(0, 12)));
}

function islev(): void {
  console.log("\n§2 — işlev (kaynak)");
  const sapan = shaKahini(sha256Hex);
  check("§2a saf SHA-256 = Node crypto (UTF-8, eşsiz vekil, blok sınırları, 211 örnek)", sapan.length === 0, sapan.slice(0, 3).join(" "));
  const boylar = [1, 999, 1000, 1001, 2000, 3074, 4000, 4700, 6000];
  const hatali: string[] = [];
  for (const n of boylar) {
    const metin = `{"v":1,"x":"${"a|b".repeat(n)}"}`.slice(0, n);
    const parcalar = splitIntoQrParts(metin);
    if (!parcalar) { hatali.push(`${n}: bölünemedi`); continue; }
    if (parcalar.length > QR_PART_MAX_COUNT) hatali.push(`${n}: ${parcalar.length} parça`);
    if (parcalar.some((p) => (parseQrPart(p)?.data.length ?? Infinity) > QR_PART_MAX_CHARS + 1)) hatali.push(`${n}: parça tavanı`);
    if (joinQrParts([...parcalar].reverse()) !== metin) hatali.push(`${n}: birleşmedi`);
  }
  check("§2b böl → karışık sırayla birleştir = aynı metin; 1…4 parça, parça tavanı", hatali.length === 0, hatali.join(" · "));
  const iki = splitIntoQrParts("q".repeat(2500)) ?? [];
  const baska = splitIntoQrParts("r".repeat(2500)) ?? [];
  const kurcali = (iki[0] ?? "").replace(/q$/, "Q");
  check("§2c kurcalanmış parça ayrıştırılmaz", parseQrPart(kurcali) === null && addQrPart(null, kurcali).kind === "gecersiz");
  check("§2d karışık küme / eksik parça → null", joinQrParts([iki[0] ?? "", baska[1] ?? "", iki[2] ?? ""]) === null && joinQrParts(iki.slice(1)) === null);
  check("§2e parça tavanını aşan metin QR'a bölünmez (metin kopyalanır)", splitIntoQrParts("z".repeat(4 * QR_PART_MAX_CHARS + 1)) === null && splitIntoQrParts("") === null);
  const vekil = `${"a".repeat(999)}😀${"b".repeat(1500)}`;
  const vp = splitIntoQrParts(vekil) ?? [];
  check("§2f kesim vekil çiftini bölmez", vp.every((p) => !/[\ud800-\udbff]$/.test(parseQrPart(p)?.data ?? "")) && joinQrParts(vp) === vekil);
}

function sondalar(): void {
  console.log("\n§3 — kalıcı sondalar (✓K)");
  check("✓K1 içerik farkı yakalanır", aynaFarki("a", "b") === "içerik farklı");
  check("✓K2 eksik ayna yakalanır (yokluk eşit sayılmaz)", aynaFarki("a", null) === "ayna yok");
  check("✓K3 özdeşte susar", aynaFarki("a", "a") === null);
  const bozuk = (s: string): string => (s.length === 56 ? "0".repeat(64) : sha256Hex(s));
  check("✓K4 SHA kâhini blok sınırındaki bozuk özet işlevini yakalar", shaKahini(bozuk).length > 0);
}

aynalar();
islev();
sondalar();
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
