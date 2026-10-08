// =============================================================================
// THINKPAD KÖKENİ — CI dışındaki KAYITLI derleme makinesinin yapıtı (kullanıcı kararı 2026-10-08)
// =============================================================================
// `deploy/korumali-thinkpad.sh` zip'i Mac'e çekerken yanına DERLEME KÜNYESİ yazar (`<zip>.derleme.json`):
// makine (ad + ölçülen Tailscale IP) · betiğin commit'i + SHA256'sı · kaynak commit · iki ağacın temizliği ·
// Mac'te derlenen Rust parçalarının özetleri · zip'in iki uçta eşleşen SHA256'sı. İmza aracı künyeyi yapıtla
// ÇAPRAZ ölçer; künye yok/biçimsiz/ölçülemedi ya da bir alan tutmazsa imza YOK (fail-closed).
// Künye imzalı değildir: Mac'in kendisi güven sınırıdır; kapı yanlış zip'i / başka makineyi / kirli ağacı /
// elle değiştirilmiş betiği yakalamak içindir. Derleme kipi (prova | gercek) PAKET.json `prova` ile İKİ YÖNLÜ
// ölçülür: prova paketi gerçek sürüm künyesiyle, gerçek paket prova künyesiyle imzalanmaz.
// =============================================================================
import { createHash } from "node:crypto";
import { git } from "./git";

/** Kayıtlı derleme makineleri — yalnız kullanıcı kararıyla eklenir. */
export const KAYITLI_DERLEME_MAKINELERI = Object.freeze([Object.freeze({ ad: "thinkpad-1", tailscaleIp: "100.70.47.46", hedef: "win-x64" })]);
export const THINKPAD_BETIGI = "deploy/korumali-thinkpad.sh";
export const DERLEME_KUNYESI_TURU = "thinkpad-derleme";
/** Üretim imzası yalnız bu uzak dalın erişebildiği commit'lere (kaynak + betik) atılır. */
export const URETIM_REF = "origin/main";
/** Künyedeki derleme kipi; `kip` alanı olmayan v1 künye yalnız prova üreten betikten çıktı. */
export const DERLEME_KIPLERI = Object.freeze(["prova", "gercek"] as const);
export type DerlemeKipi = (typeof DERLEME_KIPLERI)[number];

/** Zip içindeki Rust parçaları (künye anahtarı → zip yolu). */
export const RUST_PARCALARI = Object.freeze({
  "lisans-cekirdek.win32-x64-msvc.node": "native/lisans-cekirdek.win32-x64-msvc.node",
  "tekserp-hizmet.exe": "runtime/tekserp-hizmet.exe",
  "tekserp-guncelleyici.exe": "runtime/tekserp-guncelleyici.exe",
} as const);
type RustAd = keyof typeof RUST_PARCALARI;

export interface ThinkpadOlcumu {
  /** Ayrıştırılmış `<zip>.derleme.json`; yoksa/okunamazsa null. */
  readonly kunye: unknown;
  /** İmzadan ÖNCE Mac'te ölçülen zip SHA256 (küçük harf). */
  readonly zipSha256: string;
  readonly paket: Record<string, unknown>;
  readonly serverKunye: Record<string, unknown>;
  /** Zip'ten çıkan Rust parçalarının SHA256'sı; dosya yoksa null. */
  readonly zipRust: Readonly<Record<RustAd, string | null>>;
  /** `git show <betik.commit>:<betik.yol>` SHA256'sı; ölçülemezse null. */
  readonly betikBlobSha256: string | null;
  /** Kaynak/betik commit'i `origin/main`den erişilebilir mi; ölçülemezse null. */
  readonly anaDalda: { readonly kaynak: boolean | null; readonly betik: boolean | null };
  readonly uretim: boolean;
}

export interface ThinkpadHukmu {
  readonly sonuc: "uyumlu" | "ihlal" | "olculemedi";
  readonly satirlar: string[];
}

/** İmzalı yüke (`ciKokeni`) giren kayıt; yayıncı okur ve basar. */
export type ThinkpadKaydi = {
  readonly kip: "thinkpad";
  readonly makine: string;
  readonly tailscaleIp: string;
  readonly commit: string;
  readonly zipSha256: string;
  readonly betikCommit: string;
  readonly derlemeKipi: DerlemeKipi;
};

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SURUM = /^\d+\.\d+\.\d+$/;
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Künyenin derleme kipi; alan yoksa prova (kip öncesi betik yalnız prova üretirdi), tanınmayan değer null. */
export function derlemeKipi(kunye: unknown): DerlemeKipi | null {
  const kip = obj(kunye)?.kip;
  if (kip === undefined) return "prova";
  return (DERLEME_KIPLERI as readonly unknown[]).includes(kip) ? (kip as DerlemeKipi) : null;
}

/** Saf hüküm: bütün ölçümler çağırandan gelir (bekçi doğrudan sınar). */
export function thinkpadKokeniHukmu(o: ThinkpadOlcumu): ThinkpadHukmu {
  const k = obj(o.kunye);
  const makine = obj(k?.makine);
  const betik = obj(k?.betik);
  const kaynak = obj(k?.kaynak);
  const agac = obj(k?.agac);
  const rust = obj(k?.rust);
  const zip = obj(k?.zip);
  if (!k || k.v !== 1 || k.tur !== DERLEME_KUNYESI_TURU || !makine || !betik || !kaynak || !agac || !rust || !zip) {
    return { sonuc: "olculemedi", satirlar: [`derleme künyesi yok/biçimsiz (v:1 · tur:${DERLEME_KUNYESI_TURU} · makine/betik/kaynak/agac/rust/zip) — ${THINKPAD_BETIGI} çıktısı değil`] };
  }
  const commit = str(kaynak.commit);
  if (!SHA40.test(commit) || !SHA40.test(str(betik.commit)) || !SHA256.test(str(betik.sha256)) || !SHA256.test(str(zip.sha256))) {
    return { sonuc: "olculemedi", satirlar: ["derleme künyesinde commit/özet alanları biçimsiz"] };
  }
  const kip = derlemeKipi(k);
  const kunyeSurum = k.surum === undefined || k.surum === null ? null : str(k.surum);
  if (kip === null) return { sonuc: "olculemedi", satirlar: [`derleme künyesinde kip tanınmıyor: "${String(k.kip)}" (${DERLEME_KIPLERI.join(" | ")})`] };
  if (kip === "gercek" && (kunyeSurum === null || !SURUM.test(kunyeSurum))) return { sonuc: "olculemedi", satirlar: ["gerçek sürüm künyesinde sürüm (x.y.z) yok/biçimsiz"] };
  if (o.betikBlobSha256 === null) return { sonuc: "olculemedi", satirlar: [`betik commit'i ${str(betik.commit).slice(0, 12)} depoda okunamadı — betik sürümü ölçülemedi`] };
  if (o.uretim && (o.anaDalda.kaynak === null || o.anaDalda.betik === null)) {
    return { sonuc: "olculemedi", satirlar: [`${URETIM_REF} erişilebilirliği ölçülemedi (git fetch origin?)`] };
  }

  const ih: string[] = [];
  const kayitli = KAYITLI_DERLEME_MAKINELERI.find((m) => m.ad === makine.ad && m.tailscaleIp === makine.tailscaleIp);
  if (!kayitli) ih.push(`derleme makinesi "${str(makine.ad)}" (${str(makine.tailscaleIp)}) kayıtlı değil — kayıtlı: ${KAYITLI_DERLEME_MAKINELERI.map((m) => `${m.ad} ${m.tailscaleIp}`).join(", ")}`);
  else if (o.paket.korumaHedef !== kayitli.hedef) ih.push(`paket hedefi "${str(o.paket.korumaHedef)}" — ${kayitli.ad} ${kayitli.hedef} derler`);
  if (str(zip.sha256) !== str(zip.uzakSha256)) ih.push("zip SHA256 iki uçta eşleşmemiş (künyede Mac ≠ thinkpad)");
  if (str(zip.sha256) !== o.zipSha256.toLowerCase()) ih.push(`imzalanan zip künyedekinden farklı: ${o.zipSha256.slice(0, 12)} ≠ künye ${str(zip.sha256).slice(0, 12)}`);
  if (agac.macKlonTemiz !== true || agac.uzakAgacTemiz !== true || o.paket.calismaAgaciTemiz !== true) ih.push("kirli ağaçtan derlenmiş (künye agac / PAKET.json calismaAgaciTemiz)");
  if (o.serverKunye.commit !== commit) ih.push(`yapıt (server-kunye.json) ${str(o.serverKunye.commit).slice(0, 12) || "(yok)"} commit'inden — künye ${commit.slice(0, 12)}`);
  const pc = str(o.paket.commit);
  if (!/^[0-9a-f]{7,40}$/.test(pc) || !commit.startsWith(pc)) ih.push(`paket (PAKET.json) "${pc}" commit'inde birleştirilmiş — künye ${commit.slice(0, 12)}`);
  const ikili = obj(o.paket.hizmetIkilileri);
  for (const ad of Object.keys(RUST_PARCALARI) as RustAd[]) {
    const beklenen = str(rust[ad]);
    if (!SHA256.test(beklenen) || o.zipRust[ad] !== beklenen) ih.push(`Rust parçası ${ad}: zip ${String(o.zipRust[ad]).slice(0, 12)} ≠ künye ${beklenen.slice(0, 12) || "(yok)"}`);
    if (ad.endsWith(".exe") && str(obj(ikili?.[ad])?.sha256).toLowerCase() !== beklenen) ih.push(`PAKET.json hizmetIkilileri ${ad} künyedeki özetle tutmuyor`);
  }
  const paketSurum = str(o.paket.uygulamaSurumu);
  if (kip === "gercek") {
    if (o.paket.prova !== false) ih.push(`künye GERÇEK sürüm (${kunyeSurum}) ama paket prova=${String(o.paket.prova)} — prova paketi gerçek sürüm diye imzalanmaz`);
    if (paketSurum !== kunyeSurum) ih.push(`paket sürümü "${paketSurum}" — künye gerçek sürüm ${kunyeSurum}`);
  } else {
    if (o.paket.prova !== true) ih.push(`künye PROVA derlemesi ama paket prova=${String(o.paket.prova)} — prova koşusunun yapıtı gerçek paket olamaz`);
    if (!paketSurum.includes("-prova.") || (kunyeSurum !== null && !paketSurum.startsWith(`${kunyeSurum}-prova.`))) ih.push(`prova paketinin sürümü "${paketSurum}" prova biçiminde değil (${kunyeSurum ?? "<sürüm>"}-prova.<commit>)`);
  }
  if (betik.yol !== THINKPAD_BETIGI) ih.push(`betik "${str(betik.yol)}" — ${THINKPAD_BETIGI} bekleniyor`);
  if (o.betikBlobSha256 !== betik.sha256) ih.push(`koşan betik ${str(betik.commit).slice(0, 12)} commit'indeki ${THINKPAD_BETIGI} değil (elle değiştirilmiş)`);
  if (o.uretim && o.anaDalda.kaynak === false) ih.push(`kaynak ${commit.slice(0, 12)} ${URETIM_REF}'de değil — üretim imzası yalnız ana dalın yapıtına`);
  if (o.uretim && o.anaDalda.betik === false) ih.push(`betik commit'i ${str(betik.commit).slice(0, 12)} ${URETIM_REF}'de değil`);
  if (ih.length) return { sonuc: "ihlal", satirlar: ih };
  return { sonuc: "uyumlu", satirlar: [`thinkpad kökeni (${kip}${kip === "gercek" ? ` ${kunyeSurum}` : ""}): ${str(makine.ad)} ${str(makine.tailscaleIp)} · ${commit.slice(0, 12)} · zip ${o.zipSha256.slice(0, 12)} · betik ${str(betik.commit).slice(0, 12)}`] };
}

export function thinkpadKaydi(kunye: unknown, zipSha256: string): ThinkpadKaydi {
  const k = obj(kunye) ?? {};
  return {
    kip: "thinkpad",
    makine: str(obj(k.makine)?.ad),
    tailscaleIp: str(obj(k.makine)?.tailscaleIp),
    commit: str(obj(k.kaynak)?.commit),
    zipSha256: zipSha256.toLowerCase(),
    betikCommit: str(obj(k.betik)?.commit),
    derlemeKipi: derlemeKipi(k) ?? "prova",
  };
}

/** Betiğin künyedeki commit'teki SHA256'sı (`git show`); okunamazsa null. */
export function betikBlobSha256(depo: string, commit: string, yol = THINKPAD_BETIGI): string | null {
  if (!SHA40.test(commit)) return null;
  try {
    // Betik UTF-8 metindir: `git()`in utf8 çözümü baytları korur.
    return createHash("sha256").update(Buffer.from(git(["-C", depo, "show", `${commit}:${yol}`], { stdio: "yut" }), "utf8")).digest("hex");
  } catch {
    return null;
  }
}

/** `commit` `origin/main`den erişilebilir mi: true/false; ref ya da commit yoksa null. */
export function anaDaldaMi(depo: string, commit: string): boolean | null {
  if (!SHA40.test(commit)) return null;
  try {
    git(["-C", depo, "rev-parse", "--verify", `${URETIM_REF}^{commit}`], { stdio: "yut" });
    git(["-C", depo, "cat-file", "-e", `${commit}^{commit}`], { stdio: "yut" });
  } catch {
    return null;
  }
  try {
    git(["-C", depo, "merge-base", "--is-ancestor", commit, URETIM_REF], { stdio: "yut" });
    return true;
  } catch {
    return false;
  }
}
