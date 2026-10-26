// =============================================================================
// BEKÇİ — CI PARÇALI KOŞUMU: her bekçi TAM bir parçada (sessiz atlanan yok)
// Çalıştır: npx tsx scripts/run-all-tests.ts ci_parca
// =============================================================================
// NEDEN: CI bekçi paketini 8 parçaya böler (`scripts/lib/parca.ts`, `ci.yml`
// `backend-test`). Parçalamanın tek kabul edilemez arızası SESSİZ KAPSAM KAYBIDIR:
// hiçbir parçaya düşmeyen dosya hiç koşmaz ve yeşil paket onu söylemez. Üç ayak:
//   §1–§4 dağıtım saf işlevi: birleşim = küme, kesişim boş, belirlenimli, dengeli,
//         yeni dosya ad özetiyle yer bulur, sabit grup bölünmez.
//   §5–§6 birleşim denetimi (özet işin kapısı): işlev + koşucunun `--birlesim` kipi,
//         negatif sondalarla (dosya düşür → kırmızı).
//   §7    `ci.yml` hizası: matrix listesi 1..N ↔ `--shard …/N` ↔ özet işin kapısı.
// DB GEREKTİRMEZ.
// =============================================================================
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cocukOrtami } from "./lib/hedef-db-kapisi";
import {
  SABIT_GRUPLAR,
  birlesimDenetimi,
  ozetParcasi,
  parcaArgumaniCoz,
  parcalariKur,
  parcaYukleri,
  sureTablosuOku,
  type ParcaKaydi,
} from "./lib/parca";

const SCRIPTS_DIR = __dirname;
const KOK = join(__dirname, "..", "..");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

const dosyalar = readdirSync(SCRIPTS_DIR).filter((f) => /^test_.*\.ts$/.test(f)).sort();
const sureler = sureTablosuOku();
const kayitlariKur = (p: string[][]): ParcaKaydi[] =>
  p.map((d, k) => ({ parca: k + 1, toplam: p.length, sha: "x", dosyalar: [...d], basarisiz: [], sureler: {} }));

console.log("\n§1 — dağıtım: birleşim = bütün bekçiler, kesişim boş, belirlenimli\n");
check("§1 körlük zemini: bekçi kümesi dolu", dosyalar.length > 400, `${dosyalar.length} dosya`);
for (const n of [1, 2, 3, 8, 13]) {
  const p = parcalariKur(dosyalar, n, sureler);
  const duz = p.flat();
  const tekil = new Set(duz);
  check(
    `§1 N=${n}: ${n} parça · birleşim = küme · kesişim boş`,
    p.length === n && duz.length === dosyalar.length && tekil.size === dosyalar.length && dosyalar.every((f) => tekil.has(f)),
    `${duz.length} yerleşim / ${tekil.size} tekil / ${dosyalar.length} dosya`,
  );
  const grupsuz = (d: string[]) => d.filter((f) => !SABIT_GRUPLAR.some((g) => g.includes(f)));
  check(
    `§1 N=${n}: belirlenimli (aynı girdi → aynı çıktı) ve parça içi ada göre sıralı (sabit grup blokları hariç)`,
    JSON.stringify(p) === JSON.stringify(parcalariKur([...dosyalar].reverse(), n, sureler)) &&
      p.every((d) => grupsuz(d).every((f, k, a) => k === 0 || a[k - 1]! < f)),
  );
}

console.log("\n§2 — denge (N=8, süre tablosuna göre)\n");
{
  const p = parcalariKur(dosyalar, 8, sureler);
  const yuk = parcaYukleri(p, sureler);
  const ort = yuk.reduce((s, x) => s + x, 0) / 8;
  const enUzun = Math.max(...dosyalar.map((f) => sureler[f] ?? 0));
  check(
    "§2 en yüklü parça ≤ max(en uzun dosya, ortalama × 1,15)",
    Math.max(...yuk) <= Math.max(enUzun, ort * 1.15),
    `parçalar ${yuk.map((x) => x.toFixed(0)).join("/")}s · ortalama ${ort.toFixed(0)}s · en uzun dosya ${enUzun}s`,
  );
  const bilinmeyen = dosyalar.filter((f) => sureler[f] === undefined);
  const bayat = Object.keys(sureler).filter((f) => !dosyalar.includes(f));
  console.log(`   ÖLÇÜ: tabloda olmayan ${bilinmeyen.length} dosya (ad özetiyle yerleşir) · tabloda olup diskte olmayan ${bayat.length}`);
}

console.log("\n§3 — tabloda olmayan (yeni) dosya\n");
{
  const yeni = "test_zz_parca_sondasi_yeni.ts";
  const once = parcalariKur(dosyalar, 8, sureler);
  const sonra = parcalariKur([...dosyalar, yeni], 8, sureler);
  const k = sonra.findIndex((d) => d.includes(yeni));
  check("§3 yeni dosya ad özetinin parçasına düşer", k === ozetParcasi(yeni, 8), `parça ${k + 1}`);
  check(
    "§3 yeni dosya BİLİNENLERİN yerini oynatmaz",
    sonra.every((d, j) => JSON.stringify(d.filter((f) => f !== yeni)) === JSON.stringify(once[j])),
  );
}

console.log("\n§4 — sabit gruplar (gizli sıra bağımlılığı)\n");
{
  const p = parcalariKur(dosyalar, 8, sureler);
  const yer = (f: string) => p.findIndex((d) => d.includes(f));
  const a = dosyalar.find((f) => sureler[f] !== undefined)!;
  const b = dosyalar.find((f) => sureler[f] !== undefined && yer(f) !== yer(a))!;
  const g = parcalariKur(dosyalar, 8, sureler, [[b, a]]);
  const gy = (f: string) => g.findIndex((d) => d.includes(f));
  check("§4 sentetik grup: farklı parçadaki iki dosya AYNI parçaya düşer", gy(a) === gy(b) && gy(a) >= 0, `${a} · ${b}`);
  check("§4 sentetik grupla da birleşim tam", birlesimDenetimi(dosyalar, kayitlariKur(g)).length === 0);
  const olu = SABIT_GRUPLAR.flat().filter((f) => !dosyalar.includes(f));
  check("§4 SABIT_GRUPLAR üyelerinin hepsi diskte (ölü üye yok)", olu.length === 0, olu.join(", ") || `${SABIT_GRUPLAR.length} grup`);
  const bitisik = (d: string[], grup: readonly string[]) => {
    const k = d.indexOf(grup[0]!);
    return k >= 0 && grup.every((f, j) => d[k + j] === f);
  };
  for (const grup of SABIT_GRUPLAR) {
    check(`§4 sabit grup tek parçada, BİTİŞİK ve yazılı sırada: ${grup.join(" → ")}`, p.some((d) => bitisik(d, grup)));
  }
  // Sonda: bir blok, ada göre araya düşecek bir bekçiyle bölünmüyor (ters adlı grup).
  const ters = [dosyalar[dosyalar.length - 1]!, dosyalar[0]!];
  const tp = parcalariKur(dosyalar, 8, sureler, [ters]);
  check("§4 sonda: ad sırasına TERS grup da bitişik ve yazılı sırada koşar", tp.some((d) => bitisik(d, ters)), ters.join(" → "));
}

console.log("\n§5 — birleşim denetimi (işlev) + negatif sondalar\n");
{
  const p = parcalariKur(dosyalar, 8, sureler);
  const tam = kayitlariKur(p);
  check("§5 gerçek dağıtım → yeşil", birlesimDenetimi(dosyalar, tam).length === 0);
  const dusur = kayitlariKur(p);
  const dusen = dusur[2]!.dosyalar.pop()!;
  const h1 = birlesimDenetimi(dosyalar, dusur);
  check("§5 sonda: bir dosya düşürüldü → ADIYLA kırmızı", h1.some((h) => h.includes("HİÇBİR PARÇADA") && h.includes(dusen)), h1[0] ?? "");
  const cift = kayitlariKur(p);
  cift[0]!.dosyalar.push(cift[1]!.dosyalar[0]!);
  check("§5 sonda: bir dosya iki parçada → kırmızı", birlesimDenetimi(dosyalar, cift).some((h) => h.includes("BİRDEN ÇOK")));
  check("§5 sonda: bir parçanın kaydı yok → kırmızı", birlesimDenetimi(dosyalar, tam.slice(1)).length > 0);
  check(
    "§5 sonda: diskte olmayan dosya kayıtta → kırmızı",
    birlesimDenetimi(dosyalar, kayitlariKur([...p.slice(0, 7), [...p[7]!, "test_hayalet.ts"]])).some((h) => h.includes("diskte yok")),
  );
  check("§5 sonda: hiç kayıt yok → kırmızı", birlesimDenetimi(dosyalar, []).length > 0);
  check(
    "§5 sonda: kayıtlar farklı N taşıyor → kırmızı",
    birlesimDenetimi(dosyalar, tam.map((k, j) => (j === 0 ? { ...k, toplam: 9 } : k))).length > 0,
  );
  check(
    "§5 `i/N` çözümü: 3/8 geçer · 0/8, 9/8, 8, boş reddedilir",
    JSON.stringify(parcaArgumaniCoz("3/8")) === '{"i":3,"n":8}' &&
      [parcaArgumaniCoz("0/8"), parcaArgumaniCoz("9/8"), parcaArgumaniCoz("8"), parcaArgumaniCoz("")].every((x) => x === null),
  );
}

console.log("\n§6 — koşucunun `--birlesim` kipi (özet işin GERÇEK komutu)\n");
{
  const p = parcalariKur(dosyalar, 8, sureler);
  const kos = (kayitlar: ParcaKaydi[]) => {
    const dizin = mkdtempSync(join(tmpdir(), "tekserp-parca-"));
    try {
      for (const k of kayitlar) writeFileSync(join(dizin, `parca-${k.parca}.json`), JSON.stringify(k));
      const r = spawnSync("npx", ["tsx", join(SCRIPTS_DIR, "run-all-tests.ts"), "--birlesim", dizin], {
        encoding: "utf8",
        env: cocukOrtami(),
        shell: process.platform === "win32",
        timeout: 120_000,
      });
      return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    } finally {
      rmSync(dizin, { recursive: true, force: true });
    }
  };
  const yesil = kos(kayitlariKur(p));
  check("§6 tam kayıt kümesi → çıkış 0", yesil.status === 0, yesil.out.trim().split("\n").at(-1) ?? "");
  const eksik = kayitlariKur(p);
  const dusen = eksik[4]!.dosyalar.shift()!;
  const kirmizi = kos(eksik);
  check(
    "§6 sonda: bir dosya düşürüldü → çıkış 1 ve dosya ADIYLA basıldı",
    kirmizi.status === 1 && kirmizi.out.includes(`HİÇBİR PARÇADA KOŞMADI: ${dusen}`),
    `exit ${kirmizi.status}`,
  );
}

console.log("\n§7 — ci.yml hizası (matrix 1..N ↔ --shard …/N ↔ özet iş)\n");
{
  const ci = readFileSync(join(KOK, ".github/workflows/ci.yml"), "utf8");
  const hiza = (y: string): string[] => {
    const ihlal: string[] = [];
    const liste = /^\s+parca:\s*\[([\d,\s]+)\]\s*$/m.exec(y)?.[1]?.split(",").map((x) => Number(x.trim()));
    const shardN = [...y.matchAll(/--shard \$\{\{ matrix\.parca \}\}\/(\d+)/g)].map((m) => Number(m[1]));
    if (!liste) ihlal.push("matrix `parca: [...]` listesi yok");
    if (shardN.length !== 1) ihlal.push(`\`--shard \${{ matrix.parca }}/N\` ${shardN.length} kez (beklenen 1)`);
    const n = shardN[0] ?? 0;
    if (liste && JSON.stringify(liste) !== JSON.stringify(Array.from({ length: n }, (_, k) => k + 1)))
      ihlal.push(`matrix [${liste.join(",")}] ≠ 1..${n}`);
    const ozet = /^ {2}backend:\n([\s\S]*?)(?=^ {2}[\w-]+:\n)/m.exec(y)?.[1] ?? "";
    if (!/name: Backend \(tsc \+ test\)/.test(ozet)) ihlal.push("özet iş adı `Backend (tsc + test)` değil");
    if (!/needs: \[backend-lint, backend-test\]/.test(ozet)) ihlal.push("özet iş iki işi beklemiyor");
    if (!/run-all-tests\.ts --birlesim/.test(ozet)) ihlal.push("özet iş birleşim denetimini koşmuyor");
    if (!/needs\.backend-lint\.result \}\}" = "success" \] && \[ "\$\{\{ needs\.backend-test\.result/.test(ozet))
      ihlal.push("özet iş iki işin sonucunu şart koşmuyor");
    if (!/TEKSERP_PARCA_KAYIT: \/tmp\/parca\/parca-\$\{\{ matrix\.parca \}\}\.json/.test(y)) ihlal.push("parça kaydı yolu yok");
    return ihlal;
  };
  const ih = hiza(ci);
  check("§7 ⭐ ci.yml parçalı koşum hizalı", ih.length === 0, ih.join(" · ") || "temiz");
  const sondalar: [string, string][] = [
    ["matrix bir parça eksik", ci.replace(/parca: \[1, 2, 3, 4, 5, 6, 7, 8\]/, "parca: [1, 2, 3, 4, 5, 6, 7]")],
    ["birleşim adımı silindi", ci.replace(/run-all-tests\.ts --birlesim/, "run-all-tests.ts --yok")],
    ["özet iş sonucu şart koşmuyor", ci.replace(/\] && \[ "\$\{\{ needs\.backend-test\.result \}\}" = "success" \]/, "]")],
  ];
  for (const [ad, mutant] of sondalar) {
    check(`§7 sonda: ${ad} → kırmızı`, mutant !== ci && hiza(mutant).length > 0, mutant === ci ? "MUTASYON UYGULANMADI" : "");
  }
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
