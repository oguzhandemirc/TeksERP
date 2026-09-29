// =============================================================================
// BEKÇİ — PATRON BULUTU FİLİGRAN DOĞRULUĞU (`src/cloud-sync/`, B1)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts bulut_filigran   (kendi _test DB'si; ~20 sn)
//
// NE ÖLÇER: gerçek eşitleme turu SAHTE BULUTA karşı (yerel HTTP; imzalı istek protokolün
// doğrulayıcısıyla, gövde KATI sözleşme şemasıyla denetlenir; bulut zincir · sürüm anı ·
// TAM işaretle-süpür kurallarını referans olarak uygular):
//   ⭐ ön koşul FAIL-CLOSED: TEST sınıfı · hak yok · abonelik bitti/yok · aralık yok ·
//      DEVREDİLDİ · ÖLÇÜLEMEDİ · bulut adresi yok → dışarı SIFIR istek (P8 · P10)
//   ⭐ ilk tur TAM: her açık projeksiyon `tam` parçalarıyla, önceki filigran null; istek
//      imzalı (amaç esitle, gövde özeti SIKIŞTIRILMIŞ baytlardan), gzip
//   ⭐ artımlı tur yalnız değişeni taşır, zincir `önceki = son onaylanan`
//   ⭐ GÜVENLİ UFUK (P21): açık tx'in satırı atlanmaz — commit sonrası turda gelir
//   ⭐ filigran YALNIZ `kabul`le ilerler: ret · 5xx · ağ hatası konumu ilerletmez, aynı
//      değişiklik sonraki turda yeniden gider; ağ tekrarı AYNI paket kimliğiyle
//   ⭐ eşitlik bozucu: aynı `updatedAt`li satırlar sayfa sınırında KAYBOLMAZ, tekrar etmez
//   ⭐ zincir kopukluğu (P22) ve bulutun TAM isteği → sonraki tur TAM
//   ⭐ anlık kayıtlar içerik özeti aynıysa tekrar gitmez; zil konu dağıtımı
//   ⭐ rapor isteği (P16): bilinen rapor HAZIR, audit raporu RAPOR_BILINMIYOR, bozuk
//      parametre PARAMETRE_GECERSIZ — fabrika KENDİ şemasıyla doğrular
//   ⭐ iş tık'ı: aralık kiradan, standart rapor görüntüleri saatlik ve tekrarsız, abonelik
//      bitince dışarı sıfır istek
//
// NEGATİF SONDA — dosya DIŞI mutasyon (cp + shasum ile birebir geri alındı; commit mesajında):
//   F1 `computeHorizon` açık tx'i yok sayar (base = dbNow)            → §4 ❌
//   F2 kaynak taraması eşitlik bozucusuz (`>` yerine yalnız zaman)    → §6 ❌
//   F3 ret edilen projeksiyonun zinciri de yazılır                    → §5 ❌
// ⭐ KALICI SONDA ✓K1 (her koşumda): sahte bulut imzasız/kurcalı isteği reddeder — §2'nin
// "imza geçerli" ölçümü kör değil.
// =============================================================================
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuditService } from "../src/services/audit.service";
import { setMeasuredFingerprint, getLicenseSnapshot, getLicenseInstallationId } from "../src/lib/license/runtime";
import { runSyncRound, type RoundOutcome } from "../src/cloud-sync/sync-round";
import { egressCloudTransport } from "../src/cloud-sync/cloud-client";
import { getCloudUrl, setCloudUrlForTests } from "../src/cloud-sync/cloud-url";
import { evaluateCloudEligibility } from "../src/cloud-sync/eligibility";
import { __setScanLimitForTests } from "../src/cloud-sync/change-scan";
import { RECORD_PROJECTIONS } from "../src/cloud-sync/projections";
import { FULL_RESEND_MARKER, wmKey } from "../src/cloud-sync/watermarks";
import { claimAndRunReportRequests, standardReportPlan, REMOTE_REPORTS } from "../src/cloud-sync/report-requests";
import { onDoorbellTopic, dispatchDoorbellTopic, __resetDoorbellTopicsForTests } from "../src/jobs/doorbell-topics";
import { runCloudSyncTick, getCloudSyncStatus, __configureCloudSyncForTests } from "../src/jobs/cloud-sync.job";
import { DAY_MS, msToIso } from "../src/lib/license/protocol";
import { readFinanceEnabled, readProductionEnabled } from "../src/services/system-setting.service";
import { HORIZON_BASE_MARGIN_MS } from "../src/cloud-sync/horizon";
import { bulutLisansKur, sahteBulutBaslat, type SahteBulut, type BulutLisans } from "./lib/bulut-fikstur";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

// Audit yazımı bellekte kalır (defter satırı yazılmaz).
AuditService.logEvent = async () => undefined;
AuditService.log = async () => undefined;

const TAG = `BLTF${Date.now().toString(36).toUpperCase()}`;
const HEPSI = new Set(["HER_TUR", "SAATLIK", "GUNLUK"] as const);
const tur = (o: Partial<Parameters<typeof runSyncRound>[0]> = {}): Promise<RoundOutcome> =>
  runSyncRound({ kind: "ARTIMLI", cadences: new Set(["HER_TUR"]), ...o }, { transport: egressCloudTransport });

async function temizleEsitlemeDurumu(): Promise<void> {
  await prisma.syncWatermark.deleteMany({});
  await prisma.syncMark.deleteMany({});
}

async function temizleFikstur(): Promise<void> {
  await prisma.$executeRawUnsafe(`DELETE FROM "colors" WHERE "code" LIKE $1`, `${TAG}%`);
}

async function renkYarat(ek: string): Promise<string> {
  const c = await prisma.color.create({ data: { code: `${TAG}${ek}`, name: `${TAG} renk ${ek}` }, select: { id: true } });
  return c.id;
}

/** Güvenli ufuk DB saatinin pay kadar gerisindedir: yeni yazım, pay geçmeden turda görünmez (tasarım gereği). */
const ufkuGec = (): Promise<void> => new Promise((r) => setTimeout(r, HORIZON_BASE_MARGIN_MS + 600));

async function onKosulBolumu(lisans: BulutLisans, bulut: SahteBulut): Promise<void> {
  console.log("\n§1 — ön koşul fail-closed (dışarı sıfır istek)");
  const once = bulut.istekler.length;
  const bekle = async (ad: string, kur: () => void, neden: string): Promise<void> => {
    kur();
    const e = evaluateCloudEligibility(getLicenseSnapshot(), Date.now(), getCloudUrl().url, getLicenseInstallationId());
    const o = await tur();
    check(`§1 ${ad} → ${neden}`, !e.ok && e.reason === neden && o.status === "GONDERILMEDI", `${e.ok ? "UYGUN" : e.reason} · ${o.status}`);
  };
  await bekle("TEST sınıfı", () => lisans.lisansiYaz({ sinif: "TEST" }), "SINIF_URETIM_DEGIL");
  await bekle("patron-bulut hakkı yok", () => lisans.lisansiYaz({ moduller: ["production.enabled", "finance.enabled"] }), "PATRON_BULUT_HAKKI_YOK");
  await bekle("abonelik bitmiş", () => lisans.lisansiYaz({}, { patronBulutBitis: msToIso(Date.now() - DAY_MS) }), "ABONELIK_YOK");
  await bekle("abonelik yok", () => lisans.lisansiYaz({}, { patronBulutBitis: null }), "ABONELIK_YOK");
  await bekle("aralık yok", () => lisans.lisansiYaz({}, { esitlemeAraligiDk: null }), "ARALIK_YOK");
  await bekle("DEVREDİLDİ", () => lisans.lisansiYaz({}, { devredildi: true }), "DEVREDILDI");
  lisans.lisansiYaz();
  await bekle("parmak izi ölçülemedi", () => setMeasuredFingerprint(null), "LISANS_OLCULEMEDI");
  lisans.lisansiYaz();
  setMeasuredFingerprint({ digest: lisans.f.parmakIzi, measured: { f1: true, f2: true, f3: true, f4: true, f5: true }, measuredAt: new Date().toISOString() });
  await bekle("bulut adresi kapalı", () => setCloudUrlForTests(null), "BULUT_ADRESI_YOK");
  setCloudUrlForTests(bulut.url);
  check("§1z ⭐ hiçbir ret dalında dışarı istek atılmadı", bulut.istekler.length === once, `${bulut.istekler.length - once} istek`);
  const e = evaluateCloudEligibility(getLicenseSnapshot(), Date.now(), bulut.url, getLicenseInstallationId());
  check("§1y uygun lisans geri gelince eşitleme açık (kurulum kimliği HAK'tan)", e.ok && e.installationId === lisans.installationId, e.ok ? `aralık ${e.intervalMinutes} dk` : e.reason);
}

async function ilkTurBolumu(bulut: SahteBulut): Promise<void> {
  console.log("\n§2 — ilk tur: TAM + imza + gzip");
  const o = await runSyncRound({ kind: "ARTIMLI", cadences: HEPSI }, { transport: egressCloudTransport });
  check("§2a tur TAMAM", o.status === "TAMAM", `${o.status} ${o.reason ?? ""} · ${o.packets} paket`);
  const esitle = bulut.istekler.filter((i) => i.yol === "/v1/esitle");
  check("§2b ⭐ her istek imzalı (amaç esitle, gövde özeti sıkıştırılmış bayttan) ve gzip", esitle.length > 0 && esitle.every((i) => i.imza && i.gzip && i.durum === 200), `${esitle.length} istek`);
  const tamlar = new Map<string, { parca: number; toplamParca: number; onceki: unknown }[]>();
  for (const p of bulut.paketler) for (const k of p.kayitlar) {
    if (!k.tam) continue;
    tamlar.set(k.projeksiyon, [...(tamlar.get(k.projeksiyon) ?? []), { parca: k.tam.parca, toplamParca: k.tam.toplamParca, onceki: k.filigran.onceki }]);
  }
  const moduller = { "production.enabled": await readProductionEnabled(), "finance.enabled": await readFinanceEnabled() };
  const acik = RECORD_PROJECTIONS.filter((p) => !p.module || moduller[p.module]).map((p) => p.name);
  const kapali = RECORD_PROJECTIONS.filter((p) => p.module && !moduller[p.module]).map((p) => p.name);
  const eksik = acik.filter((n) => !tamlar.has(n));
  check("§2c ⭐ açık modüllerin her kayıt projeksiyonu TAM gitti; ilk parça zinciri sıfırdan kurar (önceki null), son parça = toplam",
    eksik.length === 0 && [...tamlar.values()].every((l) => l.some((x) => x.parca === x.toplamParca) && l.some((x) => x.parca === 1 && x.onceki === null)),
    eksik.length ? `eksik: ${eksik.join(", ")}` : `${tamlar.size} ad (alt satırlar dahil)`);
  check("§2c' kapalı modülün projeksiyonu GİTMEDİ (§4.6)", kapali.every((n) => !tamlar.has(n)), kapali.length ? kapali.join(", ") : "kapalı modül yok");
  const dbRenk = new Set((await prisma.color.findMany({ select: { id: true } })).map((c) => c.id));
  const bulutRenk = new Set([...(bulut.satirlar.get("renk") ?? new Map()).keys()]);
  check("§2d buluttaki renk kümesi DB ile birebir", dbRenk.size === bulutRenk.size && [...dbRenk].every((id) => bulutRenk.has(id)), `${dbRenk.size} ↔ ${bulutRenk.size}`);
  const zincir = await prisma.syncWatermark.findUnique({ where: { source: wmKey.chain("renk") } });
  check("§2e onaylanan zincir fabrikada yazıldı (ufuk + sayaç, TAM işareti yok)", !!zincir?.watermarkAt && zincir.digest === null && !!zincir.tieBreaker, `${zincir?.watermarkAt?.toISOString()} ${zincir?.tieBreaker}`);
  const anlik = new Set(bulut.paketler.flatMap((p) => p.anliklar.map((a) => a.projeksiyon)));
  check("§2f anlık kayıtlar gitti (özet bölümleri + karneler)", ["ozet.stok", "ozet.siparis", "ozet.sevkiyat", "ozet.fason", "stok-karnesi", "acik-siparis-karsilama", "rapor-katalogu"].every((n) => anlik.has(n)), [...anlik].join(", "));
}

async function artimliBolumu(bulut: SahteBulut): Promise<void> {
  console.log("\n§3 — artımlı tur");
  const renk = (await prisma.color.findFirst({ where: { code: { startsWith: TAG } }, select: { id: true } }))!.id;
  const oncekiZincir = bulut.zincir.get("renk");
  await prisma.color.update({ where: { id: renk }, data: { name: `${TAG} yeni ad` } });
  await ufkuGec();
  const n0 = bulut.paketler.length;
  const o = await tur();
  const yeni = bulut.paketler.slice(n0);
  const kayitlar = yeni.flatMap((p) => p.kayitlar);
  const renkKaydi = kayitlar.find((k) => k.projeksiyon === "renk");
  check("§3a tur TAMAM", o.status === "TAMAM", `${o.status} ${o.reason ?? ""}`);
  check("§3b ⭐ yalnız değişen gitti: renk kaydı, içinde değişen satır ve yeni ad", !!renkKaydi && renkKaydi.yaz.length >= 1 && renkKaydi.yaz.some((r) => r.id === renk && r.ad === `${TAG} yeni ad`) && kayitlar.every((k) => k.projeksiyon === "renk" || k.yaz.length + k.sil.length === 0),
    kayitlar.map((k) => `${k.projeksiyon}:${k.yaz.length}/${k.sil.length}`).join(", "));
  check("§3c ⭐ zincir: önceki = son onaylanan, yeni > önceki", !!renkKaydi && JSON.stringify(renkKaydi.filigran.onceki) === JSON.stringify(oncekiZincir) && renkKaydi.filigran.yeni.k > (oncekiZincir?.k ?? ""),
    `${JSON.stringify(oncekiZincir)} → ${JSON.stringify(renkKaydi?.filigran)}`);
  const n1 = bulut.paketler.length;
  const bos = await tur();
  const kalp = bulut.paketler.slice(n1);
  check("§3d değişiklik yoksa tek boş paket (kalp atışı — bulut 'son eşitleme'yi ölçer)", bos.status === "TAMAM" && kalp.length === 1 && kalp[0]!.kayitlar.length === 0 && kalp[0]!.anliklar.length === 0,
    `${kalp.length} paket · ${kalp[0]?.kayitlar.length ?? "-"} kayıt · ${kalp[0]?.anliklar.length ?? "-"} anlık`);
}

async function ufukBolumu(bulut: SahteBulut): Promise<void> {
  console.log("\n§4 — güvenli ufuk (P21)");
  const renk = await renkYarat("UFUK");
  await ufkuGec();
  await tur();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const bas = (await c.query<{ t: Date }>("SELECT now() AS t")).rows[0]!.t;
    await c.query(`UPDATE "colors" SET "name" = $1, "updatedAt" = clock_timestamp() WHERE "id" = $2`, [`${TAG} açık tx`, renk]);
    // Tx pay süresinden UZUN açık kalır: satırın damgası artık "DB şimdi − pay"ın gerisindedir —
    // ufuk açık tx'i yok sayarsa tarama onu geçer ve commit sonrası satır sonsuza dek kaçar.
    await ufkuGec();
    const n0 = bulut.paketler.length;
    const o = await tur();
    const gorundu = bulut.paketler.slice(n0).some((p) => p.kayitlar.some((k) => k.projeksiyon === "renk" && k.yaz.some((r) => r.id === renk)));
    check("§4a ⭐ ufuk açık tx'in başlangıcından ÖNCE", !!o.horizon && new Date(o.horizon) < bas, `ufuk ${o.horizon} · tx ${bas.toISOString()}`);
    check("§4b açık tx'in satırı bu turda yok (henüz commit edilmedi)", !gorundu);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
  await ufkuGec();
  const n1 = bulut.paketler.length;
  await tur();
  const geldi = bulut.paketler.slice(n1).some((p) => p.kayitlar.some((k) => k.projeksiyon === "renk" && k.yaz.some((r) => r.id === renk && r.ad === `${TAG} açık tx`)));
  check("§4c ⭐ commit sonrası turda satır ATLANMADAN geldi", geldi);
}

async function onayBolumu(bulut: SahteBulut): Promise<void> {
  console.log("\n§5 — filigran yalnız kabulle ilerler");
  const renk = await renkYarat("ONAY");
  await ufkuGec();
  await tur();
  const zincirOnce = await prisma.syncWatermark.findUnique({ where: { source: wmKey.chain("renk") } });
  await prisma.color.update({ where: { id: renk }, data: { name: `${TAG} ret` } });
  await ufkuGec();
  bulut.mod.ret.add("renk");
  const o = await tur();
  bulut.mod.ret.clear();
  const zincirSonra = await prisma.syncWatermark.findUnique({ where: { source: wmKey.chain("renk") } });
  check("§5a ret → tur KISMI, renk zinciri İLERLEMEDİ", o.status === "KISMI" && zincirOnce?.tieBreaker === zincirSonra?.tieBreaker, `${o.status} · ${zincirOnce?.tieBreaker} → ${zincirSonra?.tieBreaker}`);
  const n0 = bulut.paketler.length;
  await tur();
  const tekrar = bulut.paketler.slice(n0).some((p) => p.kayitlar.some((k) => k.projeksiyon === "renk" && k.yaz.some((r) => r.id === renk && r.ad === `${TAG} ret`)));
  check("§5b ⭐ reddedilen değişiklik sonraki turda yeniden gitti", tekrar);

  await prisma.color.update({ where: { id: renk }, data: { name: `${TAG} ağ` } });
  await ufkuGec();
  bulut.mod.hata500 = 1;
  const i0 = bulut.istekler.length;
  const o2 = await tur();
  const denemeler = bulut.istekler.slice(i0).filter((i) => i.yol === "/v1/esitle");
  check("§5c ⭐ 5xx → aynı paket kimliğiyle ağ tekrarı, sonra kabul", o2.status === "TAMAM" && denemeler.length >= 2 && denemeler[0]!.durum === 500 && denemeler[0]!.paketId === denemeler[1]!.paketId,
    denemeler.map((d) => `${d.durum}:${d.paketId?.slice(0, 8)}`).join(" "));

  await prisma.color.update({ where: { id: renk }, data: { name: `${TAG} kopuk` } });
  await ufkuGec();
  const z0 = await prisma.syncWatermark.findUnique({ where: { source: wmKey.chain("renk") } });
  bulut.mod.hata500 = 10;
  const o3 = await tur();
  bulut.mod.hata500 = 0;
  const z1 = await prisma.syncWatermark.findUnique({ where: { source: wmKey.chain("renk") } });
  check("§5d kalıcı 5xx → tur HATA, zincir ilerlemedi", o3.status === "HATA" && z0?.tieBreaker === z1?.tieBreaker, `${o3.status} ${o3.reason}`);
  const n1 = bulut.paketler.length;
  await tur();
  check("§5e hata sonrası değişiklik kaybolmadı", bulut.paketler.slice(n1).some((p) => p.kayitlar.some((k) => k.projeksiyon === "renk" && k.yaz.some((r) => r.id === renk && r.ad === `${TAG} kopuk`))));
}

async function esitlikBozucuBolumu(bulut: SahteBulut): Promise<void> {
  console.log("\n§6 — eşitlik bozucu (aynı updatedAt, sayfa sınırı)");
  await tur();
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) ids.push(await renkYarat(`ES${i}`));
  // Aynı an, son taranan konumdan SONRA (geçmişe yazılan damga filigranın göremediği bir şeydir).
  const sabit = new Date();
  await prisma.$executeRawUnsafe(`UPDATE "colors" SET "updatedAt" = $1 WHERE "id" = ANY($2::uuid[])`, sabit, ids);
  await ufkuGec();
  __setScanLimitForTests(2);
  const gelen: string[] = [];
  try {
    for (let i = 0; i < 6; i++) {
      const n0 = bulut.paketler.length;
      const o = await tur();
      for (const p of bulut.paketler.slice(n0)) for (const k of p.kayitlar) if (k.projeksiyon === "renk") for (const r of k.yaz) if (ids.includes(String(r.id))) gelen.push(String(r.id));
      if (!o.more) break;
    }
  } finally {
    __setScanLimitForTests(null);
  }
  const tekil = new Set(gelen);
  check("§6a ⭐ aynı zamanlı 5 satırın HEPSİ geldi (sayfa sınırında kayıp yok)", ids.every((id) => tekil.has(id)), `${tekil.size}/5`);
  check("§6b ⭐ hiçbiri iki kez gelmedi (bozucu tekrar üretmez)", gelen.length === tekil.size, `${gelen.length} gönderim`);
}

async function kopuklukBolumu(bulut: SahteBulut): Promise<void> {
  console.log("\n§7 — zincir kopukluğu ve TAM isteği (P22)");
  bulut.mod.istenenTam.add("renk");
  await tur();
  const z = await prisma.syncWatermark.findUnique({ where: { source: wmKey.chain("renk") } });
  check("§7a bulutun TAM isteği fabrikada işaretlendi", z?.digest === FULL_RESEND_MARKER, String(z?.digest));
  const n0 = bulut.paketler.length;
  await tur();
  const tam = bulut.paketler.slice(n0).flatMap((p) => p.kayitlar).filter((k) => k.projeksiyon === "renk");
  check("§7b ⭐ sonraki tur renk'i TAM gönderdi (parça 1, önceki null), işaret kalktı", tam.length > 0 && tam[0]!.tam?.parca === 1 && tam[0]!.filigran.onceki === null,
    tam.map((k) => `${k.tam?.parca}/${k.tam?.toplamParca}`).join(","));
  const z2 = await prisma.syncWatermark.findUnique({ where: { source: wmKey.chain("renk") } });
  check("§7c TAM tamamlanınca işaret kalktı", z2?.digest === null, String(z2?.digest));

  // Bulut filigranını kaybetti (restore): fabrikanın önceki değeri buluttan ileride → FILIGRAN_KOPUK.
  bulut.zincir.delete("renk");
  const renk = await renkYarat("KOPUK");
  await ufkuGec();
  await tur();
  const z3 = await prisma.syncWatermark.findUnique({ where: { source: wmKey.chain("renk") } });
  check("§7d ⭐ bulut zinciri geride → FILIGRAN_KOPUK → TAM işareti", z3?.digest === FULL_RESEND_MARKER, String(z3?.digest));
  const n1 = bulut.paketler.length;
  await tur();
  const kayit = bulut.paketler.slice(n1).flatMap((p) => p.kayitlar).filter((k) => k.projeksiyon === "renk");
  check("§7e kopukluk TAM ile onarıldı, yeni satır bulutta", kayit.some((k) => k.tam) && (bulut.satirlar.get("renk")?.has(renk) ?? false));
}

async function anlikBolumu(bulut: SahteBulut): Promise<void> {
  console.log("\n§8 — anlık kayıtlar ve zil");
  const n0 = bulut.paketler.length;
  await runSyncRound({ kind: "ARTIMLI", cadences: new Set(["HER_TUR"]), snapshotsOnly: true }, { transport: egressCloudTransport });
  const yeni = bulut.paketler.slice(n0);
  check("§8a ⭐ içerik değişmediyse anlık tekrar gitmez (özet eşit)", yeni.length === 1 && yeni[0]!.anliklar.length === 0 && yeni[0]!.kayitlar.length === 0,
    `${yeni[0]?.anliklar.map((a) => a.projeksiyon).join(",") || "boş"}`);
  await prisma.syncWatermark.deleteMany({ where: { source: wmKey.snapshot("ozet.stok") } });
  const n1 = bulut.paketler.length;
  await runSyncRound({ kind: "ARTIMLI", cadences: new Set(["HER_TUR"]), snapshotsOnly: true }, { transport: egressCloudTransport });
  const tekrar = bulut.paketler.slice(n1).flatMap((p) => p.anliklar.map((a) => a.projeksiyon));
  check("§8b onaylı özet kaybolunca anlık yeniden gider; kayıt projeksiyonu taranmaz (yalnız anlık tur)", tekrar.includes("ozet.stok") && bulut.paketler.slice(n1).every((p) => p.kayitlar.length === 0), tekrar.join(","));
  __resetDoorbellTopicsForTests();
  let ozet = 0;
  let rapor = 0;
  onDoorbellTopic("ozet", () => ozet++);
  onDoorbellTopic("rapor", () => rapor++);
  const d1 = dispatchDoorbellTopic("ozet");
  const d2 = dispatchDoorbellTopic("guncelleme");
  check("§8c zil konu dağıtımı: ozet dinleyicisi çağrıldı, dinleyicisiz konu sessiz", d1 === 1 && ozet === 1 && rapor === 0 && d2 === 0);
  const zilKaynak = fs.readFileSync(`${__dirname}/../src/jobs/license-doorbell.job.ts`, "utf8");
  check("§8d lisans zili lisans dışı konuları dağıtıcıya verir (`lisans` yoklamada kalır)", /if \(ev\.konu === "lisans"\) requestImmediateLicensePoll\(\);\s*\n\s*else dispatchDoorbellTopic\(ev\.konu\);/.test(zilKaynak));
  __resetDoorbellTopicsForTests();
}

async function raporBolumu(lisans: BulutLisans, bulut: SahteBulut): Promise<void> {
  console.log("\n§9 — rapor isteği (P16)");
  const a = randomUUID();
  const b = randomUUID();
  const c = randomUUID();
  bulut.mod.bekleyenRaporlar.push(
    { istekId: a, raporAnahtari: "inventory/scorecard", parametreler: {} },
    { istekId: b, raporAnahtari: "audit/system-log-summary", parametreler: {} },
    { istekId: c, raporAnahtari: "sales/order-intake", parametreler: { bilinmeyen: 1 } },
  );
  const r = await claimAndRunReportRequests({ baseUrl: bulut.url, installationId: lisans.installationId, transport: egressCloudTransport });
  const by = new Map(bulut.raporSonuclari.map((x) => [x.istekId, x]));
  check("§9a üç istek üstlenildi, üç sonuç gönderildi", r.claimed === 3 && r.sent === 3, JSON.stringify(r));
  check("§9b ⭐ stok karnesi HAZIR ve veri taşıyor", by.get(a)?.durum === "HAZIR" && by.get(a)?.veri !== null);
  check("§9c ⭐ audit raporu buluttan istenemez → RAPOR_BILINMIYOR", by.get(b)?.durum === "HATA" && by.get(b)?.hataKodu === "RAPOR_BILINMIYOR");
  check("§9d ⭐ tanınmayan parametre → PARAMETRE_GECERSIZ (fabrika kendi şemasıyla doğrular)", by.get(c)?.durum === "HATA" && by.get(c)?.hataKodu === "PARAMETRE_GECERSIZ");
  const plan = standardReportPlan(new Date());
  const donemli = REMOTE_REPORTS.filter((x) => x.standard === "DONEMLI").length;
  const kesit = REMOTE_REPORTS.filter((x) => x.standard === "KESIT").length;
  check("§9e standart görüntü planı: dönemli × 3 dönem + kesit × 1", plan.length === donemli * 3 + kesit, `${plan.length} = ${donemli}×3 + ${kesit}`);
}

async function isBolumu(lisans: BulutLisans, bulut: SahteBulut): Promise<void> {
  console.log("\n§10 — iş (zamanlayıcı tık'ı)");
  __configureCloudSyncForTests({ transport: egressCloudTransport, reset: true });
  const t0 = Date.now();
  const p0 = bulut.paketler.length;
  const r0 = bulut.raporSonuclari.length;
  await runCloudSyncTick(t0);
  const standart = bulut.raporSonuclari.slice(r0).filter((x) => x.istekId === null);
  check("§10a ⭐ ilk tık: bir tur + saatlik standart rapor görüntüleri (istek beklemeden)", bulut.paketler.length > p0 && standart.length === standardReportPlan(new Date(t0)).length,
    `${bulut.paketler.length - p0} paket · ${standart.length} standart görüntü`);
  check("§10b standart görüntü dönemleri bugün/bu ay/geçen ay ya da kesit", standart.every((x) => x.donem === null || ["bugun", "bu-ay", "gecen-ay"].includes(x.donem)));
  const p1 = bulut.paketler.length;
  const r1 = bulut.raporSonuclari.length;
  await runCloudSyncTick(t0 + 60_000);
  check("§10c ⭐ aralık (kiradan 5 dk) dolmadan ikinci tur YOK", bulut.paketler.length === p1, `${bulut.paketler.length - p1} paket`);
  await runCloudSyncTick(t0 + 5 * 60_000 + 1000);
  const tekrar = bulut.raporSonuclari.slice(r1).filter((x) => x.istekId === null);
  check("§10d aralık dolunca tur; saat dolmadan standart görüntü yeniden hesaplanmaz", bulut.paketler.length > p1 && tekrar.length === 0, `${tekrar.length} görüntü`);
  lisans.lisansiYaz({}, { patronBulutBitis: null });
  __configureCloudSyncForTests({ reset: true });
  const p2 = bulut.paketler.length;
  await runCloudSyncTick(Date.now());
  const st = getCloudSyncStatus();
  check("§10e ⭐ abonelik biterse iş dışarı çıkmaz, durum nedeni görünür (P10)", bulut.paketler.length === p2 && !st.eligible && st.blockReason === "ABONELIK_YOK", `${st.blockReason}`);
  lisans.lisansiYaz();
}

async function kaliciSonda(bulut: SahteBulut): Promise<void> {
  console.log("\n§K — kalıcı sonda: sahte bulut imzasızı reddeder");
  const govde = gzipSync(Buffer.from(JSON.stringify({ v: 1 })));
  const res = await egressCloudTransport({ url: `${bulut.url}/v1/esitle`, method: "POST", headers: { "content-type": "application/json", "content-encoding": "gzip" }, body: govde });
  check("§K1 ⭐ imzasız istek 401 (§2b'nin imza ölçümü kör değil)", res.status === 401, String(res.status));
}

async function main(): Promise<void> {
  console.log(`=== PATRON BULUTU FİLİGRAN (${TAG}) ===`);
  let bulut: SahteBulut | null = null;
  let lisans: BulutLisans | null = null;
  try {
    await temizleEsitlemeDurumu();
    await temizleFikstur();
    await renkYarat("ILK");
    lisans = await bulutLisansKur();
    bulut = await sahteBulutBaslat(lisans.x);
    await onKosulBolumu(lisans, bulut);
    await ilkTurBolumu(bulut);
    await artimliBolumu(bulut);
    await ufukBolumu(bulut);
    await onayBolumu(bulut);
    await esitlikBozucuBolumu(bulut);
    await kopuklukBolumu(bulut);
    await anlikBolumu(bulut);
    await raporBolumu(lisans, bulut);
    await isBolumu(lisans, bulut);
    await kaliciSonda(bulut);
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    await bulut?.kapat();
    await temizleFikstur().catch(() => undefined);
    await temizleEsitlemeDurumu().catch(() => undefined);
    if (lisans) fs.rmSync(lisans.dizin, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end().catch(() => undefined);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
