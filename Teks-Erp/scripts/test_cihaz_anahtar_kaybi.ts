/**
 * Bekçi: kısa kimlik anahtar halkası KAYBI (izlenebilirlik D5 · K-C5) — sessiz üretim yok; kanıtı
 * doğrulanamayan cihazlar kayıt kayıt seçilip yeniden bağlanır, yeni sır yalnız aynı donanıma.
 *   §1 iz yok (ilk kurulum) → üretim, audit/sağlık YOK · §2 iz var → üretim + halkaKaybi + audit 1
 *   §3 sağlık/bildirim kaynağı aynı hüküm; HALKA sayacı · §4 proof-lost listesi + YAZMAZ
 *   §5 proof-reset kayıt kayıt + defter PROOF_RESET beklenenHw · §6 replay → ATLANDI, defter değişmez
 *   §7 aynı hw → sır; status → sır yok; hw yok / farklı hw → PENDING + REVOKED, sır yok
 *   §8 emanetten dönen anahtar (addKeyToRing) kaybı kapatır · §9 izin/doğrulama
 * Gerçek HTTP: app aynı süreçte 127.0.0.1:<boş port>. Halka geçici dizinde. Yalnız `_test` DB.
 * Koşum: `cd Teks-Erp && npx tsx scripts/run-all-tests.ts test_cihaz_anahtar_kaybi`
 *
 * Negatif sondalar (2026-10-26, md5 ile geri alındı):
 *   N1 `noteRingLossOnBoot`ta audit yazımı kaldırıldı              ⇒ 3 ❌ (§2b §2c §2d; 32/3)
 *   N2 `status()`ta `halkaKaybi` null'a sabitlendi                  ⇒ 1 ❌ (§3a; 34/1)
 *   N3 `gateOnAnnounce`ta hw eşitliği kaldırıldı (her hw GECTI)     ⇒ 1 ❌ (§7e; 34/1)
 */
import prisma from "../src/lib/prisma"; // İLK import: dotenv → DATABASE_URL
import http from "node:http";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AuthService } from "../src/services/auth.service";
import { ShortCredentialService } from "../src/services/short-credential.service";
import {
  addKeyToRing, getShortCredentialKeyRing, kidOf, ringGeneratedThisProcessAt, setShortCredentialKeyDirForTests,
  SHORT_CREDENTIAL_KEY_FILE,
} from "../src/lib/short-credential/keyring";
import {
  evaluateRingLoss, halkaVerdictStats, noteRingLossOnBoot, resetRingLossStateForTests,
} from "../src/lib/short-credential/ring-footprint";
import { deriveDeviceSecret } from "../src/lib/device-proof";
import { ringLossSubjects } from "../src/services/notification-sources/cihaz";
import { fixtureHedefEngeli } from "./lib/hedef-db-kapisi";
import { INSTALL_CLASS_ENV } from "../src/services/helpers/install-class.helper";

let gecti = 0;
let kaldi = 0;
function check(etiket: string, ok: boolean, ayrinti = ""): void {
  if (ok) gecti++;
  else kaldi++;
  console.log(`${ok ? "✅" : "❌"} ${etiket}${ayrinti ? ` — ${ayrinti}` : ""}`);
}

type Cevap = { status: number; body: Record<string, unknown> };
function istek(port: number, method: string, yol: string, govde: unknown, basliklar: Record<string, string> = {}): Promise<Cevap> {
  const veri = govde === undefined ? "" : JSON.stringify(govde);
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: "127.0.0.1", port, path: yol, method,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(veri), ...basliklar } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          let j: Record<string, unknown> = {};
          try { j = JSON.parse(b); } catch { /* düz metin */ }
          resolve({ status: res.statusCode ?? 0, body: j });
        });
      },
    );
    r.on("error", reject);
    if (veri) r.write(veri);
    r.end();
  });
}
const kod = (c: Cevap): string => String((c.body.details as { code?: string } | undefined)?.code ?? "");
const data = <T = Record<string, unknown>>(c: Cevap): T => ((c.body.data as T | undefined) ?? ({} as T));
const hex = (n: number) => randomBytes(n).toString("hex");
const hw = (o: string) => ({ v: 1, kaynak: "ANDROID_ID", ozet: o });
const kayipOlayi = () => prisma.systemLog.count({ where: { action: "SHORT_CREDENTIAL_RING_LOST" } });

async function main(): Promise<void> {
  const engel = fixtureHedefEngeli();
  if (engel) {
    console.error(`HEDEF RED: ${engel}`);
    process.exit(2);
  }
  delete process.env[INSTALL_CLASS_ENV];
  delete process.env.RATE_LIMIT_ENABLED;

  // ─── §1 iz yok → ilk kurulum: üretim bugünkü gibi, audit/sağlık YOK ───
  const dir1 = mkdtempSync(join(tmpdir(), "anahtar-kaybi-1-"));
  setShortCredentialKeyDirForTests(dir1);
  resetRingLossStateForTests();
  const once1 = await kayipOlayi();
  const r1 = getShortCredentialKeyRing();
  check("§1a dosya yok → halka üretildi (ilk kurulum)", r1.ok && existsSync(join(dir1, SHORT_CREDENTIAL_KEY_FILE)));
  check("§1b üretim anı süreçte damgalı", ringGeneratedThisProcessAt() !== null);
  const dosya1 = r1.ok ? JSON.parse(readFileSync(join(dir1, SHORT_CREDENTIAL_KEY_FILE), "utf8")) as Record<string, unknown> : {};
  check("§1c dosya biçimi değişmedi (v, etkin, anahtarlar — ek alan yok)",
    JSON.stringify(Object.keys(dosya1)) === JSON.stringify(["v", "etkin", "anahtarlar"]));
  const bos = new Map();
  check("§1d iz yokken hüküm null", (await evaluateRingLoss(bos)) === null);
  check("§1e iz yokken boot notu audit YAZMAZ", (await noteRingLossOnBoot(bos)) === null && (await kayipOlayi()) === once1);

  // ─── fikstür: kayıp kid'li cihazlar (eski halka) + bu halkanın cihazı ───
  const { default: app } = await import("../src/app");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  const stamp = hex(4);
  const perm = await prisma.permission.findFirst({ where: { code: "admin:settings" }, select: { id: true } });
  if (!perm) throw new Error("admin:settings izin kaydı yok (seed eksik?)");
  const parola = `Ak-${hex(9)}`; // değer basılmaz
  const yonetici = await prisma.user.create({
    data: {
      username: `akb-yon-${stamp}`, fullName: "Anahtar kaybı bekçisi yönetici",
      passwordHash: await AuthService.hashPassword(parola), isActive: true,
      permissions: { create: [{ permissionId: perm.id }] },
    },
    select: { id: true, username: true },
  });
  // Panel kanalı izin ister (CHANNEL_DENIED): operatöre admin:settings DIŞI bir okuma izni.
  const okuma = await prisma.permission.findFirst({ where: { code: "order:read" }, select: { id: true } });
  if (!okuma) throw new Error("order:read izin kaydı yok (seed eksik?)");
  const operator = await prisma.user.create({
    data: {
      username: `akb-op-${stamp}`, fullName: "Anahtar kaybı bekçisi operatör", passwordHash: await AuthService.hashPassword(parola), isActive: true,
      permissions: { create: [{ permissionId: okuma.id }] },
    },
    select: { id: true, username: true },
  });
  const giris = await istek(port, "POST", "/api/auth/login", { username: yonetici.username, password: parola, clientType: "electron" });
  const yetki = { authorization: `Bearer ${String(data<{ token?: string }>(giris).token ?? "")}` };
  const opGiris = await istek(port, "POST", "/api/auth/login", { username: operator.username, password: parola, clientType: "electron" });
  const opYetki = { authorization: `Bearer ${String(data<{ token?: string }>(opGiris).token ?? "")}` };

  const eskiAnahtar = randomBytes(32); // emanette duran "kayıp" anahtar (§8 geri konur)
  const eskiKid = kidOf(eskiAnahtar);
  const ring = getShortCredentialKeyRing();
  if (!ring.ok) throw new Error("halka yok");
  const yaratilan: string[] = [];
  const cihaz = async (ad: string, kid: string, hwOzet: string | null) => {
    const row = await prisma.device.create({
      data: {
        deviceId: randomUUID(), name: `${ad} ${stamp}`, kind: "TABLET", status: "APPROVED", isActive: true,
        proofSalt: `${kid}:${hex(32)}`, proofIssuedAt: new Date(), proofConfirmedAt: new Date(),
        lastSeenAt: new Date(), hwDigest: hwOzet, hwSource: hwOzet ? "ANDROID_ID" : null,
      },
      select: { id: true, deviceId: true, name: true },
    });
    yaratilan.push(row.id);
    return row;
  };
  const H1 = hex(32), H2 = hex(32), H4 = hex(32);
  const d1 = await cihaz("AKB aynı donanım", eskiKid, H1);
  const d2 = await cihaz("AKB eski istemci", eskiKid, H2);
  const d3 = await cihaz("AKB sağlam", ring.ring.active.kid, hex(32));
  const d4 = await cihaz("AKB farklı donanım", eskiKid, H4);
  const d5 = await cihaz("AKB seçilmeyen", eskiKid, hex(32));

  try {
    // ─── §2 iz var → kayıp görünür ───
    resetRingLossStateForTests();
    const adimBasi = new Date(Date.now() - 1000); // bu adımın satırı (ortamdaki eski olaylar değil)
    const once2 = await kayipOlayi();
    const not = await noteRingLossOnBoot();
    check("§2a iz varken boot notu kaybı döner", not !== null && not.kayipKidler.includes(eskiKid), JSON.stringify(not?.kayipKidler.length));
    const olay = await prisma.systemLog.findFirst({
      where: { action: "SHORT_CREDENTIAL_RING_LOST", createdAt: { gte: adimBasi } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { category: true, newData: true },
    });
    check("§2b audit SYSTEM SHORT_CREDENTIAL_RING_LOST tam 1 satır", (await kayipOlayi()) === once2 + 1 && olay?.category === "SYSTEM");
    const yuk = JSON.stringify(olay?.newData ?? {});
    check("§2c audit yükü kid listesi taşır, anahtar içeriği TAŞIMAZ",
      yuk.includes(eskiKid) && !yuk.includes(eskiAnahtar.toString("base64url")) && !yuk.includes(ring.ring.active.key.toString("base64url")));
    check("§2d boot notu ikinci kez yazmaz", (await noteRingLossOnBoot()) === null && (await kayipOlayi()) === once2 + 1);

    // ─── §3 sağlık + bildirim kaynağı aynı hüküm; HALKA sayacı ───
    const st = await ShortCredentialService.status();
    check("§3a sağlık halkaKaybi dolu (kid + cihaz sayısı)",
      !!st.halkaKaybi && st.halkaKaybi.kayipKidler.includes(eskiKid) && st.halkaKaybi.etkilenen.cihazKaniti >= 4);
    const konular = await ringLossSubjects();
    check("§3b bildirim koşulu `cihaz.halka-kaybi` tek konu (halka)", konular.length === 1 && konular[0]!.key === "halka");
    const sayac0 = halkaVerdictStats().sayi;
    await istek(port, "GET", "/api/auth/me", undefined, { "x-device-id": d2.deviceId });
    check("§3c kid'i halkada olmayan cihazın isteği HALKA sayacını artırır", halkaVerdictStats().sayi === sayac0 + 1);

    // ─── §4 proof-lost listesi (YAZMAZ) ───
    const defter0 = await prisma.deviceBindingEvent.count({ where: { deviceRefId: { in: yaratilan } } });
    const dam0 = await prisma.device.findMany({ where: { id: { in: yaratilan } }, select: { id: true, updatedAt: true, proofSalt: true }, orderBy: { id: "asc" } });
    const liste = await istek(port, "GET", "/api/admin/devices/proof-lost", undefined, yetki);
    const cihazlar = data<{ cihazlar?: Array<{ id: string; hasHw: boolean; kid: string }> }>(liste).cihazlar ?? [];
    const ids = new Set(cihazlar.map((c) => c.id));
    check("§4a liste 200 + kayıp kid'li dört cihaz", liste.status === 200 && [d1, d2, d4, d5].every((d) => ids.has(d.id)), `HTTP ${liste.status}`);
    check("§4b halkadaki kid'li cihaz listede YOK", !ids.has(d3.id));
    check("§4c satır `proofSalt` sızdırmaz (yalnız kid)", !JSON.stringify(liste.body).includes("proofSalt") && cihazlar.find((c) => c.id === d1.id)?.kid === eskiKid);
    const dam1 = await prisma.device.findMany({ where: { id: { in: yaratilan } }, select: { id: true, updatedAt: true, proofSalt: true }, orderBy: { id: "asc" } });
    check("§4d liste YAZMAZ (defter + cihaz satırı aynı)",
      (await prisma.deviceBindingEvent.count({ where: { deviceRefId: { in: yaratilan } } })) === defter0 && JSON.stringify(dam0) === JSON.stringify(dam1));

    // ─── §5 kayıt kayıt sıfırlama ───
    const sifirla = (deviceIds: string[]) => istek(port, "POST", "/api/admin/devices/proof-reset", { deviceIds }, yetki);
    const s1 = await sifirla([d1.id, d2.id, d3.id, d4.id]);
    const sonuc = new Map((data<{ sonuclar?: Array<{ id: string; sonuc: string; neden?: string }> }>(s1).sonuclar ?? []).map((x) => [x.id, x]));
    check("§5a seçilen kayıp cihazlar SIFIRLANDI", s1.status === 200 && [d1, d2, d4].every((d) => sonuc.get(d.id)?.sonuc === "SIFIRLANDI"), `HTTP ${s1.status}`);
    check("§5b halkadaki cihaz ATLANDI (HALKADA)", sonuc.get(d3.id)?.sonuc === "ATLANDI" && sonuc.get(d3.id)?.neden === "HALKADA");
    const d5Sonra = await prisma.device.findUnique({ where: { id: d5.id }, select: { proofSalt: true } });
    check("§5c seçilmeyen cihaza dokunulmadı", d5Sonra?.proofSalt === dam0.find((x) => x.id === d5.id)?.proofSalt);
    const ev1 = await prisma.deviceBindingEvent.findFirst({ where: { deviceRefId: d1.id, event: "PROOF_RESET" }, select: { meta: true, actorId: true } });
    check("§5d defter PROOF_RESET meta.beklenenHw = hwDigest, aktör yönetici",
      (ev1?.meta as { beklenenHw?: string } | null)?.beklenenHw === H1 && ev1?.actorId === yonetici.id);
    const d1Satir = await prisma.device.findUnique({ where: { id: d1.id }, select: { proofSalt: true, proofConfirmedAt: true, status: true } });
    check("§5e kanıt alanları null, durum APPROVED kalır", d1Satir?.proofSalt === null && d1Satir.proofConfirmedAt === null && d1Satir.status === "APPROVED");
    const audit = await prisma.systemLog.count({ where: { tableName: "devices", recordId: d1.id, newData: { path: ["event"], equals: "PROOF_RESET" } } });
    check("§5f audit devices PROOF_RESET yazıldı", audit === 1, `${audit}`);

    // ─── §6 replay ───
    const defterR = await prisma.deviceBindingEvent.count({ where: { deviceRefId: { in: yaratilan }, event: "PROOF_RESET" } });
    const s2 = await sifirla([d1.id, d2.id, d4.id]);
    const tekrar = data<{ sonuclar?: Array<{ sonuc: string; neden?: string }> }>(s2).sonuclar ?? [];
    check("§6a replay → hepsi ATLANDI (KANIT_YOK)", s2.status === 200 && tekrar.length === 3 && tekrar.every((x) => x.sonuc === "ATLANDI" && x.neden === "KANIT_YOK"));
    check("§6b replay ikinci defter satırı yazmaz",
      (await prisma.deviceBindingEvent.count({ where: { deviceRefId: { in: yaratilan }, event: "PROOF_RESET" } })) === defterR);

    // ─── §7 donanım kapısı ───
    const durum = await istek(port, "GET", "/api/devices/status", undefined, { "x-device-id": d1.deviceId });
    check("§7a status (hw yok) sır VERMEZ, durum korunur", durum.status === 200 && data(durum).deviceSecret === undefined && data(durum).status === "APPROVED");
    const a1 = await istek(port, "POST", "/api/devices/announce", { deviceId: d1.deviceId, hw: hw(H1) });
    const sir = String(data(a1).deviceSecret ?? "");
    const tuz = (await prisma.device.findUnique({ where: { id: d1.id }, select: { proofSalt: true } }))?.proofSalt ?? "";
    check("§7b aynı localId + aynı hw → yeni sır (etkin halka kid'i)",
      a1.status === 200 && sir.length === 64 && tuz.startsWith(`${ring.ring.active.kid}:`) && deriveDeviceSecret(ring.ring, d1.deviceId, tuz) === sir);
    const a2 = await istek(port, "POST", "/api/devices/announce", { deviceId: d2.deviceId });
    const d2Satir = await prisma.device.findUnique({ where: { id: d2.id }, select: { status: true, proofSalt: true } });
    check("§7c hw göndermeyen (eski istemci) → sır yok, PENDING (yönetici onayı)",
      a2.status === 200 && data(a2).deviceSecret === undefined && d2Satir?.status === "PENDING" && d2Satir.proofSalt === null);
    const ev2 = await prisma.deviceBindingEvent.findFirst({
      where: { deviceRefId: d2.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { event: true, meta: true },
    });
    check("§7d defter REVOKED (neden PROOF_RESET_HW)", ev2?.event === "REVOKED" && (ev2.meta as { neden?: string } | null)?.neden === "PROOF_RESET_HW");
    const a4 = await istek(port, "POST", "/api/devices/announce", { deviceId: d4.deviceId, hw: hw(hex(32)) });
    const d4Satir = await prisma.device.findUnique({ where: { id: d4.id }, select: { status: true, proofSalt: true } });
    check("§7e farklı hw → sır yok, PENDING", a4.status === 200 && data(a4).deviceSecret === undefined && d4Satir?.status === "PENDING" && d4Satir.proofSalt === null);

    // ─── §8 emanetten dönen anahtar kaybı kapatır ───
    check("§8a geri yüklemeden önce eski kid kayıp", ((await evaluateRingLoss())?.kayipKidler ?? []).includes(eskiKid));
    addKeyToRing(eskiAnahtar);
    const sonra = await evaluateRingLoss();
    check("§8b addKeyToRing sonrası eski kid kayıp DEĞİL", !(sonra?.kayipKidler ?? []).includes(eskiKid));
    const liste2 = await istek(port, "GET", "/api/admin/devices/proof-lost", undefined, yetki);
    const ids2 = new Set((data<{ cihazlar?: Array<{ id: string }> }>(liste2).cihazlar ?? []).map((c) => c.id));
    check("§8c seçilmeyen cihaz kendiliğinden listeden çıktı (emanet yolu)", liste2.status === 200 && !ids2.has(d5.id));

    // ─── §9 izin + doğrulama ───
    const izinsiz = await istek(port, "GET", "/api/admin/devices/proof-lost", undefined, {});
    check("§9a tokensız 401", izinsiz.status === 401, `HTTP ${izinsiz.status}`);
    const yetkisiz = await istek(port, "POST", "/api/admin/devices/proof-reset", { deviceIds: [d5.id] }, opYetki);
    check("§9b admin:settings'siz 403", yetkisiz.status === 403, `HTTP ${yetkisiz.status} ${kod(yetkisiz)}`);
    const bosSecim = await istek(port, "POST", "/api/admin/devices/proof-reset", { deviceIds: [] }, yetki);
    check("§9c boş seçim 400 (Türkçe mesaj)", bosSecim.status === 400);
  } finally {
    // Defter satırları KALIR (append-only); fikstür cihazları pasife, kullanıcılar pasife.
    await prisma.device.updateMany({ where: { id: { in: yaratilan } }, data: { isActive: false, proofSalt: null } });
    await prisma.user.updateMany({ where: { id: { in: [yonetici.id, operator.id] } }, data: { isActive: false } });
    setShortCredentialKeyDirForTests(null);
    await new Promise<void>((r) => server.close(() => r()));
  }

  console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
  await prisma.$disconnect();
  process.exit(kaldi === 0 ? 0 : 1);
}

if (require.main === module) {
  main().catch(async (e: unknown) => {
    console.error(e instanceof Prisma.PrismaClientKnownRequestError ? `${e.code} ${e.message}` : e);
    await prisma.$disconnect();
    process.exit(1);
  });
}
