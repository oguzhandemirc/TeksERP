// =============================================================================
// ÖDENMİŞ TARİH (P) — lisans v2 §1.1 (K5): P'nin TEK kaynağı `src/services/paid-through.ts` (`odenmisTarihi`).
//   §1 ⭐ formül vektörleri (tasarım §1.1 tablosu, fabrika sözleşmesi — L2-5 "P = sözleşme sonu"nu kiradaki
//      `odenmisTarih` ile `gecerlilikBitis`in EŞİTLİĞİNDEN çıkarır): peşin/vadeli ve demo → P = geçerlilik bitişi ·
//      taksitli → P = sıradaki ÖDENMEMİŞ kalemin vadesi < geçerlilik bitişi (vade + uzatma) · kalıcı → ikisi null ·
//      ödenen/iptal kalem ve pasif plan yok sayılır · GECIKTI ödenmemiştir · vade sözleşme sonundan sonraysa sözleşme sonu.
//   §2 bilgi bandı tahmini (K1): P − 30 g penceresinde yalnız internetsizken (son alışveriş > 7 g) ya da P sözleşme sonuyken.
//   §3 TEK KAYNAK: `src/` içinde `odenmisTarih` özelliğine yazılan her değer P'nin türetilmiş sonucundan (paidThrough)
//      gelir; `odenmisTarihi(` yalnız paid-through.ts'te çağrılır (TS AST taraması, protokol aynası hariç).
//   §4 ⭐ gerçek uç: etkinleştirme/yoklama kirası P'yi taşır — kalıcı → null; vadeli → geçerlilik bitişi; taksit planı →
//      ilk vade; ÖDEME ONAYINDA sıradaki vadeye KENDİLİĞİNDEN ilerler; son ödeme → null. Kira teslim edilen HAK'ın
//      baytına bağlıdır (`hakOzeti` → `checkLeaseBinding` geçer). Eski fabrika: yeni alanlar opsiyonel, `v` = 1.
//   §5 P modelinin geçerliliği (yetenek + HAK ufku + kira alanı) ve portal görünümü.
// ⭐ KALICI SONDA ✓K: §3 tarayıcı sentetik ihlali (geçerlilik bitişini doğrudan `odenmisTarih`e yazan kod) yakalar ve
//    türetilmiş değeri geçirir · §5 yeteneksiz/ufuksuz kurulumda P modeli YOK.
// Koşum: npx tsx scripts/run-all-tests.ts odenmis_tarih   (yalnız *_test DB)
// =============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { DAY_MS, ENDPOINTS, LeaseSchema, checkLeaseBinding, jwsDigest, verifyEntitlement, verifyLease } from "../src/lisans-protokol";
import { kurulumAnahtariUret } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { odenmisTarihi, reminderBandVisible, type InstallmentPlanLike, type PaidThrough } from "../src/services/paid-through";
import {
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  hedefDbKapisi,
  imzaliPost,
  kapat,
  kiraIdOf,
  kiraYuku,
  kontrol,
  kurulumFiksturu,
  portalSunuculariKur,
  sonuc,
  temizleKurulumlar,
  ufukluHakSurumu,
  yoklamaGovdesi,
} from "./lib/test-ortam";

const SRC = path.resolve(__dirname, "..", "src");
const gun = (n: number, taban = Date.UTC(2027, 0, 15)) => new Date(taban + n * DAY_MS);
const plan = (kalemler: InstallmentPlanLike["kalemler"], aktif = true): InstallmentPlanLike => ({ aktif, kalemler });
const esit = (p: PaidThrough, tarih: Date | null, tur: PaidThrough["tur"]) => (p.tarih?.getTime() ?? null) === (tarih?.getTime() ?? null) && p.tur === tur;

function formul(): void {
  console.log("§1 formül vektörleri (tasarım §1.1 tablosu)");
  const D = gun(0);
  const v1 = gun(10);
  const v2 = gun(40);
  const uzatma = 15 * DAY_MS;
  const pesin = odenmisTarihi({ gecerlilikBitis: D }, []);
  kontrol("§1a peşin/vadeli: P = sözleşme sonu = gecerlilikBitis (fabrikada eşitlik → 'sözleşme sonu')", esit(pesin, D, "SOZLESME_SONU") && pesin.tarih?.getTime() === D.getTime());
  kontrol("§1b demo: P = demo bitişi (aynı biçim)", esit(odenmisTarihi({ gecerlilikBitis: gun(30) }, []), gun(30), "SOZLESME_SONU"));
  const taksitBitis = new Date(v1.getTime() + uzatma);
  const taksit = odenmisTarihi({ gecerlilikBitis: taksitBitis }, [plan([{ vade: v1, durum: "BEKLIYOR" }, { vade: v2, durum: "BEKLIYOR" }])]);
  kontrol("§1c ⭐ taksitli: P = sıradaki ödenmemiş vade; gecerlilikBitis = vade + 15 → P < gecerlilikBitis", esit(taksit, v1, "TAKSIT") && taksit.tarih!.getTime() < taksitBitis.getTime());
  kontrol("§1d ödenen kalem atlanır (P = sonraki vade)", esit(odenmisTarihi({ gecerlilikBitis: new Date(v2.getTime() + uzatma) }, [plan([{ vade: v1, durum: "ODENDI" }, { vade: v2, durum: "BEKLIYOR" }])]), v2, "TAKSIT"));
  const gecmis = gun(-20);
  kontrol("§1e GECIKTI ödenmemiştir: P geçmişte kalır (fabrikada ek süre/kısıtlı merdiveni işler)", esit(odenmisTarihi({ gecerlilikBitis: new Date(gecmis.getTime() + uzatma) }, [plan([{ vade: gecmis, durum: "GECIKTI" }, { vade: v2, durum: "BEKLIYOR" }])]), gecmis, "TAKSIT"));
  kontrol(
    "§1f IPTAL kalem ve PASİF plan yok sayılır",
    esit(odenmisTarihi({ gecerlilikBitis: D }, [plan([{ vade: gun(-5), durum: "IPTAL" }]), plan([{ vade: gun(-3), durum: "BEKLIYOR" }], false)]), D, "SOZLESME_SONU"),
  );
  kontrol("§1g kalıcı (ödemesi tamam): P = null, gecerlilikBitis = null", esit(odenmisTarihi({ gecerlilikBitis: null }, []), null, "SURESIZ"));
  kontrol("§1h taksit vadesi sözleşme sonundan SONRAYSA P = sözleşme sonu (P ≤ gecerlilikBitis)", esit(odenmisTarihi({ gecerlilikBitis: D }, [plan([{ vade: gun(5), durum: "BEKLIYOR" }])]), D, "SOZLESME_SONU"));
  kontrol("§1i eşit tarihte sözleşme sonu kazanır (fabrika eşitlikten 'sözleşme sonu' okur)", esit(odenmisTarihi({ gecerlilikBitis: D }, [plan([{ vade: D, durum: "BEKLIYOR" }])]), D, "SOZLESME_SONU"));
  kontrol("§1j süre sınırı olmayan HAK + bekleyen taksit → P = vade", esit(odenmisTarihi({ gecerlilikBitis: null }, [plan([{ vade: v1, durum: "BEKLIYOR" }])]), v1, "TAKSIT"));
}

function bant(): void {
  console.log("\n§2 bilgi bandı tahmini (K1)");
  const P = gun(0);
  const t = P.getTime();
  const sozlesme: PaidThrough = { tarih: P, tur: "SOZLESME_SONU" };
  const taksit: PaidThrough = { tarih: P, tur: "TAKSIT" };
  const cevrimici = t - 29 * DAY_MS - 3_600_000;
  kontrol("§2a P − 31 g → bant yok", !reminderBandVisible(sozlesme, null, t - 31 * DAY_MS));
  kontrol("§2b ⭐ P − 29 g, internetli TAKSİT → bant YOK (her ay görünmez)", !reminderBandVisible(taksit, cevrimici, t - 29 * DAY_MS));
  kontrol("§2c P − 29 g, 8 gündür alışveriş yok (internetsiz) TAKSİT → bant var", reminderBandVisible(taksit, t - 37 * DAY_MS, t - 29 * DAY_MS));
  kontrol("§2d P − 29 g, internetli ama P SÖZLEŞME SONU → bant var", reminderBandVisible(sozlesme, cevrimici, t - 29 * DAY_MS));
  kontrol("§2e P geçti ya da süresiz → bilgi bandı yok (ek süre ayrı kademe)", !reminderBandVisible(sozlesme, null, t) && !reminderBandVisible({ tarih: null, tur: "SURESIZ" }, null, t));
}

// ---------------------------------------------------------------- §3 tek kaynak

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return f === "lisans-protokol" ? [] : tsFiles(p);
    return f.endsWith(".ts") ? [p] : [];
  });
}

/**
 * P'nin türetilmiş değeri: `paidThrough…` / `paid` (paidThroughOf sonucu) ya da onu döndüren görünüm; ya da zaten
 * türetilmiş bir `…odenmisTarih` alanının aynen aktarımı (DB'de böyle bir kolon YOK — kaynağı yine türetimdir).
 */
const DERIVED = /\bpaid(Through)?\b|\bpaidThrough(Of|View)\b|\.paidThrough\b|^[A-Za-z_$][\w$]*(\?)?\.odenmisTarih$/;

function violations(name: string, text: string): string[] {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n) && n.name.getText(sf) === "odenmisTarih" && !DERIVED.test(n.initializer.getText(sf))) {
      out.push(`${name}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} odenmisTarih ← ${n.initializer.getText(sf).slice(0, 60)}`);
    }
    if (ts.isCallExpression(n) && n.expression.getText(sf) === "odenmisTarihi" && !name.endsWith("paid-through.ts")) {
      out.push(`${name}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} odenmisTarihi() paid-through.ts dışında`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function tekKaynak(): void {
  console.log("\n§3 tek kaynak (AST)");
  const files = tsFiles(SRC);
  const all = files.flatMap((f) => violations(path.relative(SRC, f), readFileSync(f, "utf8")));
  const yazanlar = files.filter((f) => /\bodenmisTarih\s*:/.test(readFileSync(f, "utf8"))).map((f) => path.relative(SRC, f));
  kontrol("§3a tarayıcı gerçekten ölçüyor (kira basımı dahil en az iki yazan dosya)", yazanlar.includes(path.join("services", "lease.service.ts")) && yazanlar.length >= 2, yazanlar.join(", "));
  kontrol("§3b ⭐ `odenmisTarih` yalnız türetilmiş P'den yazılır; `odenmisTarihi()` yalnız paid-through.ts'te", all.length === 0, all.join(" | "));
  const ihlal = violations("sahte.ts", "const k = { odenmisTarih: hak.gecerlilikBitis?.toISOString() ?? null }; odenmisTarihi(hak, []);");
  const temiz = violations("sahte.ts", "const k = { odenmisTarih: paid.tarih ? paid.tarih.toISOString() : null, b: { odenmisTarih: file.odenmisTarih } };");
  const aktarimKilifi = violations("sahte.ts", "const k = { odenmisTarih: file.odenmisTarih ?? hak.gecerlilikBitis };");
  kontrol(
    "§3c ✓K sentetik ihlal (geçerlilik bitişini doğrudan yazan + dışarıdan formül çağrısı + aktarım kılıfında bitiş) yakalanır, türetilmiş değer ve düz aktarım geçer",
    ihlal.length === 2 && aktarimKilifi.length === 1 && temiz.length === 0,
    [...ihlal, ...aktarimKilifi].join(" | "),
  );
}

// ---------------------------------------------------------------- §4 · §5 gerçek uç

async function uc(): Promise<void> {
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const s = await import("../src/services/sanction.service");
  const { paidThroughView } = await import("../src/portal/paid-through-view");
  const sunucu = await portalSunuculariKur(ctx);
  const kurulumlar: string[] = [];
  try {
    console.log("\n§4 gerçek uç — kira P taşır, ödeme onayında ilerler");
    const k = await kurulumFiksturu(ctx);
    kurulumlar.push(k.kurulumDbId);
    const anahtar = kurulumAnahtariUret();
    const et = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, { kurulumId: k.kurulumId, amac: "etkinlestir", anahtar, govde: etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar, parmakIzi: f.parmakIzi }) });
    let son = kiraIdOf(et.json);
    const yokla = async () => {
      const y = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, { kurulumId: k.kurulumId, amac: "yokla", anahtar, govde: yoklamaGovdesi({ sonKiraId: son, parmakIzi: f.parmakIzi }) });
      if (y.status !== 200) throw new Error(`yoklama ${y.status} ${y.kod ?? ""}`);
      son = kiraIdOf(y.json);
      return kiraYuku(y.json);
    };
    const kEt = kiraYuku(et.json);
    kontrol("§4a kalıcı HAK: etkinleştirme kirası `odenmisTarih: null`, gecerlilikBitis null", et.status === 200 && kEt.odenmisTarih === null && kEt.gecerlilikBitis === null, `${et.status}`);
    const lease = verifyLease(et.json.kira, f.kokler);
    const hak = verifyEntitlement(et.json.hak, f.kokler);
    kontrol(
      "§4b kira teslim edilen HAK'ın baytına bağlı: hakOzeti = jwsDigest(HAK) ve checkLeaseBinding geçer",
      lease.ok && hak.ok && kEt.hakOzeti === jwsDigest(String(et.json.hak)) && checkLeaseBinding(lease.value, hak.value).ok,
    );
    const eskiBicim = { ...kEt };
    for (const alan of ["odenmisTarih", "hakOzeti", "iptalSira", "kapanis", "parmakIziKurali"]) delete eskiBicim[alan];
    kontrol("§4c eski fabrika uyumu: `v` = 1 ve yeni alanlar olmadan da kira şeması geçer (eski doğrulayıcı atar)", kEt.v === 1 && LeaseSchema.safeParse(eskiBicim).success);

    const D = new Date(Date.now() + 90 * DAY_MS);
    await s.setValidityEnd({ installationDbId: k.kurulumDbId, validUntil: D, reason: "bekçi: vadeli sözleşme", actor: "bekci" });
    const kVadeli = await yokla();
    kontrol("§4d ⭐ vadeli: P = geçerlilik bitişi (kirada odenmisTarih === gecerlilikBitis)", kVadeli.odenmisTarih === D.toISOString() && kVadeli.gecerlilikBitis === D.toISOString(), String(kVadeli.odenmisTarih));

    const v1 = new Date(Date.now() + 10 * DAY_MS);
    const v2 = new Date(Date.now() + 40 * DAY_MS);
    const p = await s.createInstallmentPlan({ installationDbId: k.kurulumDbId, description: "bekçi taksidi", items: [{ dueAt: v1, amount: "100" }, { dueAt: v2, amount: "100" }], actor: "bekci" });
    const kTaksit = await yokla();
    kontrol(
      "§4e ⭐ taksitli: P = ilk vade, gecerlilikBitis = vade + 15 (eski derleme bugünkü gibi) → P < gecerlilikBitis",
      kTaksit.odenmisTarih === v1.toISOString() && kTaksit.gecerlilikBitis === new Date(v1.getTime() + 15 * DAY_MS).toISOString(),
      `${String(kTaksit.odenmisTarih)} · ${String(kTaksit.gecerlilikBitis)}`,
    );
    await s.recordInstallmentPayment({ itemId: p.kalemler[0]!.id, actor: "bekci" });
    const kOdendi = await yokla();
    kontrol("§4f ⭐ ödeme onayı → sonraki kira P'yi SIRADAKİ vadeye taşır (kendiliğinden)", kOdendi.odenmisTarih === v2.toISOString() && kOdendi.gecerlilikBitis === new Date(v2.getTime() + 15 * DAY_MS).toISOString(), String(kOdendi.odenmisTarih));
    await s.recordInstallmentPayment({ itemId: p.kalemler[1]!.id, actor: "bekci" });
    const kTamam = await yokla();
    kontrol("§4g son taksit ödendi → P = null ve gecerlilikBitis = null (süresiz)", kTamam.odenmisTarih === null && kTamam.gecerlilikBitis === null);

    console.log("\n§5 P modeli ve portal görünümü");
    const gorunum = () => paidThroughView(prisma, k.kurulumDbId, Date.now());
    const g1 = await gorunum();
    kontrol("§5a ✓K yetenek bildirmeyen + ufuksuz HAK: P modeli YOK (eski çapa)", g1 !== null && g1 !== undefined && g1.pModeli === false && g1.tur === "SURESIZ" && g1.internetVar === true);
    await ufukluHakSurumu(f, k.hakId, 400);
    const y = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, {
      kurulumId: k.kurulumId,
      amac: "yokla",
      anahtar,
      govde: yoklamaGovdesi({ sonKiraId: son, parmakIzi: f.parmakIzi, v2: { yetenekler: ["odenmis-tarih"] } }),
    });
    const g2 = await gorunum();
    kontrol("§5b yetenek + ufuklu HAK + P'li kira → P modeli VAR; yanıt yeni HAK'ı taşır", y.status === 200 && typeof y.json.hak === "string" && g2?.pModeli === true, `${y.status} ${String(g2?.pModeli)}`);
    const V = new Date(Date.now() + 20 * DAY_MS);
    await s.setValidityEnd({ installationDbId: k.kurulumDbId, validUntil: V, reason: "bekçi: sözleşme sonu", actor: "bekci" });
    const g3 = await gorunum();
    kontrol(
      "§5c portal: P (sözleşme sonu, 20 g) + son alışveriş + bant tahmini (internetli ama sözleşme sonu → görünür)",
      g3?.tur === "SOZLESME_SONU" && g3.tarih?.getTime() === V.getTime() && g3.sonAlisveris !== null && g3.bantGorunurTahmini === true,
      JSON.stringify(g3),
    );
  } finally {
    await sunucu.kapat();
    await temizleKurulumlar(kurulumlar, ortam.kidler);
    ortam.temizle();
  }
}

async function main(): Promise<void> {
  hedefDbKapisi();
  console.log("=== Ödenmiş tarih (P) — tek kaynak ===");
  formul();
  bant();
  tekKaynak();
  await uc();
  await kapat();
  sonuc();
}

main().catch(async (err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  await kapat();
  process.exit(1);
});
