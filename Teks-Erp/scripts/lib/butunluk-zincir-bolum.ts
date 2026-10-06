// `test_lisans_butunluk` §8 — zincirli (`pkt-*`) bütünlük listesi backend'de (PAKET-ANAHTARI-KOK-ALTINDA.md D3):
// liste sırası, YERLEŞİK kip (iptal yalnız uyarı), sertifika sınıfından dar yetki kuralı, PAKET iptal deposu ve
// güncelleyiciye bağlı `paket-zinciri` yeteneği. TS ve (varsa) test çapalı native çekirdekle koşulur.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  CHAINED_INTEGRITY_FILE,
  LICENSE_CLASSES,
  PACKAGE_REVOCATION_FILE,
  PackageRevocationSchema,
  TYP,
  parseJws,
  signChainedPackageDocument,
  signDocument,
  verifyPackageRevocation,
  type LicenseClass,
  type PackageRevocationDoc,
} from "../../src/lib/license/protocol";
import { IntegrityManifestSchema, INTEGRITY_TYP } from "../../src/lib/license/integrity";
import { INTEGRITY_FILE } from "../../src/lib/license/integrity-scope";
import { INTEGRITY_CERT_REVOKED_WARNING, decideForClass, runIntegrityCheck, type IntegrityCheckInput } from "../../src/lib/license/integrity-check";
import type { LicenseCore } from "../../src/lib/license/license-core";
import { loadLicenseStoreSync } from "../../src/lib/license/store";
import { adoptPackageRevocation, loadPackageRevocation } from "../../src/lib/license/package-revocation-store";
import { __resetLicenseCapabilitiesForTests, licenseCapabilities } from "../../src/lib/license/capabilities";
import { UPDATER_DIR_ENV, UPDATER_STATUS_FILE, readUpdaterStatus } from "../../src/lib/license/updater-ipc";
import { anahtarUret, fiksturKur, sertifikaBas, sertifikaYuku } from "./lisans-fikstur";

type Check = (label: string, ok: boolean, extra?: string) => void;

export interface ZincirOrtami {
  readonly check: Check;
  readonly temp: string;
  /** Bugünkü (`paket-*`) imzalı paket kökü üretir: `butunluk.jws` + liste. */
  readonly paketKur: (ad: string) => Promise<string>;
  readonly girdi: (kok: string, o?: Partial<IntegrityCheckInput>) => IntegrityCheckInput;
}

const f = fiksturKur(Date.now());
const PKT = anahtarUret("pkt-2026-1");
const DAY = 86_400_000;

function sertifika(siniflar: readonly LicenseClass[] = LICENSE_CLASSES) {
  const yuk = sertifikaYuku(f, PKT, "PAKET", { siniflar: [...siniflar] });
  return { yuk, token: sertifikaBas(f.kok, yuk) };
}

function paketIptali(sira: number, sertifikaId: string): string {
  const yuk: PackageRevocationDoc = {
    v: 1,
    iptalId: randomUUID(),
    sira,
    verilis: new Date(f.simdi - DAY).toISOString(),
    iptaller: [{ kid: PKT.kid, sertifikaId, tarih: new Date(f.simdi - DAY).toISOString(), neden: "sızıntı" }],
  };
  return signDocument({ typ: TYP.PAKET_IPTAL, schema: PackageRevocationSchema, payload: yuk, key: f.kok });
}

/** Bugünkü listenin yükünü `pkt-*` anahtarıyla zincirli yeniden imzalar; `eskiyiSil` ise `butunluk.jws` kalkar. */
function zincirle(kok: string, cert: string, eskiyiSil: boolean): void {
  const eski = readFileSync(path.join(kok, INTEGRITY_FILE), "utf8").trim();
  const p = parseJws(eski);
  if (!p.ok) throw new Error("eski liste çözülemedi");
  const payload = IntegrityManifestSchema.parse(p.value.payload);
  const token = signChainedPackageDocument({
    typ: INTEGRITY_TYP,
    schema: IntegrityManifestSchema,
    payload,
    key: PKT,
    certificate: cert,
    signedAt: new Date(f.simdi).toISOString(),
  });
  writeFileSync(path.join(kok, CHAINED_INTEGRITY_FILE), `${token}\n`);
  if (eskiyiSil) rmSync(path.join(kok, INTEGRITY_FILE));
}

async function listeSirasi(o: ZincirOrtami, core: LicenseCore, ek: string): Promise<void> {
  const cert = sertifika();
  const k = await o.paketKur(`zincir-${ek}`);
  zincirle(k, cert.token, true);
  const g = (x: Partial<IntegrityCheckInput> = {}) => runIntegrityCheck(o.girdi(k, { core, roots: f.kokler, ...x }));
  const ok = await g();
  o.check(`§8a [${ek}] zincirli liste GECERLI, imzacı sertifikadan`, ok.durum === "GECERLI" && ok.kid === PKT.kid && ok.sertifika?.sertifikaId === cert.yuk.sertifikaId && ok.uyari === null, `${ok.durum} ${ok.kod}`);
  const kokYok = await g({ roots: [f.kokler[1]!] });
  o.check(`§8b [${ek}] sertifikayı imzalayan kök çapada yoksa GEÇERLİ değil`, kokYok.durum !== "GECERLI", `${kokYok.durum} ${kokYok.kod}`);
  const iptal = verifyPackageRevocation(paketIptali(1, cert.yuk.sertifikaId), f.kokler);
  const ip = await g({ packageRevocation: iptal.ok ? iptal.value : null });
  o.check(`§8c [${ek}] iptalli sertifika YERLEŞİK: GECERLI + uyarı`, iptal.ok && ip.durum === "GECERLI" && ip.uyari === INTEGRITY_CERT_REVOKED_WARNING && ip.sertifika?.iptal === true, `${ip.durum} ${ip.uyari}`);

  const ikili = await o.paketKur(`zincir-ikili-${ek}`);
  zincirle(ikili, cert.token, false);
  const iki = await runIntegrityCheck(o.girdi(ikili, { core, roots: f.kokler }));
  o.check(`§8d [${ek}] iki liste varken zincirli okunur`, iki.durum === "GECERLI" && iki.kid === PKT.kid, `${iki.durum} ${iki.kid}`);
  const eski = await runIntegrityCheck(o.girdi(await o.paketKur(`zincir-eski-${ek}`), { core, roots: f.kokler }));
  o.check(`§8e [${ek}] yalnız eski liste: bugünkü yol, sertifika yok`, eski.durum === "GECERLI" && eski.sertifika === null && eski.uyari === null, `${eski.durum} ${eski.kod}`);
}

async function sinifKurali(o: ZincirOrtami, core: LicenseCore, ek: string): Promise<void> {
  const dar = sertifika(["TEST", "DEMO"]);
  const k = await o.paketKur(`zincir-dar-${ek}`);
  zincirle(k, dar.token, true);
  const g = (entitlementClass: string | null) => runIntegrityCheck(o.girdi(k, { core, roots: f.kokler, entitlementClass }));
  const yok = await g(null);
  o.check(`§8f [${ek}] dar sertifika + sınıf bilinmiyor → SINIF_BILINMIYOR`, yok.durum === "OLCULEMEDI" && yok.kod === "BUTUNLUK_SINIF_BILINMIYOR", `${yok.durum} ${yok.kod}`);
  const pencere = decideForClass(yok, "TEST");
  o.check(
    `§8f' [${ek}] etkinleştirme penceresi: sınıf bilinmiyorken OLCULEMEDI/künyesiz → TEST HAK'ıyla GECERLI + imzalı künye`,
    yok.kunye === null && pencere?.durum === "GECERLI" && pencere.kunye !== null,
    `${yok.kod} → ${pencere?.durum}`,
  );
  const disari = await g("URETIM");
  o.check(`§8g [${ek}] dar sertifika + sınıf dışında → SINIF_YETKISIZ`, disari.durum === "GECERSIZ" && disari.kod === "BUTUNLUK_SINIF_YETKISIZ", `${disari.durum} ${disari.kod}`);
  const icinde = await g("TEST");
  o.check(`§8h [${ek}] dar sertifika + sınıf içinde → GECERLI`, icinde.durum === "GECERLI", `${icinde.durum} ${icinde.kod}`);
}

function iptalDeposu(o: ZincirOrtami): void {
  const dir = path.join(o.temp, "lisans-paket-iptal");
  mkdirSync(dir, { recursive: true });
  loadLicenseStoreSync({ dir });
  const id = randomUUID();
  o.check("§8i iptal deposu boş → null", loadPackageRevocation(f.kokler) === null);
  o.check("§8j sıra 2 benimsenir", adoptPackageRevocation(paketIptali(2, id), f.kokler) && loadPackageRevocation(f.kokler)?.document.sira === 2);
  o.check("§8k eşit/düşük sıra benimsenmez", !adoptPackageRevocation(paketIptali(2, id), f.kokler) && !adoptPackageRevocation(paketIptali(1, id), f.kokler));
  o.check("§8l kökle doğrulanmayan benimsenmez", !adoptPackageRevocation(paketIptali(3, id), [f.kokler[1]!]) && !adoptPackageRevocation("x.y.z", f.kokler));
  o.check("§8m dosyada en yüksek sıra kalır", loadPackageRevocation(f.kokler)?.document.sira === 2 && readFileSync(path.join(dir, PACKAGE_REVOCATION_FILE), "utf8").length > 0);
}

function durumYaz(dir: string, paketZinciri: boolean | undefined): void {
  const t = new Date().toISOString();
  const doc: Record<string, unknown> = {
    v: 1, zaman: t, sonCanlilik: t, canlilikEsigiSn: 180, turSn: 60, guncelleyiciSurum: "0.1.3", kuruluSurum: "2.14.0", durum: "HAZIR",
    surum: null, kaynakSurum: null, urun: null, islemId: null, adim: null, hataKodu: null, mesaj: null, ilerleme: null, planlanan: null,
    politika: null, karar: null, bekleyen: null, son: null, sonAyrinti: null,
    ...(paketZinciri === undefined ? {} : { paketZinciri }),
  };
  mkdirSync(path.join(dir, path.dirname(UPDATER_STATUS_FILE)), { recursive: true });
  writeFileSync(path.join(dir, UPDATER_STATUS_FILE), JSON.stringify(doc));
}

function yetenek(o: ZincirOrtami): void {
  const dir = path.join(o.temp, "guncelleyici-durum");
  const onceki = process.env[UPDATER_DIR_ENV];
  process.env[UPDATER_DIR_ENV] = dir;
  try {
    durumYaz(dir, undefined);
    o.check("§8n durum belgesi okunur (fikstür geçerli)", readUpdaterStatus(dir).kind === "ok");
    __resetLicenseCapabilitiesForTests();
    o.check("§8o eski güncelleyici (alan yok) → paket-zinciri bildirilmez", !licenseCapabilities().includes("paket-zinciri"));
    durumYaz(dir, true);
    o.check("§8p paketZinciri:true → paket-zinciri bildirilir", licenseCapabilities().includes("paket-zinciri"));
    durumYaz(dir, false);
    o.check("§8q süreç içinde görülen yetenek düşmez", licenseCapabilities().includes("paket-zinciri"));
  } finally {
    if (onceki === undefined) delete process.env[UPDATER_DIR_ENV];
    else process.env[UPDATER_DIR_ENV] = onceki;
    __resetLicenseCapabilitiesForTests();
  }
}

export async function bolum8(o: ZincirOrtami, cores: readonly { readonly core: LicenseCore; readonly ek: string }[]): Promise<void> {
  for (const c of cores) {
    await listeSirasi(o, c.core, c.ek);
    await sinifKurali(o, c.core, c.ek);
  }
  iptalDeposu(o);
  yetenek(o);
}
