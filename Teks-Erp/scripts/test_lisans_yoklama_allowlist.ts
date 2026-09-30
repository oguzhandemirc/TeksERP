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
// kurulum kimliği eklendi · A3 iş hatası dağılımına hata mesajı eklendi · (F1a) A4 ortamdan DB
// kimliği düştü (§1d) · A5 yoklamadan satıcı saati sapması düştü (§1d) · (3d-2) A6 kurulum kaydı şeması
// gevşetildi (`looseObject`): dosya yolu taşıyan satır gövdeye girdi → §1b · §2c · §4a/b/c kırmızı (5).
// (Dağıtım v2) §5 güncelleme raporu: güncelleyicinin durum/geçmiş dosyası taklit edilir; rapor beyanlı
// anahtarlarla gider, güncelleyicinin serbest iletisi ve onaylayanın adı GİTMEZ, dosya yoksa alan yok.
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
import { configureLicenseRuntimeForTests, recordVendorClockSkew, setLicenseDbFacts, setMeasuredFingerprint } from "../src/lib/license/runtime";
import { INSTALL_HISTORY_FILE_NAME, PollRequestSchema, type Fingerprint } from "../src/lib/license/protocol";
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

AuditService.logEvent = async () => undefined;

/** BEYAN: gövdede geçebilecek anahtarların TAMAMI (her derinlikte). Genişletmek bir karardır. */
const IZINLI_ANAHTARLAR = new Set([
  "v", "sonKiraId", "hak", "hakId", "surum", "parmakIzi", "f1", "f2", "f3", "f4", "f5",
  // Faz 2d: kurulumun X25519 AÇIK anahtarı (modül anahtarlarının alıcısı) — sır değil, iş verisi değil.
  "sifrelemeAnahtari",
  "durum", "gecerlilik", "nedenler", "kip", "hesaplananKademe", "uygulananKademe",
  "saat", "duvar", "guvenilir", "bulgu", "saticiSapmaSn",
  "ortam", "platform", "mimari", "isletimSistemi", "nodeSurum", "uygulamaSurum", "derlemeTarihi", "konteyner", "installationId",
  "saglik", "calismaSn", "dbBoyutBayt", "yedek", "hukum", "yasSaat", "offsite", "yapilandirildi", "ok", "eksikSayisi",
  "diskDolulukYuzde", "auditYazmaHatasi", "havuzZamanAsimi", "istemciler", "tur", "adet", "isHatalari", "is",
  "gozlem", "reddedilecekIstek", "reddedilecekModul",
  "kurulumKayitlari", "kayitId", "tarih", "commit", "paketOzeti", "oncekiSurum", "yeniSurum", "migrationSayisi",
  "yeniMigrationSayisi", "geriDonus", "damga", "kod", "veri", "veriSifreli",
  // Dağıtım v2 güncelleme raporu (GUNCELLEYICI.md §3.1): dilim · güncelleyici durumu · bekleyen karar · son sonuç.
  "guncelleme", "saatDilimi", "guncelleyici", "bekleyen", "karar", "neden", "son", "hedefSurum", "kaynakSurum",
  "sonuc", "baslangic", "bitis", "veriGeriYuklendi",
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

// Kurulum kökü taklidi: lisans dizini + yanında kur.ps1'in kurulum geçmişi dosyası.
const KOK = fs.mkdtempSync(path.join(os.tmpdir(), "lisans-allowlist-"));
const DIZIN = path.join(KOK, "lisans");
const GECMIS = path.join(KOK, INSTALL_HISTORY_FILE_NAME);
const KAYIT_A = randomUUID();
const KAYIT_B = randomUUID();
function kayit(kayitId: string, ek: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kayitId, tur: "KURULUM", tarih: "2026-09-29T21:30:00Z", commit: "1234567", paketOzeti: "a".repeat(64),
    oncekiSurum: "2.11.1", yeniSurum: "2.11.2", migrationSayisi: 365, yeniMigrationSayisi: 16,
    geriDonus: { damga: "20260929_213000", kod: true, veri: true, veriSifreli: true }, ...ek,
  });
}
// Güncelleyicinin durum dizini taklidi (D2 §5): serbest ileti ve onaylayan adı dosyada VAR, gövdede olmamalı.
const GUNCELLEYICI = path.join(KOK, "guncelleme");
const ISLEM = randomUUID();
fs.mkdirSync(path.join(GUNCELLEYICI, "durum"), { recursive: true });
fs.writeFileSync(path.join(GUNCELLEYICI, "durum", "durum.json"), JSON.stringify({
  v: 1, durum: "HAZIR", urun: "backend", surum: "2.15.0", kaynakSurum: "2.14.0", kuruluSurum: "2.14.0", adim: null, hataKodu: null,
  mesaj: "GIZLI-GUNCELLEYICI-ILETISI C:\\TeksERP\\surumler", niyetId: "n1", islemId: null, ilerleme: null, planlanan: null,
  politika: { kip: "ONAYLI", izin: true, neden: null }, guncelleyiciSurum: "0.1.0", zaman: "2026-09-30T20:07:12.000Z",
}));
fs.writeFileSync(path.join(GUNCELLEYICI, "durum", "gecmis.jsonl"), JSON.stringify({
  v: 1, islemId: ISLEM, niyetId: "n0", urun: "backend", kaynakSurum: "2.13.1", surum: "2.14.0", sonuc: "GERI_DONDU", hataKodu: "SAGLIK_ZAMAN_ASIMI",
  basladi: "2026-09-29T23:00:00.000Z", bitti: "2026-09-29T23:20:00.000Z", gocSayisi: { once: 380, sonra: 384 }, yedek: ISLEM,
  onay: { kullaniciId: randomUUID(), ad: "Onaylayan-Kisi-Adi", zaman: "2026-09-29T22:58:00Z", planlanan: null },
}) + "\n");
process.env.TEKSERP_GUNCELLEME_DIZINI = GUNCELLEYICI;
// BOM + bozuk satır + allowlist dışı alanlı satır (dosya adı taşıyor) + aynı kaydın ikinci hâli.
fs.writeFileSync(GECMIS, [
  "\uFEFF" + kayit(KAYIT_A, { yeniSurum: "2.11.0" }), "{bozuk", kayit(randomUUID(), { yol: "C:\\TeksERP\\premigrate_x.dump" }),
  kayit(KAYIT_B), kayit(KAYIT_A),
].join("\r\n") + "\n");

async function hazirla(): Promise<{ f: Fikstur; dbKimligi: string; ornekler: { istemci: string; kullanici: string; hataMetni: string } }> {
  const dizin = DIZIN;
  const key = loadLicenseStoreSync({ dir: dizin }).key;
  if (!key) throw new Error("depo anahtarı yok");
  const kimlik = await ensureInstallationIdentity();
  // Lisans kimliği portalda doğar (fikstürün kimliği); DB kimliği yalnız bilgi olarak `ortam`da (D14).
  const f0 = fiksturKur(Date.now());
  const f: Fikstur = { ...f0, kurulum: { kid: key.kid, x: key.x, privateKey: key.privateKey, acik: createPublicKey(key.privateKey) } };
  configureLicenseRuntimeForTests({ roots: f.kokler, vendorUrl: null });
  setLicenseDbFacts({ installationId: kimlik.installationId, firstOpenMs: Date.now() - 86_400_000, ledgerHighWaterMs: null });
  setMeasuredFingerprint({ digest: f.parmakIzi as Fingerprint, measured: { f1: true, f2: true, f3: true, f4: true, f5: true }, measuredAt: new Date().toISOString() });
  await acceptLicenseResponse(
    { v: 1, hak: hakBas(f), kira: kiraBas(f, { zorlama: false }), indirmeBelirtecleri: [], sunucuSaati: new Date().toISOString(), kurulumId: f.kurulumId },
    "cevrimdisi",
  );
  // Satıcı saati sapması ölçülmüş olsun: `saticiSapmaSn` beyanlı anahtar olarak gövdede görünsün.
  recordVendorClockSkew(-20 * 60_000);
  const ornekler = { istemci: `TEST-kurulum-${randomUUID()}`, kullanici: randomUUID(), hataMetni: "GIZLI-HATA-METNI C:\\gizli\\yol\\tekserp_20260929.dump" };
  touchClient({ instanceId: ornekler.istemci, kind: "electron", version: "1.2.3", userId: ornekler.kullanici });
  touchClient({ instanceId: `${ornekler.istemci}-2`, kind: "mobil", version: null, userId: null });
  reportJobFailure("lisans-bekci-is", new Error(ornekler.hataMetni));
  return { f, dbKimligi: kimlik.installationId, ornekler };
}

async function main(): Promise<void> {
  try {
    const { f, dbKimligi, ornekler } = await hazirla();
    const govde = await buildPollBody();
    const metin = JSON.stringify(govde);

    console.log("\n§1 — beyan edilmiş anahtar kümesi (her derinlik)");
    const tumu = anahtarlar(govde, "", []);
    const disarda = tumu.filter((y) => !IZINLI_ANAHTARLAR.has(y.split(".").pop()?.replace(/\[\d+\]$/, "") ?? ""));
    check("§1a körlük zemini: gövde dolu (≥ 40 anahtar yolu)", tumu.length >= 40, `${tumu.length}`);
    check("§1b ⭐ beyan DIŞI anahtar YOK", disarda.length === 0, disarda.join(", "));
    check("§1c ⭐ gövde KATI protokol şemasından geçer", PollRequestSchema.safeParse(govde).success);
    check(
      "§1d ortam.installationId = DB kimliği (yalnız bilgi), saat.saticiSapmaSn ölçülen sapma; lisans kimliği gövdede YOK (imzalı başlıkta)",
      govde.ortam.installationId === dbKimligi && govde.saat.saticiSapmaSn === -1200 && dbKimligi !== f.kurulumId && !metin.includes(f.kurulumId),
      `${govde.ortam.installationId?.slice(0, 8)} / ${String(govde.saat.saticiSapmaSn)}`,
    );

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

    console.log("\n§4 — kurulum kaydı (3d-2): son N geçerli satır, dosya adı/yol taşımaz");
    const kk = govde.kurulumKayitlari ?? [];
    check("§4a ⭐ geçerli iki kayıt gövdede (bozuk + allowlist dışı satır atlandı, BOM okundu)", kk.length === 2, `${kk.length}`);
    check("§4b aynı kaydın SON hâli kalır, sıra eskiden yeniye", kk[0]?.kayitId === KAYIT_B && kk[1]?.kayitId === KAYIT_A && kk[1]?.yeniSurum === "2.11.2");
    const yollu = { ...govde, kurulumKayitlari: [{ ...kk[0], yol: "x" }] };
    check("§4c karşı: kayda allowlist dışı alan eklenemez (KATI RED)", !PollRequestSchema.safeParse(yollu).success);
    fs.rmSync(GECMIS);
    const govde2 = await buildPollBody();
    check("§4d dosya yoksa alan HİÇ gitmez (eski satıcı uyumu)", !("kurulumKayitlari" in govde2));

    console.log("\n§5 — güncelleme raporu (Dağıtım v2): allowlist, serbest metin yok, dosya yoksa alan yok");
    const g = govde.guncelleme;
    check("§5a ⭐ rapor gövdede: güncelleyici çalışıyor, onay bekleyen 2.15.0, son deneme geri döndü (kodlu)",
      g?.guncelleyici.durum === "CALISIYOR" && g.bekleyen?.surum === "2.15.0" && g.bekleyen.karar === "ONAY_BEKLIYOR" &&
      g.son?.kayitId === ISLEM && g.son.sonuc === "GERI_DONDU" && g.son.kod === "SAGLIK_ZAMAN_ASIMI", JSON.stringify(g));
    check("§5b ⭐ güncelleyicinin serbest iletisi ve onaylayanın adı gövdede YOK", !metin.includes("GIZLI-GUNCELLEYICI-ILETISI") && !metin.includes("Onaylayan-Kisi-Adi"));
    fs.rmSync(GUNCELLEYICI, { recursive: true, force: true });
    const govde3 = await buildPollBody();
    check("§5c güncelleyici yoksa alan HİÇ gitmez (eski satıcı uyumu)", !("guncelleme" in govde3));
  } catch (e) {
    fail++;
    console.log(`❌ beklenmeyen hata — ${e instanceof Error ? e.stack : String(e)}`);
  } finally {
    fs.rmSync(KOK, { recursive: true, force: true });
    await prisma.$disconnect();
    await pool.end();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
