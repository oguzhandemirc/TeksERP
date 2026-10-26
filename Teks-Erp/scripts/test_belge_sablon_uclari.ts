// =============================================================================
// BEKÇİ — /api/document-templates izin matrisi (T1B) · HTTP ayaklı
// =============================================================================
// Çalıştırma (Teks-Erp/ içinden):
//   DATABASE_URL='postgresql://…/<ad>_test?schema=public' \
//     node ../scripts/agir-is.mjs -- npx tsx scripts/bekci-http.ts belge_sablon_uclari
//
// ÖLÇÜLENLER:
//   §1 Kimliksiz istek 401 (izin kapısından ÖNCE kimlik)
//   §2 Okuma uçları: read/design/publish/admin:settings açar; izinsiz 403 PERMISSION_DENIED; atama ızgarası profileCatalog (T5)
//   §3 Tasarım uçları (oluştur, sürüm kaydet, ata): design + admin:settings; read/publish 403
//   §4 Yayın ucu: publish + admin:settings; read/design 403
//   §5 Gerçek kayıtlı önizleme + örnek kaynak listesi: belgenin kendi okuma izni de aranır
//   §7 Sistem önizlemesi: read açar, refakat kartı 200, FREE_DOCUMENT 409 NO_SYSTEM_PREVIEW, bilinmeyen 400, izinsiz 403
//   §6 Tasarımcı bayrağı (T1C, P-c) KAPALIYKEN: sözleşme okuması 200, diğer uçlar 403 DOCUMENT_DESIGNER_DISABLED
//      (§1–§5 bayrak AÇIK koşar; ayar satırı `finally`de birebir geri yazılır)
//
// ⭐ NEGATİF SONDA (2026-10-24, ölçüldü): routes/document-template.routes.ts'de `/:id/publish`
//    kapısı DOCUMENT_TEMPLATE_DESIGN'a çevrildi → §4 iki ❌ (design yayınladı, publish 403 aldı); geri alınınca 22/0.
// ⭐ NEGATİF SONDA (2026-10-25, T1C, ölçüldü): tasarımcı kapısı her isteği geçirecek biçimde `return next()`e
//    çevrildi → §6 iki ❌ (liste + oluşturma bayrak kapalıyken geçti); yedekten geri kondu, 25/0.
// ⭐ NEGATİF SONDA (2026-10-26, T5, ölçüldü): assignment.service.ts'de `profileCatalog` anahtarı yeniden adlandırıldı
//    → §2 profil kataloğu ❌ (katalog=undefined); yedekten geri kondu, 26/0.
// ⭐ NEGATİF SONDA (2026-10-26, Sistem önizleme, ölçüldü): system-preview.service.ts'de 409 `conflict` → `badRequest`
//    → §7 bir ❌ (FREE_DOCUMENT 400 aldı); geri alındı, 31/0.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { AuthService } from "../src/services/auth.service";
import { httpBekciKapisi } from "./lib/http-bekci-kapisi";
import { atlamaDefteri } from "./lib/atlama";
import { SETTING_KEYS } from "../src/services/system-setting.service";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100";
const API = `${BASE}/api/document-templates`;
const DOC = "SHIPMENT_DISPATCH";

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
const ATLAMA = atlamaDefteri(() => {
  fail++;
});

const PASSWORD = "test123456";
const PREFIX = `bekci.sablon.${process.pid}`;
const ROLES = {
  // Electron girişi en az bir web izni ister; belge tasarımıyla ilgisiz bir okuma izni.
  none: ["station:read"],
  read: ["document-template:read"],
  design: ["document-template:design"],
  publish: ["document-template:publish"],
  admin: ["admin:settings"],
} as const;
type RoleKey = keyof typeof ROLES;
const userIds: string[] = [];
const templateIds: string[] = [];
const DESIGNER_KEY = SETTING_KEYS.DOCUMENTS_DESIGNER_ENABLED;
let designerRow: { value: unknown } | null | undefined;

async function setDesigner(on: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key: DESIGNER_KEY }, create: { key: DESIGNER_KEY, value: on }, update: { value: on } });
}

async function login(role: RoleKey): Promise<Record<string, string>> {
  const perms = await prisma.permission.findMany({ where: { code: { in: [...ROLES[role]] } }, select: { id: true } });
  if (perms.length !== ROLES[role].length) throw new Error(`İzin satırı eksik (${role}) — katalog uzlaştırması koşulmadı`);
  const u = await prisma.user.create({
    data: {
      username: `${PREFIX}.${role}`,
      fullName: `Şablon Bekçi ${role}`,
      passwordHash: await AuthService.hashPassword(PASSWORD),
      permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
    },
    select: { id: true },
  });
  userIds.push(u.id);
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: `${PREFIX}.${role}`, password: PASSWORD, clientType: "electron" }),
  });
  if (!r.ok) throw new Error(`giriş başarısız (${role}): ${r.status}`);
  const token = ((await r.json()) as { data: { token: string } }).data.token;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function call(h: Record<string, string> | null, method: string, path: string, body?: unknown) {
  const r = await fetch(`${API}${path}`, { method, headers: h ?? {}, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await r.json().catch(() => null)) as { data?: unknown; error?: { details?: { code?: string } }; details?: { code?: string } } | null;
  return { status: r.status, data: json?.data as Record<string, unknown> | undefined, code: json?.error?.details?.code ?? json?.details?.code };
}

const HTTP_KONTROL = 31;

async function main(): Promise<void> {
  console.log("=== Belge şablonu uçları izin matrisi ===\n");
  const kapi = await httpBekciKapisi({ base: BASE, kontrolSayisi: HTTP_KONTROL });
  if (kapi.kirmizi) {
    check("HTTP ayağı ölçülebildi", false, kapi.kirmizi);
    ATLAMA.atla("§1–§5 HTTP", "kapı kırmızı verdi — ayak hiç koşmadı", HTTP_KONTROL);
    return;
  }
  if (!kapi.token) {
    ATLAMA.atla("§1–§5 HTTP", kapi.atlaSebebi ?? "ölçüm yapılamadı", HTTP_KONTROL);
    return;
  }
  const H = {} as Record<RoleKey, Record<string, string>>;
  for (const r of Object.keys(ROLES) as RoleKey[]) H[r] = await login(r);

  // §6 bayrak kapalı (kapı ham okur → önbellek beklemez)
  designerRow = await prisma.systemSetting.findUnique({ where: { key: DESIGNER_KEY }, select: { value: true } });
  await setDesigner(false);
  check("§6 bayrak kapalıyken sözleşme okunur (200)", (await call(H.admin, "GET", "/contracts")).status === 200);
  const offList = await call(H.admin, "GET", "/");
  check("§6 bayrak kapalıyken şablon listesi 403 DOCUMENT_DESIGNER_DISABLED", offList.status === 403 && offList.code === "DOCUMENT_DESIGNER_DISABLED", `durum=${offList.status} kod=${offList.code}`);
  const offCreate = await call(H.admin, "POST", "/", { docType: DOC, name: `${PREFIX}-kapali`, copyFrom: { kind: "blank" } });
  check("§6 bayrak kapalıyken şablon oluşturulamaz (403)", offCreate.status === 403 && offCreate.code === "DOCUMENT_DESIGNER_DISABLED", `durum=${offCreate.status} kod=${offCreate.code}`);
  await setDesigner(true);

  // §1
  check("§1 kimliksiz istek 401", (await call(null, "GET", "/contracts")).status === 401);

  // §2 okuma
  for (const r of ["read", "design", "publish", "admin"] as RoleKey[]) {
    const res = await call(H[r], "GET", "/contracts");
    check(`§2 ${r} sözleşme listesini okur`, res.status === 200, `durum=${res.status}`);
  }
  const deny = await call(H.none, "GET", "/");
  check("§2 izinsiz okuma 403 PERMISSION_DENIED", deny.status === 403 && deny.code === "PERMISSION_DENIED", `durum=${deny.status} kod=${deny.code}`);
  // §2b atama ızgarası HER profili taşır (T5: atamadan önce etkilenen cari listesi; salt okuma ek alanı)
  const asg = await call(H.read, "GET", "/assignments");
  const cat = asg.data?.profileCatalog as Array<{ id?: string; overrideKeys?: unknown; affected?: { customers?: unknown } }> | undefined;
  const profileCount = await prisma.documentProfile.count();
  check(
    "§2 read atama ızgarasında profil kataloğunu okur (tüm profiller, etkilenen cari + ezme anahtarı)",
    asg.status === 200 && Array.isArray(cat) && cat.length === profileCount && cat.every((p) => !!p.id && Array.isArray(p.overrideKeys) && Array.isArray(p.affected?.customers)),
    `durum=${asg.status} katalog=${cat?.length} profil=${profileCount}`,
  );

  // §3 tasarım
  const create = (h: Record<string, string>, name: string) => call(h, "POST", "/", { docType: DOC, name: `${PREFIX}-${name}`, copyFrom: { kind: "blank" } });
  for (const r of ["read", "publish"] as RoleKey[]) {
    const res = await create(H[r], r);
    check(`§3 ${r} şablon oluşturamaz (403)`, res.status === 403, `durum=${res.status}`);
  }
  const byDesign = await create(H.design, "design");
  const byAdmin = await create(H.admin, "admin");
  check("§3 design şablon oluşturur (201)", byDesign.status === 201, `durum=${byDesign.status} kod=${byDesign.code}`);
  check("§3 admin:settings şablon oluşturur (201)", byAdmin.status === 201, `durum=${byAdmin.status}`);
  const tid = (byDesign.data?.template as { id?: string } | undefined)?.id;
  const aid = (byAdmin.data?.template as { id?: string } | undefined)?.id;
  [tid, aid].forEach((x) => x && templateIds.push(x));
  if (!tid) {
    check("§3 oluşturulan şablon kimliği döndü", false);
    return;
  }
  const versions = await call(H.read, "GET", `/${tid}/versions`);
  const v1 = (versions.data as unknown as Array<{ id: string }> | undefined)?.[0]?.id;
  check("§3 read sürüm listesini okur", versions.status === 200 && !!v1);
  const saveBody = { baseVersionId: v1, editMode: "CODE", sourceHtml: "<p>Bekçi</p>", css: "", pageSettings: {}, tableBindings: {}, settings: {}, internalFields: [] };
  check("§3 publish sürüm kaydedemez (403)", (await call(H.publish, "POST", `/${tid}/versions`, saveBody)).status === 403);
  const saved = await call(H.design, "POST", `/${tid}/versions`, saveBody);
  check("§3 design sürüm kaydeder (201)", saved.status === 201, `durum=${saved.status} kod=${saved.code}`);
  const v2 = ((saved.data?.version as { id?: string } | undefined)?.id) ?? v1;
  check("§3 read atama yapamaz (403)", (await call(H.read, "PUT", `/defaults/${DOC}`, { templateId: null })).status === 403);
  check("§3 design varsayılanı kaldırabilir (200)", (await call(H.design, "PUT", `/defaults/${DOC}`, { templateId: null })).status === 200);

  // §4 yayın
  const pub = { versionId: v2, expectedPublishedVersionId: null };
  for (const r of ["read", "design"] as RoleKey[]) {
    const res = await call(H[r], "POST", `/${tid}/publish`, pub);
    check(`§4 ${r} yayınlayamaz (403)`, res.status === 403, `durum=${res.status}`);
  }
  const published = await call(H.publish, "POST", `/${tid}/publish`, pub);
  check("§4 publish yayınlar (200)", published.status === 200, `durum=${published.status} kod=${published.code}`);
  const adminPub = await call(H.admin, "POST", `/${tid}/publish`, { versionId: v2, expectedPublishedVersionId: v2 });
  check("§4 admin:settings yayın ucunu açar (200)", adminPub.status === 200, `durum=${adminPub.status} kod=${adminPub.code}`);

  // §5 gerçek kayıt kapısı
  const previewBody = (sample: unknown) => ({ docType: DOC, source: { editMode: "CODE", sourceHtml: "<p>x</p>", css: "", pageSettings: {}, settings: {}, internalFields: [] }, sample });
  const scen = await call(H.design, "POST", "/preview", previewBody({ kind: "senaryo", key: "ornek" }));
  check("§5 design örnek senaryoyla önizler (200)", scen.status === 200 && typeof scen.data?.html === "string", `durum=${scen.status} kod=${scen.code}`);
  const rec = await call(H.design, "POST", "/preview", previewBody({ kind: "kayit", sourceId: "00000000-0000-4000-8000-000000000000" }));
  check("§5 sevk okuma izni olmadan gerçek kayıt önizlemesi 403", rec.status === 403 && rec.code === "PERMISSION_DENIED", `durum=${rec.status}`);
  const src = await call(H.design, "GET", `/sample-sources/${DOC}`);
  check("§5 sevk okuma izni olmadan örnek kaynak listesi 403", src.status === 403, `durum=${src.status}`);

  // §7 Sistem önizlemesi: örnek veri (gerçek kayıt yok) → tasarım okuma izni yeter; yazmaz.
  const sp = await call(H.read, "POST", `/sistem-onizleme/${DOC}`);
  check("§7 read sistem önizlemesini alır (200, html)", sp.status === 200 && String(sp.data?.html ?? "").length > 500, `durum=${sp.status}`);
  const spCard = await call(H.read, "POST", "/sistem-onizleme/TRAVELER_CARD");
  check("§7 eşleniği olmayan refakat kartı da çizilir (200)", spCard.status === 200 && typeof spCard.data?.html === "string", `durum=${spCard.status} kod=${spCard.code}`);
  const spFree = await call(H.read, "POST", "/sistem-onizleme/FREE_DOCUMENT");
  check("§7 yerleşik çıktısı olmayan tür 409 NO_SYSTEM_PREVIEW", spFree.status === 409 && spFree.code === "NO_SYSTEM_PREVIEW", `durum=${spFree.status} kod=${spFree.code}`);
  const spBad = await call(H.read, "POST", "/sistem-onizleme/YOK_BOYLE");
  check("§7 bilinmeyen tür 400 (FAIL-CLOSED)", spBad.status === 400, `durum=${spBad.status}`);
  check("§7 izinsiz 403", (await call(H.none, "POST", `/sistem-onizleme/${DOC}`)).status === 403);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    try {
      if (designerRow === null) await prisma.systemSetting.deleteMany({ where: { key: DESIGNER_KEY } });
      else if (designerRow) await prisma.systemSetting.update({ where: { key: DESIGNER_KEY }, data: { value: designerRow.value as never } });
      if (templateIds.length) {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);
          await tx.documentTemplate.updateMany({ where: { id: { in: templateIds } }, data: { publishedVersionId: null } });
          await tx.documentTemplateVersion.deleteMany({ where: { templateId: { in: templateIds } } });
          await tx.documentTemplate.deleteMany({ where: { id: { in: templateIds } } });
        });
      }
      if (userIds.length) {
        await prisma.userPermission.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.session.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
        await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { isActive: false } }).catch(() => undefined);
      }
    } catch (e) {
      console.error("⚠️ temizlik:", e instanceof Error ? e.message : e);
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
