// =============================================================================
// BEKÇİ — ATKI KARTINDA İPLİK PAYI % (Seyitoğlu 3. bölüm L3; DB'siz + statik)
// =============================================================================
//   §1 kütle payı = ipliğin atkı kg/m ÷ Σ (maliyet motoru `yarnUsagePerM`, gerçek sıklık/boy/fireyle aynı oran)
//   §2 denye eksik → atım sayısı payı + `shareBasis: "PICKS"`; satır yok / Σ atım 0 → null
//   §3 statik — helper motoru ÇAĞIRIR (formül sabiti 9 000 000 kopyalanmaz); kart dönen beş rota süslenir
// Negatif sonda (2026-11-12): kütle kolu atım payına çevrildi → §1a §1b ❌; `withWeftShares` GET /:id'den
// kaldırıldı → §3b ❌; geri alındı.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { weftYarnShares, withWeftShares } from "../src/services/helpers/weft-share.helper";
import { yarnUsagePerM, type CostInput } from "../src/services/helpers/fabric-cost.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
const D = (v: number | null) => (v == null ? null : new Prisma.Decimal(v));
const y = (id: string, picks: number, den: number | null) => ({ yarnItemId: id, picksInRepeat: picks, yarnItem: { name: id, linearDensityDen: D(den) } });

console.log("=== ATKI İPLİK PAYI BEKÇİSİ ===\n── §1 Kütle payı ──");
const a = weftYarnShares([y("A", 1, 100), y("B", 1, 300)]);
check("§1a ⭐ eşit atım, denye 100/300 → kütlece 25/75 (atım payı 50/50 DEĞİL)", a.basis === "MASS" && a.shares[0] === 25 && a.shares[1] === 75, JSON.stringify(a));
const b = weftYarnShares([y("A", 2, 150), y("B", 1, 150), y("C", 3, 50)]);
// kg ∝ picks × den: 300 · 150 · 150 → %50 · %25 · %25
check("§1b ⭐ üç iplik picks×denye oranında (50/25/25)", b.basis === "MASS" && JSON.stringify(b.shares) === "[50,25,25]", JSON.stringify(b));
// Gerçek terimlerle (sıklık 22.5, boy 182 cm, fire %4) motorun kg/m oranı aynı payı verir — ortak çarpanlar sadeleşir.
const real = yarnUsagePerM({
  schemaVersion: 1, warp: null,
  weft: {
    weftSpecId: null, picksPerCm: { value: D(22.5)!, source: "KART" }, lengthCm: { value: D(182)!, source: "PARAMETRE" }, wastePct: { value: D(4)!, source: "PARAMETRE" },
    yarns: [{ yarnItemId: "A", name: "A", denier: { value: D(100)!, source: "KART" }, price: null, picksInRepeat: 1 }, { yarnItemId: "B", name: "B", denier: { value: D(300)!, source: "KART" }, price: null, picksInRepeat: 1 }],
  },
} as unknown as CostInput).weft;
const realShare = real[0]!.kgPerM.div(real[0]!.kgPerM.plus(real[1]!.kgPerM)).mul(100).toDecimalPlaces(2).toNumber();
check("§1c gerçek sıklık/boy/fireyle motor oranı = normalize pay (sadeleşme)", realShare === a.shares[0], `${realShare} vs ${a.shares[0]}`);
const sum = b.shares.reduce((s, x) => s + x, 0);
check("§1d paylar toplamı 100 (±0,02)", Math.abs(sum - 100) <= 0.02, String(sum));

console.log("\n── §2 Esas düşümü ──");
const c = weftYarnShares([y("A", 3, 100), y("B", 1, null)]);
check("§2a ⭐ bir ipliğin denyesi yok → atım payı 75/25 + basis PICKS", c.basis === "PICKS" && JSON.stringify(c.shares) === "[75,25]", JSON.stringify(c));
check("§2b satır yok → basis null, pay yok", JSON.stringify(weftYarnShares([])) === JSON.stringify({ basis: null, shares: [] }));
check("§2c Σ atım 0 → basis null", weftYarnShares([y("A", 0, 100)]).basis === null);
const dec = withWeftShares({ id: "k", yarns: [y("A", 1, 100), y("B", 1, 300)] });
check("§2d süs: kart `shareBasis`, satır `sharePct`; diğer alanlar korunur", dec.shareBasis === "MASS" && dec.yarns[1]!.sharePct === 75 && dec.id === "k" && dec.yarns[0]!.yarnItemId === "A");
const empty = withWeftShares({ id: "k", yarns: [] as ReturnType<typeof y>[] });
check("§2e boş kart süsü: shareBasis null, yarns []", empty.shareBasis === null && empty.yarns.length === 0);

console.log("\n── §3 Statik ──");
const SRC = path.join(__dirname, "..", "src");
const helper = readFileSync(path.join(SRC, "services/helpers/weft-share.helper.ts"), "utf8");
check("§3a helper motoru çağırır (`yarnUsagePerM`), formül sabiti kopyalanmaz", /yarnUsagePerM\(input\)/.test(helper) && !/9_?000_?000/.test(helper));
const rota = readFileSync(path.join(SRC, "routes/weft-spec.routes.ts"), "utf8");
const susler = [
  /listWeftSpecs\([^)]*\)\)\)\.map\(withWeftShares\)/,
  /withWeftShares\(await getWeftSpec\(id\)\)/,
  /withWeftShares\(await createWeftSpec\(/,
  /withWeftShares\(await updateWeftSpec\(/,
  /weftSpec: withWeftShares\(forked\.weftSpec\)/,
];
const eksik = susler.filter((r) => !r.test(rota)).map(String);
check("§3b ⭐ kart dönen beş yanıt (liste · detay · oluştur · güncelle · kopya) süslü", eksik.length === 0, eksik.join(" | "));

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
