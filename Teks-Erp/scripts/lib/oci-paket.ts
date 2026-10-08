// =============================================================================
// LINUX/OCI TESLİM PAKETİ (`backend-oci`, sözleşme 5) — biçim + yayıncı denetimi (GUNCELLEYICI-SAGLAMLIK §1.3 · L3)
// =============================================================================
// Paket TEK sıkıştırılmamış dış tar'dır (`tekserp-backend-oci-<sürüm>.tar`); üyeleri düz addır (dizin yok):
//   tekserp-korumali_<sürüm>_linux-amd64.tar.gz   İMZALI imajın `docker save | gzip -n` çıktısı
//   docker-compose.yml                           güncelleyicili şablon (`docker-compose.guncelleyici.yml`, sürüm dolu)
//   .env.ornek                                   ilk kurulumun yapılandırma şablonu
//   tekserp-guncelleyici · guncelleyici-kunye.json linux-x64 güncelleyici + kendi künyesi (CI, ubuntu-22.04)
//   PAKET-DOCKER.json · PAKET-DOCKER.json.jws    teslim künyesi = `tekserp-butunluk` yükü (urun backend-docker)
//   butunluk-liste.txt · SHA256SUMS              imzalı liste (üyeleri kapsar) · elle denetim özetleri
// Yayıncı (`backend-bildirim.ts` `--tar`) dış zinciri TAM ölçer ve imzasız TABAN imajı reddeder: son katman yalnız
// imaj içi imza dosyalarını taşımalı, etiket `tr.tekserp.butunluk` = imzalayan, imzalı yük çapayla doğrulanmalı.
// İmaj kimliği CONFIG ÖZETİDİR (`sha256:<hex>`): `docker image inspect .Id` containerd deposunda index özetini
// verir ve depodan depoya değişir — kimlik her yerde arşivden ölçülür.
// =============================================================================
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CHAINED_INTEGRITY_FILE, isChainPackageKid, parseJws, type PackageTrust } from "../../src/lib/license/protocol";
import { readIntegrityList, verifyIntegrity, verifySignedManifest, type PackageKey } from "../../src/lib/license/integrity";
import { INTEGRITY_FILE } from "../../src/lib/license/integrity-scope";
import { INTEGRITY_LIST_FILE } from "../../src/lib/license/integrity-list";
import { imajArsiviOlc, tarDosyasiOku } from "./oci-arsiv";
import { CliError } from "./cli-girdi";

export const OCI_PLATFORM = "linux-x64-oci";
export const OCI_KUNYE = "PAKET-DOCKER.json";
export const OCI_KUNYE_JWS = "PAKET-DOCKER.json.jws";
export const OCI_KUNYE_URUN = "backend-docker";
export const OCI_IMAJ_ADI = "tekserp-korumali";
export const OCI_GUNCELLEYICI = "tekserp-guncelleyici";
export const OCI_GUNCELLEYICI_KUNYE = "guncelleyici-kunye.json";
/** Künyenin imzalı kapsamındaki teslim üyeleri (imaj arşivinin adı sürümden). */
export const ociKapsam = (surum: string): string[] => [ociImajArsivi(surum), "docker-compose.yml", ".env.ornek", OCI_GUNCELLEYICI, OCI_GUNCELLEYICI_KUNYE];
export const ociImajArsivi = (surum: string): string => `${OCI_IMAJ_ADI}_${surum}_linux-amd64.tar.gz`;
export const ociPaketAdi = (surum: string): string => `tekserp-backend-oci-${surum}.tar`;
/** Dış tar'ın TAM üye kümesi — fazlası da eksiği de RED. */
export const ociUyeler = (surum: string): string[] => [...ociKapsam(surum), OCI_KUNYE, OCI_KUNYE_JWS, INTEGRITY_LIST_FILE, "SHA256SUMS"];
/** İnce imza katmanının taşıyabileceği dosyalar (`imaj-imzala.mjs`). */
const IMZA_KATMANI = new Set([`app/${INTEGRITY_LIST_FILE}`, `app/${INTEGRITY_FILE}`, `app/${CHAINED_INTEGRITY_FILE}`, "app/paket-iptal.jws"]);

const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

function jwsYuku(jws: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(jws.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
}

export interface OciAcilan {
  readonly p: { readonly paketId: string; readonly urun: string; readonly surum: string; readonly derlemeTarihi: string; readonly musteri: string | null };
  readonly kid: string;
  readonly eskiKid: string | null;
  readonly zincirKid: string | null;
  readonly commit: string;
  readonly gocSayisi: number;
  readonly nodeSurum: string;
  readonly imaj: { readonly kimlik: string; readonly etiket: string };
  readonly guncelleyici: { readonly surum: string; readonly sha256: string };
  /** İmaj içi imzalı yükün CI kökeni (`ciKokeni`; Docker derlemesinde bugün kaçış cümlesi). */
  readonly ciKokeni: unknown;
}

/** ELF64 · little-endian · x86-64 (e_machine 0x3E). */
export function elfX64Mi(dosya: string): boolean {
  const b = Buffer.alloc(20);
  const fd = fs.openSync(dosya, "r");
  try {
    fs.readSync(fd, b, 0, 20, 0);
  } finally {
    fs.closeSync(fd);
  }
  return b.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && b[4] === 2 && b[5] === 1 && b.readUInt16LE(18) === 0x3e;
}

/** İmaj arşivinin imzalı son katmanını ölçer; imzasız taban, kurcalı/yabancı imza, etiket uyuşmazlığı RED. */
export async function imajDenetle(
  arsiv: string,
  beklenen: { readonly kimlik: string; readonly etiket: string; readonly surum: string },
  guven: { readonly capa: readonly PackageKey[]; readonly zincir: Omit<PackageTrust, "keys"> },
): Promise<{ readonly ciKokeni: unknown; readonly kid: string }> {
  let o;
  try {
    o = await imajArsiviOlc(arsiv);
  } catch (e) {
    throw new CliError(`imaj arşivi ölçülemedi: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (o.kimlik !== beklenen.kimlik) throw new CliError(`imaj kimliği (config özeti) ${o.kimlik} ≠ künye ${beklenen.kimlik}`);
  if (o.etiketler.length !== 1 || o.etiketler[0] !== beklenen.etiket) throw new CliError(`imaj etiketi ${JSON.stringify(o.etiketler)} ≠ künye ${beklenen.etiket}`);
  if (o.platform !== "linux/amd64") throw new CliError(`imaj platformu ${o.platform} (linux/amd64 bekleniyor)`);
  if (o.etiketDegerleri["tr.tekserp.imaj"] !== "korumali") throw new CliError("imaj korumalı imaj değil (label tr.tekserp.imaj)");
  const labelKid = o.etiketDegerleri["tr.tekserp.butunluk"];
  if (!labelKid) throw new CliError("İMZASIZ TABAN imaj: label tr.tekserp.butunluk yok — önce imaj-imzala.mjs (imaj içi liste)");
  const dosyalar = o.sonKatman.filter((g) => g.tip !== "dizin");
  const yabanci = o.sonKatman.filter((g) => (g.tip === "dizin" ? !/^app\/?$/.test(g.ad) : !IMZA_KATMANI.has(g.ad)));
  if (yabanci.length > 0) throw new CliError(`son katman ince imza katmanı değil (${yabanci.slice(0, 3).map((g) => g.ad).join(", ")}…) — imzasız taban üstüne değişiklik mi?`);
  const icerik = new Map(dosyalar.map((g) => [g.ad.slice("app/".length), g.veri!]));
  const yukAdi = [CHAINED_INTEGRITY_FILE, INTEGRITY_FILE].find((a) => icerik.has(a));
  if (!icerik.has(INTEGRITY_LIST_FILE) || !yukAdi) throw new CliError("İMZASIZ TABAN imaj: son katmanda imzalı liste/yük yok");
  const jws = icerik.get(yukAdi)!.toString("utf8").trim();
  const imza = verifySignedManifest(jws, guven.capa, guven.zincir);
  if (!imza.ok) throw new CliError(`imaj içi imza ${imza.durum} (${imza.code}) [${yukAdi}]`);
  if (imza.kid !== labelKid) throw new CliError(`imaj label'ı ${labelKid}, imaj içi yükü imzalayan ${imza.kid}`);
  if (imza.manifest.urun !== OCI_KUNYE_URUN || imza.manifest.surum !== beklenen.surum) {
    throw new CliError(`imaj içi künye ${imza.manifest.urun} ${imza.manifest.surum} ≠ ${OCI_KUNYE_URUN} ${beklenen.surum}`);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-imaj-liste-"));
  try {
    fs.writeFileSync(path.join(tmp, INTEGRITY_LIST_FILE), icerik.get(INTEGRITY_LIST_FILE)!);
    const liste = await readIntegrityList(tmp, imza.manifest.liste);
    if (!liste.ok) throw new CliError(`imaj içi liste imzalı yükle bağlanmıyor (${liste.bucket})`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { ciKokeni: jwsYuku(jws).ciKokeni ?? null, kid: imza.kid };
}

/** Dış tar → geçici dizin (üye kümesi TAM, yalnız düz dosya) → künye + güncelleyici + compose + imaj. */
export async function ociPaketiAc(tarDosyasi: string, guven: { readonly capa: readonly PackageKey[]; readonly zincir: Omit<PackageTrust, "keys"> }): Promise<OciAcilan> {
  const girdiler = await tarDosyasiOku(tarDosyasi, () => false);
  const adlar = girdiler.map((g) => g.ad);
  const kotu = girdiler.filter((g) => g.tip !== "dosya" || g.ad.includes("/") || g.ad.startsWith(".."));
  if (kotu.length > 0) throw new CliError(`dış tar yalnız düz dosya taşır (${kotu.slice(0, 3).map((g) => `${g.ad}:${g.tip}`).join(", ")})`);
  if (new Set(adlar).size !== adlar.length) throw new CliError("dış tar'da yinelenen üye");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-oci-"));
  try {
    execFileSync("tar", ["-xf", tarDosyasi, "-C", tmp]);
    const jws = fs.readFileSync(path.join(tmp, OCI_KUNYE_JWS), "utf8").trim();
    const baslik = parseJws(jws);
    if (!baslik.ok) throw new CliError(`${OCI_KUNYE_JWS} ayrıştırılamadı: ${baslik.code}`);
    const kid = baslik.value.header.kid;
    const rapor = isChainPackageKid(kid) ? await verifyIntegrity(jws, tmp, [], guven.zincir) : await verifyIntegrity(jws, tmp, guven.capa);
    if (rapor.durum !== "GECERLI" || !rapor.paket) throw new CliError(`teslim paketi bütünlüğü ${rapor.durum} (${rapor.kod ?? "?"}) — imzasız/kurcalı paket yayınlanmaz`);
    const p = rapor.paket;
    if (p.urun !== OCI_KUNYE_URUN) throw new CliError(`künye ürünü ${p.urun} (${OCI_KUNYE_URUN} bekleniyor)`);
    if (p.musteri !== null) throw new CliError(`künye müşterisi ${p.musteri} — ortak paket müşteri taşımaz`);
    const beklenenUyeler = ociUyeler(p.surum);
    const fazla = adlar.filter((a) => !beklenenUyeler.includes(a));
    const eksik = beklenenUyeler.filter((a) => !adlar.includes(a));
    if (fazla.length || eksik.length) throw new CliError(`dış tar üyeleri biçimde değil — fazla: ${fazla.join(", ") || "yok"} · eksik: ${eksik.join(", ") || "yok"}`);
    // İmzalı yük künyenin TAMAMIDIR; ek alanlar (imaj · guncelleyici · gocSayisi) imzanın kapsamında, şema onları atar.
    const k = jwsYuku(jws) as {
      platform?: unknown; commit?: unknown; gocSayisi?: unknown; kapsam?: { dosyalar?: unknown };
      imaj?: { kimlik?: unknown; etiket?: unknown; arsiv?: unknown };
      sunucu?: { nodeSurum?: unknown }; guncelleyici?: { surum?: unknown; sha256?: unknown };
    };
    const hata: string[] = [];
    if (k.platform !== OCI_PLATFORM) hata.push(`platform ${String(k.platform)}`);
    if (typeof k.commit !== "string" || !/^[0-9a-f]{7,40}$/.test(k.commit)) hata.push("commit");
    if (!Number.isInteger(k.gocSayisi) || (k.gocSayisi as number) < 1) hata.push("gocSayisi");
    if (typeof k.sunucu?.nodeSurum !== "string") hata.push("sunucu.nodeSurum");
    const etiket = `${OCI_IMAJ_ADI}:${p.surum}`;
    if (k.imaj?.etiket !== etiket) hata.push(`imaj.etiket ${String(k.imaj?.etiket)} (compose ${etiket} bekler)`);
    if (typeof k.imaj?.kimlik !== "string" || !/^sha256:[0-9a-f]{64}$/.test(k.imaj.kimlik)) hata.push("imaj.kimlik");
    if (k.imaj?.arsiv !== ociImajArsivi(p.surum)) hata.push("imaj.arsiv");
    if (JSON.stringify(k.kapsam?.dosyalar) !== JSON.stringify(ociKapsam(p.surum))) hata.push(`kapsam.dosyalar ${JSON.stringify(k.kapsam?.dosyalar)}`);
    if (typeof k.guncelleyici?.surum !== "string" || typeof k.guncelleyici?.sha256 !== "string") hata.push("guncelleyici");
    if (hata.length) throw new CliError(`teslim künyesi eksik/biçimsiz: ${hata.join(" · ")}`);
    // Güncelleyici: imzalı listedeki ikili linux-x64 ELF, künyesi sürüm derlemesinin (test çapasız, üretim kipi).
    const ikili = path.join(tmp, OCI_GUNCELLEYICI);
    if (!elfX64Mi(ikili)) throw new CliError(`${OCI_GUNCELLEYICI} linux-x64 ELF değil`);
    if (sha256(fs.readFileSync(ikili)) !== k.guncelleyici!.sha256) throw new CliError("güncelleyici özeti künyeyle tutmuyor");
    const gk = JSON.parse(fs.readFileSync(path.join(tmp, OCI_GUNCELLEYICI_KUNYE), "utf8")) as Record<string, unknown>;
    if (gk.ad !== "tekserp-guncelleyici" || gk.hedef !== "linux" || gk.testCapasi !== false || gk.capaKipi !== "uretim" || gk.surum !== k.guncelleyici!.surum) {
      throw new CliError(`güncelleyici künyesi sürüm derlemesinin değil: ${JSON.stringify(gk)}`);
    }
    // Compose: güncelleyicili şablon, sürümü dolu; imaj satırları künyenin etiketi.
    const compose = fs.readFileSync(path.join(tmp, "docker-compose.yml"), "utf8");
    const imajSatirlari = [...compose.matchAll(/^ {4}image: (tekserp-korumali:\S+)/gm)].map((m) => m[1]);
    if (compose.includes("@@") || !/^ {6}TEKSERP_GOC_ACILISTA: "0"/m.test(compose) || imajSatirlari.length < 2 || imajSatirlari.some((x) => x !== etiket)) {
      throw new CliError(`docker-compose.yml güncelleyicili şablonun ${p.surum} için doldurulmuş hâli değil`);
    }
    const imaj = await imajDenetle(path.join(tmp, ociImajArsivi(p.surum)), { kimlik: k.imaj!.kimlik as string, etiket, surum: p.surum }, guven);
    return {
      p,
      kid,
      eskiKid: isChainPackageKid(kid) ? null : kid,
      zincirKid: isChainPackageKid(kid) ? kid : null,
      commit: k.commit as string,
      gocSayisi: k.gocSayisi as number,
      nodeSurum: k.sunucu!.nodeSurum as string,
      imaj: { kimlik: k.imaj!.kimlik as string, etiket },
      guncelleyici: { surum: k.guncelleyici!.surum as string, sha256: k.guncelleyici!.sha256 as string },
      ciKokeni: imaj.ciKokeni,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
