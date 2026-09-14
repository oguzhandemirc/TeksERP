// =============================================================================
// ETKİ LİSTESİ — "bu değişikliği ANAN bekçiler hangileri?"
// =============================================================================
// KAPI DEĞİL, ÖLÇÜM YARDIMCISI. Hiçbir şeyi durdurmaz; sha teslim etmeden önce
// "hangi bekçileri koşturmalıyım" sorusuna ÖLÇÜLMÜŞ bir cevap verir.
//
// ⭐ NEDEN VAR (bu gecenin üç vakası, 2026-09-14): bir YAZICI değişti, onu ANAN
// bekçiler koşulmadı ve kırmızı CI'da çıktı — üç kez, üç ayrı alanda:
//   · K2 `SackAllocation` sil-yaz → DAMGA (`clearedAt`): ürün okuyucularının
//     yedisi de düzgün süzüldü ama `test_sack_pool_lifecycle`ın `allocOf`u
//     süzgeçsiz kaldı ⇒ 45/2 (`A3` toplam, `I4` "silindi" iddiası).
//   · ENTRY_CORRECTION yazıcısı → `test_roll_relabel` fikstür temizliğinin FK'sı.
//   · Faz 1b router'ı → `production_regime_gate` CI'da yakaladı.
// Üçünde de kusur koddaki bir hata DEĞİL, **ölçüm kapsamının eksikliğiydi**:
// *"dizini tarayan bütün tarayıcılara koştur"* kuralı biliniyordu ama HANGİLERİ
// olduğu her seferinde elle çıkarılıyordu.
//
// KULLANIM
//   npx tsx scripts/etki-listesi.ts --cached      # sahnelenmiş değişiklik
//   npx tsx scripts/etki-listesi.ts <sha>         # tek commit
//   npx tsx scripts/etki-listesi.ts <sha1>..<sha2>
//   npx tsx scripts/etki-listesi.ts --sonda       # kendi yüklemini ölçer
//
// ⚠️ SINIRI: bu araç METİN anması ölçer, çağrı GRAFİĞİ değil. Bir bekçi modeli
//    dolaylı (servis üzerinden) kullanıyorsa ve adını hiç yazmıyorsa listeye
//    GİRMEZ. ⇒ Liste bir ALT SINIRDIR, "bunlar yeter" demez. Tam kapsam `npm test`.
// =============================================================================
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const KOK = path.resolve(__dirname, "..");
const REPO = path.resolve(KOK, "..");

/** Bir token'ın bekçilerin bu kadarından fazlasında geçmesi = ÇOK GENEL. */
export const GENEL_ORAN = 0.25;
/** Bu uzunluğun altındaki token gürültüdür (`ok`, `tx`, `id`…). */
export const ASGARI_UZUNLUK = 4;

export type Bulgu = { token: string; kaynak: string };

/**
 * Değişen bir dosyadan ARANACAK TOKEN'lar: kullandığı Prisma delegeleri, ihraç
 * ettiği semboller ve dosyanın kendi adı (helper/route adı).
 */
export function tokenlar(kaynak: string, dosyaYolu: string): Map<string, string> {
  const out = new Map<string, string>();
  const ekle = (t: string, nereden: string): void => {
    if (t.length >= ASGARI_UZUNLUK && !out.has(t)) out.set(t, nereden);
  };
  for (const m of kaynak.matchAll(/(?:prisma|tx|db)\.([a-z][A-Za-z0-9]*)\./g)) ekle(m[1], "model");
  for (const m of kaynak.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)) ekle(m[1], "yeni sembol");
  for (const m of kaynak.matchAll(/export\s+const\s+([A-Za-z0-9_]+)/g)) ekle(m[1], "yeni sembol");
  for (const m of kaynak.matchAll(/export\s+(?:type|interface|enum)\s+([A-Za-z0-9_]+)/g)) ekle(m[1], "yeni sembol");
  const ad = path.basename(dosyaYolu).replace(/\.(ts|tsx)$/, "");
  if (/\.(helper|routes|service|job)$/.test(ad)) ekle(ad, "dosya adı");
  return out;
}

/**
 * YAYGIN MODEL SEDDİ — saf. Bekçilerin `GENEL_ORAN`ından fazlasının andığı model
 * ayırt edici değildir (`roll`, `order`, `user`) ve odaktan düşer.
 * ⚠️ Düşen BASILIR: sessizce elenirse okuyan kapsamı yanlış sanır.
 */
export function yayginlar(modeller: string[], df: (m: string) => number, bekciSayisi: number): string[] {
  const esik = Math.max(3, Math.floor(bekciSayisi * GENEL_ORAN));
  return modeller.filter((m) => df(m) > esik);
}

/**
 * ⭐ ODAK MODELLER — değişen ŞEMA SATIRLARININ düştüğü model blokları.
 *
 * Bunu ölçmenin başka yolu yoktu: `d05067c3`te `+model X` satırı YOKTUR (model
 * zaten vardı, yalnız kolon eklendi) ⇒ diff'te model adı aramak işe yaramaz.
 * ⚠️ Ve "değişen dosyalardaki BÜTÜN delegeler" de işe yaramaz: o küme 30 model
 * verdi ve A kademesi 553 bekçinin **267**'sine çıktı (ölçüldü 2026-09-14).
 * Doğru kaynak, değişen satırın HANGİ MODEL BLOĞUNDA olduğu: `SackAllocation`
 * (+ geri ilişki yüzünden `User`; `user` yaygın olduğu için sed düşürür).
 */
export function odakModeller(semaDiffU0: string, yeniSema: string): string[] {
  const satirlar: number[] = [];
  for (const m of semaDiffU0.matchAll(/^@@ .* \+(\d+)(?:,(\d+))? @@/gm)) {
    const bas = Number(m[1]);
    const n = Math.max(Number(m[2] ?? 1), 1);
    for (let i = 0; i < n; i++) satirlar.push(bas + i);
  }
  const bloklar: Array<{ ad: string; bas: number; son: number }> = [];
  let cur: { ad: string; bas: number } | null = null;
  yeniSema.split("\n").forEach((l, idx) => {
    const mm = /^model (\w+) \{/.exec(l);
    if (mm) cur = { ad: mm[1], bas: idx + 1 };
    else if (l.startsWith("}") && cur) {
      bloklar.push({ ad: cur.ad, bas: cur.bas, son: idx + 1 });
      cur = null;
    }
  });
  const out = new Set<string>();
  for (const s of satirlar) {
    for (const b of bloklar) if (s >= b.bas && s <= b.son) out.add(b.ad.charAt(0).toLowerCase() + b.ad.slice(1));
  }
  return [...out].sort();
}

export type Kademe = { A: string[]; B: string[]; C: string[] };
/** Modeli OKUYAN çağrı biçimleri — anmak ile OKUMAK ayrı şeydir. */
const OKUMA = "(findMany|findFirst|findUnique|findUniqueOrThrow|aggregate|groupBy|count)";

/**
 * ⭐ KADEMELİ TRİYAJ — ve bu kurgu bir ÇÜRÜTMENİN ürünüdür.
 *
 * İlk hâlim "değişen sembolleri ANAN bekçileri sırala" idi (IDF ağırlıklı).
 * Ölçüldü (2026-09-14, `d05067c3`): 553 bekçinin 379'u listeye girdi ve
 * **gerçekten kırılan bekçi listede 31. sıradaydı**; IDF eklenince ilk 20'den
 * tamamen DÜŞTÜ. Sebep yapısaldı: *kırılan bekçi, tam olarak YENİ API'Yİ
 * ANMAYAN bekçidir* — yalnız eski yüzeyi anar. "Yeniyi anma"ya göre sıralamak
 * bu sınıfa karşı ÖNYARGILIDIR.
 * ⇒ Doğru ayırt edici TERSİDİR: modeli OKUYOR ama yeni sembollerin hiçbirini
 *   anmıyor ⇒ **okuyucusu güncellenmemiş olabilir**. Ölçüm: 553 → **3**, ve
 *   kırılan bekçi o üçün içinde.
 */
export function kademele(
  modeller: string[],
  yeniSemboller: string[],
  bekciler: Map<string, string>,
): Kademe {
  const A: string[] = [];
  const B: string[] = [];
  const C: string[] = [];
  const yeniRe = yeniSemboller.length
    ? new RegExp(`\\b(${yeniSemboller.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`)
    : null;
  for (const [ad, kaynak] of bekciler) {
    const yeniyiAniyor = yeniRe !== null && yeniRe.test(kaynak);
    const okuyor = modeller.some((m) => new RegExp(`${m}\\.${OKUMA}`).test(kaynak));
    const aniyor = modeller.some((m) => new RegExp(`\\b${m}\\b`).test(kaynak));
    if (yeniyiAniyor) B.push(ad);
    else if (okuyor) A.push(ad);
    else if (aniyor) C.push(ad);
  }
  return { A: A.sort(), B: B.sort(), C: C.sort() };
}

function degisenDosyalar(hedef: string): string[] {
  const argv =
    hedef === "--cached"
      ? ["diff", "--cached", "--name-only"]
      : hedef.includes("..")
        ? ["diff", "--name-only", hedef]
        : ["show", "--name-only", "--format=", hedef];
  return execFileSync("git", argv, { cwd: REPO, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("/scripts/test_"));
}

function bekciKaynaklari(): Map<string, string> {
  const out = new Map<string, string>();
  const dosyalar = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "Teks-Erp/scripts"],
    { cwd: REPO, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter((f) => /\/test_[a-z0-9_]+\.ts$/.test(f));
  for (const f of dosyalar) {
    try {
      out.set(path.basename(f), readFileSync(path.join(REPO, f), "utf8"));
    } catch {
      /* okunamayan dosya atlanır — liste alt sınırdır */
    }
  }
  return out;
}

function sonda(): number {
  let fail = 0;
  const ok = (l: string, k: boolean, d = ""): void => {
    console.log(`${k ? "✅" : "❌"} ${l}${d ? " — " + d : ""}`);
    if (!k) fail++;
  };
  console.log("=== etki-listesi kendi yüklemini ölçüyor ===\n");

  // ① token çıkarımı — model ile YENİ SEMBOL ayrı sınıflar
  const t = tokenlar(
    'export const ACTIVE_SACK = 1;\nexport function yazTx() { return prisma.sackAllocation.create(); }\n',
    "src/services/helpers/sack-allocation.helper.ts",
  );
  ok("① model token'ı çıktı", t.get("sackAllocation") === "model");
  ok("① yeni sembol (fonksiyon) çıktı", t.get("yazTx") === "yeni sembol");
  ok("① yeni sembol (sabit) çıktı", t.get("ACTIVE_SACK") === "yeni sembol");
  ok("① dosya adı (helper) çıktı", t.has("sack-allocation.helper"));
  ok("① kısa token ELENDİ", !t.has("tx"), `asgari ${ASGARI_UZUNLUK}`);

  // ② ODAK MODEL — değişen satır HANGİ model bloğunda
  const sema = "model Renk {\n  id String\n  ad String\n}\nmodel Kutu {\n  id String\n}\n";
  ok(
    "② ⭐ değişen satır Renk bloğunda ⇒ odak `renk`",
    odakModeller("@@ -3 +3 @@\n", sema).join() === "renk",
    odakModeller("@@ -3 +3 @@\n", sema).join(),
  );
  ok(
    "② ⭐ başka bloktaki satır ⇒ odak `kutu` (blok sınırı doğru)",
    odakModeller("@@ -6 +6 @@\n", sema).join() === "kutu",
  );
  ok("② diff boşsa odak BOŞ", odakModeller("", sema).length === 0);

  // ③ KADEMELER — 1e'nin istediği sentetik ağaç + ÇÜRÜTMENİN kontrol grubu
  const bekciler = new Map<string, string>([
    ["test_okur_eski.ts", "await prisma.sackAllocation.aggregate({ where: { orderLineId: id } });"],
    ["test_okur_yeni.ts", "await prisma.sackAllocation.aggregate({ where: { ...ACTIVE_ALLOCATION } });"],
    ["test_yalniz_anar.ts", "// sackAllocation damgası belgede anlatılıyor"],
    ["test_ilgisiz.ts", "await prisma.roll.count({});"],
  ]);
  const k = kademele(["sackAllocation"], ["ACTIVE_ALLOCATION"], bekciler);
  ok("③ ⭐ A: modeli OKUYAN + yeniyi ANMAYAN", k.A.join() === "test_okur_eski.ts", k.A.join());
  ok("③ ⭐ B: yeniyi ANAN A'da DEĞİL", k.B.join() === "test_okur_yeni.ts", k.B.join());
  ok("③ ⭐ C: yalnız anan, okumayan ayrı kademe", k.C.join() === "test_yalniz_anar.ts", k.C.join());
  ok("③ ilgisiz bekçi hiçbir kademede yok", !k.A.includes("test_ilgisiz.ts") && !k.C.includes("test_ilgisiz.ts"));

  // ④ YAYGIN SEDDİ
  ok("④ ⭐ yaygın model düşer", yayginlar(["roll"], () => 300, 553).join() === "roll");
  ok("④ ayırt edici model KALIR", yayginlar(["sackAllocation"], () => 33, 553).length === 0);

  console.log(`\n=== Sonda sonucu: ${fail === 0 ? "temiz" : `${fail} başarısız`} ===`);
  return fail;
}

function main(): void {
  const hedef = process.argv[2];
  if (hedef === "--sonda") {
    process.exit(sonda() > 0 ? 1 : 0);
  }
  if (!hedef) {
    console.log("kullanım: npx tsx scripts/etki-listesi.ts <--cached | sha | sha1..sha2 | --sonda>");
    process.exit(2);
  }
  const degisen = degisenDosyalar(hedef);
  if (degisen.length === 0) {
    console.log(`⚠️ ${hedef}: değişen .ts dosyası YOK (ya da yalnız bekçi/doküman değişti) — etki listesi BOŞ.`);
    console.log("   ⚠️ Boş liste 'etki yok' DEMEZ: bu araç METİN anması ölçer, çağrı grafiği değil.");
    return;
  }
  const tumTokenlar = new Map<string, string>();
  for (const f of degisen) {
    let kaynak = "";
    try {
      kaynak = readFileSync(path.join(REPO, f), "utf8");
    } catch {
      continue; // silinmiş dosya — adı yine token olarak kalır
    }
    for (const [t, nereden] of tokenlar(kaynak, f)) if (!tumTokenlar.has(t)) tumTokenlar.set(t, `${nereden} · ${f}`);
  }
  // ODAK: şema değiştiyse değişen satırların model blokları; değişmediyse
  // değişen dosyalardaki delegeler. İkisinde de YAYGIN modeller düşer.
  let modeller: string[] = [];
  // ⚠️ `degisen` YALNIZ .ts süzüyor ⇒ `schema.prisma` orada YOKTUR. Şema
  // değişikliğini AYRI sor; ilk yazımda bunu atlayıp odak yolunu hiç
  // tetikleyememiştim (A kademesi 171'de kaldı).
  const aralikArgv = hedef === "--cached" ? ["diff", "--cached", "-U0"] : hedef.includes("..") ? ["diff", "-U0", hedef] : ["diff", "-U0", `${hedef}^`, hedef];
  const semaDiff = execFileSync("git", [...aralikArgv, "--", "Teks-Erp/prisma/schema.prisma"], { cwd: REPO, encoding: "utf8" });
  if (semaDiff.trim() !== "") {
    modeller = odakModeller(semaDiff, readFileSync(path.join(KOK, "prisma/schema.prisma"), "utf8"));
  }
  if (modeller.length === 0) modeller = [...tumTokenlar].filter(([, n]) => n.startsWith("model")).map(([t]) => t);
  // ⚠️ YAYGIN MODEL SEDDİ: bekçilerin çeyreğinden fazlasının okuduğu bir model
  // ayırt edici değildir (`roll`, `order`, `user`). Düşer ve DÜŞTÜĞÜ BASILIR.
  const bekcilerOn = bekciKaynaklari();
  const df = (m: string): number => [...bekcilerOn.values()].filter((k) => new RegExp(`\\b${m}\\b`).test(k)).length;
  const yayginEsik = Math.max(3, Math.floor(bekcilerOn.size * GENEL_ORAN));
  const yaygin = modeller.filter((m) => df(m) > yayginEsik);
  modeller = modeller.filter((m) => !yaygin.includes(m));
  const yeniSemboller = [...tumTokenlar].filter(([, n]) => n.startsWith("yeni sembol")).map(([t]) => t);
  const bekciler = bekcilerOn;
  const { A, B, C } = kademele(modeller, yeniSemboller, bekciler);

  console.log(`\n=== ETKİ LİSTESİ · ${hedef} ===`);
  console.log(
    `değişen .ts: ${degisen.length} · model: ${modeller.length} · yeni sembol: ${yeniSemboller.length} · bekçi: ${bekciler.size}`,
  );
  console.log(`ODAK model: ${modeller.join(", ") || "(yok)"}${yaygin.length ? `  ⚠️ yaygın düştü: ${yaygin.join(", ")}` : ""}`);

  console.log(`\n⛔ A — ÖNCE KOŞ (${A.length}): modeli OKUYOR, yeni sembollerin HİÇBİRİNİ anmıyor`);
  console.log("     ⇒ okuyucusu güncellenmemiş olabilir; bu gecenin üç kırmızısının sınıfı budur.");
  for (const ad of A) console.log(`     ${ad}`);
  if (A.length > 0) {
    const adlar = A.map((x) => x.replace(/^test_|\.ts$/g, ""));
    console.log("\n   KOŞUM (süzgeç DÜZ ALT DİZGİ — bekçi başına bir koşum):");
    console.log(`     for t in ${adlar.join(" ")}; do npx tsx scripts/run-all-tests.ts "$t"; done`);
  }

  console.log(`\n✓ B — zaten farkında (${B.length}): yeni sembolleri anıyor`);
  for (const ad of B.slice(0, 8)) console.log(`     ${ad}`);
  if (B.length > 8) console.log(`     … (+${B.length - 8})`);

  console.log(`\nⓘ C — yalnız ANIYOR, okumuyor (${C.length}) — düşük sinyal, listelenmedi`);

  console.log(
    "\n⚠️ Bu liste bir ALT SINIRDIR: METİN anması ölçüldü, çağrı grafiği DEĞİL. Bir bekçi modeli" +
      "\n   dolaylı kullanıp adını hiç yazmıyorsa hiçbir kademede görünmez. Tam kapsam `npm test`.",
  );
}

main();
