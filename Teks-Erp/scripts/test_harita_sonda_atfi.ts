// =============================================================================
// HARİTA "NEGATİF SONDA" HÜCRESİ — ✓B ATIFSIZ KIRMIZI · ✓K/✓B biçimli · düz ✓ yalnız düşer
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts harita_sonda_atfi   (DB GEREKMEZ)
//
// ⭐ NEDEN VAR (d9 sözleşmesi 2026-09-14, 1e hükmü): `BEKCI-HARITASI.md`nin "Negatif
//    sonda" sütunu bir ✓ değil SINIF + SAYI taşır — `✓K<n>` KALICI (dosyada yaşar,
//    okuyan doğrulayabilir) · `✓B<n>` BİR KEZLİK mutasyon zinciri (dosya dışında koşuldu,
//    geri alındı; kanıtı yalnız commit mesajı ⇒ SHA ATFI ZORUNLU). Atıfsız bir `B`
//    iddiası doğrulanamayan bir cümledir: okuyan "sondalanmış" sanır, kimse gidip
//    bakamaz. Ölçüldü 2026-09-14 (1766 satır): K 2 · B+sha 6 · B ATIFSIZ 1 · düz ✓ 538 ·
//    boş 1218.
//
// ÜÇ KOL, ÜÇ SERTLİK:
//   §1 SERT   — `✓B<n>` hücresi en az bir sha (7–40 hex) YA DA `(bu commit)` işareti taşır;
//               yoksa ❌ dosya:satır. Serbest metin ("sha iniş sonrası") YASAK — yanlışlanamaz.
//               ⚠️ YAPISAL BOŞLUK (1e hükmü 2026-09-14): B sondası commit'ten ÖNCE yazılır, sha
//               SONRA doğar ⇒ satır kendi sha'sını taşıyamaz. `(bu commit)` işaretli satırın
//               sha'sı YAZILMAZ, `git blame`den TÜRETİLİR (cherry-pick sonrası origin sha'sını
//               verir — elle yazılandan iyi). Commit kipinde işaret sahnelenmiş satırda
//               doğal; sahnelenmemişse blame çözmeli (çözmezse ❌ — fail-closed).
//   §2 SERT   — sınıflı hücre biçimi: `✓K<n>`/`✓B<n>`, n ≥ 1 (`✓K` çıplak ya da `✓B0` yok).
//   §3 CIRCIR — sınıfsız düz `✓` hücresi YALNIZ DÜŞER (taban DUZ_TABAN; sabiti entegratör
//               trende yazar, çürüme kolu commit kapısında uyarı — lib/circir-kolu.ts).
//
// ⚠️ KAYNAK INDEX (`git show :yol`), ağaç değil: ortak ağaçta başkasının yarım hücresi
//    bizi durdurmasın; pathspec commit'inde GIT_INDEX_FILE geçici indeksi gösterir, o
//    okunur. Index'ten okunamazsa (repo dışı) ağaca düşer ve bunu BEYAN eder.
//
// ⚠️ KÖRLÜK ZEMİNİ: tablo satırı < 1000 (ölçüldü 2026-09-14: 1766) ya da hiç sınıflı hücre yok ⇒ kırmızı
//    ("ihlal yok" ile "tablo bulunamadı" aynı yeşile çıkmasın).
//
// ⭐ NEGATİF SONDA ✓K8 (§4, her koşumda): sınıflandırıcı sentetik hücrelerde — atıfsız B ·
//    sha'lı B · (bu commit) B · K · düz ✓ · boş · KALIN yazım — beklenen sınıfı verir; §1 atıfsız B'yi
//    ısırır; §4f sığ-klon taklidi (env) blame'i ⏭ beyanla atlar, 'havada' üretmez.
// =============================================================================
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { curumeKolu } from "./lib/circir-kolu";
import { atlamaDefteri } from "./lib/atlama";

const KOK = join(__dirname, "..", "..");
const HARITA = "Teks-Erp/docs/BEKCI-HARITASI.md";
const EN_AZ_SATIR = 1000; // 2026-09-14: 1766 satır; yarısı düşerse tablo kaybı yakalanır
/** §3 tabanı — YALNIZ DÜŞER; sabiti trende entegratör (1e) yazar (ölçüm 2026-09-14: 538). */
// 538 → 531 (2026-09-14, entegratör 1e): birleşik ağaçta ölçüldü (yedi hücre sınıflandı).
// 531 → 522 (2026-09-14, entegratör 1e): d9 `5d8efc28` dokuz kalın hücreyi düz sınıflı biçime çevirdi (birleşik ağaçta ölçüldü).
const DUZ_TABAN = 522;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) {
    pass++;
    console.log(`  ✅ ${label}${detay ? ` — ${detay}` : ""}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${detay ? ` — ${detay}` : ""}`);
  }
}
const ATLAMA = atlamaDefteri((mesaj) => check(mesaj, false));

type Sinif = "K" | "B" | "B-BU-COMMIT" | "B-ATIFSIZ" | "BICIMSIZ-KALIN" | "DUZ" | "BOS" | "DIGER";
const SHA = /\b[0-9a-f]{7,40}\b/;
export const BU_COMMIT = "(bu commit)";

/** Hücre sınıfı — saf yüklem, §4 bunu sentetik hücrelerle ölçer. */
export function hucreSinifi(hucre: string): Sinif {
  const h = hucre.trim();
  if (h === "") return "BOS";
  // KALIN yazım (`✓**K3**`) sınıflı bir NİYETTİR ama makine biçimi değil — adıyla reddedilir,
  // düz ✓ sayılmaz (d9 ölçtü 2026-09-14: 15 hücre, "sınıfsız" teşhisi on dakika yanılttı).
  if (/^✓\s*\*\*\s*[KB]/.test(h)) return "BICIMSIZ-KALIN";
  if (/^✓K\d+/.test(h)) return "K";
  if (/^✓B\d+/.test(h)) {
    const kuyruk = h.replace(/^✓B\d+/, "");
    if (SHA.test(kuyruk)) return "B";
    return kuyruk.includes(BU_COMMIT) ? "B-BU-COMMIT" : "B-ATIFSIZ";
  }
  if (/^✓/.test(h)) return "DUZ";
  return "DIGER";
}

/** `git diff --cached -U0` hunk'larından haritanın SAHNELENMİŞ (yeni) satır numaraları. */
function sahnelenmisSatirlar(): Set<number> {
  const out = new Set<number>();
  try {
    const d = execFileSync("git", ["diff", "--cached", "-U0", "--", HARITA], { cwd: KOK, encoding: "utf8", maxBuffer: 64 << 20 });
    for (const m of d.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
      const bas = Number(m[1]);
      const adet = m[2] === undefined ? 1 : Number(m[2]);
      for (let i = 0; i < adet; i++) out.add(bas + i);
    }
  } catch {
    /* repo dışı — boş küme */
  }
  return out;
}

/** HEAD'de o satırı yazan commit — `(bu commit)` işaretinin türetilmiş sha'sı; çözülmezse null. */
function blameSha(satirNo: number): string | null {
  try {
    const b = execFileSync("git", ["blame", "-l", "-s", "-L", `${satirNo},${satirNo}`, "HEAD", "--", HARITA], { cwd: KOK, encoding: "utf8" });
    // `^` SINIR işareti sha'nın ilk hanesinin YERİNE basılır (39 hane kalır) — sığ klonda her
    // satır sınırdır ve bu "çözülmedi" demektir; tam klonda yalnız kök commit'te görülür.
    if (b.startsWith("^")) return null;
    const sha = b.match(/^([0-9a-f]{40})/)?.[1];
    return sha && !/^0{40}$/.test(sha) ? sha.slice(0, 8) : null;
  } catch {
    return null;
  }
}

/**
 * Sığ klon mu? CI'ın varsayılan checkout'u depth 1'dir: blame orada ÖLÇÜLEMEZ (her satır sınır).
 * Ölçülemeyen ölçülmemiş gibi beyan edilir, ihlal gibi değil (üç sonuç). Sonda: TEKSERP_SONDA_SIG=1.
 */
function sigKlonMu(): boolean {
  if (process.env.TEKSERP_SONDA_SIG === "1") return true;
  try {
    return execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: KOK, encoding: "utf8" }).trim() === "true";
  } catch {
    return false;
  }
}
/** Sınıflı hücrenin biçimi: harf + en az 1 sayı (`✓K` çıplak, `✓B0`, `✓ B3` biçimsiz). */
export function biciimliMi(hucre: string): boolean {
  const h = hucre.trim();
  if (!/^✓[KB]/.test(h)) return true; // sınıfsız hücrenin biçim iddiası yok
  return /^✓[KB][1-9]\d*(?![0-9])/.test(h);
}

function haritayiOku(): { metin: string; kaynak: "INDEX" | "AĞAÇ" } {
  try {
    return { metin: execFileSync("git", ["show", `:${HARITA}`], { cwd: KOK, encoding: "utf8", maxBuffer: 64 << 20 }), kaynak: "INDEX" };
  } catch {
    return { metin: readFileSync(join(KOK, HARITA), "utf8"), kaynak: "AĞAÇ" };
  }
}

interface Satir { no: number; dosya: string; hucre: string }
function satirlar(metin: string): Satir[] {
  const out: Satir[] = [];
  let tabloda = false;
  const L = metin.split("\n");
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    if (/^\| Dosya \| Ne ölçüyor \| DB \| Negatif sonda/.test(l)) { tabloda = true; continue; }
    if (tabloda && /^\|---/.test(l)) continue;
    if (tabloda && !l.startsWith("|")) { tabloda = false; continue; }
    if (tabloda) {
      const c = l.split("|").map((s) => s.trim());
      out.push({ no: i + 1, dosya: c[1] ?? "", hucre: c[4] ?? "" });
    }
  }
  return out;
}

function main(): void {
  console.log("=== Harita 'Negatif sonda' hücresi bekçisi ===\n");
  const iceride = process.env.TEKSERP_SONDA_ICERIDE === "1"; // §4f çocuk koşumu — kendini yeniden çağırmaz
  const { metin, kaynak } = haritayiOku();
  if (kaynak === "AĞAÇ") console.log("  ℹ️ kaynak: AĞAÇ (index'ten okunamadı — repo dışı koşum)");
  const S = satirlar(metin);
  const sinifli = S.filter((s) => ["K", "B", "B-BU-COMMIT", "B-ATIFSIZ"].includes(hucreSinifi(s.hucre)));
  check(`§0 körlük zemini: tablo satırı ≥ ${EN_AZ_SATIR}`, S.length >= EN_AZ_SATIR, `${S.length} satır (${kaynak})`);
  check("§0 körlük zemini: en az bir SINIFLI hücre var (✓K/✓B)", sinifli.length > 0, `${sinifli.length}`);

  // §1 — ✓B atıfsız → KIRMIZI, dosya:satır
  const atifsiz = S.filter((s) => hucreSinifi(s.hucre) === "B-ATIFSIZ");
  check(
    "§1 ⭐ her `✓B<n>` hücresi sha atfı taşıyor (bir kezlik sondanın tek kanıtı commit mesajıdır)",
    atifsiz.length === 0,
    atifsiz.length ? `${atifsiz.length} atıfsız` : `${S.filter((s) => hucreSinifi(s.hucre) === "B").length} B hücresi, hepsi sha'lı`,
  );
  for (const s of atifsiz) console.log(`     · ${HARITA}:${s.no} ${s.dosya} → "${s.hucre.slice(0, 70)}" ⇒ sha ekle (7–40 hex), sha henüz yoksa \`${BU_COMMIT}\` yaz (blame türetir), ya da sonda dosyaya taşınıp ✓K<n> yazılır`);

  // §1b — `(bu commit)`: sha türetilir. Sahnelenmiş satırda doğal (henüz commit yok);
  // sahnelenmemişse HEAD blame çözmeli — çözmezse işaret havada kalmıştır (fail-closed).
  const buCommit = S.filter((s) => hucreSinifi(s.hucre) === "B-BU-COMMIT");
  const sahneli = sahnelenmisSatirlar();
  const sig = sigKlonMu();
  const havada: Satir[] = [];
  const olculemedi: Satir[] = [];
  for (const s of buCommit) {
    if (sahneli.has(s.no)) { console.log(`     ℹ️ ${HARITA}:${s.no} ${s.dosya} ✓B ${BU_COMMIT} — sahnelenmiş, sha commit'te doğar`); continue; }
    if (sig) { olculemedi.push(s); continue; }
    const sha = blameSha(s.no);
    if (sha) console.log(`     ℹ️ ${HARITA}:${s.no} ${s.dosya} ✓B ${BU_COMMIT} → blame ${sha}`);
    else havada.push(s);
  }
  // ÜÇ SONUÇ (CI `c2635fc1`, 2026-09-14: sığ klonda blame her satırı sınır (^) verdi, "havada" sanıldı):
  // sığ klonda blame ÖLÇÜLEMEZ → ⏭ adıyla, satırın biçimi yine ölçülür (§2); sha'yı tam klon türetir.
  if (sig && olculemedi.length > 0) {
    ATLAMA.atla(`§1b ${BU_COMMIT} blame`, `sığ klon (depth<∞) — ${olculemedi.length} işaretli satırın sha'sı burada türetilemez; tam klon/entegratör türetir (ci.yml fetch-depth: 0)`, olculemedi.length);
  }
  check(
    `§1b ⭐ \`${BU_COMMIT}\` işaretli ✓B satırı ya SAHNELENMİŞ ya HEAD blame'i çözülür (sha türetilir, yazılmaz)`,
    havada.length === 0,
    havada.length ? `${havada.length} havada` : sig ? `${buCommit.length} işaretli (sığ klon: blame ⏭)` : `${buCommit.length} işaretli`,
  );
  for (const s of havada) console.log(`     · ${HARITA}:${s.no} ${s.dosya} — ne sahnelenmiş ne blame çözüyor (tam klonda)`);

  // §2 — biçim (kalın yazım ayrı adla: çare "kalın yazma, düz yaz")
  const kalin = S.filter((s) => hucreSinifi(s.hucre) === "BICIMSIZ-KALIN");
  const bicimsiz = S.filter((s) => !biciimliMi(s.hucre));
  check("§2 ⭐ sınıflı hücre biçimi `✓K<n>`/`✓B<n>`, n ≥ 1 — DÜZ yazım, kalın (`✓**K3**`) değil", bicimsiz.length === 0 && kalin.length === 0, [bicimsiz.length ? `${bicimsiz.length} biçimsiz` : "", kalin.length ? `${kalin.length} KALIN` : ""].filter(Boolean).join(" · "));
  for (const s of bicimsiz) console.log(`     · ${HARITA}:${s.no} ${s.dosya} → "${s.hucre.slice(0, 40)}"`);
  for (const s of kalin) console.log(`     · ${HARITA}:${s.no} ${s.dosya} → "${s.hucre.slice(0, 40)}" ⇒ kalın yazma, düz yaz: ✓K3 / ✓B2 (sha)`);

  // §3 — düz ✓ cırcır
  const duz = S.filter((s) => hucreSinifi(s.hucre) === "DUZ").length;
  check(`§3 ⭐ sınıfsız düz ✓ hücresi ≤ taban (${DUZ_TABAN}) — yeni sonda beyanı SINIFLI yazılır`, duz <= DUZ_TABAN, `gerçek ${duz}`);
  curumeKolu(check, ATLAMA.atla, "§3 düz ✓ tabanı ÇÜRÜMEMİŞ (gerçek < taban ise entegratör tabanı düşürür)", duz, DUZ_TABAN);

  // §4 — kalıcı negatif sondalar (sınıflandırıcı sentetik hücrelerde)
  console.log("\n§4 — sondalar (✓K8)");
  check("§4a ⭐ atıfsız B ısırılıyor (serbest metin 'sha iniş sonrası' sha DEĞİLDİR)", hucreSinifi("✓B4 ⓪ commit'i (SESSIONABLE · izin satırı; sha iniş sonrası)") === "B-ATIFSIZ");
  check("§4b sha'lı B kabul", hucreSinifi("✓B2 (d78bbd22) ürün + rapor") === "B");
  check(`§4b′ \`${BU_COMMIT}\` işaretli B ayrı sınıf (sha türetilir)`, hucreSinifi(`✓B3 ${BU_COMMIT} (endedAt · revokedAt)`) === "B-BU-COMMIT");
  check("§4c K sınıfı tanınıyor", hucreSinifi("✓K3 (`--sonda`: §6i · §6ii · §6iii)") === "K");
  check("§4d düz ✓ ve boş ayrı sınıf", hucreSinifi("✓") === "DUZ" && hucreSinifi("") === "BOS");
  check("§4d′ kalın yazım (`✓**K11**`) düz ✓ SAYILMAZ, adıyla reddedilir", hucreSinifi("✓**K11** (…)") === "BICIMSIZ-KALIN" && hucreSinifi("✓ **B2** (abc1234)") === "BICIMSIZ-KALIN");
  // Sığ klon dalı: TEKSERP_SONDA_SIG=1 ile kendini çocuk süreçte koşturur — (bu commit) satırı varsa ⏭ beyanı
  // çıkmalı, "havada" ❌ ÇIKMAMALI; işaretli satır yoksa dal boş geçer (beyan da yok) — ikisi de ölçülür.
  const cocuk = iceride ? { stdout: "", stderr: "" } : spawnSync(process.execPath, [...process.execArgv, process.argv[1]], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, TEKSERP_SONDA_SIG: "1", TEKSERP_SONDA_ICERIDE: "1" }, timeout: 60_000 });
  const cOut = `${cocuk.stdout}${cocuk.stderr}`;
  const isaretli = buCommit.filter((s) => !sahneli.has(s.no)).length;
  if (!iceride) check(
    "§4f ⭐ sığ klon taklidi (TEKSERP_SONDA_SIG=1): blame ⏭ beyanla atlanır, 'havada' ❌ üretmez",
    !/havada/.test(cOut) && (isaretli === 0 || /sığ klon/.test(cOut)),
    isaretli === 0 ? "işaretli satır yok — dal boş (beyan beklenmez)" : `${isaretli} işaretli → ${/sığ klon/.test(cOut) ? "⏭ beyan var" : "BEYAN YOK"}`,
  );
  check("§4e biçim: `✓K` çıplak ve `✓B0` biçimsiz, `✓B12 (abc1234)` biçimli", !biciimliMi("✓K (üç sonda)") && !biciimliMi("✓B0") && biciimliMi("✓B12 (abc1234)"));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
