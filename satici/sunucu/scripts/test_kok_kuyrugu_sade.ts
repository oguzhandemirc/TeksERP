// =============================================================================
// KÖK KUYRUĞU SADELEŞTİRME (2026-11-02) — DB'siz, AĞSIZ, geçici dizin; gerçek CLI'lar, sahte kök (parola stdin'den).
//   §1 ara imzacının varsayılan sınıfları tek kaynaktan (`src/keys/intermediate-classes.ts`): protokol sınıfları − BAYI,
//      BARINDIRILAN dahil; `ara-uret` (--siniflar yok) bu kümeyi basar; köksüz depoda BARINDIRILAN + hak-ara planı ARA
//      (kuyruk değil); tören `DONEM_SINIFLAR` protokol aynası
//   §2 tören `kuyruk` KURU kipi (`--kuyruk` dosyası, ssh yok): her talep insan okunur (müşteri · kurulum · sınıf · sürüm
//      · neden), önceki İMZALI HAK'a göre modül/bakım/ufuk farkı; sahte talep (kimliği tutmayan taban · imzası bozuk
//      taban) ŞÜPHELİ; taban gelmediyse "ÖNCEKİ HAK OKUNAMADI"; arşiv yazılır, imza YOK, ssh çağrılmaz; `--talep` süzer,
//      bilinmeyen talep RED
//   §3 `kuyruk-imzala` şüpheli talep varsa parola sorulmadan RED (hiçbiri imzalanmaz); temiz kuyruk imzalanır ✓K
// NEGATİF SONDA (2026-11-02, dosya DIŞI, cp + shasum ile geri alındı): BARINDIRILAN dışlanan sınıflara → §1a · §1b · §1c ❌ ·
//   review kimlik karşılaştırması kapalı → §2c · §2f ❌ · tören `kuyruk` `--kuyruk` dalı kapalı (ssh'e düşer) → §2a–§2h ❌
//   (ssh izi doğdu). test_ara_imzaci: liste `planNedeni` yok → §7f ❌; dışa aktarma `planNedeni` yok → §6a' ❌.
// Koşum: cd satici/sunucu && npx tsx scripts/test_kok_kuyrugu_sade.ts
// =============================================================================
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { LICENSE_CLASSES, PROTOCOL_VERSION, msToIso, parseJws, type LicenseClass } from "../src/lisans-protokol";
import { INTERMEDIATE_DEFAULT_CLASSES } from "../src/keys/intermediate-classes";
import { KeyStore } from "../src/keys/key-store";
import { planEntitlementSigner } from "../src/services/entitlement-policy";
// Bekçi gerçek Anahtar Zinciri'ne GİTMEZ.
process.env.TEKSERP_PAROLA_KASASI = "kapali";

let pass = 0;
let fail = 0;
function kontrol(ad: string, ok: boolean, ek = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${ad}${ok ? "" : ` — ${ek}`}`);
}

const SUNUCU = path.resolve(__dirname, "..");
const REPO = path.resolve(SUNUCU, "..", "..");
const TOREN = path.join(REPO, "deploy", "satici", "uretim-toren.mjs");
const TMP = mkdtempSync(path.join(os.tmpdir(), "kok-kuyrugu-sade-"));
const KOK_PAROLA = "bekci-kok-parolasi-2099-uzun-ve-guclu";
const ARA_PAROLA = "bekci-ara-parolasi-2099-baska-ve-guclu";
const KOK = "kok-2099-1";

function anahtar(argv: string[], input = ""): { kod: number | null; out: string; err: string } {
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/anahtar.ts", ...argv], { cwd: SUNUCU, input, encoding: "utf8", timeout: 120_000, env: { PATH: process.env.PATH ?? "", TEKSERP_PAROLA_KASASI: "kapali" } });
  return { kod: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

/** Tören AĞSIZ: PATH'in başına `ssh` kuklası konur — çağrılırsa iz dosyası doğar (bekçi yokluğunu ölçer). */
function toren(argv: string[], kuklaBin: string): { kod: number | null; out: string; err: string } {
  const r = spawnSync(process.execPath, [TOREN, ...argv], {
    cwd: REPO,
    input: "",
    encoding: "utf8",
    timeout: 180_000,
    env: { PATH: `${kuklaBin}:${process.env.PATH ?? ""}`, HOME: process.env.HOME ?? os.homedir(), TEKSERP_PAROLA_KASASI: "kapali" },
  });
  return { kod: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

const gun = (n: number): string => msToIso(Date.now() + n * 86_400_000);

function hak(g: { hakId: string; surum: number; kurulumId: string; musteriId: string; tesisId: string; lisansNo: string; moduller: string[]; bakim: string; ufuk: number; sinif?: LicenseClass }): Record<string, unknown> {
  return {
    v: PROTOCOL_VERSION,
    hakId: g.hakId,
    surum: g.surum,
    lisansNo: g.lisansNo,
    musteri: { id: g.musteriId, ad: "Bekçi Bulut Müşterisi" },
    tesis: { id: g.tesisId, ad: "Bulut Tesisi" },
    kurulumId: g.kurulumId,
    sinif: g.sinif ?? "BARINDIRILAN",
    moduller: g.moduller,
    kalici: false,
    bakimBitis: g.bakim,
    verilis: msToIso(Date.now() - 3_600_000),
    cevrimdisiUfukGun: g.ufuk,
  };
}

function main(): void {
  try {
    const hedef = path.join(TMP, "satici-uretim");
    const K = path.join(hedef, "anahtarlar");
    mkdirSync(K, { recursive: true, mode: 0o700 });
    chmodSync(hedef, 0o700);
    const kok = anahtar(["kok-uret", `--kid=${KOK}`, `--dizin=${K}`], `${KOK_PAROLA}\n${KOK_PAROLA}\n`);
    if (kok.kod !== 0) throw new Error(`kok-uret: ${kok.err.trim().slice(-300)}`);
    const kokDosya = JSON.parse(readFileSync(path.join(K, `${KOK}.kok.json`), "utf8")) as { kid: string; x: string; siniflar: LicenseClass[] };
    const capa = path.join(TMP, "capa.json");
    writeFileSync(capa, JSON.stringify([{ kid: kokDosya.kid, x: kokDosya.x, classes: kokDosya.siniflar }]));

    console.log("§1 ara imzacının varsayılan sınıfları");
    const beklenen = LICENSE_CLASSES.filter((c) => c !== "BAYI");
    kontrol("§1a tek kaynak: protokol sınıfları − BAYI (BARINDIRILAN dahil, BAYI hariç)",
      JSON.stringify([...INTERMEDIATE_DEFAULT_CLASSES]) === JSON.stringify(beklenen) && INTERMEDIATE_DEFAULT_CLASSES.includes("BARINDIRILAN") && !INTERMEDIATE_DEFAULT_CLASSES.includes("BAYI"),
      JSON.stringify(INTERMEDIATE_DEFAULT_CLASSES));
    const araDizin = path.join(TMP, "ara");
    mkdirSync(araDizin, { mode: 0o700 });
    const ara = anahtar(["ara-uret", "--kid=ara-2099-1", `--kok=${KOK}`, `--kok-dizin=${K}`, `--dizin=${araDizin}`], `${KOK_PAROLA}\n${ARA_PAROLA}\n${ARA_PAROLA}\n`);
    const araDosyasi = path.join(araDizin, "ara-2099-1.ara.json");
    const araSiniflar = existsSync(araDosyasi) ? ((parseJws((JSON.parse(readFileSync(araDosyasi, "utf8")) as { sertifika: string }).sertifika) as { ok: boolean; value?: { payload: { siniflar: string[] } } }).value?.payload.siniflar ?? []) : [];
    kontrol("§1b ⭐ ara-uret (--siniflar yok) kökün bütün sınıflarında BAYI dışı kümeyi basar — BARINDIRILAN DAHİL",
      ara.kod === 0 && JSON.stringify(araSiniflar) === JSON.stringify(beklenen), `${ara.kod} ${ara.err.trim().slice(-200)} ${JSON.stringify(araSiniflar)}`);
    const depo = KeyStore.load({ ANAHTAR_DIZINI: araDizin, GUVEN_CAPASI: undefined, GUVEN_CAPASI_DOSYASI: capa } as never);
    const plan = (cls: LicenseClass, caps: string[]) => planEntitlementSigner(depo, cls, caps, Date.now());
    const pB = plan("BARINDIRILAN", ["hak-ara"]);
    const pBayi = plan("BAYI", ["hak-ara"]);
    kontrol("§1c ⭐ köksüz depo (VDS): BARINDIRILAN + hak-ara → ARA (kök kuyruğu DEĞİL) · BAYI → KUYRUK ARA_IMZACI_YOK (bayi anahtarının işi)",
      pB.kind === "ARA" && pB.kid === "ara-2099-1" && pBayi.kind === "KUYRUK" && pBayi.reason === "ARA_IMZACI_YOK",
      `${pB.kind} / ${pBayi.kind} · ${depo.warnings.join(" | ")}`);
    const torenMetni = readFileSync(TOREN, "utf8");
    const m = /const DONEM_SINIFLAR = (\[[^\]]*\]);/.exec(torenMetni);
    kontrol("§1d tören `DONEM_SINIFLAR` = protokol LICENSE_CLASSES; `--ara-siniflar` verilmezse tören sınıf DAYATMAZ (ara-uret varsayılanı)",
      !!m && JSON.stringify(JSON.parse(m[1]!)) === JSON.stringify([...LICENSE_CLASSES]) && /\.\.\.\(araSiniflar \? \[`--siniflar=\$\{araSiniflar\}`\] : \[\]\)/.test(torenMetni),
      m?.[1] ?? "yok");

    console.log("§2 tören `kuyruk` KURU kipi (ağsız)");
    const ids = { hakId: randomUUID(), kurulumId: randomUUID(), musteriId: randomUUID(), tesisId: randomUUID(), lisansNo: "TKS-2099-0001" };
    const v1 = hak({ ...ids, surum: 1, moduller: ["production.enabled"], bakim: gun(30), ufuk: 400 });
    const ilkKuyruk = path.join(TMP, "ilk.json");
    writeFileSync(ilkKuyruk, JSON.stringify({ v: 1, tur: "tekserp-kok-kuyrugu", uretim: msToIso(Date.now()), talepler: [{ talepId: randomUUID(), hakId: ids.hakId, lisansNo: ids.lisansNo, tabanSurum: 0, surum: 1, yuk: v1 }] }));
    const ilkCikti = path.join(TMP, "ilk-imzali.json");
    const ilk = anahtar(["kuyruk-imzala", `--kok=${KOK}`, `--kok-dizin=${K}`, `--kuyruk=${ilkKuyruk}`, `--cikti=${ilkCikti}`], `${KOK_PAROLA}\n`);
    if (ilk.kod !== 0) throw new Error(`taban HAK imzası: ${ilk.err.trim().slice(-300)}`);
    const belge1 = (JSON.parse(readFileSync(ilkCikti, "utf8")) as { haklar: { belge: string }[] }).haklar[0]!.belge;
    const onceki = { surum: 1, belge: belge1, imzalayanKid: KOK };

    const gercek = randomUUID();
    const sahteKimlik = randomUUID();
    const sahteImza = randomUUID();
    const eskiSunucu = randomUUID();
    const v2 = hak({ ...ids, surum: 2, moduller: ["production.enabled", "finance.enabled"], bakim: gun(400), ufuk: 200 });
    const baskaHak = { ...ids, hakId: randomUUID(), kurulumId: randomUUID() };
    const bozukBelge = `${belge1.slice(0, -4)}${belge1.slice(-4) === "AAAA" ? "BBBB" : "AAAA"}`;
    const eskiHak = { ...ids, hakId: randomUUID(), lisansNo: "TKS-2099-0003" };
    const sahteImzaHak = { ...ids, hakId: randomUUID(), lisansNo: "TKS-2099-0002" };
    const talepler = [
      { talepId: gercek, hakId: ids.hakId, lisansNo: ids.lisansNo, tabanSurum: 1, surum: 2, acil: false, planNedeni: "ARA_IMZACI_YOK", sebep: "bulut modül ekleme", onceki, yuk: v2 },
      // VDS ele geçti: başka HAK'ın gerçek belgesini taban diye gösterip geniş şartlar ister.
      { talepId: sahteKimlik, hakId: baskaHak.hakId, lisansNo: ids.lisansNo, tabanSurum: 1, surum: 2, acil: false, planNedeni: "ARA_IMZACI_YOK", sebep: "sahte", onceki, yuk: hak({ ...baskaHak, surum: 2, moduller: ["production.enabled", "finance.enabled", "ticaret.enabled"], bakim: gun(3000), ufuk: 400 }) },
      { talepId: sahteImza, hakId: sahteImzaHak.hakId, lisansNo: sahteImzaHak.lisansNo, tabanSurum: 1, surum: 2, acil: true, planNedeni: "YETENEK_YOK", sebep: "sahte taban", onceki: { ...onceki, belge: bozukBelge }, yuk: hak({ ...sahteImzaHak, surum: 2, moduller: ["production.enabled"], bakim: gun(60), ufuk: 400 }) },
      // Eski satıcı: `onceki`/`planNedeni` alanları yok.
      { talepId: eskiSunucu, hakId: eskiHak.hakId, lisansNo: eskiHak.lisansNo, tabanSurum: 3, surum: 4, yuk: hak({ ...eskiHak, surum: 4, moduller: ["production.enabled"], bakim: gun(90), ufuk: 400 }) },
    ];
    const kuyrukDosyasi = path.join(TMP, "kuyruk.json");
    writeFileSync(kuyrukDosyasi, JSON.stringify({ v: 1, tur: "tekserp-kok-kuyrugu", uretim: msToIso(Date.now()), talepler }));
    const kukla = path.join(TMP, "bin");
    mkdirSync(kukla);
    const sshIzi = path.join(TMP, "ssh-cagrildi");
    writeFileSync(path.join(kukla, "ssh"), `#!/bin/sh\necho "$@" > "${sshIzi}"\nexit 97\n`, { mode: 0o755 });

    const r = toren(["kuyruk", `--dizin=${hedef}`, `--kok=${KOK}`, `--kuyruk=${kuyrukDosyasi}`], kukla);
    const blok = (id: string): string => {
      const i = r.out.indexOf(`Talep ${id}`);
      if (i < 0) return "";
      const j = r.out.indexOf("\n\n", i + 1);
      return r.out.slice(i, j < 0 ? undefined : j);
    };
    const g = blok(gercek);
    kontrol("§2a ⭐ kuru koşum çıkış 0; gerçek talep: müşteri · kurulum · sınıf · sürüm 1 → 2 · neden 'yeni ara imzacı' · taban DOĞRULANDI",
      r.kod === 0 && g.includes("Bekçi Bulut Müşterisi") && g.includes(ids.kurulumId) && /Sınıf\s+: BARINDIRILAN · sürüm 1 → 2/.test(g) && g.includes("yeni ara imzacı") && g.includes("köke karşı doğrulandı") && !g.includes("ŞÜPHELİ"),
      `${r.kod} ${r.err.trim().slice(-300)}\n${g}`);
    kontrol("§2b ⭐ fark listesi: modül + finance.enabled · bakım uzar (GENİŞLER) · ufuk 400 gün → 200 gün",
      /Modüller: — → \+ finance\.enabled\s+▲ GENİŞLER/.test(g) && /Bakım bitişi: \d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}\s+▲ GENİŞLER/.test(g) && /Çevrimdışı ufuk: 400 gün → 200 gün(?!\s+▲)/.test(g), g);
    const s1 = blok(sahteKimlik);
    const s2 = blok(sahteImza);
    kontrol("§2c ⭐ sahte talep: başka HAK'ın belgesi taban gösterilir → ŞÜPHELİ (hakId/kurulumId önceki HAK'tan farklı), imzalanmaz",
      s1.includes("ŞÜPHELİ — İMZALANMAZ") && /ŞÜPHE\s+: hakId önceki HAK'tan farklı/.test(s1) && /ŞÜPHE\s+: kurulumId önceki HAK'tan farklı/.test(s1), s1);
    kontrol("§2d ⭐ sahte talep: imzası bozuk taban → DOĞRULANAMADI + ŞÜPHELİ",
      s2.includes("ŞÜPHELİ — İMZALANMAZ") && s2.includes("DOĞRULANAMADI"), s2);
    const e = blok(eskiSunucu);
    kontrol("§2e taban gelmediyse (eski satıcı) 'ÖNCEKİ HAK OKUNAMADI' açıkça; fark yok, şüpheli DEĞİL; neden 'satıcı bildirmedi'",
      e.includes("ÖNCEKİ HAK OKUNAMADI") && !e.includes("Fark") && !e.includes("ŞÜPHELİ") && e.includes("satıcı bildirmedi"), e);
    const arsivler = existsSync(path.join(hedef, "kok-kuyrugu")) ? readdirSync(path.join(hedef, "kok-kuyrugu")) : [];
    const arsiv = arsivler.length === 1 ? path.join(hedef, "kok-kuyrugu", arsivler[0]!) : "";
    const icerik = arsiv ? readdirSync(arsiv).sort().join(",") : "";
    kontrol("§2f KURU: özet '4 talep · 2 ŞÜPHELİ', arşiv kok-kuyrugu/<damga>-kuru/ (kuyruk + inceleme; imzalı belge YOK), ssh ÇAĞRILMADI",
      /Özet: 4 talep · 2 ŞÜPHELİ/.test(r.out) && r.out.includes("KURU koşum") && /-kuru$/.test(arsiv) && icerik === "inceleme.json,kuyruk.json" && !existsSync(sshIzi),
      `${icerik} · ssh ${existsSync(sshIzi)} · ${arsiv}`);
    const t = toren(["kuyruk", `--dizin=${hedef}`, `--kok=${KOK}`, `--kuyruk=${kuyrukDosyasi}`, `--talep=${gercek}`], kukla);
    kontrol("§2g --talep=<id> yalnız o talebi listeler (Özet: 1 talep · 0 ŞÜPHELİ)", t.kod === 0 && /Özet: 1 talep · 0 ŞÜPHELİ/.test(t.out) && !t.out.includes(sahteKimlik), `${t.kod} ${t.err.trim().slice(-200)}`);
    const u = toren(["kuyruk", `--dizin=${hedef}`, `--kok=${KOK}`, `--kuyruk=${kuyrukDosyasi}`, `--talep=${randomUUID()}`], kukla);
    kontrol("§2h kuyrukta olmayan --talep → çıkış 2", u.kod === 2 && /kuyrukta yok/.test(u.err), `${u.kod} ${u.err.trim().slice(-200)}`);

    console.log("§3 kuyruk-imzala sahte talep seddi");
    const cikti = path.join(TMP, "hepsi-imzali.json");
    const hepsi = anahtar(["kuyruk-imzala", `--kok=${KOK}`, `--kok-dizin=${K}`, `--kuyruk=${kuyrukDosyasi}`, `--cikti=${cikti}`], `${KOK_PAROLA}\n`);
    kontrol("§3a ⭐ şüpheli talep varken kuyruk-imzala RED (çıkış 2), hiçbir belge yazılmadı, parola sorulmadı",
      hepsi.kod === 2 && /Şüpheli talep/.test(hepsi.err) && !existsSync(cikti) && !/parolası:/.test(hepsi.err), `${hepsi.kod} ${hepsi.err.trim().slice(-200)}`);
    const temiz = path.join(TMP, "temiz.json");
    writeFileSync(temiz, JSON.stringify({ v: 1, tur: "tekserp-kok-kuyrugu", uretim: msToIso(Date.now()), talepler: [talepler[0], talepler[3]] }));
    const temizCikti = path.join(TMP, "temiz-imzali.json");
    const ok = anahtar(["kuyruk-imzala", `--kok=${KOK}`, `--kok-dizin=${K}`, `--kuyruk=${temiz}`, `--cikti=${temizCikti}`], `${KOK_PAROLA}\n`);
    kontrol("§3b ✓K temiz kuyruk (taban doğrulanan + tabanı gelmeyen) imzalanır — sed kör RED değil",
      ok.kod === 0 && existsSync(temizCikti) && (JSON.parse(readFileSync(temizCikti, "utf8")) as { haklar: unknown[] }).haklar.length === 2, `${ok.kod} ${ok.err.trim().slice(-200)}`);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) process.exit(1);
}

main();
