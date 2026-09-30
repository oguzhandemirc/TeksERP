// =============================================================================
// BİLDİRİM GİDEN KUTUSU — satıcı olayı kendi tx'inde bildirim satırı yazar (satıcı dışarı BAĞLANMAZ).
//   §0 STATİK: `enqueueNotificationTx` her çağrı yerinde ilk argüman `tx` (tx dışı yazım yok) · gövde
//      allowlist'i katalog = göç seddi (sıra dahil) · enum aynası · kurucu fazla anahtarı ATAR
//   §1 AYNI TX: kurulum hedefli BEFORE INSERT tetikleyicisi bildirim yazımını düşürünce OLAY DA YOK (destek ·
//      kopya şüphesi · kopya kira reddi · taşıma · DR · planlı eylem · taksit gecikmesi · deneme); tetikleyici
//      kalkınca olay + kanal başına bir satır (EPOSTA + TELEGRAM)
//   §2 TEKİLLİK: aynı olayın tekrarı (aynı talepId · sürmekte olan uyarı · aynı anahtar · aynı işlem kimliği ·
//      DR tekrarı · zamanlayıcının ikinci turu) yeni satır doğurmaz
//   §3 ALLOWLIST: kanarya metinler (açıklama · açan · gerekçe · sebep · mesaj · taksit açıklaması) hiçbir gövdede
//      yok; gövde anahtarları = allowlist; DB seddi fazla anahtar · dış bağlantı · uzun değer · ham hata metni REDDEDER
//   §4 GÖVDE SINIRI (bildirim iş olayını ASLA düşürmez): kodun ölçüsü = PG'nin octet_length(govde::text)'i · JSON.stringify'a
//      göre tam 2000 bayt (PG'de 2017) gövde kısaltılır · 3 baytlık 200 karakterli adlar + eşsiz vekilli konu → destek
//      talebi yine açılır, gövde ≤ 2000 · eşsiz vekil U+FFFD olur
//   §5 DENEME HIZI: kullanıcı başına 5 dk'da bir — yeni işlem kimliği 429 HIZ_SINIRI (satır yok, işlem kimliği yok) ·
//      aynı kimliğin tekrarı yanıtı alır · başka kullanıcı etkilenmez · pencere dolunca / yazım düşünce yer iade
// ⭐ KALICI SONDA ✓K (her koşumda): §0a çözümleyici sentetik `enqueueNotificationTx(prisma, …)`i yakalar ·
//    §1'in her maddesi önce DÜŞÜRÜLMÜŞ yazımla ölçülür (tetikleyici kör olsaydı olay satırı doğardı).
// NEGATİF SONDA (dosya DIŞI, cp + shasum ile geri alındı): N1 destek bildirimi tx SONRASI ayrı tx'te (ilk argüman
//   yine `tx` — §0a göremez) → §1a/§1a' ❌ · N2 `skipDuplicates` yok → §2f ❌ · N3 kurucu girdiyi yayar → §0d ❌ ·
//   N4 açıklama konuya eklenir → §1a'/§3a ❌ · N5 kira reddi bildirimsiz → §1h/§1h' ❌ · N6 eski kurucu (JSON.stringify
//   ölçüsü, vekil normalleştirmesi yok) → §0f/§4a/§4b/§4c/§4d ❌ (destek talebi 500) · N7 deneme rotası sınırsız → §5a ❌ ·
//   N8 iade kaldırıldı → §1f'/§2d/§5b ❌.
// Koşum: npx tsx scripts/test_bildirim_giden_kutusu.ts   (yalnız *_test DB)
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { ENDPOINTS, digestFingerprint } from "../src/lisans-protokol";
import { HAM_PARMAK_IZI, kurulumAnahtariUret, type TestAnahtari } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { BODY_TOTAL_MAX_BYTES, BODY_VALUE_MAX, NOTIFICATION_BODY_KEYS, NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS, NOTIFICATION_STATES, notificationBody, pgJsonbTextBytes, type NotificationBody } from "../src/notifications/catalog";
import {
  ORTAM,
  SATICI_KOKU,
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  hedefDbKapisi,
  imzaliPost,
  kapat,
  kiraIdOf,
  kontrol,
  kurulumFiksturu,
  portalGiris,
  portalIstek,
  portalKullaniciAc,
  portalSunuculariKur,
  sonuc,
  temizleKurulumlar,
  temizlePortal,
  yoklamaGovdesi,
  type KurulumFiksturu,
} from "./lib/test-ortam";

type Prisma = (typeof import("../src/lib/prisma"))["prisma"];

// ---------------------------------------------------------------- §0 statik

/** `enqueueNotificationTx(<ilk argüman>, …)` çağrıları — ilk argüman `tx` değilse bulgu. */
export function enqueueCallFindings(files: readonly { name: string; text: string }[]): { calls: number; bad: string[] } {
  let calls = 0;
  const bad: string[] = [];
  for (const { name, text } of files) {
    const sf = ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "enqueueNotificationTx") {
        calls++;
        const first = n.arguments[0];
        if (!first || !ts.isIdentifier(first) || first.text !== "tx") bad.push(`${name}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
      }
      n.forEachChild(visit);
    };
    visit(sf);
  }
  return { calls, bad };
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === "lisans-protokol" ? [] : tsFiles(p);
    return n.endsWith(".ts") ? [p] : [];
  });
}

function enumValues(schema: string, name: string): string[] {
  const m = new RegExp(`^enum ${name} \\{([\\s\\S]*?)^\\}`, "m").exec(schema);
  return m ? m[1]!.split("\n").map((l) => l.replace(/\/\/.*$/, "").trim()).filter((l) => /^[A-Z0-9_]+$/.test(l)) : [];
}

/** Eşsiz UTF-16 vekili (jsonb reddeder). */
const ESSIZ_VEKIL = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** 2/3/4 baytlık karakter, PG'nin kaçışladığı karakter, kontrol karakteri, eşsiz vekil — gövde içeriği saldırı yüzeyi. */
const HAVUZ = ["a", "Z", "7", " ", "ş", "Ğ", "é", "€", "“", "中", "😀", "𝄞", '"', "\\", "\t", "\n", "\u0001", "\u007f", "\ud800", "\udc00", "\ufffd"];
const rastgeleMetin = (n: number): string => Array.from({ length: n }, () => HAVUZ[Math.floor(Math.random() * HAVUZ.length)]!).join("");

function statik(): NotificationBody[] {
  console.log("\n§0 statik");
  const files = tsFiles(path.join(SATICI_KOKU, "src")).map((p) => ({ name: path.relative(SATICI_KOKU, p), text: readFileSync(p, "utf8") }));
  const f = enqueueCallFindings(files);
  kontrol("§0a giden kutusuna her yazım olayın tx'inde (ilk argüman `tx`)", f.calls >= 9 && f.bad.length === 0, `${f.calls} çağrı · ${f.bad.join(", ") || "ihlal yok"}`);
  const sonda = enqueueCallFindings([{ name: "sonda.ts", text: "async function x(){ await enqueueNotificationTx(prisma, g); await enqueueNotificationTx(tx, g); }" }]);
  kontrol("§0a' ✓K çözümleyici tx dışı yazımı yakalar", sonda.calls === 2 && sonda.bad.join() === "sonda.ts:1");
  const goc = readFileSync(path.join(SATICI_KOKU, "prisma", "migrations", "20261001130000_bildirim_giden_kutusu", "migration.sql"), "utf8");
  const dizi = /e\.k <> ALL \(ARRAY\[([^\]]+)\]\)/.exec(goc)?.[1] ?? "";
  const sed = [...dizi.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  kontrol("§0b gövde allowlist'i: katalog = göç seddi (sıra dahil)", JSON.stringify(sed) === JSON.stringify([...NOTIFICATION_BODY_KEYS]), sed.join(","));
  const schema = readFileSync(path.join(SATICI_KOKU, "prisma", "schema.prisma"), "utf8");
  const aynali =
    JSON.stringify(enumValues(schema, "BildirimOlayi")) === JSON.stringify([...NOTIFICATION_EVENTS]) &&
    JSON.stringify(enumValues(schema, "BildirimKanali")) === JSON.stringify([...NOTIFICATION_CHANNELS]) &&
    JSON.stringify(enumValues(schema, "BildirimDurumu")) === JSON.stringify([...NOTIFICATION_STATES]);
  kontrol("§0c enum aynası: olay · kanal · durum = katalog", aynali);
  const fazla = notificationBody({ portalYolu: "/destek/x", konu: "a\u0000b\nc", ...({ aciklama: "KANARYA", saglik: { disk: 1 } } as object) });
  kontrol("§0d kurucu yalnız allowlist anahtarını yazar, kontrol karakterini boşluğa indirir", JSON.stringify(Object.keys(fazla)) === JSON.stringify([...NOTIFICATION_BODY_KEYS]) && fazla.konu === "a b c");
  let yolRed = false;
  try {
    notificationBody({ portalYolu: "https://kotu.example/x" });
  } catch {
    yolRed = true;
  }
  kontrol("§0e kurucu dış bağlantıyı portal yolu olarak REDDEDER", yolRed);
  // §0f İçerik kaynaklı hata YOK: 400 rastgele gövde (uzun, çok baytlı, kaçışlı, kontrol, eşsiz vekil, geçersiz tarih) —
  // kurucu fırlatmaz; PG ölçüsü tavanda, değer ≤ 300 kod birimi, eşsiz vekil yok.
  const ornekler: NotificationBody[] = [];
  const bulgu = { atan: 0, asan: 0, uzun: 0, vekil: 0, kisaltilan: 0 };
  for (let i = 0; i < 400; i++) {
    const m = () => (Math.random() < 0.1 ? null : rastgeleMetin(Math.floor(Math.random() * 420)));
    try {
      const b = notificationBody({ portalYolu: "/destek/x", musteri: m(), tesis: m(), kurulum: m(), lisansNo: m(), sinif: m(), konu: m(), referans: m(), tarih: i % 9 === 0 ? new Date(Number.NaN) : new Date() });
      ornekler.push(b);
      if (pgJsonbTextBytes(b) > BODY_TOTAL_MAX_BYTES) bulgu.asan++;
      for (const v of Object.values(b)) {
        if (v !== null && v.length > BODY_VALUE_MAX) bulgu.uzun++;
        if (v !== null && ESSIZ_VEKIL.test(v)) bulgu.vekil++;
        if (v !== null && v.endsWith("…")) bulgu.kisaltilan++;
      }
    } catch {
      bulgu.atan++;
    }
  }
  kontrol(
    "§0f gövde içeriği ASLA fırlatmaz: 400 rastgele gövde (çok baytlı · kaçışlı · kontrol · eşsiz vekil · geçersiz tarih) — PG ölçüsü ≤ 2000, değer ≤ 300, eşsiz vekil yok",
    bulgu.atan === 0 && bulgu.asan === 0 && bulgu.uzun === 0 && bulgu.vekil === 0 && bulgu.kisaltilan > 0,
    JSON.stringify(bulgu),
  );
  return ornekler;
}

// ---------------------------------------------------------------- DB yardımcıları

/** Tetikleyici: bu kurulumların ya da bu tekillik anahtarlarının bildirim yazımını DÜŞÜRÜR (yalnız bu _test DB'si). */
async function patlat(prisma: Prisma, g: { kurulumlar: readonly string[]; anahtarlar: readonly string[] }): Promise<void> {
  const ids = g.kurulumlar.map((x) => `'${x}'`).join(",");
  const keys = g.anahtarlar.map((x) => `'${x.replace(/'/g, "''")}'`).join(",");
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION "bekci_bildirim_patlat"() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      IF NEW."kurulumId" = ANY(ARRAY[${ids || "NULL"}]::uuid[]) OR NEW."tekillikAnahtari" = ANY(ARRAY[${keys || "NULL"}]::text[]) THEN
        RAISE EXCEPTION 'bekci: bildirim yazimi dusuruldu';
      END IF;
      RETURN NEW;
    END $f$`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "bekci_bildirim_patlat" ON "bildirim"`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "bekci_bildirim_patlat" BEFORE INSERT ON "bildirim" FOR EACH ROW EXECUTE FUNCTION "bekci_bildirim_patlat"()`);
}

async function sustur(prisma: Prisma): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "bekci_bildirim_patlat" ON "bildirim"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "bekci_bildirim_patlat"()`);
}

async function satirlar(prisma: Prisma, olay: (typeof NOTIFICATION_EVENTS)[number], where: { kurulumId?: string | null; tekillikAnahtari?: string } = {}) {
  return prisma.bildirim.findMany({ where: { olay, ...where }, orderBy: { kanal: "asc" } });
}

const ikiKanal = (rows: { kanal: string; durum: string }[]): boolean =>
  rows.length === 2 && JSON.stringify(rows.map((r) => r.kanal).sort()) === JSON.stringify([...NOTIFICATION_CHANNELS].sort()) && rows.every((r) => r.durum === "BEKLIYOR");

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- akış

interface Ortam {
  readonly prisma: Prisma;
  readonly genel: string;
  readonly tailnet: string;
  readonly cerez: string;
  readonly a: KurulumFiksturu;
  readonly aAnahtar: TestAnahtari;
  readonly dr: KurulumFiksturu;
  readonly drAnahtar: TestAnahtari;
  readonly fpYabanci: import("../src/lisans-protokol").Fingerprint;
  readonly fpSahip: import("../src/lisans-protokol").Fingerprint;
  sonKira: string | null;
}

const KANARYA = `KANARYA-${randomUUID().slice(0, 8)}`;

function destekGovdesi(o: Ortam, talepId: string) {
  const y = yoklamaGovdesi({ sonKiraId: null, parmakIzi: o.fpSahip });
  return { v: 1, talepId, konu: "Tartı ekranı donuyor", aciklama: `Açıklama ${KANARYA}-ACIKLAMA`, acan: `Ayşe ${KANARYA}-ACAN`, panelSurum: "1.3.2", ek: null, saglik: y.saglik, ortam: ORTAM };
}

async function yokla(o: Ortam, parmakIzi: Ortam["fpSahip"]) {
  const y = await imzaliPost(o.genel, ENDPOINTS.POLL, { kurulumId: o.a.kurulumId, amac: "yokla", anahtar: o.aAnahtar, govde: yoklamaGovdesi({ sonKiraId: o.sonKira, parmakIzi }) });
  if (y.status === 200) o.sonKira = kiraIdOf(y.json);
  return y;
}

const tasi = (o: Ortam, anahtar: TestAnahtari) =>
  imzaliPost(o.genel, ENDPOINTS.TRANSFER, {
    kurulumId: o.a.kurulumId,
    amac: "tasima",
    anahtar,
    govde: { v: 1, kurulumId: o.a.kurulumId, acikAnahtar: anahtar.x, parmakIzi: o.fpYabanci, ortam: ORTAM, gerekce: `${KANARYA}-GEREKCE` },
  });

const devral = (o: Ortam) =>
  imzaliPost(o.genel, ENDPOINTS.DR_TAKEOVER, { kurulumId: o.dr.kurulumId, amac: "dr-devral", anahtar: o.drAnahtar, govde: { v: 1, anaKurulumId: o.a.kurulumId, gerekce: `${KANARYA}-DR` } });

const deneme = (o: Ortam, token: string) => portalIstek(o.tailnet, "/portal/api/bildirimler/deneme", { cerez: o.cerez, govde: { clientToken: token } });

async function planliEylem(o: Ortam) {
  const s = await import("../src/services/sanction.service");
  const p = await s.schedulePlannedAction({ installationDbId: o.a.kurulumDbId, level: "K0", dueAt: new Date(Date.now() - 60_000), message: `${KANARYA}-MESAJ`, reason: `${KANARYA}-SEBEP`, actor: "bekci" });
  return p.id;
}

async function taksit(o: Ortam) {
  const s = await import("../src/services/sanction.service");
  const plan = await s.createInstallmentPlan({ installationDbId: o.a.kurulumDbId, description: `${KANARYA}-TAKSIT`, items: [{ dueAt: new Date(Date.now() - 3 * 86_400_000), amount: "100" }], graceDays: 0, restrictionDays: 15, actor: "bekci" });
  return plan.kalemler[0]!.id;
}

async function dene<T>(f: () => Promise<T>): Promise<T | Error> {
  try {
    return await f();
  } catch (err) {
    return err as Error;
  }
}

/** §1a–§1g: yazım düşürülünce olay YOK; tetikleyici kalkınca olay + iki satır. */
async function ayniTx(o: Ortam): Promise<{ talepId: string; tasiyan: TestAnahtari; token: string; planli: string; kalem: string }> {
  const { prisma } = o;
  const talepId = randomUUID();
  const tasiyan = kurulumAnahtariUret();
  const token = randomUUID();
  const s = await import("../src/services/sanction.service");
  console.log("\n§1 aynı tx — önce bildirim yazımı DÜŞÜRÜLÜR");
  await patlat(prisma, { kurulumlar: [o.a.kurulumDbId], anahtarlar: [`DENEME:${token}`] });
  const d0 = await imzaliPost(o.genel, ENDPOINTS.SUPPORT, { kurulumId: o.a.kurulumId, amac: "destek", anahtar: o.aAnahtar, govde: destekGovdesi(o, talepId) });
  kontrol("§1a destek: bildirim düşünce talep de YOK", d0.status >= 500 && (await prisma.destekTalebi.count({ where: { kurulumId: o.a.kurulumDbId } })) === 0, `${d0.status}`);
  const k0 = await yokla(o, o.fpYabanci);
  kontrol("§1b kopya şüphesi: bildirim düşünce uyarı da YOK (yoklama geri alındı)", k0.status >= 500 && (await prisma.kopyaUyarisi.count({ where: { kurulumId: o.a.kurulumDbId } })) === 0, `${k0.status}`);
  const t0 = await tasi(o, tasiyan);
  kontrol("§1c taşıma: bildirim düşünce talep de YOK", t0.status >= 500 && (await prisma.tasimaTalebi.count({ where: { kurulumId: o.a.kurulumDbId } })) === 0, `${t0.status}`);
  const planli = await planliEylem(o);
  const p0 = await dene(() => s.runDuePlannedActions(Date.now()));
  const pDurum = (await prisma.planliEylem.findUniqueOrThrow({ where: { id: planli } })).durum;
  kontrol("§1d planlı eylem: bildirim düşünce eylem UYGULANMAZ (yaptırım satırı yok)", p0 instanceof Error && pDurum === "BEKLIYOR" && (await prisma.yaptirimEylemi.count({ where: { planliEylemId: planli } })) === 0, pDurum);
  const kalem = await taksit(o);
  const g0 = await dene(() => s.runOverdueInstallments(Date.now()));
  kontrol("§1e taksit gecikmesi: bildirim düşünce kalem BEKLER, K3 yok", g0 instanceof Error && (await prisma.taksitKalemi.findUniqueOrThrow({ where: { id: kalem } })).durum === "BEKLIYOR");
  const n0 = await deneme(o, token);
  kontrol("§1f deneme: bildirim düşünce işlem kimliği satırı da YOK", n0.status >= 500 && (await prisma.portalIslemi.count({ where: { clientToken: token } })) === 0, `${n0.status}`);
  const r0 = await devral(o);
  kontrol("§1g DR: bildirim düşünce ana kurulum ETKİN kalır", r0.status >= 500 && (await prisma.kurulum.findUniqueOrThrow({ where: { id: o.a.kurulumDbId } })).durum === "ETKIN", `${r0.status}`);
  await sustur(prisma);
  return { talepId, tasiyan, token, planli, kalem };
}

async function ayniTxSonra(o: Ortam, x: Awaited<ReturnType<typeof ayniTx>>): Promise<void> {
  const { prisma } = o;
  const s = await import("../src/services/sanction.service");
  console.log("\n§1' aynı tx — tetikleyici kalkınca olay + kanal başına satır");
  const d1 = await imzaliPost(o.genel, ENDPOINTS.SUPPORT, { kurulumId: o.a.kurulumId, amac: "destek", anahtar: o.aAnahtar, govde: destekGovdesi(o, x.talepId) });
  const talep = await prisma.destekTalebi.findFirst({ where: { kurulumId: o.a.kurulumDbId } });
  const dRows = await satirlar(prisma, "DESTEK_TALEBI", { kurulumId: o.a.kurulumDbId });
  const govde = dRows[0]?.govde as Record<string, unknown> | undefined;
  kontrol("§1a' destek: talep + iki kanal satırı (konu + talep no + portal yolu)", d1.status === 200 && !!talep && ikiKanal(dRows) && dRows.every((r) => r.ilgiliKayit === talep.id) && govde?.konu === "Tartı ekranı donuyor" && govde?.referans === talep.talepNo && govde?.portalYolu === `/destek/${talep.id}`, `${d1.status} ${dRows.length}`);
  const k1 = await yokla(o, o.fpYabanci);
  const uyari = await prisma.kopyaUyarisi.findFirst({ where: { kurulumId: o.a.kurulumDbId, tur: "PARMAK_IZI_UYUSMAZ" } });
  const kRows = await satirlar(prisma, "KOPYA_SUPHESI", { kurulumId: o.a.kurulumDbId });
  kontrol("§1b' kopya şüphesi: uyarı + iki kanal satırı (tür referansta)", k1.status === 200 && !!uyari && ikiKanal(kRows) && (kRows[0]?.govde as Record<string, unknown>).referans === "PARMAK_IZI_UYUSMAZ", `${k1.status} ${kRows.length}`);
  // İkinci pencere (KOPYA_PENCERE_SN=1): önce DÜŞÜRÜLMÜŞ yazımla, sonra serbest.
  await bekle(1_200);
  await patlat(prisma, { kurulumlar: [o.a.kurulumDbId], anahtarlar: [] });
  const r0 = await yokla(o, o.fpYabanci);
  const redYok = (await prisma.kopyaUyarisi.findUniqueOrThrow({ where: { id: uyari!.id } })).redZamani === null;
  await sustur(prisma);
  kontrol("§1h kopya kira reddi: bildirim düşünce ret de işlenmez (redZamani boş)", r0.status >= 500 && redYok, `${r0.status}`);
  const r1 = await yokla(o, o.fpYabanci);
  const redRows = await satirlar(prisma, "KOPYA_KIRA_REDDI", { kurulumId: o.a.kurulumDbId });
  kontrol("§1h' kopya kira reddi: 403 KIRA_VERILMEDI + redZamani + iki kanal satırı", r1.status === 403 && r1.kod === "KIRA_VERILMEDI" && (await prisma.kopyaUyarisi.findUniqueOrThrow({ where: { id: uyari!.id } })).redZamani !== null && ikiKanal(redRows), `${r1.status} ${redRows.length}`);
  const t1 = await tasi(o, x.tasiyan);
  const tRows = await satirlar(prisma, "TASIMA_TALEBI", { kurulumId: o.a.kurulumDbId });
  kontrol("§1c' taşıma: talep + iki kanal satırı", t1.status === 200 && ikiKanal(tRows) && tRows[0]?.ilgiliKayit === (t1.json.talepId as string), `${t1.status} ${tRows.length}`);
  const pUyg = await s.runDuePlannedActions(Date.now());
  const pRows = await satirlar(prisma, "PLANLI_EYLEM_UYGULANDI", { kurulumId: o.a.kurulumDbId });
  kontrol("§1d' planlı eylem uygulandı + iki kanal satırı (tür referansta)", pUyg >= 1 && ikiKanal(pRows) && pRows[0]?.ilgiliKayit === x.planli && (pRows[0]?.govde as Record<string, unknown>).referans === "Yaptırım K0", `${pUyg} ${pRows.length}`);
  const gUyg = await s.runOverdueInstallments(Date.now());
  const gRows = await satirlar(prisma, "TAKSIT_GECIKTI", { kurulumId: o.a.kurulumDbId });
  kontrol("§1e' taksit gecikti (K3) + iki kanal satırı", gUyg >= 1 && ikiKanal(gRows) && gRows[0]?.ilgiliKayit === x.kalem, `${gUyg} ${gRows.length}`);
  const n1 = await deneme(o, x.token);
  const nRows = await satirlar(prisma, "DENEME", { tekillikAnahtari: `DENEME:${x.token}` });
  kontrol("§1f' deneme: 201 + iki kanal satırı (kurulumsuz)", n1.status === 201 && ikiKanal(nRows) && nRows.every((r) => r.kurulumId === null), `${n1.status} ${nRows.length}`);
}

async function tekillik(o: Ortam, x: Awaited<ReturnType<typeof ayniTx>>): Promise<void> {
  const { prisma } = o;
  const s = await import("../src/services/sanction.service");
  const { enqueueNotificationTx } = await import("../src/notifications/outbox");
  const { lockInstallation } = await import("../src/lib/locks");
  console.log("\n§2 tekillik");
  const say = (olay: (typeof NOTIFICATION_EVENTS)[number]) => prisma.bildirim.count({ where: { olay, kurulumId: o.a.kurulumDbId } });
  const once = { d: await say("DESTEK_TALEBI"), k: await say("KOPYA_SUPHESI"), r: await say("KOPYA_KIRA_REDDI"), t: await say("TASIMA_TALEBI") };
  const d2 = await imzaliPost(o.genel, ENDPOINTS.SUPPORT, { kurulumId: o.a.kurulumId, amac: "destek", anahtar: o.aAnahtar, govde: destekGovdesi(o, x.talepId) });
  kontrol("§2a aynı talepId tekrar: aynı talep, yeni satır YOK", d2.status === 200 && (await say("DESTEK_TALEBI")) === once.d);
  const k2 = await yokla(o, o.fpYabanci);
  kontrol("§2b sürmekte olan uyarının tekrarı (ret dahil) yeni satır DOĞURMAZ", k2.status === 403 && (await say("KOPYA_SUPHESI")) === once.k && (await say("KOPYA_KIRA_REDDI")) === once.r, `${k2.status}`);
  const t2 = await tasi(o, x.tasiyan);
  kontrol("§2c aynı anahtarla taşıma tekrarı: aynı talep, yeni satır YOK", t2.status === 200 && (await say("TASIMA_TALEBI")) === once.t);
  const n2 = await deneme(o, x.token);
  kontrol("§2d aynı işlem kimliğiyle deneme: tekrar yanıtı, yeni satır YOK", n2.status === 201 && n2.basliklar.get("idempotent-replay") === "true" && (await prisma.bildirim.count({ where: { tekillikAnahtari: `DENEME:${x.token}` } })) === 2);
  kontrol("§2e zamanlayıcı ikinci tur: planlı eylem / taksit yeni satır doğurmaz", (await s.runDuePlannedActions(Date.now())) === 0 && (await s.runOverdueInstallments(Date.now())) === 0 && (await say("PLANLI_EYLEM_UYGULANDI")) === 2 && (await say("TAKSIT_GECIKTI")) === 2);
  const iki = await dene(() =>
    prisma.$transaction(async (tx) => {
      await lockInstallation(tx, o.a.kurulumDbId);
      const g = { event: "DENEME" as const, keyParts: ["tekillik", o.a.kurulumDbId], installationDbId: o.a.kurulumDbId, portalPath: "/bildirimler" };
      return [await enqueueNotificationTx(tx, g), await enqueueNotificationTx(tx, g)];
    }),
  );
  kontrol("§2f aynı anahtar aynı tx'te iki kez: 2 + 0 satır (UNIQUE + skipDuplicates; hata DEĞİL)", JSON.stringify(iki) === "[2,0]", iki instanceof Error ? iki.message.split("\n").filter(Boolean).pop() : JSON.stringify(iki));
  console.log("\n§1g' DR (en sonda: ana kurulum devredilir)");
  const r1 = await devral(o);
  const rRows = await satirlar(prisma, "DR_DEVRI", { kurulumId: o.a.kurulumDbId });
  kontrol("§1g' DR: ana DEVREDILDI + iki kanal satırı (ana kuruluma bağlı)", r1.status === 200 && (await prisma.kurulum.findUniqueOrThrow({ where: { id: o.a.kurulumDbId } })).durum === "DEVREDILDI" && ikiKanal(rRows), `${r1.status} ${rRows.length}`);
  const r2 = await devral(o);
  kontrol("§2g DR tekrarı (idempotent) yeni satır DOĞURMAZ", r2.status === 200 && (await say("DR_DEVRI")) === 2);
}

async function allowlist(o: Ortam, token: string): Promise<void> {
  const { prisma } = o;
  console.log("\n§3 allowlist");
  const rows = await prisma.bildirim.findMany({ where: { OR: [{ kurulumId: o.a.kurulumDbId }, { tekillikAnahtari: `DENEME:${token}` }] } });
  const metin = JSON.stringify(rows.map((r) => r.govde));
  kontrol("§3a kanarya (açıklama · açan · gerekçe · DR gerekçesi · sebep · mesaj · taksit açıklaması) hiçbir gövdede YOK", rows.length >= 16 && !metin.includes(KANARYA), `${rows.length} satır`);
  // jsonb anahtar sırasını korumaz (uzunluk + bayt sırası): küme karşılaştırılır.
  const beklenen = JSON.stringify([...NOTIFICATION_BODY_KEYS].sort());
  const anahtarlar = rows.every((r) => JSON.stringify(Object.keys(r.govde as object).sort()) === beklenen);
  kontrol("§3b her gövdenin anahtar kümesi = allowlist", anahtarlar);
  const reddedilir = async (govde: object, ek: Record<string, unknown> = {}): Promise<string> => {
    try {
      await prisma.bildirim.create({ data: { olay: "DENEME", kanal: "EPOSTA", tekillikAnahtari: `DENEME:sed-${randomUUID()}`, govde: govde as never, ...ek } });
      return "KABUL";
    } catch (err) {
      return /violates check constraint \\?"([a-z_]+)\\?"/.exec((err as Error).message)?.[1] ?? `RED(${(err as Error).message.slice(-120)})`;
    }
  };
  const temel = notificationBody({ portalYolu: "/bildirimler" });
  const sonuclar = {
    fazla: await reddedilir({ ...temel, aciklama: "talep metni" }),
    dis: await reddedilir({ ...temel, portalYolu: "https://kotu.example/x" }),
    uzun: await reddedilir({ ...temel, konu: "x".repeat(301) }),
    nesne: await reddedilir({ ...temel, konu: { gizli: 1 } }),
    hata: await reddedilir(temel, { durum: "HATA", sonHata: "Bad Request: chat not found (token 123:abc)" }),
    sohbetMetin: await reddedilir(temel, { kanal: "TELEGRAM", durum: "HATA", sonHata: "TELEGRAM_SOHBET_TASINDI", yeniSohbetKimligi: "-100abc" }),
    sohbetBaskaKod: await reddedilir(temel, { kanal: "TELEGRAM", durum: "HATA", sonHata: "TELEGRAM_HTTP_400", yeniSohbetKimligi: "-1001234" }),
    sohbetEposta: await reddedilir(temel, { kanal: "EPOSTA", durum: "HATA", sonHata: "TELEGRAM_SOHBET_TASINDI", yeniSohbetKimligi: "-1001234" }),
  };
  const govdeSeddi = [sonuclar.fazla, sonuclar.dis, sonuclar.uzun, sonuclar.nesne].every((v) => v === "bildirim_govde_allowlist");
  const sohbetSeddi = [sonuclar.sohbetMetin, sonuclar.sohbetBaskaKod, sonuclar.sohbetEposta].every((v) => v === "bildirim_yeni_sohbet_bicimi");
  kontrol(
    "§3c DB seddi: fazla anahtar · dış bağlantı · 300+ karakter · nesne değer (allowlist) · ham hata metni (kod biçimi) · yeni sohbet kimliği yalnız SAYI, yalnız Telegram + taşınma kodunda REDDEDİLİR",
    govdeSeddi && sonuclar.hata === "bildirim_hata_kodu_bicimi" && sohbetSeddi,
    JSON.stringify(sonuclar),
  );
  const gecerli = await reddedilir(temel);
  const gecerliSohbet = await reddedilir(temel, { kanal: "TELEGRAM", durum: "HATA", sonHata: "TELEGRAM_SOHBET_TASINDI", yeniSohbetKimligi: "-1001234567890" });
  kontrol("§3d ✓K aynı yoldan geçerli gövde ve geçerli taşınma kimliği KABUL edilir (sed kör değil)", gecerli === "KABUL" && gecerliSohbet === "KABUL", `${gecerli} · ${gecerliSohbet}`);
  await prisma.bildirim.deleteMany({ where: { tekillikAnahtari: { startsWith: "DENEME:sed-" } } });
}

/**
 * §4 gövde sınırı: kodun ölçüsü PG'ninkiyle aynı; JSON.stringify'a göre sınırdaki gövde (PG'de +17 bayt) kısaltılarak
 * yazılır; uzun çok baytlı adlar ve eşsiz vekilli konu İŞ OLAYINI DÜŞÜRMEZ (destek talebi yine açılır).
 */
async function govdeSiniri(o: Ortam, ornekler: readonly NotificationBody[], b: KurulumFiksturu, bAnahtar: TestAnahtari): Promise<void> {
  const { prisma } = o;
  console.log("\n§4 gövde sınırı — içerik iş olayını ASLA düşürmez");
  const olcum = await prisma
    .$queryRawUnsafe<{ i: bigint; n: number; ok: boolean }[]>(
      `SELECT t.i, octet_length(t.x::jsonb::text)::int AS n, "bildirim_govde_gecerli"(t.x::jsonb) AS ok FROM unnest($1::text[]) WITH ORDINALITY AS t(x, i) ORDER BY t.i`,
      ornekler.map((g) => JSON.stringify(g)),
    )
    .catch((err: Error) => err);
  const farkli = olcum instanceof Error ? -1 : olcum.filter((r) => r.n !== pgJsonbTextBytes(ornekler[Number(r.i) - 1]!)).length;
  const red = olcum instanceof Error ? -1 : olcum.filter((r) => !r.ok).length;
  kontrol(
    "§4a kodun ölçüsü = PG'nin octet_length(govde::text)'i ve her gövde DB seddinden geçer (§0f'nin 400 gövdesi)",
    !(olcum instanceof Error) && olcum.length === ornekler.length && farkli === 0 && red === 0,
    olcum instanceof Error ? `PG RED: ${olcum.message.split("\n").filter(Boolean).pop()?.slice(0, 120) ?? ""}` : `${olcum.length} gövde · farklı ${farkli} · red ${red}`,
  );

  // JSON.stringify'a göre TAM 2000 bayt: eski kod kabul ederdi, PG'de 2017 → seddin reddi olayın tx'ini düşürürdü.
  const alti = { musteri: "x".repeat(300), tesis: "x".repeat(300), kurulum: "x".repeat(300), lisansNo: "x".repeat(300), sinif: "x".repeat(300), konu: "x".repeat(300) };
  const taban = { ...alti, referans: "", tarih: null, portalYolu: "/bildirimler" };
  const ref = "x".repeat(2000 - Buffer.byteLength(JSON.stringify(taban), "utf8"));
  const ham = { ...taban, referans: ref };
  const sinirda = (() => {
    try {
      return notificationBody({ ...alti, referans: ref, portalYolu: "/bildirimler" });
    } catch {
      return ham;
    }
  })();
  const yaz = async (govde: object): Promise<string> => {
    try {
      await prisma.bildirim.create({ data: { olay: "DENEME", kanal: "EPOSTA", tekillikAnahtari: `DENEME:sed-${randomUUID()}`, govde: govde as never } });
      return "KABUL";
    } catch (err) {
      return /violates check constraint \\?"([a-z_]+)\\?"/.exec((err as Error).message)?.[1] ?? "RED";
    }
  };
  const hamSonuc = await yaz(ham);
  const sinirSonuc = await yaz(sinirda);
  kontrol(
    "§4b JSON.stringify'a göre tam 2000 bayt (PG'de 2017): ham gövde seddin REDDİ; kurucu PG ölçüsüyle kısaltır → KABUL",
    Buffer.byteLength(JSON.stringify(ham), "utf8") === 2000 && pgJsonbTextBytes(ham) === 2017 && hamSonuc === "bildirim_govde_allowlist" && pgJsonbTextBytes(sinirda) <= 2000 && sinirSonuc === "KABUL",
    `ham ${pgJsonbTextBytes(ham)} → ${hamSonuc} · kurucu ${pgJsonbTextBytes(sinirda)} → ${sinirSonuc}`,
  );
  await prisma.bildirim.deleteMany({ where: { tekillikAnahtari: { startsWith: "DENEME:sed-" } } });

  // Uzun çok baytlı (3 bayt) adlar: müşteri · tesis · kurulum 200'er karakter (VARCHAR(200) tavanı).
  const uc = (n: number) => `${"€".repeat(n - 8)}${randomUUID().slice(0, 8)}`;
  const k = await prisma.kurulum.findUniqueOrThrow({ where: { id: b.kurulumDbId }, select: { tesisId: true } });
  await prisma.musteri.update({ where: { id: b.musteriId }, data: { ad: uc(200) } });
  await prisma.tesis.update({ where: { id: k.tesisId }, data: { ad: uc(200) } });
  await prisma.kurulum.update({ where: { id: b.kurulumDbId }, data: { ad: uc(200) } });
  const destek = async (konu: string) => {
    const talepId = randomUUID();
    const y = yoklamaGovdesi({ sonKiraId: null, parmakIzi: o.fpSahip });
    const r = await imzaliPost(o.genel, ENDPOINTS.SUPPORT, { kurulumId: b.kurulumId, amac: "destek", anahtar: bAnahtar, govde: { v: 1, talepId, konu, aciklama: "sınır", acan: "bekçi", panelSurum: "1.3.2", ek: null, saglik: y.saglik, ortam: ORTAM } });
    const talep = await prisma.destekTalebi.findFirst({ where: { kurulumId: b.kurulumDbId, konu: { not: "" } }, orderBy: { createdAt: "desc" } });
    const rows = await prisma.bildirim.findMany({ where: { olay: "DESTEK_TALEBI", kurulumId: b.kurulumDbId, ilgiliKayit: talep?.id ?? "00000000-0000-0000-0000-000000000000" } });
    const boy = rows.length ? (await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT max(octet_length("govde"::text))::int AS n FROM "bildirim" WHERE "ilgiliKayit" = $1::uuid`, talep!.id))[0]!.n : -1;
    return { status: r.status, kod: r.kod, rows, boy };
  };
  const uzun = await destek(`${"€".repeat(199)}\ud800`);
  const g0 = uzun.rows[0]?.govde as Record<string, string | null> | undefined;
  kontrol(
    "§4c ✓K 3 baytlık 200 karakterli adlar + eşsiz vekille biten 200 karakterlik konu: destek talebi AÇILIR, iki kanal satırı, gövde PG'de ≤ 2000, uzun alanlar '…' ile kısaltıldı",
    uzun.status === 200 && ikiKanal(uzun.rows) && uzun.boy > 0 && uzun.boy <= 2000 && !!g0 && [g0.musteri, g0.tesis, g0.kurulum, g0.konu].every((v) => typeof v === "string" && v.endsWith("…")),
    `${uzun.status} ${uzun.kod ?? ""} · ${uzun.rows.length} satır · ${uzun.boy} bayt`,
  );
  const vekil = await destek("Tartı\ud800 ekranı \udc00donuyor");
  const g1 = vekil.rows[0]?.govde as Record<string, string | null> | undefined;
  kontrol(
    "§4d eşsiz vekilli konu (kısa): destek talebi AÇILIR, konu U+FFFD ile yazılır",
    vekil.status === 200 && ikiKanal(vekil.rows) && g1?.konu === "Tartı\ufffd ekranı \ufffddonuyor",
    `${vekil.status} ${vekil.kod ?? ""} · konu ${JSON.stringify(g1?.konu ?? null)}`,
  );
}

/** §5 deneme bildirimi hızı — kullanıcı başına pencere; tekrar oynatma ve başka kullanıcı etkilenmez. */
async function denemeHizi(o: Ortam, ilkToken: string, ikinci: { cerez: string }): Promise<string[]> {
  const { prisma } = o;
  console.log("\n§5 deneme bildirimi hızı (kullanıcı başına 5 dk'da bir)");
  const { CooldownLimiter } = await import("../src/http/rate-limit");
  const yeni = randomUUID();
  const r = await deneme(o, yeni);
  const satir = await prisma.bildirim.count({ where: { tekillikAnahtari: `DENEME:${yeni}` } });
  const islem = await prisma.portalIslemi.count({ where: { clientToken: yeni } });
  const tekrarSn = (r.json.details as { tekrarSn?: number } | undefined)?.tekrarSn ?? 0;
  kontrol("§5a aynı kullanıcı, YENİ işlem kimliği pencerede → 429 HIZ_SINIRI (tekrarSn), bildirim satırı ve işlem kimliği YOK", r.status === 429 && r.kod === "HIZ_SINIRI" && tekrarSn > 0 && tekrarSn <= 300 && satir === 0 && islem === 0, `${r.status} ${r.kod ?? ""} · ${tekrarSn} sn · ${satir} satır · ${islem} işlem`);
  const tekrar = await deneme(o, ilkToken);
  kontrol("§5b ✓K aynı işlem kimliğinin tekrarı pencerede de YANITI alır (201 · idempotent-replay) — sınır tekrar oynatmayı bozmaz", tekrar.status === 201 && tekrar.basliklar.get("idempotent-replay") === "true", `${tekrar.status}`);
  const baska = randomUUID();
  const b = await portalIstek(o.tailnet, "/portal/api/bildirimler/deneme", { cerez: ikinci.cerez, govde: { clientToken: baska } });
  kontrol("§5c başka kullanıcı etkilenmez (201, iki kanal satırı)", b.status === 201 && (await prisma.bildirim.count({ where: { tekillikAnahtari: `DENEME:${baska}` } })) === 2, `${b.status}`);
  const s = new CooldownLimiter(300_000);
  const t0 = 1_000_000;
  const a1 = s.take("u", t0);
  const a2 = s.take("u", t0 + 299_000);
  const a3 = s.take("u", t0 + 300_000);
  const d1 = s.take("v", t0);
  if (d1.ok) d1.refund();
  const d2 = s.take("v", t0 + 1);
  kontrol(
    "§5d sınırlayıcı: pencerede ikinci RED (kalan sn), pencere dolunca GEÇER, iade edilen yer hemen yeniden alınır",
    a1.ok && !a2.ok && a2.retryAfterSec === 1 && a3.ok && d1.ok && d2.ok,
    JSON.stringify({ a2: a2.ok ? "GEÇTİ" : a2.retryAfterSec, a3: a3.ok, d2: d2.ok }),
  );
  return [yeni, baska];
}

async function main(): Promise<void> {
  hedefDbKapisi();
  const ornekler = statik();
  const ortam = await anahtarOrtamiKur(Date.now(), { KOPYA_PENCERE_SN: "1" });
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const sunucu = await portalSunuculariKur(ctx);
  const kurulumlar: string[] = [];
  const kullanicilar: string[] = [];
  const tokenler: string[] = [];
  try {
    await sustur(prisma);
    const aAnahtar = kurulumAnahtariUret();
    const a = await kurulumFiksturu(ctx);
    kurulumlar.push(a.kurulumDbId);
    const drAnahtar = kurulumAnahtariUret();
    const dr = await kurulumFiksturu(ctx, { sinif: "DR", tesisId: a.tesisId, musteriId: a.musteriId });
    kurulumlar.push(dr.kurulumDbId);
    const etkin = async (k: KurulumFiksturu, anahtar: TestAnahtari) => {
      const y = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, { kurulumId: k.kurulumId, amac: "etkinlestir", anahtar, govde: etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar, parmakIzi: f.parmakIzi }) });
      if (y.status !== 200) throw new Error(`etkinleştirme ${y.status} ${y.kod ?? ""}`);
      return kiraIdOf(y.json);
    };
    const sonKira = await etkin(a, aAnahtar);
    await etkin(dr, drAnahtar);
    const yonetici = await portalKullaniciAc(ctx, "SATICI_YONETICI");
    kullanicilar.push(yonetici.id);
    const cerez = (await portalGiris(sunucu.tailnet, "/portal/api", yonetici)).cerez ?? "";
    const fpYabanci = digestFingerprint({ ...HAM_PARMAK_IZI, f1: "{0a0b0c0d-0e0f-4a4b-9c9d-0e0f0a0b0c0d}", f2: "99999999-8888-7777-6666-555555555555", f3: "KANARYADISK" }, f.tuz);
    const o: Ortam = { prisma, genel: sunucu.genel, tailnet: sunucu.tailnet, cerez, a, aAnahtar, dr, drAnahtar, fpYabanci, fpSahip: f.parmakIzi, sonKira };
    const x = await ayniTx(o);
    tokenler.push(x.token);
    await ayniTxSonra(o, x);
    await tekillik(o, x);
    await allowlist(o, x.token);
    const bAnahtar = kurulumAnahtariUret();
    const b = await kurulumFiksturu(ctx);
    kurulumlar.push(b.kurulumDbId);
    await etkin(b, bAnahtar);
    await govdeSiniri(o, ornekler, b, bAnahtar);
    const ikinciKullanici = await portalKullaniciAc(ctx, "SATICI_YONETICI");
    kullanicilar.push(ikinciKullanici.id);
    const ikinciCerez = (await portalGiris(sunucu.tailnet, "/portal/api", ikinciKullanici)).cerez ?? "";
    tokenler.push(...(await denemeHizi(o, x.token, { cerez: ikinciCerez })));
  } catch (err) {
    kontrol("beklenmeyen hata", false, err instanceof Error ? (err.stack ?? err.message) : String(err));
  } finally {
    await sustur(prisma).catch(() => undefined);
    await sunucu.kapat();
    await prisma.bildirim.deleteMany({ where: { tekillikAnahtari: { in: tokenler.map((t) => `DENEME:${t}`) } } });
    await temizleKurulumlar(kurulumlar, ortam.kidler);
    await temizlePortal({ kullanicilar });
    ortam.temizle();
    await kapat();
  }
  sonuc();
}

void main();
