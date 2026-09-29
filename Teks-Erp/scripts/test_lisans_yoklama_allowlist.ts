// =============================================================================
// BEKÇİ — LİSANS YOKLAMASI ALLOWLIST: gövdede beyan dışı anahtar YOK, iş/kişisel veri YOK
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts lisans_yoklama_allowlist   (kendi _test DB'si)
//
// NE ÖLÇER: fabrikanın satıcıya giden yoklama gövdesini GERÇEK kurucudan (`buildPollBody`)
// üretir ve ① her iç içe anahtarı aşağıdaki BEYAN kümesine karşı tarar (şema genişlerse de
// bu küme kilitlidir — iki anahtarlı kapı), ② gövdeyi KATI protokol şemasından geçirir,
// ③ DB'deki kullanıcı/müşteri adlarını, bağlı istemcinin kurulum/kullanıcı kimliğini, iş
// hatasının ham metnini, dosya adını, makine adını ve DB adını gövdede ARAR (hiçbiri olmamalı).
// Sözleşme: kullanıcı kararı "yoklama asgari + sağlık özeti; iş/kişisel veri ASLA".
//
// NEGATİF SONDA — dosya DIŞI mutasyon (cp + shasum ile birebir geri alındı; sonuçlar commit
// mesajında): A1 sağlık özetine ham audit hata metni alanı eklendi · A2 istemci dağılımına
// kurulum kimliği eklendi · A3 iş hatası dağılımına hata mesajı eklendi.
// =============================================================================
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createPublicKey, randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuditService } from "../src/services/audit.service";
import { ensureInstallationIdentity } from "../src/jobs/installation-identity.job";
import { reportJobFailure } from "../src/jobs/job-failure";
import { touchClient } from "../src/lib/client-registry";
import { loadLicenseStoreSync } from "../src/lib/license/store";
import { configureLicenseRuntimeForTests, setLicenseDbFacts, setMeasuredFingerprint } from "../src/lib/license/runtime";
import { PollRequestSchema, type Fingerprint } from "../src/lib/license/protocol";
import { acceptLicenseResponse, buildPollBody } from "../src/services/license-sync.service";
import { fiksturKur, hakBas, kiraBas, type Fikstur } from "./lib/lisans-fikstur";

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

(AuditService as unknown as { logEvent: () => Promise<void> }).logEvent = async () => undefined;

/** BEYAN: gövdede geçebilecek anahtarların TAMAMI (her derinlikte). Genişletmek bir karardır. */
const IZINLI_ANAHTARLAR = new Set([
  "v", "sonKiraId", "hak", "hakId", "surum", "parmakIzi", "f1", "f2", "f3", "f4", "f5",
  "durum", "gecerlilik", "nedenler", "kip", "hesaplananKademe", "uygulananKademe",
  "saat", "duvar", "guvenilir", "bulgu",
  "ortam", "platform", "mimari", "isletimSistemi", "nodeSurum", "uygulamaSurum", "derlemeTarihi", "konteyner",
  "saglik", "calismaSn", "dbBoyutBayt", "yedek", "hukum", "yasSaat", "offsite", "yapilandirildi", "ok", "eksikSayisi",
  "diskDolulukYuzde", "auditYazmaHatasi", "havuzZamanAsimi", "istemciler", "tur", "adet", "isHatalari", "is",
  "gozlem", "reddedilecekIstek", "reddedilecekModul",
]);

function anahtarlar(deger: unknown, yol: string, out: string[]): string[] {
  if (Array.isArray(deger)) deger.forEach((d, i) => anahtarlar(d, `${yol}[${i}]`, out));
  else if (deger && typeof deger === "object") {
    for (const [k, v] of Object.entries(deger)) {
      out.push(`${yol}.${k}`);
      anahtarlar(v, `${yol}.${k}`, out);
    }
  }
  return out;
}

const DIZIN = fs.mkdtempSync(path.join(os.tmpdir(), "lisans-allowlist-"));

async function hazirla(): Promise<{ f: Fikstur; ornekler: { istemci: string; kullanici: string; hataMetni: string } }> {
  const dizin = DIZIN;
  const key = loadLicenseStoreSync({ dir: dizin }).key;
  if (!key) throw new Error("depo anahtarı yok");
  const kimlik = await ensureInstallationIdentity();
  const f0 = fiksturKur(Date.now());
  const f: Fikstur = { ...f0, kurulumId: kimlik.installationId, kurulum: { kid: key.kid, x: key.x, privateKey: key.privateKey, acik: createPublicKey(key.privateKey) } };
  configureLicenseRuntimeForTests({ roots: f.kokler, vendorUrl: null });
  setLicenseDbFacts({ installationId: kimlik.installationId, firstOpenMs: Date.now() - 86_400_000, ledgerHighWaterMs: null });
  setMeasuredFingerprint({ digest: f.parmakIzi as Fingerprint, measured: { f1: true, f2: true, f3: true, f4: true, f5: true }, measuredAt: new Date().toISOString() });
  await acceptLicenseResponse({ v: 1, hak: hakBas(f), kira: kiraBas(f, { zorlama: false }), indirmeBelirtecleri: [], sunucuSaati: new Date().toISOString() }, "cevrimdisi");
  const ornekler = { istemci: `TEST-kurulum-${randomUUID()}`, kullanici: randomUUID(), hataMetni: "GIZLI-HATA-METNI C:\\gizli\\yol\\tekserp_20260929.dump" };
  touchClient({ instanceId: ornekler.istemci, kind: "electron", version: "1.2.3", userId: ornekler.kullanici });
  touchClient({ instanceId: `${ornekler.istemci}-2`, kind: "mobil", version: null, userId: null });
  reportJobFailure("lisans-bekci-is", new Error(ornekler.hataMetni));
  return { f, ornekler };
}

async function main(): Promise<void> {
  try {
    const { ornekler } = await hazirla();
    const govde = await buildPollBody();
    const metin = JSON.stringify(govde);

    console.log("\n§1 — beyan edilmiş anahtar kümesi (her derinlik)");
    const tumu = anahtarlar(govde, "", []);
    const disarda = tumu.filter((y) => !IZINLI_ANAHTARLAR.has(y.split(".").pop()?.replace(/\[\d+\]$/, "") ?? ""));
    check("§1a körlük zemini: gövde dolu (≥ 40 anahtar yolu)", tumu.length >= 40, `${tumu.length}`);
    check("§1b ⭐ beyan DIŞI anahtar YOK", disarda.length === 0, disarda.join(", "));
    check("§1c ⭐ gövde KATI protokol şemasından geçer", PollRequestSchema.safeParse(govde).success);

    console.log("\n§2 — iş/kişisel veri taraması");
    const kullanicilar = await prisma.user.findMany({ select: { username: true, fullName: true }, take: 200 });
    const cariler = await prisma.customer.findMany({ select: { name: true }, take: 200 });
    const adlar = [...kullanicilar.flatMap((u) => [u.username, u.fullName]), ...cariler.map((c) => c.name)]
      .filter((a): a is string => typeof a === "string" && a.length >= 4);
    check("§2a körlük zemini: taranacak kullanıcı/cari adı var", adlar.length >= 2, `${adlar.length}`);
    const sizan = adlar.filter((a) => metin.includes(a));
    check("§2b ⭐ kullanıcı ve cari adları gövdede YOK", sizan.length === 0, sizan.slice(0, 5).join(", "));
    const dbAdi = new URL(process.env.DATABASE_URL ?? "postgresql://x/y").pathname.replace(/^\//, "");
    const yasakli: Array<[string, string]> = [
      ["bağlı istemcinin kurulum kimliği", ornekler.istemci],
      ["bağlı istemcinin kullanıcı kimliği", ornekler.kullanici],
      ["iş hatasının ham metni", "GIZLI-HATA-METNI"],
      ["dosya adı / yol", ".dump"],
      ["makine adı", os.hostname()],
      ["veritabanı adı", dbAdi],
    ];
    for (const [ad, deger] of yasakli) check(`§2c ⭐ gövdede ${ad} YOK`, deger.length > 0 && !metin.includes(deger));

    console.log("\n§3 — sayılar gider, metin gitmez");
    const s = govde.saglik;
    check("§3a istemci dağılımı yalnız tür × sürüm SAYISI", s.istemciler.some((i) => i.tur === "panel" && i.surum === "1.2.3" && i.adet >= 1) && s.istemciler.some((i) => i.tur === "tablet" && i.surum === "0.0.0"));
    check("§3b iş hatası yalnız iş kodu + sayı", s.isHatalari.some((h) => h.is === "lisans-bekci-is" && h.adet >= 1));
    const ekli = { ...govde, saglik: { ...s, hataMetni: "x" } };
    const ekliIstemci = { ...govde, saglik: { ...s, istemciler: [{ tur: "panel", surum: "1.0.0", adet: 1, kullanici: "ali" }] } };
    check("§3c karşı: şemaya metin alanı eklenemez (KATI RED)", !PollRequestSchema.safeParse(ekli).success && !PollRequestSchema.safeParse(ekliIstemci).success);
  } catch (e) {
    fail++;
    console.log(`❌ beklenmeyen hata — ${e instanceof Error ? e.stack : String(e)}`);
  } finally {
    fs.rmSync(DIZIN, { recursive: true, force: true });
    await prisma.$disconnect();
    await pool.end();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
