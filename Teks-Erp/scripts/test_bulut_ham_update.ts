// =============================================================================
// BEKÇİ — PATRON BULUTU HAM UPDATE İSTİSNALARI (filigrana görünmeyen yazım)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts bulut_ham_update   (DB'SİZ, statik; ~5 sn)
//
// NEDEN: Prisma `update`/`updateMany` `@updatedAt`i yazar, HAM SQL yazmaz — katalog tablosuna
// `updatedAt`siz yazan ham UPDATE eşitlemeye GÖRÜNMEZ (tasarım §4.2). Ölçüm betiği
// `scripts/olcum/patron-yazim-noktalari.ts` (tipli AST) bütün yazım noktalarını basar; bu
// bekçi onun çıktısını beyana (`scripts/lib/bulut-ham-update-beyan.ts`) bağlar:
//   §1 körlük zemini: tarama dolu (≥ 20 ham UPDATE, ≥ 1 /permanent bağı)
//   §2 ⭐ opt-in kolona `updatedAt`siz yazan ham UPDATE = 0 (`payment-allocation` sayaçları
//      `updatedAt=NOW()` yazar — bıraktığı gün burada kırmızı)
//   §3 ⭐ `updatedAt`siz her ham UPDATE BEYANLI (dosya + tablo + SET ⊆ izinli kolonlar)
//   §4 ⭐ ölü beyan yok (beyan eşleşmiyorsa kod değişmiştir — beyan da değişir)
//   §5 ⭐ katalog silme stratejisi (DAMGA/YOK) ↔ koddaki silme yolları uyumlu
//
// ⭐ KALICI SONDA ✓K1: sentetik bulguda beyansız UPDATE §3 denetçisini kırmızı yapar.
// NEGATİF SONDA — dosya DIŞI mutasyon (cp + shasum ile geri alındı; commit mesajında):
//   H1 payment-allocation bir sayaç UPDATE'inden `"updatedAt" = NOW()` çıkarıldı → §2 + §3 ❌
//   H2 beyana yok olan bir dosya eklendi                                          → §4 ❌
// =============================================================================
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { HAM_UPDATE_BEYANI, type HamUpdateBeyani } from "./lib/bulut-ham-update-beyan";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

interface Ham { tablo: string; dosya: string; satir: number; setKolonlari: string[]; updatedAtYazar: boolean; optInDokunan: string[]; dinamik: boolean }
interface Olcum { hamlar: Ham[]; gorunmezGuncelleme: Ham[]; uyumsuz: string[]; genel: unknown[] }

/** SAF — beyansız ham UPDATE'ler ve kullanılmayan beyanlar. */
export function beyanDenetimi(hamlar: readonly Ham[], beyan: readonly HamUpdateBeyani[]): { beyansiz: string[]; olu: string[] } {
  const kullanilan = new Set<number>();
  const beyansiz: string[] = [];
  for (const h of hamlar.filter((x) => !x.updatedAtYazar)) {
    const i = beyan.findIndex(
      (b) =>
        b.dosya === h.dosya &&
        (b.tablo === "*" ? h.dinamik : b.tablo === h.tablo) &&
        (b.kolonlar === "*" || h.setKolonlari.every((c) => (b.kolonlar as readonly string[]).includes(c))),
    );
    if (i < 0) beyansiz.push(`${h.dosya}:${h.satir} ${h.tablo} SET[${h.setKolonlari.join(",")}]`);
    else kullanilan.add(i);
  }
  const olu = beyan.filter((_, i) => !kullanilan.has(i)).map((b) => `${b.dosya} ${b.tablo}`);
  return { beyansiz, olu };
}

function main(): void {
  console.log("=== PATRON BULUTU HAM UPDATE İSTİSNALARI ===\n");
  const r = spawnSync(process.execPath, [join(__dirname, "..", "node_modules", "tsx", "dist", "cli.mjs"), join(__dirname, "olcum", "patron-yazim-noktalari.ts"), "--json"], {
    cwd: join(__dirname, ".."),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  let o: Olcum | null = null;
  try {
    o = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))) as Olcum;
  } catch {
    o = null;
  }
  check("§0 ölçüm betiği koştu ve JSON üretti (üç sonuç: ölçülemedi ≠ temiz)", o !== null, o ? "" : (r.stderr || r.stdout).slice(0, 300));
  if (!o) {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(1);
  }
  check("§1 körlük zemini: ham UPDATE ve /permanent bağı bulundu", o.hamlar.length >= 20 && o.genel.length >= 1, `${o.hamlar.length} ham UPDATE · ${o.genel.length} bağ`);
  check("§2 ⭐ opt-in kolona updatedAt'siz ham yazım YOK", o.gorunmezGuncelleme.length === 0, o.gorunmezGuncelleme.map((h) => `${h.dosya}:${h.satir} ${h.tablo}→${h.optInDokunan.join(",")}`).join(" · ") || "0");
  const { beyansiz, olu } = beyanDenetimi(o.hamlar, HAM_UPDATE_BEYANI);
  check("§3 ⭐ updatedAt'siz her ham UPDATE beyanlı", beyansiz.length === 0, beyansiz.join(" · ") || `${o.hamlar.filter((h) => !h.updatedAtYazar).length} yazım beyanlı`);
  check("§4 ⭐ ölü beyan yok", olu.length === 0, olu.join(" · ") || `${HAM_UPDATE_BEYANI.length} beyan canlı`);
  check("§5 ⭐ katalog silme stratejisi ↔ kod silme yolları uyumlu", o.uyumsuz.length === 0, o.uyumsuz.join(" · ") || "uyumlu");
  const sonda = beyanDenetimi([{ tablo: "invoices", dosya: "src/x.ts", satir: 1, setKolonlari: ["paidTotal"], updatedAtYazar: false, optInDokunan: ["paidTotal"], dinamik: false }], HAM_UPDATE_BEYANI);
  check("§K1 ⭐ sentetik beyansız UPDATE denetçiyi kırmızı yapar", sonda.beyansiz.length === 1);
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
