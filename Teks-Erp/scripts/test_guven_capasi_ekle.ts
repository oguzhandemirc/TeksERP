// =============================================================================
// BEKÇİ — güven çapası ekleme betiği (`scripts/guven-capasi-ekle.ts` + `scripts/lib/guven-capasi.ts`)
// =============================================================================
// DB'siz. NEDEN: çapaya anahtar yılda birkaç kez (tören, rotasyon) girer; dosya biçimi o güne dek kayarsa
// betik tören günü durur ya da yanlış yazar. Bu bekçi her koşumda betiğin BUGÜNKÜ dört yeri ayrıştırıp
// bayt-eşit yeniden ürettiğini ölçer ve davranışını geçici bir KOPYADA sınar (gerçek ağaca yazmaz).
//   §0 gerçek ağaç: iki kipin dört listesi ayrıştırılır + aynalar eşit + anchor.rs = TS (kip başına); her liste
//      yalnız kendi kipinin kid'ini taşır; gömülü çapa vektörlerinin fikstür kid'leri (`kok-fikstur-1` ·
//      `paket-fikstur`) biçimin DIŞINDA — tören günü çapaya giren gerçek anahtar vektör dosyasını kaydıramaz (kipin
//      kendi listesine göre) · fikstür köklerinin kid'leri (`kok-fikstur-1` · `hazirlik-fikstur-1`) gerçek çapada yok
//      ve biçim dışı (§0g) · lisans v2 vektörleri (`protokol-v2.json`, L2-1) de aynı kayma kuralıyla (§0e2); ara
//      zincirde imzacı, ara sertifikayı imzalayan köktür (§0f2 ✓K). Sonda: v2 türleri sınıflandırıcıdan düştü →
//      §0e2 · §0f2; imzacı HAK'ın `ara-` kid'inden okundu → §0f2 (gerçek veri o hâlde kör kalır — ✓K bunu görür)
//   §1 kuru koşum dosyaya dokunmaz · §2 kök ekleme: kid'in KİPİNİN listesinin sonuna eklenir (üretim kökü üretim,
//      hazırlık kökü hazırlık listesine; öteki liste değişmez), aynalar bayt-eşit, anchor.rs kâhin deseniyle TS'e
//      eşit, TS modülü derin donuk ve `prepareTrustAnchor` geçer · §3 aynı anahtar ikinci kez → değişiklik yok ·
//      §4 PAKET ekleme (iki kip) · §5 RET dalları (dosyaya dokunmaz; anahtar iki kip arasında da tekrar edemez) ·
//      §6 elle bozulmuş biçim / ayna farkı / üretim listesinde hazırlık kökü → BICIM, yazım yok · §7 üretilen
//      anchor.rs düzeni `rustfmt --check` temiz (rustfmt yoksa ⏭)
// ⭐ KALICI SONDA ✓K: §5–§6 her koşumda ret ve biçim dallarını ısırtır; §0c fikstür kid'leri kuralda ret alır.
// Koşum: node ../scripts/agir-is.mjs -- npx tsx scripts/test_guven_capasi_ekle.ts
// =============================================================================
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { atlamaDefteri } from "./lib/atlama";
import { fiksturKur } from "./lib/lisans-fikstur";
import { main as ekle } from "./guven-capasi-ekle";
import {
  CAPA_BLOKLARI,
  CAPA_DOSYALARI,
  KOK_KID_BICIMI,
  RUSTFMT_GENISLIK,
  capaDurumuOku,
  kokKipi,
  paketKidGecerli,
  paketKipi,
  rsSabiti,
  type CapaDurumu,
} from "./lib/guven-capasi";
import { TRUST_ANCHOR_MODES, prepareTrustAnchor, type RootKey, type TrustAnchorMode } from "../src/lib/license/protocol";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}
const ATLAMA = atlamaDefteri(() => {
  fail++;
});

const DEPO = path.resolve(__dirname, "..", "..");
const TUM_DOSYALAR = [CAPA_DOSYALARI.kokTs, ...CAPA_DOSYALARI.kokAynalari, CAPA_DOSYALARI.paketTs, CAPA_DOSYALARI.anchorRs];
const RS_KOK_OGE = /\("([^"]+)", "([^"]+)", &\[([^\]]*)\]\)/g; // kâhin §0e deseni

const taze = (): string => generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x as string;
const oku = (kok: string, yol: string): string => readFileSync(path.join(kok, yol), "utf8");
const anlik = (kok: string): string => TUM_DOSYALAR.map((y) => oku(kok, y)).join("\u0000");

/** Konsolu susturup betiği süreç içinde koşar (çıkış kodu döner). */
function kos(argv: string[]): number {
  const log = console.log;
  const err = console.error;
  console.log = () => undefined;
  console.error = () => undefined;
  try {
    return ekle(argv);
  } finally {
    console.log = log;
    console.error = err;
  }
}

function kopya(): string {
  const kok = mkdtempSync(path.join(os.tmpdir(), "guven-capasi-"));
  for (const yol of TUM_DOSYALAR) {
    mkdirSync(path.dirname(path.join(kok, yol)), { recursive: true });
    copyFileSync(path.join(DEPO, yol), path.join(kok, yol));
  }
  return kok;
}

function bolum0(): CapaDurumu | null {
  console.log("\n§0 gerçek ağaç");
  let d: CapaDurumu | null = null;
  try {
    d = capaDurumuOku(DEPO);
  } catch (e) {
    check("§0a betik bugünkü dört yeri iki kipte ayrıştırır (biçim · aynalar · anchor.rs = TS · liste ailesi)", false, (e as Error).message);
    return null;
  }
  const sayilar = TRUST_ANCHOR_MODES.map((k) => `${k}: ${d!.kokler[k].length} kök · ${d!.paketler[k].length} PAKET`).join(" · ");
  check(
    "§0a betik bugünkü dört yeri iki kipte ayrıştırır (biçim · aynalar · anchor.rs = TS · liste ailesi)",
    TRUST_ANCHOR_MODES.every((k) => d!.kokler[k].length >= 1 && d!.paketler[k].length >= 1),
    sayilar,
  );
  const yabanci = TRUST_ANCHOR_MODES.flatMap((k) => [...d!.kokler[k].filter((r) => kokKipi(r.kid) !== k), ...d!.paketler[k].filter((p) => paketKipi(p.kid) !== k)].map((x) => `${k}:${x.kid}`));
  check("§0b ⭐ her liste yalnız kendi kipinin kid'ini taşır (üretimde kok-*/paket-<yıl>, hazırlıkta hazirlik-*/paket-hazirlik…)", yabanci.length === 0, yabanci.join(", ") || "temiz");
  check(
    "§0c ⭐ gömülü çapa vektörlerinin fikstür kid'leri biçim DIŞINDA (kok-fikstur-1 · paket-fikstur çapaya giremez; kural bir şeyi dışarıda bırakıyor)",
    !KOK_KID_BICIMI.test("kok-fikstur-1") && !paketKidGecerli("paket-fikstur") && KOK_KID_BICIMI.test("kok-2026-1") && paketKidGecerli("paket-2026") && paketKidGecerli("paket-hazirlik"),
  );
  const vektor = readFileSync(path.join(DEPO, "Teks-Erp/scripts/lib/lisans-cekirdek-vektor.ts"), "utf8") + readFileSync(path.join(DEPO, "Teks-Erp/scripts/lib/lisans-butunluk-vektor.ts"), "utf8");
  check("§0d körlük zemini: vektör üreticisi bu fikstür kid'lerini gerçekten kullanıyor", vektor.includes('"kok-fikstur-1"') && vektor.includes('"paket-fikstur"'));
  const kayitlar = (JSON.parse(readFileSync(path.join(DEPO, VEKTOR_DOSYASI), "utf8")) as { kayitlar: Array<{ vektor: Record<string, unknown> }> }).kayitlar;
  const gomulu = gomuluCapaImzacilari(kayitlar);
  const kayacak = kaymaAdaylari(gomulu, d);
  check(
    "§0e ⭐ gömülü çapayla koşan her vektörün imzacısı ya KENDİ kipinin listesinde ya o kipin biçimi DIŞINDA (tören günü sonuç kaymaz)",
    gomulu.length >= 16 && TRUST_ANCHOR_MODES.every((k) => gomulu.some((i) => i.kip === k)) && kayacak.length === 0,
    kayacak.join(" · ") || `${gomulu.length} vektör`,
  );
  const sahte = kaymaAdaylari(
    [
      { ad: "sahte", tur: "hak", kid: "kok-2099-1", kip: "uretim" },
      { ad: "sahte-paket", tur: "butunluk", kid: "paket-2099", kip: "uretim" },
      { ad: "hazirlik", tur: "hak", kid: "hazirlik-2026-1", kip: "hazirlik" },
      { ad: "capraz", tur: "hak", kid: "kok-2099-1", kip: "hazirlik" },
      { ad: "kipsiz", tur: "hak", kid: "kok-fikstur-1", kip: null },
    ],
    d,
  );
  check("§0f ✓K sınıflandırıcı kipinin biçiminde olup listesinde olmayan imzacıyı (kök + PAKET) ve kipsiz vektörü yakalar, öteki kipin kid'inde susar", sahte.length === 3, sahte.join(" · "));
  // Lisans v2 vektörleri ayrı dosyada (L2-1): aynı kayma kuralı orada da ölçülür — ikinci dosya kör kalmasın.
  const v2Kayitlar = (JSON.parse(readFileSync(path.join(DEPO, VEKTOR_V2_DOSYASI), "utf8")) as { kayitlar: Array<{ vektor: Record<string, unknown> }> }).kayitlar;
  const v2Gomulu = gomuluCapaImzacilari(v2Kayitlar);
  const v2Kayacak = kaymaAdaylari(v2Gomulu, d);
  check(
    "§0e2 ⭐ v2 dosyasında (protokol-v2.json) gömülü çapa vektörlerinin imzacısı da kaymaz; ara zincirde imzacı, ara sertifikayı imzalayan köktür",
    v2Gomulu.length >= 4 && TRUST_ANCHOR_MODES.every((k) => v2Gomulu.some((i) => i.kip === k)) && v2Gomulu.every((i) => i.kid !== "?") && v2Kayacak.length === 0,
    v2Kayacak.join(" · ") || `${v2Gomulu.length} vektör`,
  );
  const araYuk = b64(JSON.stringify({ imzaciSertifikasi: `${b64(JSON.stringify({ alg: "EdDSA", typ: "tekserp-sertifika", kid: "kok-2099-1" }))}.e30.x` }));
  const v2Sahte = gomuluCapaImzacilari([{ vektor: { ad: "ara", tur: "hak2", token: `${b64(JSON.stringify({ kid: "ara-2026-1" }))}.${araYuk}.x`, roots: null, kip: "uretim" } }]);
  check("§0f2 ✓K v2 ara zincirinde imzacı gömülü sertifikanın kökünden okunur (HAK'ın ara- kid'inden değil) ve kayma yakalanır", v2Sahte[0]?.kid === "kok-2099-1" && kaymaAdaylari(v2Sahte, d).length === 1, v2Sahte.map((i) => i.kid).join(","));
  const f = fiksturKur(0);
  const capaKidleri = new Set(TRUST_ANCHOR_MODES.flatMap((k) => d!.kokler[k].map((r) => r.kid)));
  const fiksturKokleri = [f.kok.kid, f.hazirlik.kid];
  check(
    "§0g ⭐ fikstür köklerinin kid'leri gerçek çapada YOK ve üretim biçimi DIŞINDA (gömülü çapayla koşan doğrulamada çarpışmaz, çapaya giremez)",
    fiksturKokleri.every((k) => !capaKidleri.has(k) && !KOK_KID_BICIMI.test(k)) && f.hazirlik.kid.startsWith("hazirlik-"),
    fiksturKokleri.join(", "),
  );
  return d;
}

const VEKTOR_DOSYASI = "Teks-Erp/native/lisans-cekirdek/test-vektorleri/protokol.json";
const VEKTOR_V2_DOSYASI = "Teks-Erp/native/lisans-cekirdek/test-vektorleri/protokol-v2.json";
const b64 = (metin: string): string => Buffer.from(metin, "utf8").toString("base64url");

function jwsKid(token: unknown): string | null {
  if (typeof token !== "string") return null;
  try {
    const kid = (JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8")) as { kid?: unknown }).kid;
    return typeof kid === "string" ? kid : null;
  } catch {
    return null;
  }
}

function gomuluSertifikaKid(token: unknown, alan: "altSertifika" | "imzaciSertifikasi"): string | null {
  if (typeof token !== "string") return null;
  try {
    return jwsKid((JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>)[alan]);
  } catch {
    return null;
  }
}

const altSertifikaKid = (token: unknown): string | null => gomuluSertifikaKid(token, "altSertifika");

interface Imzaci {
  readonly ad: string;
  readonly tur: string;
  readonly kid: string;
  /** Vektörün kipi; gömülü çapa vektörü kipsizse null (bu da kayma adayıdır). */
  readonly kip: TrustAnchorMode | null;
}

/** Gömülü çapayla koşan vektörler (`roots`/`keys` null), kipleri ve zinciri çapaya dayanan imzacının kid'i. */
function gomuluCapaImzacilari(kayitlar: ReadonlyArray<{ vektor: Record<string, unknown> }>): Imzaci[] {
  const out: Imzaci[] = [];
  for (const { vektor: v } of kayitlar) {
    const ad = String(v.ad);
    const tur = String(v.tur);
    const kip = v.kip === "uretim" || v.kip === "hazirlik" ? v.kip : null;
    let kid: string | null = null;
    if ((tur === "sertifika" || tur === "hak") && v.roots === null) kid = jwsKid(v.token);
    else if (tur === "kira" && v.roots === null) kid = altSertifikaKid(v.token);
    else if ((tur === "hak2" || tur === "iptal") && v.roots === null) kid = gomuluSertifikaKid(v.token, "imzaciSertifikasi") ?? jwsKid(v.token);
    else if (tur === "kira2" && v.roots === null) kid = altSertifikaKid(v.token);
    else if (tur === "butunluk" && v.keys === null) kid = jwsKid(v.manifest);
    else if (v.roots === null || v.keys === null) kid = "?";
    if (kid !== null) out.push({ ad, tur, kid, kip });
  }
  return out;
}

/**
 * Kayma adayı: vektörün KİPİNİN biçiminde (kök `kok-*`/`hazirlik-*`, PAKET `paket-<yıl>`/`paket-hazirlik*`) ama o kipin
 * listesinde OLMAYAN imzacı — o kid o listeye girdiğinde vektörün beklenen sonucu kayar. Kipsiz vektör de adaydır.
 */
function kaymaAdaylari(imzacilar: readonly Imzaci[], d: CapaDurumu): string[] {
  return imzacilar
    .filter((i) => {
      if (i.kip === null || i.kid === "?") return true;
      if (i.tur === "butunluk") return paketKipi(i.kid) === i.kip && !d.paketler[i.kip].some((k) => k.kid === i.kid);
      return kokKipi(i.kid) === i.kip && !d.kokler[i.kip].some((r) => r.kid === i.kid);
    })
    .map((i) => `${i.tur}/${i.ad}: ${i.kid} (${i.kip ?? "kipsiz"})`);
}

/** Yazılan TS kök modülünü yükler (geçici kopyada; önbellek kopya yoluna özgü). */
function kokModulu(kok: string): Record<string, readonly RootKey[]> {
  return require(path.join(kok, CAPA_DOSYALARI.kokTs)) as Record<string, readonly RootKey[]>;
}

const rsOgeler = (metin: string, ad: string): Array<{ kid: string; x: string; classes: string[] }> => {
  const blok = rsKokBlokDeseni(ad).exec(metin)?.[0] ?? "";
  return [...blok.matchAll(RS_KOK_OGE)].map((m) => ({ kid: m[1], x: m[2], classes: [...m[3].matchAll(/"([^"]+)"/g)].map((c) => c[1]) }));
};

function bolum1ile4(): void {
  console.log("\n§1–§4 geçici kopyada ekleme");
  const kok = kopya();
  try {
    const once = anlik(kok);
    const x = taze();
    const kokArg = [`--kok=${kok}`];
    const r1 = kos(["kok", "--kid=kok-2099-1", `--x=${x}`, "--siniflar=URETIM,DR,BAYI,BARINDIRILAN,TEST,DEMO", ...kokArg]);
    check("§1 kuru koşum: çıkış 0, dosyalara dokunulmadı", r1 === 0 && anlik(kok) === once);

    const d0 = capaDurumuOku(kok);
    const r2 = kos(["kok", "--kid=kok-2099-1", `--x=${x}`, "--siniflar=URETIM,DR,BAYI,BARINDIRILAN,TEST,DEMO", "--yaz", ...kokArg]);
    const d = capaDurumuOku(kok);
    const son = d.kokler.uretim[d.kokler.uretim.length - 1];
    check(
      "§2a --yaz: çıkış 0, yeni üretim kökü ÜRETİM listesinin SONUNDA, eskiler aynı sırada, hazırlık listesi DEĞİŞMEDİ",
      r2 === 0 &&
        son?.kid === "kok-2099-1" &&
        son.x === x &&
        d.kokler.uretim.length === d0.kokler.uretim.length + 1 &&
        JSON.stringify(d.kokler.uretim.slice(0, -1)) === JSON.stringify(d0.kokler.uretim) &&
        JSON.stringify(d.kokler.hazirlik) === JSON.stringify(d0.kokler.hazirlik),
    );
    const kaynak = oku(kok, CAPA_DOSYALARI.kokTs);
    check("§2b satıcı + patron aynası kaynakla BAYT-EŞİT", CAPA_DOSYALARI.kokAynalari.every((a) => oku(kok, a) === kaynak));
    const rsMetin = oku(kok, CAPA_DOSYALARI.anchorRs);
    check(
      "§2c anchor.rs (kâhin §0e deseni) kip başına = TS listeleri",
      TRUST_ANCHOR_MODES.every((k) => JSON.stringify(rsOgeler(rsMetin, CAPA_BLOKLARI[k].kokRs)) === JSON.stringify(d.kokler[k])),
      TRUST_ANCHOR_MODES.map((k) => `${k} ${d.kokler[k].length}`).join(" · "),
    );
    const modul = kokModulu(kok);
    const uretim = modul.PRODUCTION_ROOT_PUBLIC_KEYS;
    const hazirlik = modul.STAGING_ROOT_PUBLIC_KEYS;
    check(
      "§2d yazılan TS modülü yüklenir: iki liste derin donuk + prepareTrustAnchor geçer + yeni kök yalnız ÜRETİM listesinde",
      [uretim, hazirlik].every((l) => !!l && Object.isFrozen(l) && l.every((r) => Object.isFrozen(r) && Object.isFrozen(r.classes)) && prepareTrustAnchor(l).ok) &&
        uretim.some((r) => r.kid === "kok-2099-1" && r.x === x) &&
        !hazirlik.some((r) => r.kid === "kok-2099-1"),
    );
    check("§2e paket dosyası (integrity.ts) kök eklemede DEĞİŞMEDİ", oku(kok, CAPA_DOSYALARI.paketTs) === oku(DEPO, CAPA_DOSYALARI.paketTs));

    const hx = taze();
    const rh = kos(["kok", "--kid=hazirlik-2099-1", `--x=${hx}`, "--siniflar=TEST,DEMO", "--yaz", ...kokArg]);
    const dh = capaDurumuOku(kok);
    check(
      "§2f ⭐ hazırlık kökü HAZIRLIK listesinin SONUNA gider; üretim listesi DEĞİŞMEDİ (üretim derlemesi ona güvenmez)",
      rh === 0 &&
        dh.kokler.hazirlik[dh.kokler.hazirlik.length - 1]?.kid === "hazirlik-2099-1" &&
        JSON.stringify(dh.kokler.uretim) === JSON.stringify(d.kokler.uretim) &&
        rsOgeler(oku(kok, CAPA_DOSYALARI.anchorRs), CAPA_BLOKLARI.hazirlik.kokRs).some((r) => r.kid === "hazirlik-2099-1") &&
        !rsOgeler(oku(kok, CAPA_DOSYALARI.anchorRs), CAPA_BLOKLARI.uretim.kokRs).some((r) => r.kid === "hazirlik-2099-1"),
    );

    const ara = anlik(kok);
    const r3 = kos(["kok", "--kid=kok-2099-1", `--x=${x}`, "--siniflar=URETIM,DR,BAYI,BARINDIRILAN,TEST,DEMO", "--yaz", ...kokArg]);
    check("§3 aynı kid + aynı anahtar ikinci kez: çıkış 0, değişiklik yok (idempotent)", r3 === 0 && anlik(kok) === ara);

    const kokOnce = oku(kok, CAPA_DOSYALARI.kokTs);
    const px = taze();
    const r4 = kos(["paket", "--kid=paket-2099", `--x=${px}`, "--yaz", ...kokArg]);
    const d4 = capaDurumuOku(kok);
    const sonPaket = d4.paketler.uretim[d4.paketler.uretim.length - 1];
    check(
      "§4a PAKET ekleme (üretim): çıkış 0, integrity.ts ve anchor.rs'te ÜRETİM listesinin sonuna eklendi, eşit; hazırlık PAKET listesi aynı",
      r4 === 0 &&
        d4.paketler.uretim.length === dh.paketler.uretim.length + 1 &&
        sonPaket?.kid === "paket-2099" &&
        sonPaket.x === px &&
        JSON.stringify(d4.paketler.uretim.slice(0, -1)) === JSON.stringify(dh.paketler.uretim) &&
        JSON.stringify(d4.paketler.hazirlik) === JSON.stringify(dh.paketler.hazirlik),
    );
    check("§4b PAKET eklemede kök dosyaları DEĞİŞMEDİ", oku(kok, CAPA_DOSYALARI.kokTs) === kokOnce);
    const hpx = taze();
    const r5 = kos(["paket", "--kid=paket-hazirlik-2", `--x=${hpx}`, "--yaz", ...kokArg]);
    const d5 = capaDurumuOku(kok);
    check(
      "§4c ⭐ hazırlık PAKET anahtarı HAZIRLIK listesine gider; üretim PAKET listesi DEĞİŞMEDİ",
      r5 === 0 && d5.paketler.hazirlik[d5.paketler.hazirlik.length - 1]?.kid === "paket-hazirlik-2" && JSON.stringify(d5.paketler.uretim) === JSON.stringify(d4.paketler.uretim),
    );
  } catch (e) {
    // Yarım yazım (ör. ayna yazılmadı) ayrıştırıcıyı düşürür: çökme değil kırmızı.
    check("§1–§4 geçici kopya ekleme sonrası ayrıştırılabilir", false, (e as Error).message);
  } finally {
    rmSync(kok, { recursive: true, force: true });
  }
}

function bolum5ile6(d: CapaDurumu): void {
  console.log("\n§5 ret dalları (dosyaya dokunmaz) — ✓K");
  const hazirlik = d.kokler.hazirlik[0];
  const hazirlikPaket = d.paketler.hazirlik[0];
  // Her ret kendi kopyasında: bir dalın yanlışlıkla yazması sonrakileri kirletmesin.
  const ret = (ad: string, argv: string[], beklenen: number): void => {
    const kok = kopya();
    try {
      const once = anlik(kok);
      const r = kos([...argv, `--kok=${kok}`, "--yaz"]);
      check(`§5 ${ad} → çıkış ${beklenen}, dosyalar aynı`, r === beklenen && anlik(kok) === once, `çıkış ${r}`);
    } finally {
      rmSync(kok, { recursive: true, force: true });
    }
  };
  {
    ret("aynı kid BAŞKA anahtar (rotasyon yeni kid'dir)", ["kok", `--kid=${hazirlik?.kid ?? "hazirlik-2026-1"}`, `--x=${taze()}`, "--siniflar=TEST,DEMO"], 1);
    ret("hazırlık kökünün anahtarı ÜRETİM kid'iyle (iki kip arasında da tek kid)", ["kok", "--kid=kok-2099-2", `--x=${hazirlik?.x ?? ""}`, "--siniflar=URETIM"], 1);
    ret("hazırlık kökü ÜRETİM sınıfıyla", ["kok", "--kid=hazirlik-2099-1", `--x=${taze()}`, "--siniflar=TEST,URETIM"], 1);
    ret("biçimsiz kök kid'i (fikstür biçimi)", ["kok", "--kid=kok-fikstur-1", `--x=${taze()}`, "--siniflar=URETIM"], 1);
    ret("geçersiz açık anahtar (31 bayt)", ["kok", "--kid=kok-2099-3", `--x=${Buffer.alloc(31, 7).toString("base64url")}`, "--siniflar=URETIM"], 1);
    ret("tanınmayan sınıf", ["kok", "--kid=kok-2099-4", `--x=${taze()}`, "--siniflar=URETIM,YOK"], 1);
    ret("fikstür PAKET kid'i", ["paket", "--kid=paket-fikstur", `--x=${taze()}`], 1);
    ret("hazırlık PAKET anahtarı ÜRETİM kid'iyle (iki kip arasında da tek kid)", ["paket", "--kid=paket-2099", `--x=${hazirlikPaket?.x ?? ""}`], 1);
    ret("eksik argüman", ["kok", "--kid=kok-2099-5"], 64);
  }

  console.log("\n§6 bozuk başlangıç → BICIM, yazım yok — ✓K");
  const bozuk = (ad: string, degis: (kk: string) => void): void => {
    const kk = kopya();
    try {
      degis(kk);
      const once = anlik(kk);
      const r = kos(["kok", "--kid=kok-2099-6", `--x=${taze()}`, "--siniflar=URETIM", `--kok=${kk}`, "--yaz"]);
      check(`§6 ${ad} → çıkış 2, dosyalar aynı`, r === 2 && anlik(kk) === once, `çıkış ${r}`);
    } finally {
      rmSync(kk, { recursive: true, force: true });
    }
  };
  const tek = (yol: string, f: (s: string) => string) => (kk: string) => writeFileSync(path.join(kk, yol), f(oku(kk, yol)));
  bozuk("TS kök bloğu elle yeniden biçimlenmiş", tek(CAPA_DOSYALARI.kokTs, (s) => s.replace(/classes: Object\.freeze<LicenseClass\[\]>\(\[/, "classes:  Object.freeze<LicenseClass[]>([")));
  bozuk("satıcı aynası kaynaktan farklı", tek(CAPA_DOSYALARI.kokAynalari[0]!, (s) => `${s}\n// fark\n`));
  bozuk("anchor.rs rustfmt dışı düzen (aynı öğeler)", tek(CAPA_DOSYALARI.anchorRs, rustfmtDisiDuzen));
  bozuk("anchor.rs TS'ten farklı kök", tek(CAPA_DOSYALARI.anchorRs, (s) => s.replace(/"(hazirlik-2026-1)", "[A-Za-z0-9_-]{43}"/, `"$1", "${taze()}"`)));
  bozuk("⭐ üretim listesine hazırlık kökü elle eklenmiş (dört yer tutarlı ama aile yanlış)", (kk) => {
    if (!hazirlik) return;
    const satir = `  Object.freeze({\n    kid: ${JSON.stringify(hazirlik.kid)},\n    x: ${JSON.stringify(taze())},\n    classes: Object.freeze<LicenseClass[]>(["TEST", "DEMO"]),\n  }),\n`;
    const ts = oku(kk, CAPA_DOSYALARI.kokTs).replace(/(export const PRODUCTION_ROOT_PUBLIC_KEYS: readonly RootKey\[\] = Object\.freeze\(\[\n[\s\S]*?)(^\]\);$)/m, (_m, a: string, b: string) => `${a}${satir}${b}`);
    for (const y of [CAPA_DOSYALARI.kokTs, ...CAPA_DOSYALARI.kokAynalari]) writeFileSync(path.join(kk, y), ts);
    // anchor.rs da aynı öğelerle (rustfmt düzeniyle) yazılır: biçim ve TS = Rust tutar, yalnız AİLE yanlış.
    const uretimBlok = /export const PRODUCTION_ROOT_PUBLIC_KEYS[\s\S]*?^\]\);$/m.exec(ts)?.[0] ?? "";
    const ogeler = [...uretimBlok.matchAll(/^ {4}kid: "([^"]+)",\n {4}x: "([^"]+)",\n {4}classes: Object\.freeze<LicenseClass\[\]>\(\[([^\]]*)\]\)/gm)].map(
      (m) => `(${JSON.stringify(m[1])}, ${JSON.stringify(m[2])}, &[${m[3]}])`,
    );
    const ad = CAPA_BLOKLARI.uretim.kokRs;
    const rs = oku(kk, CAPA_DOSYALARI.anchorRs).replace(rsKokBlokDeseni(ad), () => rsSabiti(`pub const ${ad}: &[(&str, &str, &[&str])] =`, ogeler));
    writeFileSync(path.join(kk, CAPA_DOSYALARI.anchorRs), rs);
  });
}

const rsKokBlokDeseni = (ad: string): RegExp => new RegExp(`^pub const ${ad}: &\\[\\(&str, &str, &\\[&str\\]\\)\\] =[\\s\\S]*?\\];$`, "m");

/** Üretim kök bloğunu AYNI öğelerle rustfmt'in seçmeyeceği düzene çevirir (dikeyse tek satır, değilse dikey). */
function rustfmtDisiDuzen(metin: string): string {
  const ad = CAPA_BLOKLARI.uretim.kokRs;
  return metin.replace(rsKokBlokDeseni(ad), (blok) => {
    const ogeler = [...blok.matchAll(RS_KOK_OGE)].map((m) => m[0]);
    const bas = `pub const ${ad}: &[(&str, &str, &[&str])] =`;
    return blok.includes("\n    (") ? `${bas} &[${ogeler.join(", ")}];` : `${bas} &[\n${ogeler.map((o) => `    ${o},`).join("\n")}\n];`;
  });
}

function rustfmtBul(): string | null {
  const ad = process.platform === "win32" ? "rustfmt.exe" : "rustfmt";
  const yollar = [...(process.env.PATH ?? "").split(path.delimiter), path.join(os.homedir(), ".cargo", "bin")];
  const dizin = yollar.find((p) => p && existsSync(path.join(p, ad)));
  return dizin ? path.join(dizin, ad) : null;
}

function bolum7(): void {
  console.log("\n§7 anchor.rs düzeni = rustfmt");
  const rustfmt = rustfmtBul();
  const DUZENLER = 4;
  if (!rustfmt) {
    ATLAMA.atla("§7 rustfmt kıyası", "rustfmt yok (PATH · ~/.cargo/bin) — native commit kapısı `cargo fmt --check` ölçer", DUZENLER);
    return;
  }
  const kok = (kid: string): string => `(${JSON.stringify(kid)}, "${taze()}", &["URETIM", "DR", "BAYI", "BARINDIRILAN", "TEST", "DEMO"])`;
  const paket = (kid: string): string => `(${JSON.stringify(kid)}, "${taze()}")`;
  const duzenler: Array<[string, string, string[]]> = [
    ["tek satır", "pub const PRODUCTION_PACKAGE_KEYS: &[(&str, &str)] =", [paket("paket-2026")]],
    ["`=` sonrası tek satır", "pub const STAGING_PACKAGE_KEYS: &[(&str, &str)] =", [paket("paket-hazirlik"), paket("paket-hazirlik-2")]],
    ["dikey", "pub const PRODUCTION_ROOTS: &[(&str, &str, &[&str])] =", [kok("kok-2026-1"), kok("kok-2027-1"), kok("kok-2028-1")]],
    // Tek satır 141 karakter: rustfmt `=` sonrasına iner (bugünkü anchor.rs STAGING_ROOTS) — genişlik eşiği tam sınırda ölçülür.
    ["sınır (tek satır 141 karakter)", "pub const STAGING_ROOTS: &[(&str, &str, &[&str])] =", ['("hazirlik-2026-1", "705hChzAL045Gp-XoG6SaUKAW8muK1SFcW0Vpwhf-mo", &["TEST", "DEMO"])']],
  ];
  const ayar = path.join(DEPO, "Teks-Erp/native/lisans-cekirdek/rustfmt.toml");
  const gecici = mkdtempSync(path.join(os.tmpdir(), "guven-capasi-rs-"));
  try {
    for (const [ad, bas, ogeler] of duzenler) {
      const dosya = path.join(gecici, "anchor.rs");
      const metin = `${rsSabiti(bas, ogeler)}\n`;
      writeFileSync(dosya, metin);
      const r = spawnSync(rustfmt, ["--edition", "2021", "--check", "--config-path", ayar, dosya], { encoding: "utf8" });
      check(`§7 ${ad} düzeni rustfmt --check temiz (max_width ${RUSTFMT_GENISLIK})`, r.status === 0, r.status === 0 ? "" : (r.stdout || r.stderr).split("\n").slice(0, 4).join(" | "));
    }
  } finally {
    rmSync(gecici, { recursive: true, force: true });
  }
}

function main(): void {
  const d = bolum0();
  if (d) {
    bolum1ile4();
    bolum5ile6(d);
  }
  bolum7();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
