// PAKET SERTİFİKASI + DAĞITIM İPTALİ ÜRETİMİ (3.9 D5; PAKET-ANAHTARI-KOK-ALTINDA §2.5 · §2.4) — DB'siz, ağsız,
// geçici dizin; gerçek CLI (`scripts/anahtar.ts`), sahte kök (parola stdin'den).
//   §1 `paket-sertifika-uret`: pkt-<yıl>-<n> → kök imzalı PAKET sertifikası, x/kid aynen, sınıflar kökün · ist-/biçimsiz
//      kid RED, dosya yazılmaz · var olanın üstüne yazmaz
//   §2 `paket-iptal-uret`: PAKET + ISTEMCI sertifikaları tek belgede (`tekserp-paketiptal`, sıra 1) · `--onceki` satırları
//      taşır, sıra +1, aynı sertifika iki kez girmez · başka kökün önceki belgesi RED · anahtar dosyası (tur'lu) RED
//   §3 `iptal-uret` PAKET sertifikasını almaz (iptali ayrı belgede)
// Koşum: cd satici/sunucu && npx tsx scripts/test_paket_sertifika_uret.ts
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { publicKeyX, verifyCertificate, verifyPackageRevocation, type RootKey } from "../src/lisans-protokol";
// Bekçi/koşucu gerçek Anahtar Zinciri'ne GİTMEZ: parola okuyan araçlar kasa yerine stdin/dosya kullanır (scripts/lib/parola-kasasi.mjs).
process.env.TEKSERP_PAROLA_KASASI = "kapali";

let pass = 0;
let fail = 0;
function kontrol(ad: string, ok: boolean, ek = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${ad}${ok ? "" : ` — ${ek}`}`);
}

const SUNUCU = path.resolve(__dirname, "..");
const TMP = mkdtempSync(path.join(os.tmpdir(), "paket-sertifika-uret-"));
const PAROLA = "bekci-kok-parolasi-2099-uzun-ve-guclu";

function anahtar(argv: string[], input = ""): { kod: number | null; out: string; err: string } {
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/anahtar.ts", ...argv], { cwd: SUNUCU, input, encoding: "utf8", timeout: 120_000 });
  return { kod: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function kokKur(ad: string, kid: string): { dizin: string; kokler: RootKey[] } {
  const dizin = path.join(TMP, ad);
  mkdirSync(dizin, { recursive: true, mode: 0o700 });
  const r = anahtar(["kok-uret", `--kid=${kid}`, `--dizin=${dizin}`], `${PAROLA}\n${PAROLA}\n`);
  if (r.kod !== 0) throw new Error(`kok-uret: ${r.err.trim().slice(-200)}`);
  const j = JSON.parse(readFileSync(path.join(dizin, `${kid}.kok.json`), "utf8")) as { kid: string; x: string; siniflar: RootKey["classes"] };
  return { dizin, kokler: [{ kid: j.kid, x: j.x, classes: j.siniflar }] };
}

const yeniX = (): string => publicKeyX(generateKeyPairSync("ed25519").publicKey);
const json = (f: string): Record<string, unknown> => JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>;

function main(): void {
  try {
    const A = kokKur("a", "kok-2099-1");
    const B = kokKur("b", "kok-2099-2");
    console.log("§1 paket-sertifika-uret");
    const x = yeniX();
    const s1 = path.join(TMP, "pkt.sertifika.json");
    const r1 = anahtar(["paket-sertifika-uret", `--x=${x}`, "--kid=pkt-2099-1", "--kok=kok-2099-1", `--kok-dizin=${A.dizin}`, `--cikti=${s1}`], `${PAROLA}\n`);
    const v1 = existsSync(s1) ? verifyCertificate(String(json(s1).sertifika), { roots: A.kokler, usage: "PAKET", atMs: Date.now() }) : null;
    kontrol("§1a ⭐ pkt-2099-1 → kök imzalı PAKET sertifikası, kid + x aynen, sınıflar kökün", r1.kod === 0 && v1?.ok === true && v1.value.document.x === x && v1.value.document.kid === "pkt-2099-1" && v1.value.document.siniflar.length === A.kokler[0]!.classes.length, `${r1.kod} ${r1.err.trim().slice(-200)}`);
    const kotu = path.join(TMP, "kotu.json");
    const r2 = anahtar(["paket-sertifika-uret", `--x=${x}`, "--kid=ist-2099-1", "--kok=kok-2099-1", `--kok-dizin=${A.dizin}`, `--cikti=${kotu}`], `${PAROLA}\n`);
    kontrol("§1b ist- kid'i paket-sertifika-uret'te RED, dosya yok", r2.kod === 2 && !existsSync(kotu), `${r2.kod}`);
    const r3 = anahtar(["paket-sertifika-uret", `--x=${x}`, "--kid=pkt-2099-1", "--kok=kok-2099-1", `--kok-dizin=${A.dizin}`, `--cikti=${s1}`], `${PAROLA}\n`);
    kontrol("§1c var olan çıktının üstüne yazmaz", r3.kod === 2 && /zaten var/.test(r3.err), `${r3.kod}`);

    console.log("§2 paket-iptal-uret");
    const s2 = path.join(TMP, "ist.sertifika.json");
    anahtar(["istemci-sertifika-uret", `--x=${yeniX()}`, "--kid=ist-2099-1", "--kok=kok-2099-1", `--kok-dizin=${A.dizin}`, `--cikti=${s2}`], `${PAROLA}\n`);
    const i1 = path.join(TMP, "iptal-1.json");
    const p1 = anahtar(["paket-iptal-uret", "--kok=kok-2099-1", `--kok-dizin=${A.dizin}`, `--cikti=${i1}`, `--iptal=${s1},${s2}`, "--neden=bekçi"], `${PAROLA}\n`);
    const b1 = existsSync(i1) ? json(i1) : {};
    const d1 = typeof b1.belge === "string" ? verifyPackageRevocation(b1.belge, A.kokler) : null;
    kontrol("§2a ⭐ PAKET + ISTEMCI sertifikası → tekserp-paketiptal sıra 1, iki satır (pkt- · ist-), kökle doğrulanır",
      p1.kod === 0 && b1.tur === "tekserp-paketiptal-belgesi" && b1.sira === 1 && d1?.ok === true && d1.value.document.iptaller.map((e) => e.kid).sort().join(",") === "ist-2099-1,pkt-2099-1",
      `${p1.kod} ${p1.err.trim().slice(-200)}`);
    const i2 = path.join(TMP, "iptal-2.json");
    const p2 = anahtar(["paket-iptal-uret", "--kok=kok-2099-1", `--kok-dizin=${A.dizin}`, `--cikti=${i2}`, `--onceki=${i1}`, `--iptal=${s1}`], `${PAROLA}\n`);
    const b2 = existsSync(i2) ? json(i2) : {};
    const d2 = typeof b2.belge === "string" ? verifyPackageRevocation(b2.belge, A.kokler) : null;
    kontrol("§2b ⭐ --onceki satırları taşır, sıra 2, aynı sertifika iki kez girmez", p2.kod === 0 && b2.sira === 2 && d2?.ok === true && d2.value.document.iptaller.length === 2, `${p2.kod} ${p2.err.trim().slice(-200)}`);
    const p3 = anahtar(["paket-iptal-uret", "--kok=kok-2099-2", `--kok-dizin=${B.dizin}`, `--cikti=${path.join(TMP, "iptal-b.json")}`, `--onceki=${i1}`], `${PAROLA}\n`);
    kontrol("§2c başka kökün önceki belgesi RED", p3.kod === 2 && /doğrulanamadı/.test(p3.err), `${p3.kod}`);
    const sahte = path.join(TMP, "alt.json");
    writeFileSync(sahte, JSON.stringify({ tur: "tekserp-alt-anahtar", sertifika: String(json(s1).sertifika) }));
    const p4 = anahtar(["paket-iptal-uret", "--kok=kok-2099-1", `--kok-dizin=${A.dizin}`, `--cikti=${path.join(TMP, "iptal-alt.json")}`, `--iptal=${sahte}`], `${PAROLA}\n`);
    kontrol("§2d anahtar dosyası (tur'lu) dağıtım iptaline girmez", p4.kod === 2 && /yalnız PAKET\/ISTEMCI/.test(p4.err), `${p4.kod}`);

    console.log("§3 iptal-uret");
    const p5 = anahtar(["iptal-uret", "--kok=kok-2099-1", `--kok-dizin=${A.dizin}`, `--cikti=${path.join(TMP, "iptal-genel.json")}`, `--iptal=${s1}`], `${PAROLA}\n`);
    kontrol("§3a ⭐ iptal-uret PAKET sertifikasını almaz (dağıtım iptalinde)", p5.kod === 2 && !existsSync(path.join(TMP, "iptal-genel.json")), `${p5.kod} ${p5.err.trim().slice(-120)}`);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
