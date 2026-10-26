// =============================================================================
// BEKÇİ — Belge şablonu modeli: değişmez sürüm, claim'ler, arşiv/silme, P-d (T1B)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_belge_sablon_modeli.ts   (DB'li; .env test DB'si)
//
// ÖLÇÜLENLER:
//   §1 P-d dondurma (saf): ayarNormalize · columns.*.shown → internalFields · language en|auto uyarısı
//   §2 Oluşturma: eşleniksiz türde 409 NO_SYSTEM_EQUIVALENT · sahte eşlenikle v1 + dondurulmuş ayar
//   §3 Token replay dört durum: ilk deneme · replay aynı kayıt · gövde çakışması 409 · eşzamanlı aynı token tek satır
//   §4 TRIGGER: içerik UPDATE reddi · yayın damgası NULL→değer bir kez · yayınlı sürüm DELETE reddi
//   §5 Paralel aynı-base sürüm kaydı → 1 başarı + 409 TEMPLATE_VERSION_STALE; aynı içerik yeni sürüm açmaz
//   §6 Yayın: paralel aynı-beklenen yayın → 1 başarı + 409 · güvensiz içerik 400 · render hatası 400
//   §7 SoD ayarı açıkken aynı kişi 403 PUBLISH_SOD (ayar satırı birebir geri)
//   §8 Arşiv: atanmış şablon 409 + liste (tx geri alınır) · arşivli şablon atanamaz
//   §9 Silme: yalnız hiç yayınlanmamış taslak; yayınlanmış 409 TEMPLATE_PUBLISHED
//   §5e–g Geri alma (T5 "bu sürümden taslak"): eski içerik → YENİ sürüm; ileri sürümler durur · liste yazan adını taşır
//   §6f–g Yeniden yayın: eski sürüm beklenen işaretçiyle geri yayına alınır; ilk yayın damgası değişmez
//
// ⭐ NEGATİF SONDALAR (2026-10-24, ölçüldü):
//   (a) `DROP TRIGGER document_template_versions_block_tamper` (geçici SQL) → §4 KIRMIZI; trigger geri kurulunca yeşil.
//   (b) version.service publishVersion claim'i `update({ where: { id } })`e çevrildi → §6a/§6b KIRMIZI (iki yayın da geçti, iki damga).
//   (c) (T5, 2026-10-25) saveVersion "aynı içerik" denetimi son sürüm yerine HERHANGİ sürümle kıyaslandı + listVersions
//       yazan adı düşürüldü → §5e/§5g/§9a KIRMIZI (geri alma yeni sürüm açmadı); geri alınınca 48/0.
// =============================================================================
import { randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { getContract, internalFieldsOf } from "../src/services/document-template/sozlesme/kayit";
import { freezeSystemSettings } from "../src/services/document-template/contract-view.service";
import type { SystemEquivalent } from "../src/services/document-template/sistem/tipler";
import { createTemplate, archiveTemplate, unarchiveTemplate, deleteTemplate, deletePreview } from "../src/services/document-template/template.service";
import { listVersions, saveVersion, publishVersion, PUBLISH_SOD_SETTING_KEY } from "../src/services/document-template/version.service";
import { setDefault } from "../src/services/document-template/assignment.service";
import { readDocumentsConfig } from "../src/services/system-setting.service";
import { bypassReplayQueue } from "../src/services/helpers/token-replay.helper";

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

const DOC = "SHIPMENT_DISPATCH";
const PREFIX = `bekci-sablon-${process.pid}`;
const createdIds: string[] = [];
let sodRow: { value: unknown } | null | undefined;

/** jsonb anahtarları sıralar — kıyas anahtar sırasından bağımsız. */
const canon = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canon).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`
      : JSON.stringify(v ?? null);

const codeOf = (e: unknown): string | undefined => (e instanceof AppError ? (e.details?.code as string | undefined) : undefined);
async function errCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    return codeOf(e) ?? (e instanceof Error ? e.message.slice(0, 120) : String(e));
  }
}

const fakeEq = (html: string): SystemEquivalent => ({ docType: DOC, editMode: "CODE", html, css: "p{margin:0}", pageSettings: {}, tableBindings: {} });
const lookupWith = (html: string) => (d: string) => (d === DOC ? fakeEq(html) : null);

async function newTemplate(name: string, html = "<p>Sevk irsaliyesi</p>", userId: string) {
  const r = await createTemplate({ docType: DOC, name: `${PREFIX}-${name}`, copyFrom: { kind: "system" } }, userId, { systemEquivalents: lookupWith(html) });
  createdIds.push(r.template.id);
  const v1 = await prisma.documentTemplateVersion.findFirstOrThrow({ where: { templateId: r.template.id, versionNo: 1 } });
  return { t: r.template, v1 };
}

const content = (v: { editMode: string; css: string; pageSettings: unknown; settings: unknown; internalFields: unknown }, sourceHtml: string) => ({
  editMode: v.editMode as "VISUAL" | "CODE",
  sourceHtml,
  css: v.css,
  pageSettings: v.pageSettings as Record<string, unknown>,
  tableBindings: {},
  settings: v.settings as Record<string, unknown>,
  internalFields: v.internalFields as string[],
});

async function main(): Promise<void> {
  console.log("=== Belge şablonu modeli bekçisi ===\n");
  const user = await prisma.user.findFirst({ where: { deletedAt: null }, select: { id: true }, orderBy: { createdAt: "asc" } });
  if (!user) throw new Error("Test DB'sinde kullanıcı yok (seed koşulmadı).");
  const U = user.id;
  const contract = getContract(DOC);

  // ── §1 P-d ──────────────────────────────────────────────────────────────
  const internal = internalFieldsOf(contract).find((a) => a.tablo && a.kaynakKolon);
  check("§1 körlük zemini: sözleşmede kolonlu iç alan var", !!internal, internal?.kod ?? "yok");
  if (internal) {
    const raw = { columns: { [internal.tablo!]: { shown: [internal.kaynakKolon] } }, language: "en" };
    const f = freezeSystemSettings(contract, { shipmentDispatch: raw } as never);
    check("§1a columns.*.shown iç kolonu internalFields'e taşındı", f.internalFields.includes(internal.kod), f.internalFields.join(","));
    check("§1b language en → uyarı", f.warnings.length === 1);
    check("§1c settings = ayarNormalize(genel ayar)", JSON.stringify(f.settings) === JSON.stringify(contract.ayarNormalize(raw)));
    check("§1d normalize sonrası dil Türkçe", (f.settings as { language?: unknown }).language !== "en", `language=${String((f.settings as { language?: unknown }).language)}`);
    const plainF = freezeSystemSettings(contract, {} as never);
    check("§1e ayarsız kurulumda uyarı yok, iç alan yok", plainF.warnings.length === 0 && plainF.internalFields.length === 0);
  }

  // ── §2 Oluşturma ────────────────────────────────────────────────────────
  check(
    "§2a eşleniği olmayan türde 409 NO_SYSTEM_EQUIVALENT",
    (await errCode(createTemplate({ docType: DOC, name: `${PREFIX}-yok`, copyFrom: { kind: "system" } }, U, { systemEquivalents: () => null }))) ===
      "NO_SYSTEM_EQUIVALENT",
  );
  const A = await newTemplate("a", "<p>Sevk irsaliyesi</p>", U);
  const frozenNow = freezeSystemSettings(contract, await readDocumentsConfig());
  check("§2b sahte eşlenikle şablon + v1 doğdu", A.t.latestVersionNo === 1 && A.t.copiedFrom === "system" && A.v1.versionNo === 1);
  check("§2c v1 ayarı kopyalama anındaki etkin genel ayar", canon(A.v1.settings) === canon(contract.ayarNormalize(frozenNow.settings)));
  check("§2d aynı türde aynı ad 409 TEMPLATE_NAME_TAKEN", (await errCode(newTemplate("a", undefined, U))) === "TEMPLATE_NAME_TAKEN");

  // ── §3 Token replay ─────────────────────────────────────────────────────
  const tok = randomUUID();
  const body = { docType: DOC, name: `${PREFIX}-tok`, copyFrom: { kind: "blank" as const }, clientToken: tok };
  const r1 = await createTemplate(body, U);
  createdIds.push(r1.template.id);
  const r2 = await createTemplate(body, U);
  check("§3a ilk deneme kayıt yarattı", !!r1.template.id);
  check("§3b aynı token + aynı gövde → aynı kayıt (replay)", r2.template.id === r1.template.id);
  check("§3c aynı token + farklı gövde → 409 CLIENT_TOKEN_COLLISION", (await errCode(createTemplate({ ...body, name: `${PREFIX}-tok2` }, U))) === "CLIENT_TOKEN_COLLISION");
  const tok2 = randomUUID();
  const par = await Promise.allSettled([
    bypassReplayQueue(() => createTemplate({ ...body, name: `${PREFIX}-par`, clientToken: tok2 }, U)),
    bypassReplayQueue(() => createTemplate({ ...body, name: `${PREFIX}-par`, clientToken: tok2 }, U)),
  ]);
  const parRows = await prisma.documentTemplate.findMany({ where: { clientToken: tok2 }, select: { id: true } });
  parRows.forEach((r) => createdIds.push(r.id));
  check(
    "§3d eşzamanlı aynı token → tek satır, iki yanıt da o satır",
    parRows.length === 1 && par.every((p) => p.status === "fulfilled" && p.value.template.id === parRows[0]?.id),
    par.map((p) => (p.status === "fulfilled" ? "ok" : codeOf(p.reason) ?? String(p.reason))).join(","),
  );

  // ── §4 Trigger ──────────────────────────────────────────────────────────
  const T = await newTemplate("trig", undefined, U);
  check(
    "§4a içerik kolonu UPDATE reddedilir",
    (await errCode(prisma.$executeRaw`UPDATE document_template_versions SET "sourceHtml" = 'x' WHERE id = ${T.v1.id}::uuid`)) !== "OK",
  );
  check(
    "§4b ayar (settings) UPDATE reddedilir",
    (await errCode(prisma.$executeRaw`UPDATE document_template_versions SET "settings" = '{}'::jsonb WHERE id = ${T.v1.id}::uuid`)) !== "OK",
  );
  check(
    "§4c yayınlanmamış sürümde damga NULL→değer geçer",
    (await errCode(prisma.$executeRaw`UPDATE document_template_versions SET "publishedAt" = now(), "publishedById" = ${U}::uuid WHERE id = ${T.v1.id}::uuid`)) === "OK",
  );
  check(
    "§4d damga ikinci kez yazılamaz",
    (await errCode(prisma.$executeRaw`UPDATE document_template_versions SET "publishedAt" = now() + interval '1 day' WHERE id = ${T.v1.id}::uuid`)) !== "OK",
  );
  check("§4e yayınlanmış sürüm DELETE reddedilir", (await errCode(prisma.$executeRaw`DELETE FROM document_template_versions WHERE id = ${T.v1.id}::uuid`)) !== "OK");

  // ── §5 Sürüm kaydı ──────────────────────────────────────────────────────
  const same = await saveVersion(A.t.id, { baseVersionId: A.v1.id, ...content(A.v1, A.v1.sourceHtml) }, U);
  check("§5a içerik aynıysa yeni sürüm açılmaz", same.created === false && (same.version.versionNo as number) === 1);
  const saves = await Promise.allSettled([
    saveVersion(A.t.id, { baseVersionId: A.v1.id, ...content(A.v1, "<p>Birinci</p>") }, U),
    saveVersion(A.t.id, { baseVersionId: A.v1.id, ...content(A.v1, "<p>İkinci</p>") }, U),
  ]);
  const okSaves = saves.filter((s) => s.status === "fulfilled").length;
  const stale = saves.filter((s) => s.status === "rejected" && codeOf(s.reason) === "TEMPLATE_VERSION_STALE").length;
  const aVersions = await prisma.documentTemplateVersion.findMany({ where: { templateId: A.t.id }, select: { versionNo: true } });
  const aAfter = await prisma.documentTemplate.findUniqueOrThrow({ where: { id: A.t.id } });
  check("§5b paralel aynı-base kaydı → 1 başarı + 1 409 STALE", okSaves === 1 && stale === 1, `ok=${okSaves} stale=${stale}`);
  check("§5c sürüm no tekil ve sayaçla aynı", aVersions.length === 2 && aAfter.latestVersionNo === 2, `sürümler=${aVersions.map((v) => v.versionNo).join(",")}`);
  check(
    "§5d bayat base ile kayıt 409 STALE",
    (await errCode(saveVersion(A.t.id, { baseVersionId: A.v1.id, ...content(A.v1, "<p>Üçüncü</p>") }, U))) === "TEMPLATE_VERSION_STALE",
  );
  // Geri alma (T5): v1 içeriği güncel son sürüm (v2) tabanıyla kaydedilir → v3; v2 silinmez, değişmez.
  const aV2pre = await prisma.documentTemplateVersion.findFirstOrThrow({ where: { templateId: A.t.id, versionNo: 2 } });
  const restored = await saveVersion(A.t.id, { baseVersionId: aV2pre.id, ...content(A.v1, A.v1.sourceHtml), note: "v1 sürümünden geri alındı" }, U);
  const v3 = await prisma.documentTemplateVersion.findFirst({ where: { templateId: A.t.id, versionNo: 3 } });
  const aV2post = await prisma.documentTemplateVersion.findUniqueOrThrow({ where: { id: aV2pre.id } });
  check("§5e geri alma YENİ sürüm açar (v3), içerik v1 ile aynı", restored.created === true && !!v3 && v3.contentHash === A.v1.contentHash && v3.sourceHtml === A.v1.sourceHtml);
  check("§5f ileri sürüm (v2) silinmedi, değişmedi", aV2post.contentHash === aV2pre.contentHash && aV2post.sourceHtml === aV2pre.sourceHtml);
  const listed = await listVersions(A.t.id);
  const me = await prisma.user.findUniqueOrThrow({ where: { id: U }, select: { fullName: true } });
  check("§5g sürüm listesi yeniden eskiye + yazan adı", listed.map((v) => v.versionNo).join(",") === "3,2,1" && listed.every((v) => v.createdByName === me.fullName));

  // ── §6 Yayın ────────────────────────────────────────────────────────────
  const aV2 = await prisma.documentTemplateVersion.findFirstOrThrow({ where: { templateId: A.t.id, versionNo: 2 } });
  const pubs = await Promise.allSettled([
    publishVersion(A.t.id, { versionId: A.v1.id, expectedPublishedVersionId: null }, U),
    publishVersion(A.t.id, { versionId: aV2.id, expectedPublishedVersionId: null }, U),
  ]);
  const okPub = pubs.filter((s) => s.status === "fulfilled").length;
  const conflict = pubs.filter((s) => s.status === "rejected" && codeOf(s.reason) === "TEMPLATE_PUBLISH_CONFLICT").length;
  check("§6a paralel aynı-beklenen yayın → 1 başarı + 1 409 CONFLICT", okPub === 1 && conflict === 1, `ok=${okPub} conflict=${conflict}`);
  const aPub = await prisma.documentTemplate.findUniqueOrThrow({ where: { id: A.t.id } });
  const stamped = await prisma.documentTemplateVersion.count({ where: { templateId: A.t.id, publishedAt: { not: null } } });
  check("§6b yayındaki sürüm tek, damgası yazıldı", aPub.publishedVersionId !== null && stamped === 1, `damgalı=${stamped}`);
  const U2 = await newTemplate("unsafe", '<img src="https://example.com/x.png"><p>x</p>', U);
  check("§6c dış kaynaklı şablon yayında 400 TEMPLATE_UNSAFE_CONTENT", (await errCode(publishVersion(U2.t.id, { versionId: U2.v1.id, expectedPublishedVersionId: null }, U))) === "TEMPLATE_UNSAFE_CONTENT");
  const R = await newTemplate("render", "<p>{{ olmayan.alan }}</p>", U);
  check("§6d tanımsız değişkenli şablon yayında 400 TEMPLATE_RENDER_FAILED", (await errCode(publishVersion(R.t.id, { versionId: R.v1.id, expectedPublishedVersionId: null }, U))) === "TEMPLATE_RENDER_FAILED");
  const unpublished = await prisma.documentTemplate.findMany({ where: { id: { in: [U2.t.id, R.t.id] } }, select: { publishedVersionId: true } });
  check("§6e reddedilen yayın yayın işaretçisini değiştirmedi", unpublished.every((x) => x.publishedVersionId === null));
  // Yeniden yayın (T5): yayındaki olmayan sürüm beklenen işaretçiyle yayına alınır, sonra ilki geri gelir.
  const firstPub = aPub.publishedVersionId!;
  const otherVid = firstPub === A.v1.id ? aV2.id : A.v1.id;
  await publishVersion(A.t.id, { versionId: otherVid, expectedPublishedVersionId: firstPub }, U);
  const firstStamp = (await prisma.documentTemplateVersion.findUniqueOrThrow({ where: { id: firstPub } })).publishedAt?.getTime();
  await publishVersion(A.t.id, { versionId: firstPub, expectedPublishedVersionId: otherVid }, U);
  const back = await prisma.documentTemplate.findUniqueOrThrow({ where: { id: A.t.id } });
  const againStamp = (await prisma.documentTemplateVersion.findUniqueOrThrow({ where: { id: firstPub } })).publishedAt?.getTime();
  check("§6f eski sürüm yeniden yayına alındı", back.publishedVersionId === firstPub);
  check("§6g ilk yayın damgası yeniden yayında değişmedi", firstStamp !== undefined && firstStamp === againStamp);

  // ── §7 SoD ──────────────────────────────────────────────────────────────
  sodRow = await prisma.systemSetting.findUnique({ where: { key: PUBLISH_SOD_SETTING_KEY }, select: { value: true } });
  check("§7a SoD ayarı varsayılan KAPALI (satır yok ya da false)", sodRow === null || sodRow.value !== true);
  await prisma.systemSetting.upsert({ where: { key: PUBLISH_SOD_SETTING_KEY }, create: { key: PUBLISH_SOD_SETTING_KEY, value: true }, update: { value: true } });
  const S = await newTemplate("sod", undefined, U);
  check("§7b SoD açıkken tasarlayan yayınlayamaz → 403 PUBLISH_SOD", (await errCode(publishVersion(S.t.id, { versionId: S.v1.id, expectedPublishedVersionId: null }, U))) === "PUBLISH_SOD");
  // Kalıcı tek bekçi kullanıcısı (girişi yok): yayın audit satırı ona bağlanır, silinmez → koşum başına satır doğmaz.
  const other = await prisma.user.upsert({
    where: { username: "bekci-sablon-yayinci" },
    create: { username: "bekci-sablon-yayinci", fullName: "Şablon Bekçi Yayıncı", passwordHash: "-", isActive: false },
    update: {},
    select: { id: true },
  });
  check("§7c SoD açıkken başka kişi yayınlar", (await errCode(publishVersion(S.t.id, { versionId: S.v1.id, expectedPublishedVersionId: null }, other.id))) === "OK");
  await restoreSod();

  // ── §8 Arşiv ve atama ───────────────────────────────────────────────────
  const prevDefault = await prisma.documentTemplateDefault.findUnique({ where: { docType: DOC }, select: { templateId: true } });
  if (prevDefault) {
    check("§8 ön koşul: tür varsayılanı boş (test DB)", false, "varsayılan önceden atanmış — bekçi atlıyor");
  } else {
    await setDefault(DOC, A.t.id, U);
    let assignedList: unknown[] = [];
    try {
      await archiveTemplate(A.t.id, U);
    } catch (e) {
      if (codeOf(e) === "TEMPLATE_ASSIGNED") assignedList = ((e as AppError).details?.atamalar as unknown[]) ?? [];
    }
    const stillActive = (await prisma.documentTemplate.findUniqueOrThrow({ where: { id: A.t.id } })).status === "ACTIVE";
    check("§8a atanmış şablon arşivi 409 + atama listesi", assignedList.length === 1, JSON.stringify(assignedList));
    check("§8b reddedilen arşiv geri alındı (durum ACTIVE)", stillActive);
    await setDefault(DOC, null, U);
    check("§8c atama kalkınca arşiv geçer", (await errCode(archiveTemplate(A.t.id, U))) === "OK");
    check("§8d arşivli şablon atanamaz → 409 TEMPLATE_NOT_ASSIGNABLE", (await errCode(setDefault(DOC, A.t.id, U))) === "TEMPLATE_NOT_ASSIGNABLE");
    check("§8e arşivli şablona sürüm kaydedilemez", (await errCode(saveVersion(A.t.id, { baseVersionId: aV2.id, ...content(aV2, "<p>z</p>") }, U))) === "TEMPLATE_ARCHIVED");
    check("§8f arşivden çıkar", (await errCode(unarchiveTemplate(A.t.id, U))) === "OK");
  }

  // ── §9 Silme ────────────────────────────────────────────────────────────
  const pv = await deletePreview(A.t.id);
  check("§9a yayınlanmış şablonun silme önizlemesi: silinemez + sürümler listeli", pv.deletable === false && pv.versions.length === 3); // v1, v2 + §5e geri alma v3
  check("§9b yayınlanmış şablon silinemez → 409 TEMPLATE_PUBLISHED", (await errCode(deleteTemplate(A.t.id, U))) === "TEMPLATE_PUBLISHED");
  const D = await newTemplate("draft", undefined, U);
  await saveVersion(D.t.id, { baseVersionId: D.v1.id, ...content(D.v1, "<p>Taslak 2</p>") }, U);
  check("§9c taslak şablon silme önizlemesi: silinebilir", (await deletePreview(D.t.id)).deletable === true);
  check("§9d taslak şablon hard delete", (await errCode(deleteTemplate(D.t.id, U))) === "OK");
  const left = await prisma.documentTemplateVersion.count({ where: { templateId: D.t.id } });
  check("§9e taslağın sürümleri de gitti", left === 0 && (await prisma.documentTemplate.count({ where: { id: D.t.id } })) === 0);
  check("§9f trigger damgasız (taslak) sürümün DELETE'ine izin verir", left === 0);
}

async function restoreSod(): Promise<void> {
  if (sodRow === undefined) return;
  if (sodRow === null) await prisma.systemSetting.deleteMany({ where: { key: PUBLISH_SOD_SETTING_KEY } });
  else await prisma.systemSetting.update({ where: { key: PUBLISH_SOD_SETTING_KEY }, data: { value: sodRow.value as never } });
  sodRow = undefined;
}

/** Bekçi kalıntısı: yayınlı sürüm trigger'la korunur → yalnız bu oturumda replika kipiyle temizlenir. */
async function cleanup(): Promise<void> {
  const ids = [...new Set(createdIds)];
  if (!ids.length) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);
    await tx.documentTemplateDefault.deleteMany({ where: { templateId: { in: ids } } });
    await tx.documentProfileTemplate.deleteMany({ where: { templateId: { in: ids } } });
    await tx.documentTemplate.updateMany({ where: { id: { in: ids } }, data: { publishedVersionId: null } });
    await tx.documentTemplateVersion.deleteMany({ where: { templateId: { in: ids } } });
    await tx.documentTemplate.deleteMany({ where: { id: { in: ids } } });
  });
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await restoreSod().catch(() => undefined);
    await cleanup().catch((e) => console.error("⚠️ temizlik:", e instanceof Error ? e.message : e));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
