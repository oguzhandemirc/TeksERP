// =============================================================================
// test_rapor_tanimi — kayıtlı/özel rapor arka ucu (Raporlar v2, R1-KAYIT; plan §3.2–3.4)
// =============================================================================
// Ölçtükleri: §0 iki izin kodu katalogda (`test_permission_catalog` devri) · §1 tanım şeması (strict, JSON yolu, öneri, başvurusuz/tanımsız parametre;
// §1i–j R2-VERI oluşturucu süzgeç fikstürü `Electron/…/custom/data/filter-contract.fixture.json` geçer, "veya" + bir seviye iç grup derlenir
// (iç içe grup, analizde "veya", parametreli/sırasız "arasında" reddedilir; "Tümü" parametresi "veya" grubunu bütünüyle düşürür); §1k R2-KOD kod modu mesajları Türkçe + yol dilbilgisi) · §2 sistem
// tanımı boot uzlaştırması (idempotent, katalogdan çıkan ARSIV) + fikstür gövdeleri derleyiciden geçer ·
// §3 clientToken replay DÖRT durum · §4 sürüm DEĞİŞMEZ + aktif sürüm claim'i 409 + eşzamanlı kayıt + sürüm replay'i ·
// §5 durum geçişi atomik · §6 paylaşım veri yetkisi VERMEZ (izinsiz blok "yetkisiz") + görünürlük 404 ·
// §7 bozuk tanım 400 + yol + rozet · §8 tek varsayılan ön ayar · §9 audit satırları · §10 anlık görüntü
// (replay, itibarıyla, audit muafiyeti beyanı) · §11 kategori derinliği + yalnız boş kategori pasife.
//
// NEGATİF SONDALAR (2026-10-25 ÖLÇÜLDÜ, cp + md5 ile birebir geri alındı; taban 58/0):
//   S1 `definition-run.ts` izinsiz blok "tamam" sayıldı (blok izni atlandı) → §6d ❌ 1
//   S2 `saveNewVersion` claim WHERE'inden beklenen sürüm çıkarıldı → §4b + §4c ❌ 2 (§4d yarışı P2002 ile yine 409)
//   S3 `audit-muafiyeti.ts` ReportSnapshot beyanı bozuldu → §10d ❌ 1
//   S4 `blockQuerySchema` `.strict()` → `.passthrough()` → §1e ❌ 1
//   S5 (R2-VERI) oluşturucu fikstüründe `suzgec.rules` → `kurallar` (plan §3.2'den sapma) → §1i ❌ 1
//   S6 (R2-KOD) `zodMessage` tür adı çevirisi kaldırıldı ("Beklenen tür: string") → §1k ❌ 1 ·
//   S7 (R2-KOD) `safeParse` `reportInput` kaldırıldı (yanlış tür "Zorunlu alan eksik" der) → §1k ❌ 1
//   S8 (rapor küçükler, 2026-10-26) `settleFilter` "veya"da "Tümü" koşulunu yalnız düşürdü (grubu değil) → §1j ❌ 1
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AUDIT_EXEMPT_MODELS } from "./lib/audit-muafiyeti";
import { AppError } from "../src/utils/app-error";
import { REPORT_CATALOG } from "../src/constants/report-catalog";
import { PERMISSION_CATALOG, REPORT_BUILDER_PERMISSION, REPORT_PUBLISH_PERMISSION } from "../src/constants/permission-catalog";
import { MODULE_SETTING_KEY_BY_FLAG } from "../src/services/system-setting.service";
import type { AccessContext } from "../src/services/reports/semantik/izin";
import { compileQuery } from "../src/services/reports/semantik/derleyici";
import { checkReportDefinition } from "../src/services/reports/semantik/rapor-tanimi.schema";
import { SYSTEM_TEMPLATES } from "../src/services/reports/semantik/sistem-sablonlari";
import { toSemanticInput, resolveParams } from "../src/services/reports/semantik/definition-run";
import { FILTER_OPERATORS } from "../src/services/reports/semantik/tipler";
import * as defs from "../src/services/rapor-tanimi.service";
import * as runs from "../src/services/rapor-kosu.service";
import * as versions from "../src/services/rapor-surum.service";
import * as shares from "../src/services/rapor-paylasim.service";
import * as cats from "../src/services/rapor-kategori.service";
import * as presets from "../src/services/rapor-on-ayar.service";
import * as snaps from "../src/services/rapor-snapshot.service";
import { reconcileReportDefinitionCatalog } from "../src/jobs/report-definition-catalog.job";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const T = `TRT${Date.now().toString(36)}`;
const ALL_MODULES = new Set(Object.values(MODULE_SETTING_KEY_BY_FLAG));

async function expectError(fn: () => Promise<unknown>): Promise<{ status: number; code: string | undefined; details: Record<string, unknown> } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    const details = (e.details ?? {}) as Record<string, unknown>;
    return { status: e.statusCode, code: details.code as string | undefined, details };
  }
}

/** Fikstür gövdesi: iki küp (satış + finans), parametreli süzgeç, tablo + metin + anlatı. */
function fixtureBody(title = "Satış ve alacak özeti") {
  return {
    surum: 1,
    baslik: title,
    parametreler: [
      { ad: "donem", tur: "tarihAraligi", varsayilan: "son30gun" },
      { ad: "kiyas", tur: "kiyas", varsayilan: "prev" },
      { ad: "musteri", tur: "boyutSecimi", boyut: "musteri", coklu: true },
    ],
    bloklar: [
      { id: "a1", tur: "anaSayi", sorgu: { kup: "sevk", olculer: ["sevk.brutMetre"], zaman: { param: "donem", kiyas: "$kiyas" }, suzgec: { combinator: "and", rules: [{ field: "musteri", operator: "in", value: "$musteri" }] } } },
      { id: "f1", tur: "anaSayi", sorgu: { kup: "finans", olculer: ["alacak.acikToplam"], zaman: { param: "donem" } } },
      { id: "t1", tur: "tablo", sorgu: { kup: "sevk", olculer: ["sevk.brutMetre"], boyutlar: ["musteri"], zaman: { param: "donem" } } },
      { id: "m1", tur: "metin", metin: "Sevk rakamları brüttür." },
      { id: "n1", tur: "anlati", kurallar: ["anaSayiKiyas"], enFazla: 3 },
    ],
    duzen: [{ i: "a1", x: 0, y: 0, w: 4, h: 2 }, { i: "t1", x: 4, y: 0, w: 8, h: 6 }],
  };
}

function ctxFor(userId: string, permissions: string[]): AccessContext {
  return { userId, permissions, openModuleKeys: ALL_MODULES };
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(engel);
    process.exit(2);
  }
  // §0 `test_permission_catalog` dinamik izin argümanlarını (rapor-tanimi route/servis, çalıştırıcı) buraya devreder.
  const catalogCodes = new Set<string>(PERMISSION_CATALOG.map((p) => p.code));
  check("§0 report:builder ve report:publish izin kataloğunda", catalogCodes.has(REPORT_BUILDER_PERMISSION) && catalogCodes.has(REPORT_PUBLISH_PERMISSION) && REPORT_BUILDER_PERMISSION === "report:builder" && REPORT_PUBLISH_PERMISSION === "report:publish");
  // §0b R3-ANALIZ: sistem şablonlarının gövdesi kodda — her biri tanım şemasından geçer, izni katalogda.
  for (const t of SYSTEM_TEMPLATES) {
    const c = checkReportDefinition(t.govde);
    check(`§0b sistem şablonu derlenir: ${t.ad}`, c.gecerli && catalogCodes.has(t.izin) && c.gerekenIzinler.every((p) => p === t.izin), c.gecerli ? c.gerekenIzinler.join(",") : JSON.stringify(c.hatalar));
  }
  const mk = async (k: string) => (await prisma.user.create({ data: { username: `${T}-${k}`.toLowerCase(), passwordHash: "x", fullName: `${T} ${k}` }, select: { id: true } })).id;
  const ownerId = await mk("sahip");
  const viewerId = await mk("izleyen");
  const strangerId = await mk("yabanci");
  const owner: defs.Actor = { userId: ownerId, permissions: ["report:sales", "report:finance", "report:builder"] };
  const viewer: defs.Actor = { userId: viewerId, permissions: ["report:sales"] };
  const stranger: defs.Actor = { userId: strangerId, permissions: ["report:sales", "report:builder"] };
  const createdDefs: string[] = [];
  const createdCats: string[] = [];
  try {
    // ── §1 Şema ───────────────────────────────────────────────────────────────
    const good = checkReportDefinition(fixtureBody());
    check("§1a fikstür gövdesi geçerli", good.gecerli, good.gecerli ? "" : JSON.stringify(good.hatalar));
    check("§1b gereken izinler gövdeden türedi", good.gecerli && good.gerekenIzinler.includes("report:sales") && good.gerekenIzinler.includes("report:finance"));
    const typo = fixtureBody();
    typo.bloklar[0]!.sorgu!.olculer = ["sevk.brutMetr"];
    const t1 = checkReportDefinition(typo);
    const i1 = t1.gecerli ? null : t1.hatalar[0];
    check("§1c bilinmeyen ölçü → JSON yolu", i1?.yol === "bloklar[0].sorgu.olculer[0]", JSON.stringify(i1));
    check("§1d \"şunu mu demek istediniz\" önerisi", i1?.oneri === "sevk.brutMetre", String(i1?.oneri));
    const extra = fixtureBody() as Record<string, unknown> & ReturnType<typeof fixtureBody>;
    (extra.bloklar[0]!.sorgu as Record<string, unknown>).sql = "SELECT 1";
    const t2 = checkReportDefinition(extra);
    check("§1e allowlist dışı alan (sorgu.sql) reddedilir", !t2.gecerli && t2.hatalar.some((h) => h.yol === "bloklar[0].sorgu" && h.mesaj.includes("sql")), JSON.stringify(t2.hatalar));
    const unused = fixtureBody();
    unused.parametreler.push({ ad: "bos", tur: "kiyas", varsayilan: "none" } as never);
    const t3 = checkReportDefinition(unused);
    check("§1f başvurusuz parametre reddedilir", !t3.gecerli && t3.hatalar.some((h) => h.yol === "parametreler[3]"));
    const undef = fixtureBody();
    undef.bloklar[0]!.sorgu!.zaman = { param: "donem", kiyas: "$kiyass" };
    const t4 = checkReportDefinition(undef);
    check("§1g tanımsız `$ad` reddedilir + öneri", !t4.gecerli && t4.hatalar.some((h) => h.yol === "bloklar[0].sorgu.zaman.kiyas" && h.oneri === "$kiyas"), JSON.stringify(t4.gecerli ? [] : t4.hatalar));
    const t5 = checkReportDefinition({ surum: 1, baslik: "x", bloklar: [{ id: "a", tur: "grafik", gorsel: "echarts", sorgu: { kup: "sevk", olculer: ["sevk.brutMetre"] } }] });
    check("§1h serbest grafik türü yok (8 tür)", !t5.gecerli && t5.hatalar.some((h) => h.yol === "bloklar[0].gorsel"));
    // §1i R2-VERI: oluşturucunun süzgeç fikstürü (Electron vitest aynı dosyayı kurucu çıktısıyla eşler) şemadan + derleyiciden geçer.
    const builder = JSON.parse(readFileSync(join(__dirname, "../../Electron/src/pages/Reports/_v2/custom/data/filter-contract.fixture.json"), "utf8")) as { operatorler: string[]; govde: unknown };
    const bf = checkReportDefinition(builder.govde);
    let builderCompiled = false;
    if (bf.gecerli) {
      const b0 = bf.govde.bloklar[0]!;
      if (b0.tur === "tablo") compileQuery(toSemanticInput(b0.sorgu, resolveParams(bf.govde, {}), bf.govde, { asTable: true, refresh: false }), ctxFor(ownerId, ["report:*"]));
      builderCompiled = b0.tur === "tablo";
    }
    check("§1i oluşturucu süzgeç fikstürü geçerli + derlenir; işleç listesi sunucuyla aynı", bf.gecerli && builderCompiled && JSON.stringify(builder.operatorler) === JSON.stringify(FILTER_OPERATORS), bf.gecerli ? "" : JSON.stringify(bf.hatalar));
    // §1j "veya" + bir seviye iç grup derlenir (fikstürün ikinci gövdesi); sınırlar Türkçe yolla reddedilir.
    const tree = JSON.parse(readFileSync(join(__dirname, "../../Electron/src/pages/Reports/_v2/custom/data/filter-contract.fixture.json"), "utf8")) as { agacGovde: unknown };
    const t6 = checkReportDefinition(tree.agacGovde);
    let treeInput: ReturnType<typeof toSemanticInput> | null = null;
    if (t6.gecerli && t6.govde.bloklar[0]!.tur === "tablo") {
      treeInput = toSemanticInput(t6.govde.bloklar[0]!.sorgu, resolveParams(t6.govde, {}), t6.govde, { asTable: true, refresh: false });
      compileQuery(treeInput, ctxFor(ownerId, ["report:*"]));
    }
    check("§1j \"veya\" kökü + iç grup + \"arasında\" geçerli ve derlenir", t6.gecerli && treeInput?.suzgecBaglaci === "veya" && treeInput.suzgec.length === 2, t6.gecerli ? JSON.stringify(treeInput?.suzgec) : JSON.stringify(t6.hatalar));
    const sq = (suzgec: unknown) => ({ surum: 1, baslik: "x", bloklar: [{ id: "a", tur: "tablo", sorgu: { kup: "sevk", olculer: ["sevk.brutMetre"], suzgec } }] });
    const leaf = { field: "yon", operator: "=", value: "EXPORT" };
    const nestedTwice = checkReportDefinition(sq({ combinator: "or", rules: [{ combinator: "and", rules: [{ combinator: "or", rules: [leaf] }] }] }));
    const betweenRef = checkReportDefinition({ ...sq({ combinator: "and", rules: [{ field: "musteri", operator: "between", value: ["$m", "$m"] }] }), parametreler: [{ ad: "m", tur: "boyutSecimi", boyut: "musteri" }] });
    const betweenOne = checkReportDefinition(sq({ combinator: "and", rules: [{ field: "yon", operator: "between", value: "EXPORT" }] }));
    const analysisOr = checkReportDefinition({ surum: 1, baslik: "x", bloklar: [{ id: "n", tur: "analiz", yontem: "kiKare", kup: "hata", x: "vardiya", y: "hataGrubu", suzgec: { combinator: "or", rules: [leaf] } }] });
    check(
      "§1j2 iç içe grup · parametreli/sırasız \"arasında\" · analizde \"veya\" reddedilir",
      !nestedTwice.gecerli && !betweenRef.gecerli && betweenRef.hatalar.some((h) => h.yol.endsWith(".value")) && betweenRef.hatalar.some((h) => h.yol.endsWith(".operator")) && !betweenOne.gecerli && !analysisOr.gecerli,
      JSON.stringify([nestedTwice.gecerli, betweenRef.gecerli ? [] : betweenRef.hatalar.map((h) => h.yol), betweenOne.gecerli, analysisOr.gecerli]),
    );
    // "Tümü" (boş seçim) her satırı tutar: "ve"de koşul düşer, "veya"da bütün grup düşer (süzgeç daralmaz).
    const allBody = { surum: 1, baslik: "x", parametreler: [{ ad: "m", tur: "boyutSecimi", boyut: "musteri" }], bloklar: [{ id: "a", tur: "tablo", sorgu: { kup: "sevk", olculer: ["sevk.brutMetre"], suzgec: { combinator: "and", rules: [leaf, { combinator: "or", rules: [{ field: "musteri", operator: "in", value: "$m" }, { field: "yon", operator: "=", value: "DOMESTIC" }] }] } } }] };
    const ab = checkReportDefinition(allBody);
    const settled = ab.gecerli && ab.govde.bloklar[0]!.tur === "tablo" ? toSemanticInput(ab.govde.bloklar[0]!.sorgu, resolveParams(ab.govde, {}), ab.govde, { asTable: true, refresh: false }) : null;
    check("§1j3 \"Tümü\" parametresi \"veya\" grubunu bütünüyle düşürür (yalnız yön = yurtdışı kalır)", JSON.stringify(settled?.suzgec) === JSON.stringify([{ alan: "yon", islec: "=", deger: "EXPORT" }]), JSON.stringify(settled?.suzgec));
    // §1k R2-KOD: kod modu hataları Türkçe ve konumlanabilir yol taşır (istemci yolu satır/sütuna eşler, şemayı kopyalamaz).
    const codeCases: Array<[string, unknown, string, string?]> = [
      ["yanlış ölçü adı", { ...fixtureBody(), bloklar: [{ id: "a", tur: "anaSayi", sorgu: { kup: "sevk", olculer: ["sevk.brutMetr"] } }] }, "bloklar[0].sorgu.olculer[0]"],
      ["tanımsız $param", { surum: 1, baslik: "x", bloklar: [{ id: "a", tur: "anaSayi", sorgu: { kup: "sevk", olculer: ["sevk.brutMetre"], tavan: "$yok" } }] }, "bloklar[0].sorgu.tavan"],
      ["grafik türü kapalı küme dışı", { surum: 1, baslik: "x", bloklar: [{ id: "a", tur: "grafik", gorsel: "radar", sorgu: { kup: "sevk", olculer: ["sevk.brutMetre"] } }] }, "bloklar[0].gorsel"],
      ["yanlış tür", { surum: 1, baslik: 7, bloklar: [{ id: "a", tur: "metin", metin: "x" }] }, "baslik", "Beklenen tür: metin."],
      ["eksik alan", { surum: 1, bloklar: [{ id: "a", tur: "metin", metin: "x" }] }, "baslik", "Zorunlu alan eksik."],
      ["tanınmayan kök alan", { surum: 1, baslik: "x", sql: "SELECT 1", bloklar: [{ id: "a", tur: "metin", metin: "x" }] }, "(kök)"],
    ];
    const pathGrammar = /^(\(kök\)|[A-Za-z_][\w]*(\[\d+\]|\.[A-Za-z_$][\w$]*)*)$/;
    const englishLeak = /\b(Invalid|expected|received|Required|string|number|boolean|undefined)\b/;
    const codeFails = codeCases.filter(([, bodyIn, wantPath, wantText]) => {
      const r = checkReportDefinition(bodyIn);
      return r.gecerli || !r.hatalar.some((h) => h.yol === wantPath && (!wantText || h.mesaj === wantText)) || r.hatalar.some((h) => !pathGrammar.test(h.yol) || englishLeak.test(h.mesaj) || !/[a-zçğıöşü]/i.test(h.mesaj));
    });
    check("§1k kod modu: 6 bozuk gövdede beklenen yol + Türkçe mesaj + istemcinin ayrıştırdığı yol dilbilgisi", codeFails.length === 0, codeFails.map(([n, b]) => `${n}: ${JSON.stringify(checkReportDefinition(b).hatalar)}`).join(" | "));

    // ── §2 Sistem tanımları ──────────────────────────────────────────────────
    await reconcileReportDefinitionCatalog();
    const live = REPORT_CATALOG.filter((e) => e.nesil === "v2" && e.hazir).map((e) => e.key);
    const sys = await prisma.reportDefinition.findMany({ where: { kind: "SISTEM", key: { in: live } }, select: { key: true, status: true, activeVersionId: true } });
    check("§2a her hazır v2 satırın SISTEM tanımı var", sys.length === live.length && sys.every((s) => s.status === "YAYINDA"), `${sys.length}/${live.length}`);
    check("§2b SISTEM tanımının sürümü yok (gövde kod servisi)", sys.every((s) => s.activeVersionId === null));
    const again = await reconcileReportDefinitionCatalog();
    check("§2c uzlaştırma idempotent", again.kategoriEklenen + again.tanimEklenen + again.tanimGuncellenen + again.arsivlenen === 0, JSON.stringify(again));
    const kayitli = await prisma.reportCategory.findUnique({ where: { code: cats.DEFAULT_CATEGORY_CODE }, select: { id: true } });
    const stale = await prisma.reportDefinition.create({ data: { kind: "SISTEM", key: `${T}/yok`, name: "katalogda yok", categoryId: kayitli!.id, status: "YAYINDA", visibility: "HERKES" }, select: { id: true } });
    createdDefs.push(stale.id);
    await reconcileReportDefinitionCatalog();
    const staleAfter = await prisma.reportDefinition.findUnique({ where: { id: stale.id }, select: { status: true } });
    check("§2d katalogda olmayan SISTEM satırı ARSIV'e geçer (silinmez)", staleAfter?.status === "ARSIV");
    // §2f R1-VARYANT: temel rapor sayfası kendi SISTEM tanımını anahtarla bulur (ön ayar/varyant kaydı) — aynı tek where
    const byKey = await defs.listDefinitions({ kapsam: "sistem", anahtar: "sales/siparis-talep", limit: 5 }, { userId: ownerId, permissions: ["report:sales"] });
    check("§2f `anahtar` süzgeci tek SISTEM tanımı döner, özet şeridi aynı where'den", byKey.items.length === 1 && byKey.items[0]!.anahtar === "sales/siparis-talep" && byKey.ozet.toplam === 1, `${byKey.items.length} · ${byKey.ozet.toplam}`);
    const params = resolveParams(good.gecerli ? good.govde : (null as never), {});
    let compiled = 0;
    const full = ctxFor(ownerId, ["report:*"]);
    if (good.gecerli) {
      for (const b of good.govde.bloklar) {
        if (b.tur !== "anaSayi" && b.tur !== "tablo") continue;
        compileQuery(toSemanticInput(b.sorgu, params, good.govde, { asTable: b.tur === "tablo", refresh: false }), full);
        compiled++;
      }
    }
    check("§2e fikstür gövdesinin sorguları derleyiciden geçer", compiled === 3, String(compiled));

    // ── §3 Oluşturma + replay dört durum ─────────────────────────────────────
    const token = crypto.randomUUID();
    const d1 = await defs.createDefinition({ govde: fixtureBody(), durum: "TASLAK", clientToken: token }, owner);
    createdDefs.push(d1.id);
    check("§3a ① ilk deneme yaratır (v1 aktif)", d1.aktifSurum?.no === 1 && d1.tur === "OZEL" && d1.kategori.kod === cats.DEFAULT_CATEGORY_CODE);
    const d1b = await defs.createDefinition({ govde: fixtureBody(), durum: "TASLAK", clientToken: token }, owner);
    const cnt = await prisma.reportDefinition.count({ where: { clientToken: token } });
    check("§3b ② aynı token + aynı gövde → aynı kayıt", d1b.id === d1.id && cnt === 1);
    const e3 = await expectError(() => defs.createDefinition({ govde: fixtureBody("Başka başlık"), durum: "TASLAK", clientToken: token }, owner));
    check("§3c ③ aynı token + başka gövde → 409 CLIENT_TOKEN_COLLISION", e3?.status === 409 && e3.code === "CLIENT_TOKEN_COLLISION", JSON.stringify(e3));
    const token4 = crypto.randomUUID();
    const d4 = await defs.createDefinition({ govde: fixtureBody(), durum: "TASLAK", clientToken: token4 }, owner);
    createdDefs.push(d4.id);
    await defs.changeStatus(d4.id, "TASLAK", "ARSIV", owner);
    const e4 = await expectError(() => defs.createDefinition({ govde: fixtureBody(), durum: "TASLAK", clientToken: token4 }, owner));
    check("§3d ④ arşive kaldırılmışın replay'i → 409 RAPOR_TANIMI_ARSIVDE", e4?.status === 409 && e4.code === "RAPOR_TANIMI_ARSIVDE", JSON.stringify(e4));
    const bad = await expectError(() => defs.createDefinition({ govde: typo, durum: "TASLAK" }, owner));
    check("§3e geçersiz gövde → 400 RAPOR_TANIMI_BOZUK + yol", bad?.status === 400 && bad.code === "RAPOR_TANIMI_BOZUK" && JSON.stringify(bad.details.hatalar).includes("bloklar[0].sorgu.olculer[0]"));

    // ── §4 Sürümler ──────────────────────────────────────────────────────────
    const v1 = await prisma.reportDefinitionVersion.findFirstOrThrow({ where: { definitionId: d1.id, versionNo: 1 } });
    const v2 = await versions.saveNewVersion(d1.id, { govde: fixtureBody("İkinci hâl"), beklenenSurumId: v1.id, not: "başlık" }, owner);
    const afterV2 = await prisma.reportDefinition.findUniqueOrThrow({ where: { id: d1.id }, select: { activeVersionId: true } });
    check("§4a yeni sürüm aktif olur", v2.no === 2 && afterV2.activeVersionId === v2.id);
    const stale409 = await expectError(() => versions.saveNewVersion(d1.id, { govde: fixtureBody("Bayat"), beklenenSurumId: v1.id }, owner));
    check("§4b bayat beklenen sürüm → 409 RAPOR_SURUM_CAKISMASI", stale409?.status === 409 && stale409.code === "RAPOR_SURUM_CAKISMASI", JSON.stringify(stale409));
    const v1again = await prisma.reportDefinitionVersion.findUniqueOrThrow({ where: { id: v1.id } });
    const vcount = await prisma.reportDefinitionVersion.count({ where: { definitionId: d1.id } });
    check("§4c eski sürüm satırı DEĞİŞMEDİ, bayat deneme satır bırakmadı", JSON.stringify(v1again.body) === JSON.stringify(v1.body) && vcount === 2, `sürüm ${vcount}`);
    const race = await Promise.allSettled([
      versions.saveNewVersion(d1.id, { govde: fixtureBody("Yarış A"), beklenenSurumId: v2.id }, owner),
      versions.saveNewVersion(d1.id, { govde: fixtureBody("Yarış B"), beklenenSurumId: v2.id }, owner),
    ]);
    const won = race.filter((r) => r.status === "fulfilled").length;
    const lost = race.filter((r) => r.status === "rejected" && r.reason instanceof AppError && (r.reason.details as { code?: string }).code === "RAPOR_SURUM_CAKISMASI").length;
    check("§4d eşzamanlı iki kayıt: biri kazanır, öteki 409", won === 1 && lost === 1, `kazanan ${won} · 409 ${lost}`);
    const del = await expectError(() => versions.refuseVersionRemoval(d1.id, v1.id, owner));
    check("§4e sürüm silme → 409 RAPOR_SURUMU_DEGISMEZ", del?.status === 409 && del.code === "RAPOR_SURUMU_DEGISMEZ");
    // §4f yeni sürüm ucu da idempotent (K-KAYIT): aynı token → aynı sürüm (beklenen sürüm artık bayat olsa da), farklı gövde → çakışma.
    const activeNow = await prisma.reportDefinition.findUniqueOrThrow({ where: { id: d1.id }, select: { activeVersionId: true } });
    const vtoken = crypto.randomUUID();
    const vr1 = await versions.saveNewVersion(d1.id, { govde: fixtureBody("Token hâli"), beklenenSurumId: activeNow.activeVersionId!, clientToken: vtoken }, owner);
    const vr2 = await versions.saveNewVersion(d1.id, { govde: fixtureBody("Token hâli"), beklenenSurumId: activeNow.activeVersionId!, clientToken: vtoken }, owner);
    const vtcount = await prisma.reportDefinitionVersion.count({ where: { clientToken: vtoken } });
    check("§4f sürüm replay'i aynı sürümü döndürür, ikinci satır yok", vr1.id === vr2.id && vr1.no === vr2.no && vtcount === 1, `${vr1.id} ${vr2.id} ${vtcount}`);
    const vcol = await expectError(() => versions.saveNewVersion(d1.id, { govde: fixtureBody("Başka hâl"), beklenenSurumId: vr1.id, clientToken: vtoken }, owner));
    check("§4g aynı token farklı gövde → 409 CLIENT_TOKEN_COLLISION", vcol?.status === 409 && vcol.code === "CLIENT_TOKEN_COLLISION", JSON.stringify(vcol));

    // ── §5 Durum ─────────────────────────────────────────────────────────────
    const pub = await defs.changeStatus(d1.id, "TASLAK", "YAYINDA", owner);
    check("§5a TASLAK → YAYINDA", pub.durum === "YAYINDA");
    const st409 = await expectError(() => defs.changeStatus(d1.id, "TASLAK", "YAYINDA", owner));
    check("§5b bayat beklenen durum → 409", st409?.status === 409 && st409.code === "RAPOR_DURUM_CAKISMASI");
    const st400 = await expectError(() => defs.changeStatus(d1.id, "YAYINDA", "TASLAK", owner));
    check("§5c izinsiz geçiş → 400", st400?.status === 400 && st400.code === "RAPOR_DURUM_GECISI_GECERSIZ");

    // ── §6 Paylaşım ≠ veri yetkisi ───────────────────────────────────────────
    const hidden = await expectError(() => runs.runDefinition(d1.id, { parametreler: {}, yenile: true }, ctxFor(viewerId, viewer.permissions as string[]), viewer));
    check("§6a paylaşılmamış özel rapor → 404 (varlığı sızmaz)", hidden?.status === 404);
    const herkes = await expectError(() => shares.replaceShares(d1.id, { gorunurluk: "HERKES", paylasimlar: [] }, owner));
    check("§6b HERKES report:publish ister → 403", herkes?.status === 403 && herkes.code === "RAPOR_YAYIN_YETKISI_YOK");
    const cands = await shares.listShareCandidates(owner, T);
    check("§6g paylaşım adayları: kendisi yok, yalnız kimlik + ad", cands.some((c) => c.id === viewerId) && !cands.some((c) => c.id === ownerId) && cands.every((c) => Object.keys(c).sort().join() === "ad,id"), JSON.stringify(cands.slice(0, 3)));
    await shares.replaceShares(d1.id, { gorunurluk: "PAYLASIMLI", paylasimlar: [{ kullaniciId: viewerId, yetki: "GOR" }] }, owner);
    const run = await runs.runDefinition(d1.id, { parametreler: {}, yenile: true }, ctxFor(viewerId, viewer.permissions as string[]), viewer);
    const byId = new Map(run.bloklar.map((b) => [b.id, b]));
    check("§6c paylaşılan kullanıcı izinli bloğu görür", byId.get("a1")?.durum === "tamam");
    check("§6d izinsiz blok \"yetkisiz\" döner, rapor düşmez", byId.get("f1")?.durum === "yetkisiz" && run.bloklar.length === 5, JSON.stringify(byId.get("f1")));
    const ownerRun = await runs.runDefinition(d1.id, { parametreler: { musteri: [] }, yenile: true }, ctxFor(ownerId, owner.permissions as string[]), owner);
    check("§6e sahip (finans izni var) aynı bloğu görür", ownerRun.bloklar.find((b) => b.id === "f1")?.durum === "tamam");
    const notEditor = await expectError(() => versions.saveNewVersion(d1.id, { govde: fixtureBody(), beklenenSurumId: v2.id }, viewer));
    check("§6f GOR paylaşımı düzenleme vermez → 403", notEditor?.status === 403);
    const strangerSee = await expectError(() => defs.getDefinition(d1.id, stranger));
    check("§6g paylaşım dışı kullanıcı → 404", strangerSee?.status === 404);
    const badParam = await expectError(() => runs.runDefinition(d1.id, { parametreler: { yok: 1 }, yenile: false }, ctxFor(ownerId, owner.permissions as string[]), owner));
    check("§6h tanımda olmayan parametre → 400", badParam?.status === 400 && badParam.code === "RAPOR_PARAMETRE_GECERSIZ");
    const runRows = await prisma.reportRun.count({ where: { definitionId: d1.id } });
    check("§6i koşu satırı tanım + sürüme bağlı", runRows >= 1, String(runRows));

    // ── §7 Bozuk tanım ───────────────────────────────────────────────────────
    const broken = await prisma.reportDefinition.create({ data: { kind: "OZEL", name: `${T} bozuk`, categoryId: kayitli!.id, ownerId, status: "YAYINDA" }, select: { id: true } });
    createdDefs.push(broken.id);
    const bv = await prisma.reportDefinitionVersion.create({ data: { definitionId: broken.id, versionNo: 1, body: typo as never, requiredPermissions: [], createdById: ownerId }, select: { id: true } });
    await prisma.reportDefinition.update({ where: { id: broken.id }, data: { activeVersionId: bv.id } });
    const be = await expectError(() => runs.runDefinition(broken.id, { parametreler: {}, yenile: false }, ctxFor(ownerId, owner.permissions as string[]), owner));
    const brokenFlag = await prisma.reportDefinition.findUniqueOrThrow({ where: { id: broken.id }, select: { isBroken: true } });
    check("§7a silinmiş ölçü → 400 RAPOR_TANIMI_BOZUK + JSON yolu", be?.status === 400 && be.code === "RAPOR_TANIMI_BOZUK" && JSON.stringify(be.details.hatalar).includes("bloklar[0].sorgu.olculer[0]"));
    check("§7b \"bozuk\" rozeti işaretlendi", brokenFlag.isBroken === true);

    // ── §8 Ön ayarlar ────────────────────────────────────────────────────────
    const pA = await presets.createPreset(d1.id, { ad: "A", parametreler: { donem: "son7gun" }, paylasimli: false, varsayilan: true }, owner);
    const pB = await presets.createPreset(d1.id, { ad: "B", parametreler: { donem: "buAy" }, paylasimli: true, varsayilan: true }, owner);
    const defaults = await prisma.reportPreset.count({ where: { definitionId: d1.id, ownerId, isDefault: true } });
    const aNow = await prisma.reportPreset.findUniqueOrThrow({ where: { id: pA.id }, select: { isDefault: true } });
    check("§8a ikinci varsayılan birinciyi düşürür (kullanıcı × rapor tek)", defaults === 1 && !aNow.isDefault && pB.varsayilan);
    const direct = await prisma.reportPreset.create({ data: { definitionId: d1.id, ownerId, name: "C", params: {}, isDefault: true } }).then(() => "yazıldı", () => "P2002");
    check("§8b DB partial unique ikinci varsayılanı keser", direct === "P2002");
    const pr = await Promise.allSettled([1, 2].map((n) => presets.createPreset(d1.id, { ad: `Y${n}`, parametreler: {}, paylasimli: false, varsayilan: true }, owner)));
    const after = await prisma.reportPreset.count({ where: { definitionId: d1.id, ownerId, isDefault: true } });
    const prBad = pr.filter((r) => r.status === "rejected" && !(r.reason instanceof AppError && r.reason.statusCode === 409)).length;
    check("§8c eşzamanlı varsayılan: yine tek, kaybeden 409", after === 1 && prBad === 0, `varsayılan ${after}`);
    const pBad = await expectError(() => presets.createPreset(d1.id, { ad: "Z", parametreler: { donem: "dunden" }, paylasimli: false, varsayilan: false }, owner));
    check("§8d tanımla uyuşmayan parametre → 400", pBad?.status === 400);
    const viewerList = await presets.listPresets(d1.id, viewer);
    check("§8e paylaşılan kullanıcı yalnız paylaşımlı ön ayarı görür", viewerList.length === 1 && viewerList[0]!.ad === "B");

    // ── §9 Audit ─────────────────────────────────────────────────────────────
    const logs = await prisma.systemLog.findMany({ where: { recordId: { in: [d1.id, v2.id, pA.id] } }, select: { tableName: true, recordId: true } });
    const has = (t: string, id: string) => logs.some((l) => l.tableName === t && l.recordId === id);
    check("§9a tanım CREATE/UPDATE audit'li", has("REPORT_DEFINITION", d1.id));
    check("§9b sürüm CREATE audit'li", has("REPORT_DEFINITION_VERSION", v2.id));
    check("§9c paylaşım + ön ayar audit'li", has("REPORT_SHARE", d1.id) && has("REPORT_PRESET", pA.id));

    // ── §10 Anlık görüntü ────────────────────────────────────────────────────
    const stoken = crypto.randomUUID();
    const s1 = await snaps.takeSnapshot(d1.id, { parametreler: { donem: "son7gun" }, clientToken: stoken }, ctxFor(ownerId, owner.permissions as string[]), owner);
    const s2 = await snaps.takeSnapshot(d1.id, { parametreler: { donem: "son7gun" }, clientToken: stoken }, ctxFor(ownerId, owner.permissions as string[]), owner);
    const scount = await prisma.reportSnapshot.count({ where: { clientToken: stoken } });
    check("§10a görüntü replay'i ikinci satır üretmez", s1.id === s2.id && scount === 1);
    // Koşu ile aynı biçim: yalnız fabrika saati; "itibarıyla" ekini istemci basar (çift ek olmasın).
    check("§10b \"itibarıyla\" metni fabrika saatiyle, eksiz basılır", /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}(:\d{2})?$/.test(s1.itibariylaMetni), s1.itibariylaMetni);
    const sc = await expectError(() => snaps.takeSnapshot(d1.id, { parametreler: { donem: "buAy" }, clientToken: stoken }, ctxFor(ownerId, owner.permissions as string[]), owner));
    check("§10c görüntü token'ı başka parametreyle → 409", sc?.status === 409 && sc.code === "CLIENT_TOKEN_COLLISION");
    check("§10d ReportSnapshot audit muafiyeti BEYANLI (TELEMETRI)", AUDIT_EXEMPT_MODELS.some((m) => m.model === "ReportSnapshot" && m.sinif === "TELEMETRI"));
    const other = await expectError(() => snaps.getSnapshot(s1.id, viewer));
    check("§10e görüntüyü yalnız alan açar", other?.status === 404);

    // ── §11 Kategoriler ──────────────────────────────────────────────────────
    const root = await cats.createCategory({ ad: `${T} kök` }, ownerId);
    createdCats.push(root.id);
    const child = await cats.createCategory({ ad: `${T} alt`, ustId: root.id }, ownerId);
    createdCats.push(child.id);
    const deep = await expectError(() => cats.createCategory({ ad: `${T} torun`, ustId: child.id }, ownerId));
    check("§11a üçüncü seviye → 400", deep?.status === 400 && deep.code === "RAPOR_KATEGORI_DERINLIK");
    await defs.updateMeta(d1.id, { kategoriId: child.id }, owner);
    const full409 = await expectError(() => cats.deactivateCategory(child.id, ownerId));
    check("§11b dolu kategori pasife alınamaz → 409", full409?.status === 409 && full409.code === "RAPOR_KATEGORI_BOS_DEGIL");
    await defs.updateMeta(d1.id, { kategoriId: kayitli!.id }, owner);
    const off = await cats.deactivateCategory(child.id, ownerId);
    check("§11c boşalan kategori pasife alınır", off.aktif === false);
    const sysCat = await expectError(() => cats.deactivateCategory(kayitli!.id, ownerId));
    check("§11d sistem kategorisi pasife alınamaz", sysCat?.status === 409 && sysCat.code === "RAPOR_KATEGORI_SISTEM");
  } finally {
    // Fikstür temizliği (yalnız bu koşumun satırları, FK sırasıyla).
    const users = [ownerId, viewerId, strangerId];
    await prisma.reportSnapshot.deleteMany({ where: { definitionId: { in: createdDefs } } });
    await prisma.reportRun.deleteMany({ where: { userId: { in: users } } });
    await prisma.reportPreset.deleteMany({ where: { definitionId: { in: createdDefs } } });
    await prisma.reportShare.deleteMany({ where: { definitionId: { in: createdDefs } } });
    await prisma.reportDefinition.updateMany({ where: { id: { in: createdDefs } }, data: { activeVersionId: null } });
    await prisma.reportDefinitionVersion.deleteMany({ where: { definitionId: { in: createdDefs } } });
    await prisma.reportDefinition.deleteMany({ where: { id: { in: createdDefs } } });
    await prisma.reportCategory.deleteMany({ where: { id: { in: [...createdCats].reverse() }, parentId: { not: null } } });
    await prisma.reportCategory.deleteMany({ where: { id: { in: createdCats } } });
    await prisma.systemLog.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
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
    await pool?.end?.();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
