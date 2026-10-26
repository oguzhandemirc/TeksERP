// =============================================================================
// BEKÇİ — G2 ETKİNLEŞTİRME KİLİDİ (`lib/license/activation-lock.ts` · `activation-trace.ts` · `exemption.ts`
// · `licenseGate` kilit dalı · `ACTIVATION_LOCK_OPEN_ROUTES`)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts etkinlestirme_kilidi   (kendi _test DB'si; geçici kullanıcı açar,
// teardown'da siler — oturumlu kapı kararı DB'de oturum ister)
//
// NE ÖLÇER:
//   §1 sınıflayıcı tablosu (her dal; sıra: etkin > muafiyet > hazır değil > iz)
//   §2 ⭐ hiç etkinleşmemiş kurulum (kilit açık, DB izi yok) → ETKINLESMEDI; oturumlu iş ucu 403 LICENSE_NOT_ACTIVATED,
//      oturumsuz → rotaya (401 rotanın), kimliksiz kapalı uç → LICENSE_GATE; lisans/sağlık/giriş/keşif/`/auth/me` açık;
//      "verilerimi al" bu sınıfta KAPALI
//   §3 ⭐ derleme sabiti kapalı (geliştirme) → aynı kurulum kilitsiz, kapı her ucu geçirir (sıfır fark)
//   §4 ⭐ etkin kurulum (gözlem · zorla · kira bitti) → kilit YOK ve lisans DURUMU kilit kapalıyken hesaplananla bayt-eşit
//   §5 ⭐ muafiyet: kök imzalı ve HAK-ara imzalı geçerli belge → YOK + durum bayt-eşit; başka anahtar · kurcalanmış ·
//      başka makine · yanlış kullanımlı sertifika → kilit sürer
//   §6 ⭐ kayıp ↔ kopya, üç kol (satıcı kiralı yabancı iz): aynı PG kümesi → KAYIP · küme kimliği okunamadı (şimdi ya da
//      kayıtta) → BELIRSIZ, kilit yok (merdiven) · iki kimlik okundu ve farklı → KOPYA (iş ucu 403, "verilerimi al"
//      açık); kirasız ya da başka anahtara bağlı kira (satıcı kanıtsız iz) → KOPYA
//   §7 biçimsiz iz satırı → YOK sayılır → ETKINLESMEDI (DB'ye yazılan çöp kilidi açmaz)
//   §8 korumalı derleme sabiti tanımlı (statik)
//   §10 ⭐ uçtan uca (sahte satıcı, yerel HTTPS; kilit açık): çevrimiçi kod → kilit kalkar, iş ucu açılır · çevrimdışı
//      etkinleştirme zarfı → satıcı `/v1/cevrimdisi` → yanıt kabulü → kilit kalkar; kurcalı yanıt ve başka kuruluma bağlı
//      yanıt 400 `LICENSE_RESPONSE_INVALID`, kilit sürer · portalın muafiyet dosyası (`{v,muafiyet}`) yükleme yolundan
//      kabul → kilit kalkar, dosya lisans dizinine yazılır; başka kurulumun muafiyeti 400, lisans yanıtı muafiyet sanılmaz
//   ⭐ NEGATİF SONDA §9: sınıflayıcı "etkin" dalı ters çevrilmiş kopyası §4'ün ölçüsünü kırmızıya düşürür; üç kolun her
//      biri ters çevrilmiş yabancı-iz sınıflayıcısı §6 kol ölçüsünü kırmızıya düşürür
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPublicKey, randomUUID } from "node:crypto";
import { setEgressTrustForTests } from "../src/lib/http-egress";
import { activateLicense, acceptOfflineResponse, buildOfflineRequest } from "../src/services/license.service";
import { acceptExemption, exemptionTextOf } from "../src/services/license-activation.service";
import { egressTransport } from "../src/services/helpers/license-wire.helper";
import { sahteSaticiBaslat, type SahteSatici } from "./lib/lisans-sahte-satici";
import { kabulEt, temizleKabuller } from "./lib/lisans-kabul-fikstur";
import prisma from "../src/lib/prisma";
import { AuditService } from "../src/services/audit.service";
import { AuthService } from "../src/services/auth.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { licenseGate } from "../src/middlewares/license.middleware";
import { classifyActivationLock, type ActivationLockInput } from "../src/lib/license/activation-lock";
import { setPgClusterId, pgClusterDigest, __resetPgClusterForTests } from "../src/lib/license/pg-cluster";
import { LICENSE_FILES, loadLicenseStoreSync } from "../src/lib/license/store";
import { setLicenseTraceRow, TraceRowSchema, type TraceRow } from "../src/lib/license/trace-row";
import { classifyForeignTrace } from "../src/lib/license/activation-trace";
import { signStateRecord } from "../src/lib/license/saat";
import { flushLicenseTraceWrites } from "../src/lib/license/accumulation";
import {
  __resetLicenseRuntimeForTests,
  configureLicenseRuntimeForTests,
  getLicenseSnapshot,
  invalidateLicenseSnapshot,
  setActivationLockForTests,
  setLicenseDbFacts,
  setMeasuredFingerprint,
  type LicenseSnapshot,
} from "../src/lib/license/runtime";
import { DAY_MS, ENDPOINTS, ExemptionSchema, TYP, installationKeyId, msToIso, signDocument, type ExemptionDoc, type Fingerprint } from "../src/lib/license/protocol";
import { araSertifikasi, fiksturKur, hakBas, kiraBas, type Fikstur, type TestAnahtari } from "./lib/lisans-fikstur";
import { lisansKipKur, temizleLisansKipDizini } from "./lib/lisans-kip-fikstur";
import { kapidanGecir, type Uc } from "./lib/lisans-kapi-surucu";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${!ok && detay ? ` — ${detay}` : ""}`);
}

const uc = (m: string, yol: string): Uc => ({ m, desen: yol, ornek: yol });
interface Karar {
  readonly rotaya: boolean;
  readonly kod: unknown;
  readonly sinif: unknown;
}
async function karar(m: string, yol: string, token: string | null): Promise<Karar> {
  const s = await kapidanGecir(licenseGate, uc(m, yol), token);
  const d = (s.hata as { details?: Record<string, unknown> } | undefined)?.details ?? null;
  return { rotaya: s.hata === undefined, kod: d?.code, sinif: d?.sinif };
}

// ── Fikstür: hiç etkinleşmemiş kurulum (temiz LICENSE_DIR, kimlik/HAK/kira yok) ──────────────────────────────
const dizinler: string[] = [];
interface Kurulum {
  readonly f: Fikstur;
  readonly keyX: string;
  readonly dir: string;
}
function etkinlesmemis(g: { kilit: boolean; iz?: unknown; muafiyet?: (k: Kurulum) => string; parmakIzi?: Fingerprint | null; f?: Fikstur }): { k: Kurulum; snap: LicenseSnapshot } {
  __resetLicenseRuntimeForTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g2-kilit-"));
  dizinler.push(dir);
  const store = loadLicenseStoreSync({ dir });
  if (!store.key) throw new Error("kurulum anahtarı üretilemedi");
  const f = g.f ?? fiksturKur(Date.now());
  const k: Kurulum = { f, keyX: store.key.x, dir };
  configureLicenseRuntimeForTests({ roots: f.kokler, vendorUrl: null });
  setLicenseDbFacts({ installationId: randomUUID(), firstOpenMs: Date.now() - 3 * DAY_MS, ledgerHighWaterMs: null });
  const fp = g.parmakIzi === undefined ? f.parmakIzi : g.parmakIzi;
  const tum = { f1: true, f2: true, f3: true, f4: true, f5: true };
  setMeasuredFingerprint(fp === null ? null : { digest: fp, measured: tum, measuredAt: new Date().toISOString() });
  setLicenseTraceRow(g.iz === undefined ? null : g.iz);
  if (g.muafiyet) {
    fs.writeFileSync(path.join(dir, LICENSE_FILES.EXEMPTION), g.muafiyet(k));
    loadLicenseStoreSync({ dir });
  }
  setActivationLockForTests(g.kilit);
  invalidateLicenseSnapshot();
  return { k, snap: getLicenseSnapshot() };
}

function muafiyetYuku(k: Kurulum, ek: Partial<ExemptionDoc> = {}): ExemptionDoc {
  return {
    v: 1,
    muafiyetId: randomUUID(),
    kurulumAnahtarKimligi: installationKeyId(k.keyX),
    parmakIzi: k.f.parmakIzi,
    verilis: msToIso(Date.now() - 60_000),
    gerekce: "TEST — kilit öncesi kurulum",
    ...ek,
  };
}
const muafiyetBas = (yuk: ExemptionDoc, key: TestAnahtari): string => signDocument({ typ: TYP.MUAFIYET, schema: ExemptionSchema, payload: yuk, key });

// ── §1 ──────────────────────────────────────────────────────────────────────────────────────────────────────
function siniflayici(): void {
  console.log("\n§1 — sınıflayıcı tablosu");
  const b: ActivationLockInput = { enabled: true, setupError: false, ready: true, activated: false, exempt: false, trace: "YOK" };
  const t = (ek: Partial<ActivationLockInput>) => classifyActivationLock({ ...b, ...ek });
  check("§1a kilit kapalı → YOK/KAPALI", t({ enabled: false }).neden === "KAPALI");
  check("§1b etkin → YOK/ETKIN (iz YABANCI olsa da)", t({ activated: true, trace: "YABANCI" }).neden === "ETKIN");
  check("§1c muafiyet → YOK/MUAFIYET", t({ exempt: true }).neden === "MUAFIYET");
  check("§1d hazır değil → YOK (belirsizlik durdurmaz)", t({ ready: false }).sinif === "YOK");
  check("§1e iz bilinmiyor → YOK", t({ trace: "BILINMIYOR" }).sinif === "YOK");
  check("§1f iz KAYIP → YOK (bugünkü merdiven)", t({ trace: "KAYIP" }).neden === "IZ_KAYIP");
  check("§1f2 iz BELIRSIZ (küme okunamadı) → YOK/IZ_OLCULEMEDI (merdiven)", t({ trace: "BELIRSIZ" }).neden === "IZ_OLCULEMEDI");
  check("§1g iz YABANCI → KOPYA", t({ trace: "YABANCI" }).sinif === "KOPYA");
  check("§1h iz YOK → ETKINLESMEDI", t({}).sinif === "ETKINLESMEDI");
  check("§1i ⭐ kurulum hatası (kullanılamayan lisans deposu) etkin/muafiyet/hazır-değil'den ÖNCE → KURULUM_HATASI",
    t({ setupError: true, activated: true, exempt: true, ready: false }).sinif === "KURULUM_HATASI" && t({ setupError: true, enabled: false }).neden === "KAPALI");
}

// ── §2 / §3 ─────────────────────────────────────────────────────────────────────────────────────────────────
const ACIK: ReadonlyArray<readonly [string, string, boolean]> = [
  ["GET", "/api/license/durum", true],
  ["GET", "/api/license/detay", true],
  ["POST", "/api/license/kabul", true],
  ["POST", "/api/license/etkinlestir", true],
  ["POST", "/api/license/cevrimdisi-istek", true],
  ["POST", "/api/license/cevrimdisi-yanit", true],
  ["POST", "/api/license/tasima-talebi", true],
  ["GET", "/api/admin/health", true],
  ["POST", "/api/auth/login", false],
  ["GET", "/api/auth/login-methods", false],
  ["GET", "/api/auth/me", true],
  ["POST", "/api/auth/change-password", true],
  ["GET", "/api/discovery/identity", false],
];

async function etkinlesmemisKurulum(token: string): Promise<void> {
  console.log("\n§2 — hiç etkinleşmemiş kurulum, kilit açık");
  const { snap } = etkinlesmemis({ kilit: true });
  check("§2a ⭐ sınıf ETKINLESMEDI (neden IZ_YOK)", snap.etkinlestirmeKilidi.sinif === "ETKINLESMEDI" && snap.etkinlestirmeKilidi.neden === "IZ_YOK", JSON.stringify(snap.etkinlestirmeKilidi));
  for (const [m, yol] of [["POST", "/api/orders"], ["GET", "/api/orders"], ["GET", "/api/rolls"], ["POST", "/api/shipping/shipments"]] as const) {
    const k = await karar(m, yol, token);
    check(`§2b ⭐ oturumlu ${m} ${yol} → 403 LICENSE_NOT_ACTIVATED`, k.kod === "LICENSE_NOT_ACTIVATED" && k.sinif === "ETKINLESMEDI", JSON.stringify(k));
  }
  const o = await karar("POST", "/api/orders", null);
  check("§2c oturumsuz iş ucu → kapı ROTAYA geçirir (401 rotanın, ayrıntı sızmaz)", o.rotaya && o.kod === undefined);
  const p = await karar("GET", "/api/devices/status", null);
  check("§2d kimliksiz kapalı uç → yalnız LICENSE_GATE", p.kod === "LICENSE_GATE", JSON.stringify(p));
  for (const [m, yol, oturum] of ACIK) {
    check(`§2e açık: ${m} ${yol}`, (await karar(m, yol, oturum ? token : null)).rotaya);
  }
  const ex = await karar("GET", "/api/import/entities", token);
  check("§2f 'verilerimi al' ETKINLESMEDI'de kapalı (veri yok; yalnız KOPYA'da açık)", ex.kod === "LICENSE_NOT_ACTIVATED");

  console.log("\n§3 — derleme sabiti kapalı (geliştirme): sıfır fark");
  const g = etkinlesmemis({ kilit: false }).snap;
  check("§3a ⭐ aynı kurulum kilitsiz (KAPALI)", g.etkinlestirmeKilidi.neden === "KAPALI");
  check("§3b ⭐ oturumlu iş ucu kapıdan geçer", (await karar("POST", "/api/orders", token)).rotaya);
  setActivationLockForTests(null);
  check("§3c tsx (define yok) → derleme sabiti kapalı", getLicenseSnapshot().etkinlestirmeKilidi.neden === "KAPALI");
}

// ── §4 ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Saat tahmini (`estimateMs`) gerçek saatten okunur, iki hesap arasında ilerler — kilitle ilgisizdir. */
const durumIzi = (s: LicenseSnapshot["state"]): string => JSON.stringify({ ...s, saat: { ...s.saat, estimateMs: 0 } });

/** Aynı etkin kurulum, aynı an: kilit kapalı ve açık iki hesapta lisans DURUMU bayt-eşit mi. */
function durumBaytEsit(s: Parameters<typeof lisansKipKur>[0]): { esit: boolean; kilit: string } {
  lisansKipKur(s);
  const an = Date.now();
  setActivationLockForTests(false);
  const kapali = durumIzi(getLicenseSnapshot(an).state);
  setActivationLockForTests(true);
  const snap = getLicenseSnapshot(an);
  return { esit: durumIzi(snap.state) === kapali, kilit: `${snap.etkinlestirmeKilidi.sinif}/${snap.etkinlestirmeKilidi.neden}` };
}

function etkinDurumOlcusu(): Array<{ ad: string; esit: boolean; kilit: string }> {
  return [
    { ad: "gözlem", ...durumBaytEsit({ zorlama: false }) },
    { ad: "zorla K4", ...durumBaytEsit({ zorlama: true, kademe: "K4" }) },
    { ad: "kira bitti (ek süre)", ...durumBaytEsit({ zorlama: true, kiraBitti: true }) },
  ];
}

function etkinKurulum(): void {
  console.log("\n§4 — etkin kurulum: kilit YOK, durum bayt-eşit");
  for (const r of etkinDurumOlcusu()) {
    check(`§4 ⭐ ${r.ad}: kilit YOK/ETKIN ve lisans durumu kilit kapalıyla bayt-eşit`, r.kilit === "YOK/ETKIN" && r.esit, JSON.stringify(r));
  }
}

// ── §5 ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function muafiyet(token: string): Promise<void> {
  console.log("\n§5 — muafiyet belgesi");
  const kok = etkinlesmemis({ kilit: true, muafiyet: (k) => muafiyetBas(muafiyetYuku(k), k.f.kok) }).snap;
  check("§5a ⭐ kök imzalı, bu anahtar + makine → YOK/MUAFIYET", kok.etkinlestirmeKilidi.neden === "MUAFIYET", JSON.stringify(kok.etkinlestirmeKilidi));
  check("§5a2 muafiyetli kurulumda iş ucu açık", (await karar("POST", "/api/orders", token)).rotaya);
  // Durum katmanı: muafiyet belgesi lisans durumuna GİRMEZ — aynı kurulum kilit kapalıyken aynı durumu üretir.
  let ilk: Kurulum | null = null;
  const yeniden = (kilit: boolean) => {
    const r = etkinlesmemis({ kilit, muafiyet: (k) => muafiyetBas(muafiyetYuku(k), k.f.kok) });
    ilk ??= r.k;
    return r.snap;
  };
  const a = yeniden(false).state;
  const b = yeniden(true).state;
  const durumAlanlari = (s: typeof a) => JSON.stringify({ ...s, saat: undefined });
  check("§5b ⭐ muafiyetli kurulumun lisans durumu kilit kapalıyla eşit (kip · kademe · nedenler · etki)", durumAlanlari(a) === durumAlanlari(b));
  const ara = etkinlesmemis({ kilit: true, muafiyet: (k) => muafiyetBas(muafiyetYuku(k, { imzaciSertifikasi: araSertifikasi(k.f) }), k.f.ara) }).snap;
  check("§5c HAK ara imzacısı (gömülü sertifika) → YOK/MUAFIYET", ara.etkinlestirmeKilidi.neden === "MUAFIYET", JSON.stringify(ara.etkinlestirmeKilidi));
  const reds: Array<[string, (k: Kurulum) => string]> = [
    ["başka kurulumun anahtarına bağlı", (k) => muafiyetBas(muafiyetYuku(k, { kurulumAnahtarKimligi: k.f.kurulum.kid }), k.f.kok)],
    ["kurcalanmış yük", (k) => {
      const [h, , s] = muafiyetBas(muafiyetYuku(k), k.f.kok).split(".");
      return [h, Buffer.from(JSON.stringify({ ...muafiyetYuku(k), gerekce: "kurcalandı" })).toString("base64url"), s].join(".");
    }],
    ["kökte olmayan anahtarla imzalı (sertifikasız ara)", (k) => muafiyetBas(muafiyetYuku(k), k.f.ara)],
    ["ALT kullanımlı sertifikayla imzalı", (k) => muafiyetBas(muafiyetYuku(k, { imzaciSertifikasi: araSertifikasi(k.f, { kullanim: "ALT", kid: "alt-yanlis" }) }), k.f.ara)],
    ["başka makinenin parmak izine bağlı", (k) => muafiyetBas(muafiyetYuku(k, { parmakIzi: { f1: null, f2: "A".repeat(43), f3: "B".repeat(43), f4: "C".repeat(43), f5: "D".repeat(43) } }), k.f.kok)],
  ];
  for (const [ad, bas] of reds) {
    const s = etkinlesmemis({ kilit: true, muafiyet: bas }).snap;
    check(`§5d ⭐ muafiyet reddi: ${ad} → kilit sürer`, s.etkinlestirmeKilidi.sinif === "ETKINLESMEDI", JSON.stringify(s.etkinlestirmeKilidi));
  }
}

// ── §6 / §7 ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Başka (eski) bir kurulum anahtarının DB izi: satıcı kirası + o anahtarla imzalı kayıt (+ PG özeti). */
function yabanciIz(eski: Fikstur, g: { pg: string | null; kira: boolean; kiraAnahtari?: string }): unknown {
  const kayit = {
    v: 1 as const,
    kurulumId: eski.kurulumId,
    kiraId: randomUUID(),
    birikenMs: 0,
    yazildi: msToIso(Date.now() - DAY_MS),
    yuksekSu: msToIso(Date.now() - DAY_MS),
    sonKiraZorlamasi: false,
    sonYaptirim: null,
    sira: 3,
    ...(g.pg ? { pgOzeti: g.pg } : {}),
  };
  const durum = signStateRecord(kayit, eski.kurulum.privateKey, eski.kurulum.x);
  const kira = kiraBas(eski, g.kiraAnahtari ? { kurulumAnahtarKimligi: g.kiraAnahtari } : {});
  return { v: 1, kurulumId: eski.kurulumId, anahtar: eski.kurulum.x, durum, ...(g.kira ? { kira } : {}) };
}

type YabanciSiniflayici = (row: TraceRow) => "KAYIP" | "BELIRSIZ" | "YABANCI";
const SATIR = (iz: unknown): TraceRow => TraceRowSchema.parse(iz);
const KUME_A = "7300000000000000001";
const KUME_B = "7300000000000000002";

/** Üç kol + kanıtsız iz: verilen sınıflayıcı her vakada beklenen sonucu veriyor mu (sondalar bozuk kopyayı koşar). */
function ucKolOlcusu(eski: Fikstur, sinifla: YabanciSiniflayici): Record<string, boolean> {
  const ayni = pgClusterDigest(eski.kurulumId, KUME_A);
  const r: Record<string, boolean> = {};
  setPgClusterId(KUME_A);
  r.ayni = sinifla(SATIR(yabanciIz(eski, { pg: ayni, kira: true }))) === "KAYIP";
  r.farkli = sinifla(SATIR(yabanciIz(eski, { pg: pgClusterDigest(eski.kurulumId, KUME_B), kira: true }))) === "YABANCI";
  r.kayittaYok = sinifla(SATIR(yabanciIz(eski, { pg: null, kira: true }))) === "BELIRSIZ";
  r.kirasiz = sinifla(SATIR(yabanciIz(eski, { pg: ayni, kira: false }))) === "YABANCI";
  r.baskaAnahtar = sinifla(SATIR(yabanciIz(eski, { pg: ayni, kira: true, kiraAnahtari: `kur-${"Z".repeat(43)}` }))) === "YABANCI";
  __resetPgClusterForTests();
  r.simdiOkunamadi = sinifla(SATIR(yabanciIz(eski, { pg: ayni, kira: true }))) === "BELIRSIZ";
  return r;
}

async function kayipKopya(token: string): Promise<void> {
  console.log("\n§6 — kayıp ↔ kopya (yabancı DB izi), üç kol");
  const eski = fiksturKur(Date.now());
  const olcu = ucKolOlcusu(eski, (row) => classifyForeignTrace(row, { roots: eski.kokler }));
  check("§6a ⭐ aynı PG kümesi → KAYIP", olcu.ayni);
  check("§6b ⭐ küme kimliği ŞİMDİ okunamadı → BELIRSIZ (kopya değil)", olcu.simdiOkunamadi);
  check("§6c ⭐ kayıtta küme özeti yok (yazarken okunamadı) → BELIRSIZ", olcu.kayittaYok);
  check("§6d ⭐ iki kimlik okundu ve farklı → YABANCI", olcu.farkli);
  check("§6e kirasız iz (kendi imzaladığı sahte iz) → YABANCI", olcu.kirasiz);
  check("§6f kira başka anahtara bağlı → YABANCI", olcu.baskaAnahtar);

  // Kapı uçtan uca: aynı vakalar çalışma zamanının sınıfına ve kapı kararına iner.
  const ayni = pgClusterDigest(eski.kurulumId, KUME_A);
  setPgClusterId(KUME_A);
  const kayip = etkinlesmemis({ kilit: true, f: eski, iz: yabanciIz(eski, { pg: ayni, kira: true }) }).snap;
  check("§6g ⭐ KAYIP → kilit yok (IZ_KAYIP), iş ucu açık", kayip.etkinlestirmeKilidi.neden === "IZ_KAYIP" && (await karar("POST", "/api/orders", token)).rotaya, JSON.stringify(kayip.etkinlestirmeKilidi));
  const eskiKayit = etkinlesmemis({ kilit: true, f: eski, iz: yabanciIz(eski, { pg: null, kira: true }) }).snap;
  check("§6h ⭐ kayıtta özet yok → kilit yok (IZ_OLCULEMEDI), iş ucu açık", eskiKayit.etkinlestirmeKilidi.neden === "IZ_OLCULEMEDI" && (await karar("POST", "/api/orders", token)).rotaya, JSON.stringify(eskiKayit.etkinlestirmeKilidi));
  __resetPgClusterForTests();
  const okunamadi = etkinlesmemis({ kilit: true, f: eski, iz: yabanciIz(eski, { pg: ayni, kira: true }) }).snap;
  check("§6i ⭐ küme okunamadı → kilit yok (IZ_OLCULEMEDI), iş ucu açık", okunamadi.etkinlestirmeKilidi.neden === "IZ_OLCULEMEDI" && (await karar("POST", "/api/orders", token)).rotaya, JSON.stringify(okunamadi.etkinlestirmeKilidi));
  setPgClusterId(KUME_A);
  const kopya = etkinlesmemis({ kilit: true, f: eski, iz: yabanciIz(eski, { pg: pgClusterDigest(eski.kurulumId, KUME_B), kira: true }) }).snap;
  check("§6j ⭐ farklı küme → KOPYA", kopya.etkinlestirmeKilidi.sinif === "KOPYA", JSON.stringify(kopya.etkinlestirmeKilidi));
  const k1 = await karar("POST", "/api/orders", token);
  check("§6k KOPYA: oturumlu iş ucu → LICENSE_NOT_ACTIVATED/KOPYA", k1.kod === "LICENSE_NOT_ACTIVATED" && k1.sinif === "KOPYA", JSON.stringify(k1));
  for (const [m, yol] of [["GET", "/api/import/entities"], ["GET", "/api/import/orders/export"], ["POST", "/api/admin/backup"], ["GET", "/api/admin/backups/a.dump/download"]] as const) {
    check(`§6l ⭐ KOPYA: 'verilerimi al' açık — ${m} ${yol}`, (await karar(m, yol, token)).rotaya);
  }
  const sahte = etkinlesmemis({ kilit: true, f: eski, iz: yabanciIz(eski, { pg: null, kira: false }) }).snap;
  check("§6m kirasız + özetsiz sahte iz → KOPYA (BELIRSIZ kolu kanıtsız izi kurtarmaz)", sahte.etkinlestirmeKilidi.sinif === "KOPYA", JSON.stringify(sahte.etkinlestirmeKilidi));
  __resetPgClusterForTests();
  kolSondalari(eski);

  console.log("\n§7 — biçimsiz iz satırı");
  const cop = etkinlesmemis({ kilit: true, iz: { v: 1, kurulumId: "x", anahtar: "y", durum: "z" } }).snap;
  check("§7a ⭐ şemaya uymayan iz YOK sayılır → ETKINLESMEDI", cop.etkinlestirmeKilidi.sinif === "ETKINLESMEDI");
}

// ── §10 uçtan uca ───────────────────────────────────────────────────────────────────────────────────────────
const saticilar: SahteSatici[] = [];
async function hataKodu(p: Promise<unknown> | (() => unknown)): Promise<string> {
  try {
    await (typeof p === "function" ? p() : p);
    return "HATA_YOK";
  } catch (e) {
    return String((e as { details?: { code?: string } }).details?.code ?? e);
  }
}

/** Temiz lisans dizini + DB izi yok + kilit açık; fikstürün kurulum anahtarı deponun anahtarıdır, satıcı yerel HTTPS. */
async function canliKurulum(): Promise<{ f: Fikstur; satici: SahteSatici; dir: string }> {
  // Önceki kurulumun kuyruktaki iz yazımı sıfırlamadan SONRA onaylanıp yeni kurulumun belleğine dönmesin (§10d/§10e yarışı).
  await flushLicenseTraceWrites();
  __resetLicenseRuntimeForTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g2-uctan-"));
  dizinler.push(dir);
  const key = loadLicenseStoreSync({ dir }).key;
  if (!key) throw new Error("kurulum anahtarı üretilemedi");
  const f0 = fiksturKur(Date.now());
  const f: Fikstur = { ...f0, kurulum: { kid: key.kid, x: key.x, privateKey: key.privateKey, acik: createPublicKey(key.privateKey) } };
  const satici = await sahteSaticiBaslat(f);
  saticilar.push(satici);
  satici.kod = "TKS-7K3M-9QRT-2XWZ-4HJN";
  configureLicenseRuntimeForTests({ roots: f.kokler, vendorUrl: satici.url });
  setEgressTrustForTests(satici.ca);
  setLicenseDbFacts({ installationId: randomUUID(), firstOpenMs: Date.now() - 3 * DAY_MS, ledgerHighWaterMs: null });
  const tum = { f1: true, f2: true, f3: true, f4: true, f5: true };
  setMeasuredFingerprint({ digest: f.parmakIzi, measured: tum, measuredAt: new Date().toISOString() });
  setLicenseTraceRow(null);
  setActivationLockForTests(true);
  invalidateLicenseSnapshot();
  return { f, satici, dir };
}

const kilitNedeni = (): string => `${getLicenseSnapshot().etkinlestirmeKilidi.sinif}/${getLicenseSnapshot().etkinlestirmeKilidi.neden}`;

async function uctanUca(token: string): Promise<void> {
  console.log("\n§10 — uçtan uca etkinleştirme (sahte satıcı, yerel HTTPS, kilit açık)");
  const x = await canliKurulum();
  const once = await karar("POST", "/api/orders", token);
  check("§10a taze kurulum kilitli, iş ucu 403", kilitNedeni() === "ETKINLESMEDI/IZ_YOK" && once.kod === "LICENSE_NOT_ACTIVATED", kilitNedeni());
  await kabulEt();
  await activateLicense(x.satici.kod, null);
  check("§10b ⭐ S3 çevrimiçi kod → kilit kalkar (YOK/ETKIN), iş ucu kapıdan geçer", kilitNedeni() === "YOK/ETKIN" && (await karar("POST", "/api/orders", token)).rotaya, kilitNedeni());

  const y = await canliKurulum();
  await kabulEt();
  const cv = await buildOfflineRequest({ amac: "etkinlestir", kod: y.satici.kod });
  const yanit = await egressTransport({ url: `${y.satici.url}${ENDPOINTS.OFFLINE}`, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cv.istekGovdesi) });
  check("§10c çevrimdışı etkinleştirme zarfı satıcıdan imzalı yanıt alır", yanit.status === 200 && y.satici.sayac.etkinlestir === 1, `${yanit.status}`);
  const govde = JSON.parse(yanit.body) as { kira?: string };
  const kurcali = JSON.stringify({ ...govde, kira: `${govde.kira?.slice(0, -4)}AAAA` });
  check("§10d ⭐ S5 kurcalı yanıt → 400 LICENSE_RESPONSE_INVALID, kilit sürer", (await hataKodu(acceptOfflineResponse(kurcali, "cevrimdisi", null))) === "LICENSE_RESPONSE_INVALID" && kilitNedeni() === "ETKINLESMEDI/IZ_YOK", kilitNedeni());
  const baskasi = { v: 1, hak: hakBas(y.f), kira: kiraBas(y.f, { kurulumAnahtarKimligi: `kur-${"Q".repeat(43)}`, zorlama: false }), indirmeBelirtecleri: [], sunucuSaati: new Date().toISOString() };
  check("§10e ⭐ S5 başka kuruluma bağlı yanıt → 400, kilit sürer", (await hataKodu(acceptOfflineResponse(baskasi, "cevrimdisi", null))) === "LICENSE_RESPONSE_INVALID" && kilitNedeni() === "ETKINLESMEDI/IZ_YOK", kilitNedeni());
  check("§10f lisans yanıtı muafiyet sanılmaz (yükleme yolu ayrımı)", exemptionTextOf(yanit.body) === null && exemptionTextOf(govde) === null);
  await acceptOfflineResponse(Buffer.from(yanit.body, "utf8").toString("base64url"), "cevrimdisi", null);
  check("§10g ⭐ S4 çevrimdışı yanıt (karekod metni) kabul → kilit kalkar, iş ucu açık", kilitNedeni() === "YOK/ETKIN" && (await karar("POST", "/api/orders", token)).rotaya, kilitNedeni());

  const z = await canliKurulum();
  const zKur: Kurulum = { f: z.f, keyX: z.f.kurulum.x, dir: z.dir };
  const yabanci = JSON.stringify({ v: 1, muafiyet: muafiyetBas(muafiyetYuku(zKur, { kurulumAnahtarKimligi: `kur-${"Q".repeat(43)}` }), z.f.kok) });
  const yabanciMetin = exemptionTextOf(yabanci);
  check("§10h ⭐ başka kurulumun muafiyeti → 400, kilit sürer", yabanciMetin !== null && (await hataKodu(() => acceptExemption(yabanciMetin, null))) === "LICENSE_RESPONSE_INVALID" && kilitNedeni() === "ETKINLESMEDI/IZ_YOK", kilitNedeni());
  const dosya = `\uFEFF${JSON.stringify({ v: 1, muafiyet: muafiyetBas(muafiyetYuku(zKur), z.f.kok) })}`;
  const metin = exemptionTextOf(dosya);
  if (metin) acceptExemption(metin, null);
  check(
    "§10i ⭐ portal muafiyet dosyası yükleme yolundan → kilit kalkar (YOK/MUAFIYET), dosya lisans dizininde, iş ucu açık",
    metin !== null && kilitNedeni() === "YOK/MUAFIYET" && fs.existsSync(path.join(z.dir, LICENSE_FILES.EXEMPTION)) && (await karar("POST", "/api/orders", token)).rotaya,
    kilitNedeni(),
  );
  loadLicenseStoreSync({ dir: z.dir });
  invalidateLicenseSnapshot();
  check("§10j muafiyet yeniden açılışta dosyadan okunur (YOK/MUAFIYET)", kilitNedeni() === "YOK/MUAFIYET", kilitNedeni());
}

// ── §8 / §9 ─────────────────────────────────────────────────────────────────────────────────────────────────
function statik(): void {
  console.log("\n§8 — korumalı derleme");
  const kb = fs.readFileSync(path.join(__dirname, "build-korumali.mjs"), "utf8");
  check("§8a ⭐ build-korumali __TEKSERP_ETKINLESTIRME_KILIDI__ = 'true' tanımlar", /__TEKSERP_ETKINLESTIRME_KILIDI__:\s*'true'/.test(kb));
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "license", "activation-lock.ts"), "utf8");
  check("§8b kilit sabiti ortamdan okunmaz (process.env yok)", !/process\.env/.test(src));
}

/** Her kol için ters çevrilmiş sınıflayıcı: §6 ölçüsü o kolda kırmızı vermeli. */
function kolSondalari(eski: Fikstur): void {
  const gercek = (row: TraceRow) => classifyForeignTrace(row, { roots: eski.kokler });
  const sondalar: Array<[string, string, YabanciSiniflayici]> = [
    ["okunamadı → kopya", "simdiOkunamadi", (row) => { const r = gercek(row); return r === "BELIRSIZ" ? "YABANCI" : r; }],
    ["aynı → kopya", "ayni", (row) => { const r = gercek(row); return r === "KAYIP" ? "YABANCI" : r; }],
    ["farklı → kayıp", "farkli", (row) => { const r = gercek(row); return r === "YABANCI" && row.kira ? "KAYIP" : r; }],
    ["kanıtsız iz → belirsiz", "kirasiz", (row) => (row.kira ? gercek(row) : "BELIRSIZ")],
  ];
  for (const [ad, kol, bozuk] of sondalar) {
    const o = ucKolOlcusu(eski, bozuk);
    check(`§9 ⭐ sonda '${ad}' §6 ölçüsünde '${kol}' kolunu kırmızıya düşürür`, o[kol] === false, JSON.stringify(o));
  }
}

function negatifSonda(): void {
  console.log("\n§9 — negatif sonda");
  const bozuk = (i: ActivationLockInput) => (i.enabled && i.activated ? { sinif: "ETKINLESMEDI" } : classifyActivationLock(i));
  const r = bozuk({ enabled: true, setupError: false, ready: true, activated: true, exempt: false, trace: "YOK" });
  check("§9a ⭐ 'etkin kurulum kilitlenir' bozuk kopyası §4 ölçütüne (YOK/ETKIN) takılır", r.sinif !== "YOK");
}

async function main(): Promise<void> {
  console.log("=== G2 etkinleştirme kilidi ===");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  AuditService.log = async () => undefined;
  AuditService.logEvent = async () => undefined;
  siniflayici();
  statik();
  negatifSonda();
  etkinKurulum();
  const ad = `TEST-g2-kilit-${Date.now()}`;
  const u = await prisma.user.create({ data: { username: ad, passwordHash: await AuthService.hashPassword("Deneme-12345"), fullName: "TEST G2 Kilit" }, select: { id: true } });
  try {
    const { token } = await AuthService.login(ad, "Deneme-12345");
    await etkinlesmemisKurulum(token);
    await muafiyet(token);
    await kayipKopya(token);
    await uctanUca(token);
  } finally {
    for (const s of saticilar) await s.kapat().catch(() => undefined);
    await temizleKabuller().catch(() => undefined);
    await prisma.session.deleteMany({ where: { userId: u.id } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: u.id } }).catch(() => undefined);
    setActivationLockForTests(null);
    __resetPgClusterForTests();
    temizleLisansKipDizini();
    for (const d of dizinler) fs.rmSync(d, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
