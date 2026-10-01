// =============================================================================
// BEKÇİ — BACKEND GÜNCELLEME ONAYI + NİYET YAZICISI (Dağıtım v2 — docs/design/GUNCELLEYICI.md §3 m.2 · §5.1)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts guncelleme_onay   (DB: kendi _test DB'n; geçici güncelleyici dizini)
//
// GÜVEN SINIRI: düşük yetkili backend niyeti YAZAR, SYSTEM güncelleyici OKUR. Niyet yalnız sürüm + kimlik seçer —
// yol, komut, adres, dosya adı TAŞIMAZ; güncelleyici onayı yalnız aynı sürümün İMZALI adayına sayar.
//
// NE ÖLÇER:
//   §1 ⭐ gövde (negatif sondalar): tanınmayan alan (yol · komut · url · dosya) RED · yol/adres/komut gömülü sürüm RED ·
//      bilinmeyen zamanlama RED
//   §2 ⭐ niyet belgesi: KATI şema enjeksiyonu reddeder · yazıcı atomik (geçici dosya kalmaz) · dizin yok / dizin ya da
//      hedef bağlantı → YAZMAZ · biçimsiz niyet diske gitmez
//   §3 servis: HEMEN → satır + niyet (onayId = satır, AYNEN sözleşme anahtarları, hiçbir değerde yol/adres yok) +
//      audit ayak izi · tekrar oynatma aynı sonuç, ikinci satır yok · aynı token başka yük → 409 · sürüm değişti →
//      409 · PENCERE yalnız pencere varsa · GERI_AL → niyette onay yok · DONDUR → 409 · güncelleyici yok → 409
//   §4 belirteç: yoklamanın backend/ belirteci niyete · yeniden başlatmada niyetteki taze belirteç korunur, süresi
//      geçen korunmaz · doğrulama kipinde niyet yazılmaz
//   §5 HTTP (süreç içi uygulama, 127.0.0.1): izinsiz 403 · enjeksiyonlu gövde 400 · license:manage 201 + durum ·
//      `/health/yerel` döngü adresine 200 (lisans motor ölçünce) · vekil başlıklı istek 404 · public /health'te lisans YOK
// NEGATİF SONDA (elle, geri alındı; commit mesajında).
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import prisma, { pool } from "../src/lib/prisma";
import app from "../src/app";
import { DAY_MS, msToIso, signDownloadToken, windowIntervals, type LeaseUpdatePolicy } from "../src/lib/license/protocol";
import { setDownloadTokens, setLicenseEngineStatus } from "../src/lib/license/runtime";
import { UPDATER_DIR_ENV, UPDATER_INTENT_FILE, UpdaterIntentSchema, readUpdaterIntent, writeUpdaterIntent, type UpdaterIntent } from "../src/lib/license/updater-ipc";
import { VERIFICATION_MODE_ENV } from "../src/lib/dogrulama-kipi";
import { RecordUpdateApprovalSchema, recordUpdateApproval } from "../src/services/update-approval.service";
import { refreshUpdaterIntent } from "../src/services/update-intent.service";
import { DEFAULT_FACTORY_TIMEZONE } from "../src/constants/time";
import { lisansKipKur, temizleLisansKipDizini } from "./lib/lisans-kip-fikstur";
import { anahtarUret } from "./lib/lisans-fikstur";
import { kosumaOzguParola } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

const TAG = `gnc-onay-${Date.now()}`;
const VEKTOR = path.join(__dirname, "..", "native", "test-vektorleri", "guncelleyici-durum", "onay-bekliyor", "durum", "durum.json");
const KOK = fs.mkdtempSync(path.join(os.tmpdir(), "gnc-onay-"));
const NIYET = path.join(KOK, UPDATER_INTENT_FILE);
const ADAY = "2.13.0";
const olusan = { userIds: [] as string[] };
let server: Server | null = null;

/** Güncelleyicinin durum dosyası: D2'nin "onay bekliyor" çıktısı, kalp atışı ŞİMDİ (canlı). */
function durumYaz(over: Record<string, unknown> = {}): void {
  const d = JSON.parse(fs.readFileSync(VEKTOR, "utf8")) as Record<string, unknown>;
  const simdi = msToIso(Date.now());
  fs.mkdirSync(path.join(KOK, "durum"), { recursive: true });
  fs.writeFileSync(path.join(KOK, "durum", "durum.json"), JSON.stringify({ ...d, zaman: simdi, sonCanlilik: simdi, ...over }));
}

function politika(kip: LeaseUpdatePolicy["kip"], pencereli: boolean): LeaseUpdatePolicy {
  const simdi = Date.now();
  const pencere = { baslangic: "02:00", bitis: "05:00", gunler: [1, 2, 3, 4, 5, 6, 7], saatDilimi: DEFAULT_FACTORY_TIMEZONE };
  return pencereli
    ? { kip, pencere, araliklar: windowIntervals(pencere, simdi - 60 * 60 * 1000, simdi + 29 * DAY_MS), hedefSurum: null }
    : { kip, pencere: null, araliklar: [], hedefSurum: null };
}

function niyetOku(): UpdaterIntent | null {
  return fs.existsSync(NIYET) ? (JSON.parse(fs.readFileSync(NIYET, "utf8")) as UpdaterIntent) : null;
}

async function hataOf(fn: () => Promise<unknown>): Promise<{ statusCode?: number; details?: { code?: string }; message?: string } | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return err as { statusCode?: number; details?: { code?: string }; message?: string };
  }
}

function govde(): void {
  console.log("\n§1 gövde — enjeksiyon RED");
  const temiz = { clientToken: randomUUID(), surum: ADAY, zamanlama: "HEMEN" };
  check("§1a temiz gövde geçer", RecordUpdateApprovalSchema.safeParse(temiz).success);
  for (const [ad, ek] of Object.entries({ yol: "C:\\Windows\\System32", komut: "powershell -c calc", url: "https://kotu.example/paket.zip", dosya: "..\\..\\niyet.json", paket: { ad: "x.zip" } })) {
    check(`§1b ⭐ tanınmayan alan '${ad}' → RED (şema KATI)`, !RecordUpdateApprovalSchema.safeParse({ ...temiz, [ad]: ek }).success);
  }
  for (const s of ["../../2.13.0", "2.13.0/../x", "C:\\TeksERP\\x", "https://kotu.example/2.13.0", "2.13.0;del", "2.13.0 && calc", "2.13.0+yapi", "2.13", ""]) {
    check(`§1c ⭐ sürüm '${s}' → RED`, !RecordUpdateApprovalSchema.safeParse({ ...temiz, surum: s }).success);
  }
  check("§1d bilinmeyen zamanlama → RED", !RecordUpdateApprovalSchema.safeParse({ ...temiz, zamanlama: "YARIN" }).success);
  check("§1e clientToken UUID olmalı", !RecordUpdateApprovalSchema.safeParse({ ...temiz, clientToken: "abc" }).success);
}

async function niyetBelgesi(): Promise<void> {
  console.log("\n§2 niyet belgesi + atomik yazıcı");
  const iyi: UpdaterIntent = {
    v: 1,
    yazildi: msToIso(Date.now()),
    indirme: { belirtec: "eyJhbGciOiJFZERTQSJ9.eyJ2IjoxfQ.c2ln", bitis: msToIso(Date.now() + 3600_000) },
    onay: { onayId: randomUUID(), surum: ADAY, zamanlama: "HEMEN", kullaniciId: randomUUID(), ad: "Ayşe Y.", zaman: msToIso(Date.now()) },
  };
  check("§2a sözleşme biçimi geçer", UpdaterIntentSchema.safeParse(iyi).success);
  const enjeksiyonlar: Array<[string, unknown]> = [
    ["üst düzey 'komut'", { ...iyi, komut: "cmd /c del" }],
    ["üst düzey 'paketYolu'", { ...iyi, paketYolu: "C:\\x.zip" }],
    ["onay içinde 'url'", { ...iyi, onay: { ...iyi.onay, url: "https://kotu.example" } }],
    ["indirme içinde 'sunucu'", { ...iyi, indirme: { ...iyi.indirme, sunucu: "https://kotu.example" } }],
    ["yol gömülü sürüm", { ...iyi, onay: { ...iyi.onay, surum: "..\\..\\2.13.0" } }],
    ["belirteçte '/'", { ...iyi, indirme: { ...iyi.indirme, belirtec: "a/b.c" } }],
    ["çok satırlı ad", { ...iyi, onay: { ...iyi.onay, ad: "Ayşe\r\nkomut" } }],
    ["bilinmeyen zamanlama", { ...iyi, onay: { ...iyi.onay, zamanlama: "GERI_AL" } }],
  ];
  for (const [ad, n] of enjeksiyonlar) check(`§2b ⭐ niyet şeması ${ad} → RED`, !UpdaterIntentSchema.safeParse(n).success);

  const d = fs.mkdtempSync(path.join(os.tmpdir(), "gnc-niyet-"));
  try {
    const yok = await writeUpdaterIntent(d, iyi);
    check("§2c niyet dizini yok → YAZMAZ (NIYET_DIZINI_YOK)", yok.kind === "error" && yok.code === "NIYET_DIZINI_YOK" && !fs.existsSync(path.join(d, UPDATER_INTENT_FILE)));
    const baska = fs.mkdtempSync(path.join(os.tmpdir(), "gnc-baska-"));
    fs.symlinkSync(baska, path.join(d, "niyet"));
    const bag = await writeUpdaterIntent(d, iyi);
    check("§2d ⭐ niyet dizini bağlantı → YAZMAZ (bağlantı izlenmez)", bag.kind === "error" && bag.code === "NIYET_DIZINI_GUVENSIZ" && fs.readdirSync(baska).length === 0);
    fs.rmSync(path.join(d, "niyet"));
    fs.rmSync(baska, { recursive: true, force: true });
    fs.mkdirSync(path.join(d, "niyet"));
    const hedef = path.join(d, "hedef.txt");
    fs.writeFileSync(hedef, "dokunulmamalı");
    fs.symlinkSync(hedef, path.join(d, UPDATER_INTENT_FILE));
    const hedefBag = await writeUpdaterIntent(d, iyi);
    check("§2e ⭐ niyet dosyası bağlantı → YAZMAZ, bağın hedefi değişmez", hedefBag.kind === "error" && fs.readFileSync(hedef, "utf8") === "dokunulmamalı");
    fs.rmSync(path.join(d, UPDATER_INTENT_FILE));
    const yazildi = await writeUpdaterIntent(d, iyi);
    const dosyalar = fs.readdirSync(path.join(d, "niyet"));
    check("§2f atomik yazım: niyet.json yazıldı, geçici dosya kalmadı", yazildi.kind === "ok" && JSON.stringify(dosyalar) === JSON.stringify(["niyet.json"]), dosyalar.join(","));
    check("§2g okunan niyet yazılanla aynı", JSON.stringify(readUpdaterIntent(d)) === JSON.stringify(iyi));
    const bozuk = await writeUpdaterIntent(d, { ...iyi, komut: "x" } as never);
    check("§2h biçimsiz niyet diske GİTMEZ (eski dosya korunur)", bozuk.kind === "error" && bozuk.code === "NIYET_BICIMSIZ" && JSON.stringify(readUpdaterIntent(d)) === JSON.stringify(iyi));
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

async function servis(adminId: string): Promise<void> {
  console.log("\n§3 servis — onay kaydı + niyet");
  const hemen = { clientToken: randomUUID(), surum: ADAY, zamanlama: "HEMEN" as const };
  const r = await recordUpdateApproval({ userId: adminId, input: hemen });
  const satir = await prisma.updateApproval.findUnique({ where: { id: r.kayitId } });
  check("§3a HEMEN → satır (sürüm · karar · kip · onaylayan)", satir?.version === ADAY && satir.choice === "HEMEN" && satir.policyMode === "ONAYLI" && satir.approvedById === adminId);
  const n = niyetOku();
  check("§3b ⭐ niyet yazıldı: onayId = satır, sürüm, zamanlama, onaylayan (ad TEK satır)",
    r.niyet.yazildi && n?.onay?.onayId === r.kayitId && n.onay.surum === ADAY && n.onay.zamanlama === "HEMEN" && n.onay.kullaniciId === adminId && n.onay.ad === "Ayşe Yılmaz", n?.onay?.ad);
  const metin = fs.readFileSync(NIYET, "utf8");
  check("§3c ⭐ niyet YALNIZ sözleşme anahtarlarını taşır",
    JSON.stringify(Object.keys(n ?? {}).sort()) === JSON.stringify(["indirme", "onay", "v", "yazildi"]) &&
      JSON.stringify(Object.keys(n?.onay ?? {}).sort()) === JSON.stringify(["ad", "kullaniciId", "onayId", "surum", "zaman", "zamanlama"]));
  check("§3d ⭐ niyetin hiçbir değerinde yol / adres yok (/ \\ ://)", !/[\\/]/.test(metin), metin.match(/[\\/].{0,20}/)?.[0] ?? "temiz");
  check("§3e görünüm: yürürlükteki onay, kullanılmadı; Şimdi kur tekrar önerilmez", r.durum.onay?.onayId === r.kayitId && !r.durum.onay.kullanildi && !r.durum.eylemler.hemen && r.durum.eylemler.geriAl);
  let iz = 0;
  for (let i = 0; i < 20 && iz === 0; i++) {
    iz = await prisma.systemLog.count({ where: { tableName: "UPDATE_APPROVAL", recordId: r.kayitId } });
    if (iz === 0) await new Promise((res) => setTimeout(res, 50));
  }
  check("§3f audit ayak izi (UPDATE_APPROVAL, kayıt kimliği)", iz === 1);

  const tekrar = await recordUpdateApproval({ userId: adminId, input: hemen }).catch((e: unknown) => e as Error);
  check("§3g ⭐ tekrar oynatma: aynı kayıt, İKİNCİ satır yok",
    !(tekrar instanceof Error) && tekrar.kayitId === r.kayitId && (await prisma.updateApproval.count({ where: { clientToken: hemen.clientToken } })) === 1,
    tekrar instanceof Error ? tekrar.message.slice(0, 120) : "");
  const cakisma = await hataOf(() => recordUpdateApproval({ userId: adminId, input: { ...hemen, zamanlama: "PENCERE" } }));
  check("§3h aynı işlem kimliği başka yükle → 409 CLIENT_TOKEN_COLLISION", cakisma?.statusCode === 409 && cakisma.details?.code === "CLIENT_TOKEN_COLLISION");
  const say = await prisma.updateApproval.count();
  const surum = await hataOf(() => recordUpdateApproval({ userId: adminId, input: { clientToken: randomUUID(), surum: "2.99.0", zamanlama: "PENCERE" } }));
  check("§3i ekrandaki sürüm eski → 409 UPDATE_APPROVAL_VERSION_CHANGED, satır yok", surum?.statusCode === 409 && surum.details?.code === "UPDATE_APPROVAL_VERSION_CHANGED" && (await prisma.updateApproval.count()) === say);

  const pencere = await recordUpdateApproval({ userId: adminId, input: { clientToken: randomUUID(), surum: ADAY, zamanlama: "PENCERE" } });
  check("§3j PENCERE (sıradaki aralık var) → yeni satır yürürlükte, niyet PENCERE", niyetOku()?.onay?.zamanlama === "PENCERE" && pencere.durum.onay?.onayId === pencere.kayitId);
  const geri = await recordUpdateApproval({ userId: adminId, input: { clientToken: randomUUID(), surum: ADAY, zamanlama: "GERI_AL" } });
  check("§3k ⭐ GERI_AL → yeni satır, niyette onay YOK, yürürlükte onay yok", niyetOku()?.onay === null && geri.durum.onay === null && (await prisma.updateApproval.findUnique({ where: { id: geri.kayitId } }))?.choice === "GERI_AL");
  const bosGeri = await hataOf(() => recordUpdateApproval({ userId: adminId, input: { clientToken: randomUUID(), surum: ADAY, zamanlama: "GERI_AL" } }));
  check("§3l geri alınacak onay yokken GERI_AL → 409", bosGeri?.statusCode === 409 && bosGeri.details?.code === "UPDATE_APPROVAL_NOT_ALLOWED");

  lisansKipKur({ zorlama: false, kiraEk: { guncelleme: politika("ONAYLI", false) } });
  const pencereYok = await hataOf(() => recordUpdateApproval({ userId: adminId, input: { clientToken: randomUUID(), surum: ADAY, zamanlama: "PENCERE" } }));
  check("§3m kirada pencere yok → PENCERE 409 (yalnız Şimdi kur)", pencereYok?.statusCode === 409 && /Şimdi kur/.test(pencereYok.message ?? ""));
  lisansKipKur({ zorlama: false, kiraEk: { guncelleme: politika("DONDUR", true) } });
  durumYaz({ politika: { kip: "DONDUR", izin: false, neden: "POLITIKA_DONDUR" } });
  const dondur = await hataOf(() => recordUpdateApproval({ userId: adminId, input: { clientToken: randomUUID(), surum: ADAY, zamanlama: "HEMEN" } }));
  check("§3n ⭐ DONDUR → 409 (onay DONDUR'u açamaz), satır yok", dondur?.statusCode === 409 && dondur.details?.code === "UPDATE_APPROVAL_NOT_ALLOWED" && (await prisma.updateApproval.count()) === say + 2);
  lisansKipKur({ zorlama: false, kiraEk: { guncelleme: politika("ONAYLI", true) } });
  durumYaz();
  delete process.env[UPDATER_DIR_ENV];
  const yok = await hataOf(() => recordUpdateApproval({ userId: adminId, input: { clientToken: randomUUID(), surum: ADAY, zamanlama: "HEMEN" } }));
  process.env[UPDATER_DIR_ENV] = KOK;
  check("§3o güncelleyici yok → 409 (niyet yazılacak yer yok)", yok?.statusCode === 409 && /güncelleyici/.test(yok.message ?? ""));
}

async function belirtec(): Promise<void> {
  console.log("\n§4 indirme belirteci niyete");
  const anahtar = anahtarUret("ind-gnc-onay-1");
  const exp = msToIso(Date.now() + 60 * 60 * 1000);
  const tok = signDownloadToken({
    payload: { v: 1, kanal: "deneme-kanal", yolOneki: "/deneme-kanal/backend/", kurulumId: "3f0c2b1e-5a5d-4c1e-9d36-6f0c2b1e5a5d", exp },
    key: { kid: anahtar.kid, privateKey: anahtar.privateKey },
    nowMs: Date.now(),
  });
  setDownloadTokens([{ yolOneki: "/deneme-kanal/mobil/", belirtec: "baska.urun.belirteci" }, { yolOneki: "/deneme-kanal/backend/", belirtec: tok }]);
  const r = await refreshUpdaterIntent();
  const n = niyetOku();
  check("§4a ⭐ yoklamanın backend/ belirteci niyete (ürün öneki seçilir, bitiş = exp)", r.kind === "ok" && n?.indirme?.belirtec === tok && n.indirme.bitis === exp);
  setDownloadTokens([]);
  await refreshUpdaterIntent();
  check("§4b yeniden başlatma (bellekte belirteç yok): niyetteki TAZE belirteç korunur", niyetOku()?.indirme?.belirtec === tok);
  const eski = niyetOku()!;
  fs.writeFileSync(NIYET, JSON.stringify({ ...eski, indirme: { belirtec: tok, bitis: msToIso(Date.now() - 1000) } }));
  await refreshUpdaterIntent();
  check("§4c süresi geçmiş belirteç korunmaz", niyetOku()?.indirme === null);
  process.env[VERIFICATION_MODE_ENV] = "1";
  const dogrulama = await refreshUpdaterIntent();
  delete process.env[VERIFICATION_MODE_ENV];
  check("§4d doğrulama kipinde niyet YAZILMAZ", dogrulama.kind === "skipped");
}

async function http(): Promise<void> {
  console.log("\n§5 HTTP (süreç içi, 127.0.0.1)");
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const bcrypt = await import("bcryptjs");
  const parola = kosumaOzguParola();
  const kullanici = async (ek: string, kodlar: string[]): Promise<string> => {
    const izinler = await prisma.permission.findMany({ where: { code: { in: kodlar } }, select: { id: true } });
    const u = await prisma.user.create({
      data: {
        username: `${TAG}-${ek}`,
        passwordHash: await bcrypt.hash(parola, 10),
        fullName: `${TAG} ${ek}`,
        isActive: true,
        permissions: { create: izinler.map((p) => ({ permissionId: p.id })) },
      },
      select: { id: true, username: true },
    });
    olusan.userIds.push(u.id);
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u.username, password: parola, clientType: "electron" }),
    });
    return (((await r.json()) as { data?: { token?: string } }).data?.token ?? "") as string;
  };
  const cagir = async (token: string, body: unknown) => {
    const r = await fetch(`${base}/api/guncelleme/onay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as { data?: { kayitId?: string; durum?: { onay?: { onayId?: string } } } } };
  };
  const izleyici = await kullanici("izleyici", ["license:view"]);
  const yonetici = await kullanici("yonetici", ["license:manage"]);
  check("§5a iki kullanıcı giriş yaptı", izleyici.length > 0 && yonetici.length > 0);
  const gorur = await fetch(`${base}/api/guncelleme/durum`, { headers: { Authorization: `Bearer ${izleyici}` } });
  check("§5b license:view durumu GÖRÜR (200)", gorur.status === 200);
  const say = await prisma.updateApproval.count();
  const izinsiz = await cagir(izleyici, { clientToken: randomUUID(), surum: ADAY, zamanlama: "HEMEN" });
  check("§5c ⭐ license:manage yok → 403, satır yok", izinsiz.status === 403 && (await prisma.updateApproval.count()) === say);
  const enjeksiyon = await cagir(yonetici, { clientToken: randomUUID(), surum: ADAY, zamanlama: "HEMEN", komut: "powershell -c calc", yol: "C:\\x" });
  check("§5d ⭐ enjeksiyonlu gövde → 400, satır yok", enjeksiyon.status === 400 && (await prisma.updateApproval.count()) === say);
  const token = randomUUID();
  const ok = await cagir(yonetici, { clientToken: token, surum: ADAY, zamanlama: "HEMEN" });
  check("§5e license:manage → 201 + güncel durum (onay yürürlükte)", ok.status === 201 && ok.body.data?.durum?.onay?.onayId === ok.body.data?.kayitId);
  const tekrar = await cagir(yonetici, { clientToken: token, surum: ADAY, zamanlama: "HEMEN" });
  check("§5f ⭐ tekrar oynatma HTTP'de de aynı kayıt", tekrar.status === 201 && tekrar.body.data?.kayitId === ok.body.data?.kayitId);

  const yerel = await fetch(`${base}/health/yerel`);
  const yb = (await yerel.json()) as Record<string, unknown>;
  check("§5g /health/yerel döngü adresine 200 (status · db · version); motor ölçmeden lisans YOK", yerel.status === 200 && yb.status === "UP" && yb.db === "UP" && typeof yb.version === "string" && !("lisans" in yb));
  setLicenseEngineStatus("CALISIYOR");
  const olcum = (await (await fetch(`${base}/health/yerel`)).json()) as { lisans?: Record<string, unknown> };
  check("§5h ⭐ motor ölçünce lisans{kip,butunluk,cekirdek}", JSON.stringify(Object.keys(olcum.lisans ?? {}).sort()) === JSON.stringify(["butunluk", "cekirdek", "kip"]), JSON.stringify(olcum.lisans));
  const vekil = await fetch(`${base}/health/yerel`, { headers: { "X-Forwarded-For": "192.168.1.50" } });
  check("§5i ⭐ vekil başlıklı istek (döngüden gelse de) → 404", vekil.status === 404);
  const pub = (await (await fetch(`${base}/health`)).json()) as Record<string, unknown>;
  check("§5j ⭐ public /health lisans TAŞIMAZ (donmuş küme)", !("lisans" in pub) && pub.status === "UP");
}

const adim = async (ad: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (err) {
    console.log(`  ⚠️ temizlik (${ad}): ${err instanceof Error ? err.message : String(err)}`);
  }
};

/** Bir kullanıcı kümesinin bu bekçide doğan her şeyi: onaylar (ve ayak izleri), oturum, log, izin, kullanıcı. */
async function temizleKullanicilar(userIds: readonly string[]): Promise<void> {
  if (userIds.length === 0) return;
  const onaylar = (await prisma.updateApproval.findMany({ where: { approvedById: { in: [...userIds] } }, select: { id: true } })).map((o) => o.id);
  await adim("onay logları", () => prisma.systemLog.deleteMany({ where: { tableName: "UPDATE_APPROVAL", recordId: { in: onaylar } } }));
  await adim("onaylar", () => prisma.updateApproval.deleteMany({ where: { approvedById: { in: [...userIds] } } }));
  for (const id of userIds) {
    await adim("oturum", () => prisma.session.deleteMany({ where: { userId: id } }));
    await adim("kullanıcı logları", () => prisma.systemLog.deleteMany({ where: { userId: id } }));
    await adim("kullanıcı izinleri", () => prisma.userPermission.deleteMany({ where: { userId: id } }));
    await adim("kullanıcı", () => prisma.user.delete({ where: { id } }));
  }
}

/** Yarıda kalmış önceki koşumun kullanıcıları (ad öneki) — "yürürlükteki onay" tabloda EN SON satırdır. */
async function temizleOncekiKosum(): Promise<void> {
  const eski = await prisma.user.findMany({ where: { username: { startsWith: "gnc-onay-" } }, select: { id: true } });
  await temizleKullanicilar(eski.map((u) => u.id));
}

async function temizlik(): Promise<void> {
  if (server) await adim("sunucu", () => new Promise<void>((r, j) => server!.close((e) => (e ? j(e) : r()))));
  await temizleKullanicilar(olusan.userIds);
  delete process.env[UPDATER_DIR_ENV];
  fs.rmSync(KOK, { recursive: true, force: true });
  temizleLisansKipDizini();
}

async function main(): Promise<void> {
  console.log("=== BACKEND GÜNCELLEME ONAYI + NİYET ===");
  await temizleOncekiKosum();
  // Servis yolunun onaylayanı bekçinin KENDİ kullanıcısı: doğan her onay satırı teardown'da ona bağlıdır.
  const onaylayan = await prisma.user.create({
    data: { username: `${TAG}-onaylayan`, passwordHash: "-", fullName: "Ayşe\nYılmaz", isActive: true },
    select: { id: true },
  });
  olusan.userIds.push(onaylayan.id);
  fs.mkdirSync(path.join(KOK, "niyet"), { recursive: true });
  durumYaz();
  process.env[UPDATER_DIR_ENV] = KOK;
  lisansKipKur({ zorlama: false, kiraEk: { guncelleme: politika("ONAYLI", true) } });
  govde();
  await niyetBelgesi();
  await servis(onaylayan.id);
  await belirtec();
  await http();
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e instanceof Error ? e.stack : e);
    fail++;
  })
  .finally(async () => {
    await temizlik();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
