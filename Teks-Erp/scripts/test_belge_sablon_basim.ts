// =============================================================================
// BEKÇİ — Belge basımı ↔ tasarımcı şablonu: çözüm, donma, bayrak, SoD (T1C) · DB'li
// =============================================================================
// Çalıştırma: DATABASE_URL='postgresql://…/<ad>_test' npx tsx scripts/test_belge_sablon_basim.ts
//
// Gerçek `freezeForSource` / `reissueForSourceTx` / `getHtml` yolundan ölçer; yalnız kaynak okuyucusu
// (`fresh`) ve profil çözücüsü (`resolveProfileId`) fikstüre çevrilir (`test_belge_yuvarlama_damgasi` kalıbı).
//   §1 bayrak kapalı: varsayılan şablon yayında olsa da freeze Sistem'e düşer, snapshot'a `template` yazılmaz,
//      `/html` sonucu yalnız `html` taşır (Sistem yolunun bayt eşitliği: `test_sevk_belge_altin`)
//   §2 çözüm sırası: profil ataması > tür varsayılanı > Sistem
//   §3 yayında olmayan / arşivdeki atama atlanır + uyarı (`templateWarnings`, `/html` warnings)
//   §4 ⭐ yeniden baskı DONMUŞ sürümle: yeni sürüm yayınlansa da v1 belge v1 şablonla basılır
//   §5 reissue (v+1) yeniden çözer; "Güncel şablonla bas" canlı çözer
//   §6 bayrak kapanınca donmuş şablonlu belge yine şablonla basılır; canlı yol Sistem'e döner
//   §7 render hatası 422 TEMPLATE_RENDER_FAILED; `systemTemplate` (?sistemSablonu=1) Sistem ile basar + audit
//   §8 VOIDED filigranı şablon CSS'iyle gizlenemez (5 sonda: display none, opacity, z-index, `tekserp-` seçici, `:not(#…)`)
//   §9 ⭐ profil ezmesi şablonlu basımda da uygulanır (R4: şablon ayarı → profil ezmesi), etkin ayar donar
//   §10 SoD bayrağı: açıkken tasarlayan=yayınlayan 403 PUBLISH_SOD; başka kişi yayınlar; kapalıyken serbest
//
// ⭐ NEGATİF SONDALAR (2026-10-25, ölçüldü; dosya yedekten geri kondu):
//   (a) `buildSnapshotEnvelope`te `template: tpl.ref` satırı kaldırıldı → 16 ❌ (§2–§6, §9; §4 üçü de)
//   (b) şablonlu zarfta profil ezmesi atlandı (`if (profileId && !tpl?.ref)`) → §9 2 ❌; geri alınınca 36/0
// =============================================================================
import { randomUUID } from "node:crypto";
import { PrintedDocType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import "../src/services/shipping.service";
import {
  DOC_CONFIG_KEYS,
  getRegisteredDocBuilders,
  printedDocumentService,
  registerPrintedDocBuilder,
  type PrintedDocSnapshot,
} from "../src/services/printed-document.service";
import { SAMPLE_PRINTED_DOCS } from "../src/services/document-render/sample-data";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import type { SystemEquivalent } from "../src/services/document-template/sistem/tipler";
import { createTemplate } from "../src/services/document-template/template.service";
import { publishVersion, saveVersion } from "../src/services/document-template/version.service";
import { fixtureHedefEngeli, hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const TYPE = PrintedDocType.SHIPMENT_DISPATCH;
const TAG = `bekci-basim-${process.pid}`;
// Gerçek kullanıcılar (belge `printedById` ve audit FK'leri); seed en az iki kullanıcı yaratır.
let USER_A = "";
let USER_B = "";
const KEYS = [SETTING_KEYS.DOCUMENTS_DESIGNER_ENABLED, SETTING_KEYS.DOCUMENTS_PUBLISH_SOD_ENABLED] as const;
const savedSettings = new Map<string, { value: unknown } | null>();
const templateIds: string[] = [];
const sourceIds: string[] = [];
let profileId: string | null = null;
let defaultRowBefore: { templateId: string } | null = null;

// Fikstür kaynak: freeze/reissue gerçek; yalnız içerik okuyucusu ve profil çözücüsü sabit.
let activeProfile: string | null = null;
const real = getRegisteredDocBuilders().get(TYPE)!;
registerPrintedDocBuilder(TYPE, {
  ...real,
  fresh: async (_db, sourceId) => ({ documentNo: `TEST-T1C-${sourceId.slice(0, 8)}`, doc: SAMPLE_PRINTED_DOCS[TYPE] }),
  resolveProfileId: async () => activeProfile,
});

const codeOf = (e: unknown): string | undefined => (e instanceof AppError ? (e.details?.code as string | undefined) : undefined);
async function errCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    return codeOf(e) ?? (e instanceof Error ? e.message.slice(0, 120) : String(e));
  }
}

async function setFlag(key: string, on: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: on }, update: { value: on } });
}
const designer = (on: boolean) => setFlag(SETTING_KEYS.DOCUMENTS_DESIGNER_ENABLED, on);
const sod = (on: boolean) => setFlag(SETTING_KEYS.DOCUMENTS_PUBLISH_SOD_ENABLED, on);

/** Şablon gövdesi: işaret + belge no + profil ezmesinin görünür izi (`ayar.sections.taxNo`). */
const body = (mark: string) =>
  `<p class="m">${mark} {{ belge.no }} {% if ayar.sections.taxNo %}VKN-ACIK{% else %}VKN-KAPALI{% endif %}</p>`;
const fakeEq = (html: string, css = "p{margin:0}"): SystemEquivalent => ({ docType: TYPE, editMode: "CODE", html, css, pageSettings: {}, tableBindings: {} });

async function newTemplate(name: string, mark: string, publish: boolean) {
  const r = await createTemplate({ docType: TYPE, name: `${TAG}-${name}`, copyFrom: { kind: "system" } }, USER_A, {
    systemEquivalents: (d) => (d === TYPE ? fakeEq(body(mark)) : null),
  });
  templateIds.push(r.template.id);
  const v1 = await prisma.documentTemplateVersion.findFirstOrThrow({ where: { templateId: r.template.id, versionNo: 1 } });
  if (publish) await publishVersion(r.template.id, { versionId: v1.id, expectedPublishedVersionId: null }, USER_B);
  return { id: r.template.id, v1 };
}

type Ver = Awaited<ReturnType<typeof newTemplate>>["v1"];
async function newVersion(templateId: string, base: Ver, sourceHtml: string, css = base.css, user = USER_A) {
  const r = await saveVersion(
    templateId,
    {
      baseVersionId: base.id,
      editMode: "CODE",
      sourceHtml,
      css,
      pageSettings: base.pageSettings,
      tableBindings: base.tableBindings as Record<string, unknown>,
      settings: base.settings,
      internalFields: base.internalFields as string[],
    },
    user,
  );
  return prisma.documentTemplateVersion.findUniqueOrThrow({ where: { id: (r.version as { id: string }).id } });
}

async function freeze(): Promise<string> {
  const sourceId = randomUUID();
  sourceIds.push(sourceId);
  await prisma.$transaction((tx) => printedDocumentService.freezeForSource(tx, TYPE, sourceId));
  return sourceId;
}
async function snap(sourceId: string, version?: number): Promise<PrintedDocSnapshot> {
  const row = await prisma.printedDocument.findFirstOrThrow({
    where: { docType: TYPE, sourceId, ...(version ? { version } : {}) },
    orderBy: { version: "desc" },
    select: { snapshot: true },
  });
  return row.snapshot as unknown as PrintedDocSnapshot;
}
async function html(sourceId: string, version?: number, opts?: Parameters<typeof printedDocumentService.getHtml>[3]) {
  const r = await printedDocumentService.getHtml(TYPE, sourceId, version, opts);
  return r.data!;
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli() ?? fixtureHedefEngeli();
  if (engel) {
    check("hedef DB fixture DB'si", false, engel);
    return;
  }
  // Kalıcı tasarımcı/yayıncı fikstürleri (iş anahtarı `username`; upsert, koşumlar arası yeniden
  // kullanılır — belge `printedById` ve audit FK'leri yüzünden silinmez).
  const fixtureUser = async (username: string, fullName: string) =>
    (
      await prisma.user.upsert({
        where: { username },
        create: { username, fullName, passwordHash: "-", isActive: false },
        update: {},
        select: { id: true },
      })
    ).id;
  USER_A = await fixtureUser("bekci.t1c.tasarimci", "Bekçi Tasarımcı");
  USER_B = await fixtureUser("bekci.t1c.yayinci", "Bekçi Yayıncı");
  for (const k of KEYS) savedSettings.set(k, await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } }));
  defaultRowBefore = await prisma.documentTemplateDefault.findUnique({ where: { docType: TYPE }, select: { templateId: true } });
  await designer(true);
  await sod(false);

  const def = await newTemplate("varsayilan", "SABLON-DEF-V1", true);
  const prof = await newTemplate("profil", "SABLON-PROF", true);
  const draft = await newTemplate("taslak", "SABLON-TASLAK", false);
  const profile = await prisma.documentProfile.create({
    data: { name: `${TAG}-profil`, config: { [DOC_CONFIG_KEYS[TYPE]]: { sections: { taxNo: false } } } },
    select: { id: true },
  });
  profileId = profile.id;
  await prisma.documentTemplateDefault.upsert({ where: { docType: TYPE }, create: { docType: TYPE, templateId: def.id }, update: { templateId: def.id } });

  console.log("§1 Bayrak kapalı → Sistem, snapshot'a şablon yazılmaz");
  await designer(false);
  const sys = await freeze();
  const s1 = await snap(sys);
  check("§1 freeze `template` yazmaz", !("template" in s1) && !("templateWarnings" in s1), Object.keys(s1).join(","));
  const h1 = await html(sys);
  check("§1 /html yalnız `html` taşır (additive alan yok)", Object.keys(h1).join(",") === "html");
  check("§1 Sistem tasarımı basılır (şablon işareti yok)", h1.html.length > 1000 && !h1.html.includes("SABLON-") && !h1.html.includes("tekserp-h"));
  await designer(true);

  console.log("§2 Çözüm sırası: profil > varsayılan > Sistem");
  const onDefault = await freeze();
  check("§2 profilsiz kaynak tür varsayılanını dondurur", (await snap(onDefault)).template?.templateId === def.id);
  await prisma.documentProfileTemplate.create({ data: { profileId: profile.id, docType: TYPE, templateId: prof.id } });
  activeProfile = profile.id;
  const onProfile = await freeze();
  const s2 = await snap(onProfile);
  check("§2 profil ataması varsayılanı ezer", s2.template?.templateId === prof.id, s2.template?.name);
  check("§2 donan atıf dört alan", !!s2.template && s2.template.versionId === prof.v1.id && s2.template.versionNo === 1 && s2.template.name === `${TAG}-profil`);
  check("§2 schemaVersion 1 kalır", s2.schemaVersion === 1);
  const h2 = await html(onProfile);
  check("§2 /html şablonla basar + additive alanlar", h2.html.includes("SABLON-PROF") && h2.template?.versionNo === 1 && h2.tablesAvailable === true);

  console.log("§3 Yayında olmayan / arşivdeki atama atlanır + uyarı");
  await prisma.documentProfileTemplate.update({ where: { profileId_docType: { profileId: profile.id, docType: TYPE } }, data: { templateId: draft.id } });
  const skipDraft = await freeze();
  const s3 = await snap(skipDraft);
  check("§3 yayınsız profil ataması atlanır → varsayılan", s3.template?.templateId === def.id);
  check("§3 uyarı düşer (yayında değil)", (s3.templateWarnings ?? []).some((w) => w.includes("yayında değil")), JSON.stringify(s3.templateWarnings));
  check("§3 /html uyarıyı taşır", ((await html(skipDraft)).warnings ?? []).length > 0);
  await prisma.documentTemplate.update({ where: { id: def.id }, data: { status: "ARCHIVED" } });
  const skipAll = await freeze();
  const s3b = await snap(skipAll);
  check("§3 arşivdeki varsayılan da atlanır → Sistem", !s3b.template && (s3b.templateWarnings ?? []).some((w) => w.includes("arşivde")));
  await prisma.documentTemplate.update({ where: { id: def.id }, data: { status: "ACTIVE" } });
  await prisma.documentProfileTemplate.delete({ where: { profileId_docType: { profileId: profile.id, docType: TYPE } } });

  console.log("§4 ⭐ Yeniden baskı donmuş sürümle");
  activeProfile = null;
  const frozenV1 = await freeze();
  const v2 = await newVersion(def.id, def.v1, body("SABLON-DEF-V2"));
  await publishVersion(def.id, { versionId: v2.id, expectedPublishedVersionId: def.v1.id }, USER_B);
  const h4 = await html(frozenV1);
  check("§4 yeni sürüm yayınlandıktan sonra v1 belge v1 şablonla basılır", h4.html.includes("SABLON-DEF-V1") && !h4.html.includes("SABLON-DEF-V2"));
  check("§4 açık sürüm numarasıyla yeniden baskı da aynı", (await html(frozenV1, 1)).html.includes("SABLON-DEF-V1"));
  check("§4 /html donmuş sürüm numarasını söyler", h4.template?.versionNo === 1);

  console.log("§5 Reissue yeniden çözer; güncel şablonla bas canlı çözer");
  const live = await html(frozenV1, undefined, { useCurrentConfig: true });
  check("§5 useCurrentConfig yayındaki v2 ile basar (yazmaz)", live.html.includes("SABLON-DEF-V2") && (await snap(frozenV1)).template?.versionNo === 1);
  await prisma.$transaction((tx) => printedDocumentService.reissueForSourceTx(tx, TYPE, frozenV1, "Bekçi revizyonu", USER_A));
  const s5 = await snap(frozenV1);
  check("§5 reissue (v2 belge) yayındaki şablon sürümünü dondurur", s5.template?.versionNo === 2, String(s5.template?.versionNo));
  check("§5 reissue sonrası güncel baskı v2 şablon", (await html(frozenV1)).html.includes("SABLON-DEF-V2"));
  check("§5 eski belge sürümü (v1) hâlâ v1 şablonla basılır", (await html(frozenV1, 1)).html.includes("SABLON-DEF-V1"));

  console.log("§6 Bayrak kapanınca donmuş şablonlu belge şablonla basılır");
  await designer(false);
  check("§6 donmuş şablonlu belge şablonla basılır", (await html(onDefault)).html.includes("SABLON-DEF-V1"));
  const liveOff = await html(onDefault, undefined, { useCurrentConfig: true });
  check("§6 canlı yol (güncel şablonla bas) Sistem'e döner", !liveOff.html.includes("SABLON-") && !liveOff.template);
  await designer(true);

  console.log("§7 Render hatası 422 + Sistem şablonuyla bas");
  const broken = await newVersion(def.id, v2, `{% for i in (1..400000) %}<p>${"x".repeat(40)}</p>{% endfor %}`);
  const badSrc = randomUUID();
  sourceIds.push(badSrc);
  const goodSnap = await snap(onDefault);
  const badRow = await prisma.printedDocument.create({
    data: {
      docType: TYPE,
      sourceId: badSrc,
      version: 1,
      status: "ACTIVE",
      documentNo: `TEST-T1C-${badSrc.slice(0, 8)}`,
      snapshot: { ...goodSnap, template: { templateId: def.id, versionId: broken.id, versionNo: broken.versionNo, name: "bozuk" } } as never,
    },
  });
  check("§7 render hatası 422 TEMPLATE_RENDER_FAILED", (await errCode(html(badSrc))) === "TEMPLATE_RENDER_FAILED");
  const status = await printedDocumentService.getHtml(TYPE, badSrc).then(() => 0).catch((e: AppError) => e.statusCode);
  check("§7 HTTP durumu 422", status === 422, String(status));
  const auditBefore = await prisma.systemLog.count({ where: { recordId: badRow.id } });
  const fallback = await html(badSrc, undefined, { systemTemplate: true, actorId: USER_A });
  check("§7 systemTemplate Sistem tasarımıyla basar", fallback.html.length > 1000 && !fallback.html.includes("tekserp-h") && !fallback.template);
  await new Promise((r) => setTimeout(r, 300));
  const auditAfter = await prisma.systemLog.count({ where: { recordId: badRow.id } });
  check("§7 Sistem çıkışı audit iz bırakır", auditAfter === auditBefore + 1, `${auditBefore}→${auditAfter}`);

  console.log("§8 VOIDED filigranı şablon CSS'iyle gizlenemez");
  const probes: Array<[string, string]> = [
    ["display:none", "div,p{display:none!important}"],
    ["opacity", "body *{opacity:0!important}"],
    ["z-index", "p{position:fixed;inset:0;z-index:2147483647!important;background:#fff}"],
    ["tekserp- seçici", "#tekserp-f{display:none}"],
    [":not(#…)", "div:not(#x){visibility:hidden!important}"],
  ];
  let base = broken;
  for (const [label, css] of probes) {
    let v: Ver | null = null;
    const saved = await errCode((async () => { v = await newVersion(def.id, base, body("SABLON-CSS"), css); })());
    if (!v) {
      check(`§8 ${label}: kayıtta reddedilir`, saved !== "OK", saved);
      continue;
    }
    base = v;
    const vv = v as Ver;
    const src = randomUUID();
    sourceIds.push(src);
    await prisma.printedDocument.create({
      data: {
        docType: TYPE, sourceId: src, version: 1, status: "VOIDED", voidReason: "Bekçi", voidedAt: new Date(),
        documentNo: `TEST-T1C-${src.slice(0, 8)}`,
        snapshot: { ...goodSnap, template: { templateId: def.id, versionId: vv.id, versionNo: vv.versionNo, name: "css" } } as never,
      },
    });
    const out = await errCode(html(src));
    if (out !== "OK") {
      check(`§8 ${label}: filigransız basılamaz (422)`, out === "TEMPLATE_RENDER_FAILED", out);
      continue;
    }
    const h = (await html(src)).html;
    const wm = h.indexOf('id="tekserp-f"');
    const layer = h.indexOf("@layer");
    const tplCss = h.indexOf(css.slice(0, 8));
    check(
      `§8 ${label}: filigran öğesi + öncelikli katman kuralı şablon CSS'inden önce`,
      wm > 0 && h.includes("İPTAL") && h.includes("display:block!important") && layer >= 0 && (tplCss < 0 || layer < tplCss),
    );
  }

  console.log("§9 ⭐ Profil ezmesi şablonlu basımda uygulanır (R4)");
  await prisma.documentProfileTemplate.create({ data: { profileId: profile.id, docType: TYPE, templateId: prof.id } });
  activeProfile = profile.id;
  const r4 = await freeze();
  const s9 = await snap(r4);
  check("§9 etkin ayar (şablon + profil) donar", s9.template?.templateId === prof.id && (s9.docConfigOverride as { sections?: { taxNo?: boolean } } | null)?.sections?.taxNo === false);
  check("§9 profil ezmesi basımda görünür (VKN-KAPALI)", (await html(r4)).html.includes("VKN-KAPALI"));
  activeProfile = null;
  check("§9 profilsiz kaynakta şablon ayarı (VKN-ACIK)", (await html(await freeze())).html.includes("VKN-ACIK"));

  console.log("§10 SoD bayrağı");
  const sodV = await newVersion(prof.id, prof.v1, body("SABLON-SOD"), prof.v1.css, USER_A);
  await sod(true);
  check("§10 açıkken tasarlayan yayınlayamaz (PUBLISH_SOD)", (await errCode(publishVersion(prof.id, { versionId: sodV.id, expectedPublishedVersionId: prof.v1.id }, USER_A))) === "PUBLISH_SOD");
  check("§10 açıkken başka kişi yayınlar", (await errCode(publishVersion(prof.id, { versionId: sodV.id, expectedPublishedVersionId: prof.v1.id }, USER_B))) === "OK");
  await sod(false);
  const sodV2 = await newVersion(prof.id, sodV, body("SABLON-SOD2"), prof.v1.css, USER_A);
  check("§10 kapalıyken tasarlayan yayınlayabilir", (await errCode(publishVersion(prof.id, { versionId: sodV2.id, expectedPublishedVersionId: sodV.id }, USER_A))) === "OK");
}

async function cleanup(): Promise<void> {
  registerPrintedDocBuilder(TYPE, real);
  if (sourceIds.length) await prisma.printedDocument.deleteMany({ where: { docType: TYPE, sourceId: { in: sourceIds } } });
  if (profileId) await prisma.documentProfileTemplate.deleteMany({ where: { profileId } });
  if (defaultRowBefore) {
    await prisma.documentTemplateDefault.update({ where: { docType: TYPE }, data: { templateId: defaultRowBefore.templateId } });
  } else {
    await prisma.documentTemplateDefault.deleteMany({ where: { docType: TYPE, templateId: { in: templateIds } } });
  }
  if (templateIds.length) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);
      await tx.documentTemplate.updateMany({ where: { id: { in: templateIds } }, data: { publishedVersionId: null } });
      await tx.documentTemplateVersion.deleteMany({ where: { templateId: { in: templateIds } } });
      await tx.documentTemplate.deleteMany({ where: { id: { in: templateIds } } });
    });
  }
  if (profileId) await prisma.documentProfile.delete({ where: { id: profileId } });
  for (const [key, row] of savedSettings) {
    if (row === null) await prisma.systemSetting.deleteMany({ where: { key } });
    else await prisma.systemSetting.update({ where: { key }, data: { value: row.value as never } });
  }
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (e) {
      console.error("temizlik hatası:", e);
      fail++;
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail ? 1 : 0;
  });
