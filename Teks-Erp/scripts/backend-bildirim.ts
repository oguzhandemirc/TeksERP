// =============================================================================
// BACKEND SÜRÜM BİLDİRİMİ — imzalı paketten `tekserp-surum` (Dağıtım v2, docs/design/GUNCELLEYICI.md §1)
// =============================================================================
// Satıcı Mac'inde koşar; imza anahtarı CI'a ve pakete GİRMEZ. Yayıncı `deploy/backend-yayinla.mjs` çağırır.
//
//   npx tsx scripts/backend-bildirim.ts dogrula --zip=<paket.zip> --kanal=<kod> --kanal-turu=<uretim|hazirlik>
//       --pg-gerekli=<ana.küçük> --ozet-dosyasi=<txt> --cikti=<dizin> [--pg-paket=<zip>] [--min-kaynak=<sürüm>] [--zorunlu]
//   npx tsx scripts/backend-bildirim.ts imzala  … aynı … --anahtar=<PAKET anahtar dosyası>
//
// dogrula: zip'i geçici dizine açar, imzalı dosya listesini (`butunluk.jws`) PAKET çapasıyla TAM denetler
//   (GEÇERLİ değilse DUR), künyeyi `PAKET.json`la ve kanalla bağlar, bildirimi kurar (imzasız).
// imzala: aynısı + PAKET anahtarıyla imzalar (parola TTY'de gizli ya da stdin satırı — argümandan ASLA);
//   imzalayan = paketin `butunluk.jws`ini imzalayan anahtar olmalı; imza geri doğrulanır.
// Çıktı: `<cikti>/sonuc.json` {v, kip, bildirim, surum, paket, uyarilar}; imzada ayrıca `<cikti>/surum.json`
//   (işaretçi — yayıncı hem `<sürüm>/surum.json` hem `son.json` olarak yükler).
// Test çapası (`--capa=<json>` ya da ortam `TEKSERP_TEST_PAKET_CAPASI`) YALNIZ bekçiler içindir ve YALNIZ hazırlık
// kanalında kabul edilir; gerçek çapa `PACKAGE_PUBLIC_KEYS`. Kurulumun güncelleyicisi kendi gömülü çapasıyla doğrular.
// =============================================================================
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PgVersionSchema,
  ReleaseVersionSchema,
  compareVersions,
  parseJws,
  releasePointerText,
  signReleaseManifest,
  verifyReleaseManifest,
  type ReleaseManifest,
} from "../src/lib/license/protocol";
import { PACKAGE_PUBLIC_KEYS, verifyIntegrity, type PackageKey } from "../src/lib/license/integrity";
import { INTEGRITY_FILE, isStagingPackageKid } from "../src/lib/license/integrity-scope";
import { openPackageKey } from "./lib/butunluk-imza";
import { CliError, args, askPassword } from "./lib/cli-girdi";

interface Girdi {
  readonly komut: "dogrula" | "imzala";
  readonly zip: string;
  readonly kanal: string;
  readonly kanalTuru: "uretim" | "hazirlik";
  readonly pgGerekli: string;
  readonly pgPaket: string | null;
  readonly minKaynak: string | null;
  readonly zorunlu: boolean;
  readonly ozet: string;
  readonly cikti: string;
  readonly anahtar: string | null;
  readonly capa: readonly PackageKey[];
}

function sha256Dosya(yol: string): string {
  return createHash("sha256").update(fs.readFileSync(yol)).digest("hex");
}

function girdiOku(argv: readonly string[]): Girdi {
  const { command, flags } = args(argv);
  if (command !== "dogrula" && command !== "imzala") throw new CliError("komut: dogrula | imzala");
  const gerek = (ad: string): string => {
    const v = flags.get(ad);
    if (!v) throw new CliError(`--${ad}=… gerekli`);
    return v;
  };
  const kanalTuru = gerek("kanal-turu");
  if (kanalTuru !== "uretim" && kanalTuru !== "hazirlik") throw new CliError("--kanal-turu uretim | hazirlik");
  const pgGerekli = gerek("pg-gerekli");
  if (!PgVersionSchema.safeParse(pgGerekli).success) throw new CliError(`--pg-gerekli ana.küçük biçiminde olmalı (ör. 16.4): ${pgGerekli}`);
  const minKaynak = flags.get("min-kaynak") ?? null;
  if (minKaynak !== null && !ReleaseVersionSchema.safeParse(minKaynak).success) throw new CliError(`--min-kaynak sürüm biçiminde değil: ${minKaynak}`);
  const ozet = fs.readFileSync(gerek("ozet-dosyasi"), "utf8").trim();
  if (ozet.length === 0 || ozet.length > 2000) throw new CliError(`sürüm özeti 1–2000 karakter olmalı (${ozet.length})`);
  const capaDosyasi = flags.get("capa") ?? process.env.TEKSERP_TEST_PAKET_CAPASI;
  if (capaDosyasi && kanalTuru !== "hazirlik") throw new CliError("test çapası yalnız hazırlık kanalında kabul edilir");
  const capa: readonly PackageKey[] = capaDosyasi ? (JSON.parse(fs.readFileSync(capaDosyasi, "utf8")) as PackageKey[]) : PACKAGE_PUBLIC_KEYS;
  if (capaDosyasi) console.error("⚠ TEST ÇAPASI kullanılıyor — yalnız bekçi içindir");
  return {
    komut: command,
    zip: path.resolve(gerek("zip")),
    kanal: gerek("kanal"),
    kanalTuru,
    pgGerekli,
    pgPaket: flags.get("pg-paket") ? path.resolve(flags.get("pg-paket")!) : null,
    minKaynak,
    zorunlu: flags.has("zorunlu"),
    ozet,
    cikti: path.resolve(gerek("cikti")),
    anahtar: command === "imzala" ? gerek("anahtar") : null,
    capa,
  };
}

interface PaketKunyesi {
  readonly korumali?: unknown;
  readonly korumaHedef?: unknown;
  readonly backendKanal?: unknown;
  readonly prova?: unknown;
  readonly commit?: unknown;
  readonly uygulamaSurumu?: unknown;
  readonly migrationSayisi?: unknown;
  readonly runtimeNodeSurumu?: unknown;
}

/** Paketi açar, bütünlüğünü ve künyesini denetler; bildirim yükünü kurar (imzasız). */
async function bildirimKur(g: Girdi, uyarilar: string[]): Promise<ReleaseManifest> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-bildirim-"));
  try {
    execFileSync("unzip", ["-q", g.zip, "-d", tmp]);
    const kunye = JSON.parse(fs.readFileSync(path.join(tmp, "PAKET.json"), "utf8").replace(/^﻿/, "")) as PaketKunyesi;
    if (kunye.korumali !== true) throw new CliError("yalnız KORUMALI paket yayınlanır (PAKET.json korumali=true)");
    if (kunye.korumaHedef !== "win-x64") throw new CliError(`paket hedefi win-x64 değil: ${String(kunye.korumaHedef)}`);
    if (kunye.backendKanal !== g.kanal) throw new CliError(`paket "${String(kunye.backendKanal)}" kanalı için üretilmiş, hedef "${g.kanal}" (paketle.ps1 -Musteri ${g.kanal})`);
    if (kunye.prova === true && g.kanalTuru === "uretim") throw new CliError("PROVA paketi üretim kanalına yayınlanmaz");
    const jws = fs.readFileSync(path.join(tmp, INTEGRITY_FILE), "utf8").trim();
    const rapor = await verifyIntegrity(jws, tmp, g.capa);
    if (rapor.durum !== "GECERLI" || !rapor.paket) throw new CliError(`paket bütünlüğü ${rapor.durum} (${rapor.kod ?? "?"}) — imzasız/kurcalı paket yayınlanmaz`);
    const baslik = parseJws(jws);
    if (!baslik.ok) throw new CliError(`butunluk.jws ayrıştırılamadı: ${baslik.code}`);
    const kid = baslik.value.header.kid;
    if (isStagingPackageKid(kid) && g.kanalTuru === "uretim") {
      uyarilar.push(`paket HAZIRLIK anahtarıyla (${kid}) imzalı: bu kanaldaki ÜRETİM sınıfı kurulumlar onu REDDEDER (yalnız TEST/DEMO kurar)`);
    }
    const p = rapor.paket;
    if (p.urun !== "backend") throw new CliError(`künye ürünü backend değil: ${p.urun}`);
    if (p.surum !== kunye.uygulamaSurumu) throw new CliError(`künye sürümü (${p.surum}) PAKET.json uygulamaSurumu (${String(kunye.uygulamaSurumu)}) ile aynı değil`);
    if (p.musteri !== null && p.musteri !== g.kanal) throw new CliError(`künye müşterisi ${p.musteri}, hedef kanal ${g.kanal}`);
    if (typeof kunye.commit !== "string" || typeof kunye.runtimeNodeSurumu !== "string" || typeof kunye.migrationSayisi !== "number") {
      throw new CliError("PAKET.json commit / runtimeNodeSurumu / migrationSayisi eksik");
    }
    if (g.minKaynak !== null && (compareVersions(g.minKaynak, p.surum) ?? 0) >= 0) throw new CliError(`--min-kaynak (${g.minKaynak}) sürümden (${p.surum}) eski olmalı`);
    const pgPaket = g.pgPaket
      ? { ad: path.basename(g.pgPaket), boyut: fs.statSync(g.pgPaket).size, sha256: sha256Dosya(g.pgPaket) }
      : null;
    return {
      v: 1,
      urun: "backend",
      platform: "win32-x64",
      kanal: g.kanal,
      surum: p.surum,
      commit: kunye.commit,
      derlemeTarihi: p.derlemeTarihi,
      yayinZamani: new Date().toISOString(),
      paket: { ad: path.basename(g.zip), boyut: fs.statSync(g.zip).size, sha256: sha256Dosya(g.zip), paketId: p.paketId },
      paketImzaKid: kid,
      minKaynakSurum: g.minKaynak,
      gocSayisi: kunye.migrationSayisi,
      pg: { gerekenSurum: g.pgGerekli, paket: pgPaket },
      runtime: { node: kunye.runtimeNodeSurumu },
      notlar: { ozet: g.ozet },
      zorunlu: g.zorunlu,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const g = girdiOku(process.argv.slice(2));
  const uyarilar: string[] = [];
  const yuk = await bildirimKur(g, uyarilar);
  fs.mkdirSync(g.cikti, { recursive: true });
  let bildirim: string | null = null;
  if (g.komut === "imzala" && g.anahtar) {
    const key = await openPackageKey(g.anahtar, (kid) => askPassword(`PAKET anahtarı (${kid}) parolası: `));
    if (key.kid !== yuk.paketImzaKid) throw new CliError(`anahtar ${key.kid}, paketin imzalayanı ${yuk.paketImzaKid} — bildirim paketi imzalayan anahtarla imzalanır`);
    bildirim = signReleaseManifest({ payload: yuk, key: { kid: key.kid, privateKey: key.privateKey } });
    const geri = verifyReleaseManifest(bildirim, { keys: [{ kid: key.kid, x: key.x }], kanal: g.kanal });
    if (!geri.ok) throw new Error(`öz-denetim düştü: ${geri.code}`);
    fs.writeFileSync(path.join(g.cikti, "surum.json"), releasePointerText(bildirim), { mode: 0o644 });
  }
  const sonuc = { v: 1, kip: g.komut, surum: yuk.surum, bildirim: yuk, jws: bildirim, uyarilar };
  fs.writeFileSync(path.join(g.cikti, "sonuc.json"), `${JSON.stringify(sonuc, null, 2)}\n`);
  for (const u of uyarilar) console.error(`⚠ ${u}`);
  console.error(`✓ ${g.komut}: backend ${yuk.surum} → ${g.kanal} · paket ${yuk.paket.ad} (${yuk.paket.boyut} B) · kid ${yuk.paketImzaKid}`);
}

main().catch((e: unknown) => {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(e instanceof CliError ? 2 : 1);
});
