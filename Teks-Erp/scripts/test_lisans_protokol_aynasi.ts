// =============================================================================
// LİSANS PROTOKOLÜ AYNASI — `Teks-Erp/src/lib/license/protocol/` TEK KAYNAKTIR; satıcı sunucusu
// (`satici/sunucu/src/lisans-protokol/`) ve patron bulutu sunucusu (`patron/sunucu/src/lisans-protokol/`)
// aynı dosyaları BAYT-EŞİT taşır.
// Ayna bozulursa iki taraf aynı belgeyi farklı doğrular (imza/şema/kod farkı) ve hata sessizdir:
// fabrika reddeder, satıcı "verdim" sanır. Emsal: `test_mobil_enum_aynasi`.
//
// ÖLÇÜM: dosya KÜMESİ birebir (eksik de fazla da kırmızı) + her dosyanın sha256'sı birebir.
// Boş kaynak "iki boş küme eşit" diye yeşil veremez (kaynak ≥ 5 dosya şartı).
// ÜÇ SONUÇ: zorunlu ayna (satıcı · patron sunucusu) yoksa KIRMIZI; henüz doğmamış ayna yalnız
//   ⏭ beyanla geçilir — yokluk "eşit" sayılmaz, "ölçülmedi" diye söylenir.
// Düzeltme: değişiklik ÖNCE kaynakta, sonra `cp -p Teks-Erp/src/lib/license/protocol/*.ts <ayna>/`.
//
// ⭐ KALICI SONDA ✓K3 (her koşumda): karşılaştırıcı sentetik kümelerde ısırır — içerik farkı ·
//    aynada eksik dosya · aynada fazla dosya (ve özdeş kümede SUSAR).
// Koşum: npx tsx scripts/test_lisans_protokol_aynasi.ts   (DB GEREKMEZ)
// =============================================================================
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const KOK = path.resolve(__dirname, "..", "..");
const KAYNAK = "Teks-Erp/src/lib/license/protocol";
const AYNALAR: readonly { dizin: string; zorunlu: boolean; not: string }[] = [
  { dizin: "satici/sunucu/src/lisans-protokol", zorunlu: true, not: "satıcı sunucusu (Faz 1b)" },
  { dizin: "patron/sunucu/src/lisans-protokol", zorunlu: true, not: "patron bulutu sunucusu (Plan B, B2)" },
];

/** Dizindeki dosyalar → sha256 (alt dizin yok sayılmaz: klasör düz olmalı, alt dizin de fark sayılır). */
export function ozetler(dizin: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const ad of readdirSync(dizin).sort()) {
    const p = path.join(dizin, ad);
    if (statSync(p).isDirectory()) {
      out.set(`${ad}/`, "DIZIN");
      continue;
    }
    out.set(ad, createHash("sha256").update(readFileSync(p)).digest("hex"));
  }
  return out;
}

export interface AynaFarki {
  readonly icerik: string[];
  readonly aynadaEksik: string[];
  readonly aynadaFazla: string[];
}

export function aynaFarki(kaynak: ReadonlyMap<string, string>, ayna: ReadonlyMap<string, string>): AynaFarki {
  return {
    icerik: [...kaynak].filter(([ad, h]) => ayna.has(ad) && ayna.get(ad) !== h).map(([ad]) => ad),
    aynadaEksik: [...kaynak.keys()].filter((ad) => !ayna.has(ad)),
    aynadaFazla: [...ayna.keys()].filter((ad) => !kaynak.has(ad)),
  };
}

const temiz = (d: AynaFarki) => d.icerik.length === 0 && d.aynadaEksik.length === 0 && d.aynadaFazla.length === 0;

function main(): void {
  console.log("\n§1 kaynak");
  const kaynakDizin = path.join(KOK, KAYNAK);
  const kaynak = existsSync(kaynakDizin) ? ozetler(kaynakDizin) : new Map<string, string>();
  check(`§1a kaynak klasör dolu (${KAYNAK})`, kaynak.size >= 5, `${kaynak.size} dosya`);

  console.log("\n§2 aynalar");
  for (const a of AYNALAR) {
    const dizin = path.join(KOK, a.dizin);
    if (!existsSync(dizin)) {
      if (a.zorunlu) check(`§2 ${a.dizin} VAR`, false, `zorunlu ayna yok — ${a.not}`);
      else console.log(`⏭ ${a.dizin} ölçülmedi: ${a.not}`);
      continue;
    }
    const fark = aynaFarki(kaynak, ozetler(dizin));
    check(`§2 ${a.dizin} kaynakla BAYT-EŞİT`, temiz(fark) && kaynak.size > 0, temiz(fark) ? `${kaynak.size} dosya` : `içerik farkı: ${fark.icerik.join(",") || "—"} · eksik: ${fark.aynadaEksik.join(",") || "—"} · fazla: ${fark.aynadaFazla.join(",") || "—"}`);
  }

  console.log("\n§3 ✓K sondaları (sentetik kümeler)");
  const k = new Map([
    ["a.ts", "1"],
    ["b.ts", "2"],
  ]);
  check("§3a içerik farkı ısırır", aynaFarki(k, new Map([["a.ts", "1"], ["b.ts", "X"]])).icerik.includes("b.ts"));
  check("§3b aynada eksik dosya ısırır", aynaFarki(k, new Map([["a.ts", "1"]])).aynadaEksik.includes("b.ts"));
  check("§3c aynada fazla dosya ısırır", aynaFarki(k, new Map([...k, ["c.ts", "3"]])).aynadaFazla.includes("c.ts"));
  check("§3d özdeş kümede susar", temiz(aynaFarki(k, new Map(k))));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
