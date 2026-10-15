// =============================================================================
// KİMLİK E-POSTA ÖZETİ YENİLEME BEKÇİSİ (PATRON-TESIS-DB §6; `services/identity-rekey.ts`, CLI `tesis-db.ts ozet-yenile`).
// Kurgu (eski anahtar K1): K kimliği A + B'de AKTİF · L yalnız C'de · P'nin C hesabı PASİF (bağsız) · D daveti kabul
// etmiş, onaylamamış DAVETLİ (üyeliksiz, bağsız). Yeni anahtar K2.
//   §1 kuru koşum (servis + CLI) HİÇ yazmaz; plan K ve L'yi yenilenecek, P ve D'yi bağsız sayar; CLI çıktısı e-posta
//      ve özet taşımaz (yalnız kimlik kimliği + sayı)
//   §2 çakışma fail-closed: yeni özet başka kimlikte → plan çakışma, uygula HİÇ yazmaz (L de), CLI --apply çıkış 1 ·
//      üyelik e-postaları tutarsız → çakışma · plandan SONRA doğan çakışma kilit altında yakalanır, durur
//   §3 uygula: K ve L yeni anahtarla, P ve D bayat · ayak izi üyelik tesislerinde yüksüz (e-posta/özet yok)
//   §4 ikinci koşum no-op (servis 0, CLI degisen=0)
//   §5 reçetenin rol adımı (`tesis-db rol-hizala --apply`, CLI) roller K2'ye hizalanınca K2'li sunucuda K iki
//      tesisle, L girer · K1'li eski özetle 401 · D çözülmez (bayat)
// Koşum: npx tsx scripts/test_kimlik_ozet_yenile.ts
// =============================================================================
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FacilityDbKey } from "../src/auth/facility-db-key";
import { acceptInvite } from "../src/auth/invite.service";
import { withCentral, withTesis } from "../src/lib/tenant";
import { REKEY_AUDIT_EVENT, applyDigestRekey, planDigestRekey, type RekeyPlan } from "../src/services/identity-rekey";
import { inviteFacilityAdmin } from "../src/services/vendor-admin.service";
import { giris, idler, veri } from "./lib/coklu-tesis-ek";
import { PATRON_KOKU, TEST_PAROLASI, hesapKur, kontrol, ortamKur, sonuc, temizleTesis, tesisKur, type Ortam, type TestHesabi } from "./lib/test-ortam";

const IZINLER = ["bulut:siparis:oku"];
const dizin = mkdtempSync(path.join(os.tmpdir(), "patron-ozet-"));
process.on("exit", () => rmSync(dizin, { recursive: true, force: true }));
const K2_DOSYA = path.join(dizin, "yeni-tesis-db.key");
const K2 = FacilityDbKey.load(K2_DOSYA, { create: true });

interface Kurgu {
  a: string;
  b: string;
  c: string;
  k: TestHesabi;
  kB: string;
  l: TestHesabi;
  p: TestHesabi;
  dEposta: string;
  ids: Record<"k" | "l" | "p" | "d", string>;
}

const kimlikId = async (o: Ortam, eposta: string) => (await withCentral(o.goc, {}, (tx) => tx.identity.findUniqueOrThrow({ where: { emailDigest: o.anahtar.emailDigest(eposta) } }))).id;
const ozetler = async (o: Ortam, s: Kurgu) =>
  JSON.stringify(await withCentral(o.goc, {}, (tx) => tx.identity.findMany({ where: { id: { in: Object.values(s.ids) } }, select: { id: true, emailDigest: true, updatedAt: true }, orderBy: { id: "asc" } })));
const ozetOf = async (o: Ortam, id: string) => (await withCentral(o.goc, {}, (tx) => tx.identity.findUniqueOrThrow({ where: { id } }))).emailDigest;
const durumu = (plan: RekeyPlan, id: string) => plan.items.find((i) => i.identityId === id);
const izler = (o: Ortam, tesisId: string) => withTesis(o.goc, { tesisId }, (tx) => tx.accountAudit.findMany({ where: { tesisId, event: REKEY_AUDIT_EVENT } }));

function cli(apply: boolean, komut: "ozet-yenile" | "rol-hizala" = "ozet-yenile"): { code: number; out: string } {
  const r = spawnSync("npx", ["tsx", "scripts/tesis-db.ts", komut, ...(apply ? ["--apply"] : [])], {
    cwd: PATRON_KOKU,
    encoding: "utf8",
    env: { ...process.env, TESIS_ROL_ANAHTARI_DOSYASI: K2_DOSYA },
  });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}
const sirsiz = (out: string) => !out.includes("@") && !/[0-9a-f]{64}/.test(out);

async function kur(o: Ortam): Promise<Kurgu> {
  const [a, b, c] = [(await tesisKur(o, { ad: "Özet Alfa" })).tesisId, (await tesisKur(o, { ad: "Özet Beta" })).tesisId, (await tesisKur(o, { ad: "Özet Gama" })).tesisId];
  const k = await hesapKur(o, a, IZINLER);
  const kId = await kimlikId(o, k.eposta);
  const kB = (await withTesis(o.goc, { tesisId: b }, (tx) => tx.account.create({ data: { tesisId: b, email: k.eposta, name: "Ortak", permissions: IZINLER, status: "AKTIF", identityId: kId } }))).id;
  await withCentral(o.goc, {}, (tx) => tx.loginRoute.create({ data: { identityId: kId, tesisId: b, accountId: kB } }));
  const l = await hesapKur(o, c, IZINLER);
  const p = await hesapKur(o, c, IZINLER);
  await withTesis(o.goc, { tesisId: c }, (tx) => tx.account.update({ where: { id: p.accountId }, data: { status: "PASIF", closedAt: new Date(o.saat.simdi()) } }));
  const dEposta = `bekci-d-${randomUUID().slice(0, 8)}@ornek.test`;
  const davet = await inviteFacilityAdmin(o.goc, { tesisId: c, email: dEposta, name: "Bekleyen", validHours: 24, zorla: { talep: "BEKCI", gerekce: "bekçi fikstürü" } }, o.saat.simdi());
  await acceptInvite(o.ctx, { token: davet.token, password: TEST_PAROLASI });
  const ids = { k: kId, l: await kimlikId(o, l.eposta), p: await kimlikId(o, p.eposta), d: await kimlikId(o, dEposta) };
  return { a, b, c, k, kB, l, p, dEposta, ids };
}

async function kuru(o: Ortam, s: Kurgu): Promise<void> {
  console.log("\n§1 kuru koşum");
  const once = await ozetler(o, s);
  const plan = await planDigestRekey(o.goc, K2);
  const st = (id: string) => `${durumu(plan, id)?.status}/${durumu(plan, id)?.linked}`;
  kontrol("§1a ⭐ plan: K yenilenecek (2 üyelik) · L yenilenecek (1) · P ve D bağsız", st(s.ids.k) === "yenilenecek/2" && st(s.ids.l) === "yenilenecek/1" && st(s.ids.p) === "bagsiz/0" && st(s.ids.d) === "bagsiz/0", [s.ids.k, s.ids.l, s.ids.p, s.ids.d].map(st).join(" "));
  const r = cli(false);
  kontrol("§1b CLI kuru koşum çıkış 0 · K ve L kimliği listede · `kip=kuru` özeti", r.code === 0 && r.out.includes(s.ids.k) && r.out.includes(s.ids.l) && r.out.includes("PATRON_OZET_YENILE kip=kuru"), r.out.slice(-300));
  kontrol("§1c ⭐ CLI çıktısı e-posta ve özet taşımaz", sirsiz(r.out));
  kontrol("§1d ⭐ kuru koşum (servis + CLI) hiçbir özeti yazmadı, ayak izi yok", (await ozetler(o, s)) === once && (await izler(o, s.a)).length === 0);
}

async function cakisma(o: Ortam, s: Kurgu): Promise<void> {
  console.log("\n§2 çakışma fail-closed");
  const once = await ozetler(o, s);
  const yId = randomUUID();
  const ekle = () => withCentral(o.goc, {}, (tx) => tx.identity.create({ data: { id: yId, emailDigest: K2.emailDigest(s.k.eposta), status: "DAVETLI" } }));
  const sil = () => withCentral(o.goc, {}, (tx) => tx.identity.delete({ where: { id: yId } }));
  await ekle();
  const plan = await planDigestRekey(o.goc, K2);
  kontrol("§2a ⭐ yeni özet başka kimlikte → K çakışma OZET_BASKA_KIMLIKTE", durumu(plan, s.ids.k)?.status === "cakisma" && durumu(plan, s.ids.k)?.conflict === "OZET_BASKA_KIMLIKTE");
  const r = await applyDigestRekey(o.goc, K2, plan);
  kontrol("§2b ⭐ uygula REDDEDER, HİÇ yazmaz (çakışmasız L dahil)", r.kind === "reddedildi" && (await ozetler(o, s)) === once, r.kind);
  const c = cli(true);
  kontrol("§2c CLI --apply çıkış 1 · kimlik + sebep listede · yazılmadı · sırsız", c.code === 1 && c.out.includes(`çakışma ${s.ids.k} sebep=OZET_BASKA_KIMLIKTE`) && (await ozetler(o, s)) === once && sirsiz(c.out), c.out.slice(-300));
  await sil();
  await withTesis(o.goc, { tesisId: s.b }, (tx) => tx.account.update({ where: { id: s.kB }, data: { email: `baska-${randomUUID().slice(0, 8)}@ornek.test` } }));
  const tutarsiz = await planDigestRekey(o.goc, K2);
  kontrol("§2d ⭐ üyelik e-postaları tutarsız → çakışma EPOSTA_TUTARSIZ", durumu(tutarsiz, s.ids.k)?.conflict === "EPOSTA_TUTARSIZ");
  await withTesis(o.goc, { tesisId: s.b }, (tx) => tx.account.update({ where: { id: s.kB }, data: { email: s.k.eposta } }));
  const temiz = await planDigestRekey(o.goc, K2);
  await ekle();
  const yaris = await applyDigestRekey(o.goc, K2, temiz);
  kontrol(
    "§2e ⭐ plandan SONRA doğan çakışma kilit altında yakalanır: K'de durur, K yazılmaz",
    yaris.kind === "durdu" && yaris.stop.identityId === s.ids.k && yaris.stop.reason === "OZET_BASKA_KIMLIKTE" && (await ozetOf(o, s.ids.k)) === o.anahtar.emailDigest(s.k.eposta),
    JSON.stringify(yaris),
  );
  await sil();
}

async function uygula(o: Ortam, s: Kurgu): Promise<void> {
  console.log("\n§3 uygula + §4 ikinci koşum");
  const r = await applyDigestRekey(o.goc, K2, await planDigestRekey(o.goc, K2));
  kontrol("§3a uygula tamam", r.kind === "tamam" && r.changed >= 1, JSON.stringify(r));
  kontrol("§3b ⭐ K ve L özeti yeni anahtarla", (await ozetOf(o, s.ids.k)) === K2.emailDigest(s.k.eposta) && (await ozetOf(o, s.ids.l)) === K2.emailDigest(s.l.eposta));
  kontrol("§3c ⭐ bağsız P ve D bayat kalır (eski anahtar özeti)", (await ozetOf(o, s.ids.p)) === o.anahtar.emailDigest(s.p.eposta) && (await ozetOf(o, s.ids.d)) === o.anahtar.emailDigest(s.dEposta));
  const [iA, iB, iC] = [await izler(o, s.a), await izler(o, s.b), await izler(o, s.c)];
  kontrol(
    "§3d ayak izi her üyelik tesisinde (A: K · B: K · C: L), yüksüz, e-posta/özet yok",
    iA.length === 1 && iA[0]!.entityId === s.k.accountId && iB.length === 1 && iB[0]!.entityId === s.kB && iC.length === 1 && iC[0]!.entityId === s.l.accountId && [...iA, ...iB, ...iC].every((x) => x.summary === null && x.actor === "satici-cli"),
  );
  const ikinci = await planDigestRekey(o.goc, K2);
  const tekrar = await applyDigestRekey(o.goc, K2, ikinci);
  kontrol("§4a ⭐ ikinci koşum no-op: K ve L güncel, 0 değişiklik", durumu(ikinci, s.ids.k)?.status === "guncel" && durumu(ikinci, s.ids.l)?.status === "guncel" && tekrar.kind === "tamam" && tekrar.changed === 0, JSON.stringify(tekrar));
  const c = cli(true);
  kontrol("§4b CLI --apply ikinci kez: çıkış 0 · degisen=0 · yeni ayak izi yok", c.code === 0 && c.out.includes("degisen=0") && (await izler(o, s.a)).length === 1, c.out.slice(-200));
}

async function girisler(o: Ortam, s: Kurgu): Promise<void> {
  console.log("\n§5 yeni anahtarla giriş");
  const eski = await giris(o, s.k);
  kontrol("§5a eski anahtarlı sunucu artık K'yi bulamaz (401)", eski.status === 401, `${eski.status}`);
  // Reçetenin rol adımı gerçek yoldan (CLI): el hizası yok; adım atlanırsa K2'li sunucu tesis DB'sine bağlanamaz.
  const h = cli(true, "rol-hizala");
  kontrol("§5b0 `rol-hizala --apply` çıkış 0 · uyumsuz=0 · sırsız", h.code === 0 && /kip=uygula .*uyumsuz=0 /.test(h.out) && sirsiz(h.out), h.out.slice(-300));
  const o2 = await ortamKur({ GIRIS_HIZ_DK: "1000", GIRIS_ESIGI: "50" }, undefined, undefined, { anahtar: K2, secrets: o.ctx.secrets });
  try {
    o2.saat.ayarla(o.saat.simdi() + 120_000);
    const kg = await giris(o2, s.k);
    kontrol("§5b ⭐ K2'li sunucuda K girer, iki tesis listelenir (A, B)", kg.status === 200 && idler(veri(kg).tesisler) === [s.a, s.b].join(","), `${kg.status} ${idler(kg.status === 200 ? veri(kg).tesisler : [])}`);
    const lg = await giris(o2, s.l);
    kontrol("§5c ⭐ L girer (C)", lg.status === 200 && veri(lg).tesisId === s.c, `${lg.status}`);
    const d = await withCentral(o2.goc, {}, (tx) => tx.identity.findUnique({ where: { emailDigest: K2.emailDigest(s.dEposta) } }));
    kontrol("§5d bağsız D yeni anahtarla çözülmez (bayat; bakım kapatır)", d === null);
  } finally {
    await o2.kapat();
  }
}

async function main(): Promise<void> {
  const o = await ortamKur({ GIRIS_HIZ_DK: "1000", GIRIS_ESIGI: "50" });
  let s: Kurgu | null = null;
  try {
    s = await kur(o);
    await kuru(o, s);
    await cakisma(o, s);
    await uygula(o, s);
    await girisler(o, s);
  } finally {
    if (s) for (const t of [s.a, s.b, s.c]) await temizleTesis(o, t);
    await o.kapat();
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
