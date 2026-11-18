// =============================================================================
// Rol (yetki şablonu) kataloğu boot-time uzlaştırması
// =============================================================================
// `permission-catalog.job.ts`'in KARDEŞİ ve ondan SONRA koşar (şablon satırları
// izin satırlarına bağlıdır). Aynı gerekçe, aynı sözleşme:
//
//   NEDEN VAR: Şablonlar yalnız `prisma/seed.ts`'te yaşıyordu, seed ise yalnız
//   ilk kurulumda koşar. 2026-08-06 denetiminde canlı fabrikada ölçüldü:
//   "Admin (Tam Yetki)" şablonu 55 izin taşıyordu, katalog 67 — o şablonla
//   açılan yeni yönetici 12 yetkiyi ALMIYOR ve bunu hiçbir yerde göremiyordu.
//   Ayrıca masaüstü (büro) rolleri HİÇ YOKTU. Kural: kodu deploy etmek = rolleri
//   getirmek.
//
// SÖZLEŞME — YALNIZ EKLE:
//   • Kodu DB'de olmayan şablon OLUŞTURULUR.
//   • Var olan şablonun ADI/AÇIKLAMASI EZİLMEZ (fabrika değiştirmiş olabilir).
//   • Var olan şablona katalogdaki EKSİK izinler EKLENİR; fabrikanın elle
//     eklediği fazlalar KORUNUR ve hiçbir izin ÇIKARILMAZ.
//   • PASİF şablona da dokunulmaz-oluşturulmaz: `isActive=false` fabrikanın
//     "bu rolü kullanmıyorum" kararıdır. Bu yüzden sistem şablonunun SİLİNMESİ
//     de pasifleştirmeye çevrildi (permission-management.service) — sert silme,
//     bir sonraki restart'ta diriliş demekti.
//
// KİMLİK `code`'DUR: fabrika şablonu yeniden adlandırabilir. Kodsuz eski
// satırlar BİR KEZ adlarıyla eşlenip kodlanır (`LEGACY_TEMPLATE_NAME_TO_CODE`);
// ad çakışması olan kodsuz satır da "sahiplenilir" — ikinci bir kopya doğmaz.
//
// TAM YETKİ YAYILIMI (kullanıcı kararı 2026-11-18): `ADMIN_FULL`a bu koşumda eklenen
// izinler, şablona bağlı kullanıcılara da verilir (`spreadAdminFullTx`); diğer şablonlar
// yalnız şablonda büyür, kullanıcıya yayılmaz.
//
// BEST-EFFORT: hata sunucuyu DÜŞÜRMEZ ama sessizce de yutulmaz.
// =============================================================================

import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import {
  ROLE_TEMPLATE_CATALOG,
  LEGACY_TEMPLATE_NAME_TO_CODE,
  SOD_PERMISSION_CODES,
  resolveRoleTemplateCodes,
} from "../constants/role-template-catalog";
import { AuditService } from "../services/audit.service";
import { foldNameForCompare } from "../services/helpers/name-normalize.helper";
import { emitUserPermissionsChangedTx } from "../services/notification-sources/yetki";
import { bilgi, uyari } from "../lib/logger";

/** Uzlaştırma tx'inin ilk ifadesi — çok örnekli açılışta şablon ekleme + Tam Yetki yayılımı serileşir. */
export const ROLE_TEMPLATE_RECONCILE_LOCK_NS: number = 8049;
const ROLE_TEMPLATE_RECONCILE_LOCK_KEY = 1;

/** Yeni izinleri şablonu almış kullanıcılara da yayan TEK şablon (diğerleri yalnız şablona eklenir). */
export const AUTO_SPREAD_TEMPLATE_CODE = "ADMIN_FULL";

export type AdminFullSpreadRow = {
  userPermissionId: string;
  userId: string;
  permissionCode: string;
};

export type RoleTemplateReconcileResult = {
  /** Katalogdaki rol sayısı. */
  total: number;
  /** Yeni oluşturulan şablon kodları. */
  created: string[];
  /** Kodsuz eski satırdan sahiplenilen (kodu yazılan) şablon kodları. */
  adopted: string[];
  /** Var olan şablonlara eklenen izinler: kod → eklenen izin kodları. */
  itemsAdded: Record<string, string[]>;
  /** Katalogda olmayan (fabrikanın kendi) şablon adları — DOKUNULMAZ. */
  custom: string[];
  /** Tam Yetki'ye bu koşumda eklenen izinlerden bağlı kullanıcılara yayılan satırlar. */
  spread: AdminFullSpreadRow[];
};

/** SoD izinleri yayılmaz ve bağlılık ölçümüne girmez (elle atanır) — saf süzgeç, bekçi doğrudan sınar. */
export function withoutSodPermissionIds(ids: readonly string[], codeById: ReadonlyMap<string, string>): string[] {
  const sod = new Set<string>(SOD_PERMISSION_CODES);
  return ids.filter((id) => !sod.has(codeById.get(id) ?? ""));
}

/** YALNIZ BEKÇİ: şablon kodu → katalogda yeni doğmuş gibi eklenecek izin kodları (satır silmeden taklit). */
export type RoleTemplateReconcileOptions = { extraCodesByTemplate?: Readonly<Record<string, readonly string[]>> };

/**
 * Tam Yetki yayılımı — `ADMIN_FULL`a BU koşumda eklenen izinleri şablona "bağlı" kullanıcılara verir.
 * Bağlılığın kalıcı izi yok (`applyTemplate` kopyalar, link kalmaz; audit karar kaynağı olamaz):
 * bağlı = ekleme ÖNCESİ şablon izinlerinin (SoD hariç) HEPSİNİ süresiz taşıyan, silinmemiş, sistem
 * hesabı olmayan kullanıcı. Bilerek tek izni alınmış kullanıcı bağlı sayılmaz → hiçbir şey almaz;
 * SoD izni hiç yayılmaz (elle atanır). tokenVersion artmaz: izin her istekte DB'den çözülür
 * (önbellek TTL 30 sn) ve her sürümde bütün yöneticileri oturumdan atmak istenmez.
 */
async function spreadAdminFullTx(
  tx: Prisma.TransactionClient,
  preexistingPermIds: ReadonlySet<string>,
  addedPermIds: readonly string[],
  codeById: ReadonlyMap<string, string>,
): Promise<AdminFullSpreadRow[]> {
  const required = withoutSodPermissionIds([...preexistingPermIds], codeById);
  const toSpread = withoutSodPermissionIds(addedPermIds, codeById);
  // Boş ön küme "herkes bağlı" demek olurdu — fail-closed: yayma.
  if (required.length === 0 || toSpread.length === 0) return [];

  const now = new Date();
  const held = await tx.userPermission.groupBy({
    by: ["userId"],
    where: {
      permissionId: { in: required },
      validUntil: null,
      OR: [{ validFrom: null }, { validFrom: { lte: now } }],
      user: { deletedAt: null, isSystemAccount: false },
    },
    _count: { _all: true },
  });
  const boundUserIds = held.filter((h) => h._count._all === required.length).map((h) => h.userId).sort();
  if (boundUserIds.length === 0) return [];

  const created = await tx.userPermission.createManyAndReturn({
    data: boundUserIds.flatMap((userId) => toSpread.map((permissionId) => ({ userId, permissionId, grantedById: null }))),
    skipDuplicates: true, // kullanıcı izni tek tek almış olabilir
    select: { id: true, userId: true, permissionId: true },
  });
  const byUser = new Map<string, string[]>();
  for (const r of created) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r.permissionId]);
  // Sıralı ve ardışık (tx + Promise.all yasak).
  for (const userId of [...byUser.keys()].sort()) {
    await emitUserPermissionsChangedTx(tx, userId, { addedPermissionIds: byUser.get(userId) ?? [], removedCount: 0 }, null);
  }
  return created
    .map((r) => ({ userPermissionId: r.id, userId: r.userId, permissionCode: codeById.get(r.permissionId) ?? r.permissionId }))
    .sort((a, b) => a.userId.localeCompare(b.userId) || a.permissionCode.localeCompare(b.permissionCode));
}

/** Var olan şablona eksik izinleri ekler; Tam Yetki ise GERÇEKTEN eklenenleri bağlı kullanıcılara yayar. */
async function addMissingTemplateItemsTx(
  tx: Prisma.TransactionClient,
  hedef: { code: string; id: string; isActive: boolean; permissions: { permissionId: string }[] },
  wantedIds: readonly string[],
  idToCode: ReadonlyMap<string, string>,
): Promise<{ added: string[]; spread: AdminFullSpreadRow[] }> {
  const mevcut = new Set(hedef.permissions.map((p) => p.permissionId));
  const eksik = wantedIds.filter((id) => !mevcut.has(id));
  if (eksik.length === 0) return { added: [], spread: [] };
  // Dönen satırlar = GERÇEKTEN eklenenler; yayılım yalnız bunlara bakar (iki koşum aynı sonucu verir).
  const res = await tx.permissionTemplateItem.createManyAndReturn({
    data: eksik.map((permissionId) => ({ templateId: hedef.id, permissionId })),
    skipDuplicates: true, // eşzamanlı boot yarışında güvenli (@@id bileşik)
    select: { permissionId: true },
  });
  const eklenen = res.map((r) => r.permissionId);
  const added = eklenen.map((id) => idToCode.get(id) ?? id).sort();
  const spread =
    eklenen.length > 0 && hedef.code === AUTO_SPREAD_TEMPLATE_CODE && hedef.isActive
      ? await spreadAdminFullTx(tx, mevcut, eklenen, idToCode)
      : [];
  return { added, spread };
}

/**
 * Uzlaştırmanın YAZAN kısmı — üç modele dokunur (`permissionTemplate` update +
 * create, `permissionTemplateItem` createMany) ve hepsi TEK tx'te olmalı: yarım
 * kalan bir boot, kodu yazılmış ama izinleri eklenmemiş bir şablon bırakırdı ve
 * o şablonla açılan yönetici eksik yetkiyle çalışırdı.
 *
 * Tx bütçesi ÖLÇÜLDÜ (2026-09-05): katalog 29 şablon / 298 izin bağı — en kötü
 * hâl (boş DB) 29 create + 29 createMany; varsayılan 20 sn tavanının çok altında.
 */
async function reconcileRoleTemplatesTx(
  tx: Prisma.TransactionClient,
  opts: RoleTemplateReconcileOptions,
): Promise<RoleTemplateReconcileResult> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROLE_TEMPLATE_RECONCILE_LOCK_NS}::int, ${ROLE_TEMPLATE_RECONCILE_LOCK_KEY}::int)`;
  const permissions = await tx.permission.findMany({ select: { id: true, code: true } });
  const permIdByCode = new Map(permissions.map((p) => [p.code, p.id]));
  const idToCode = new Map(permissions.map((p) => [p.id, p.code]));

  const existing = await tx.permissionTemplate.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      permissions: { select: { permissionId: true } },
    },
  });

  const byCode = new Map(existing.filter((t) => t.code).map((t) => [t.code as string, t]));
  // Ada göre arama Türkçe-duyarsız: "Muhasebe" ile "MUHASEBE" aynı satırdır
  // (assertTemplateNameAvailable ile aynı kural — aksi halde uzlaştırma, panelin
  // reddedeceği bir adla create deneyip P2002 ile patlardı).
  const codelessByFoldedName = new Map(
    existing.filter((t) => !t.code).map((t) => [foldNameForCompare(t.name), t]),
  );

  const created: string[] = [];
  const adopted: string[] = [];
  const adoptedIds = new Set<string>();
  const itemsAdded: Record<string, string[]> = {};
  const spread: AdminFullSpreadRow[] = [];

  // Kod → eski ad (sahiplenme YALNIZ bu tabloyla yapılır, bkz. aşağıdaki not).
  const legacyNameByCode = new Map(
    Object.entries(LEGACY_TEMPLATE_NAME_TO_CODE).map(([name, code]) => [code, name]),
  );

  for (const entry of ROLE_TEMPLATE_CATALOG) {
    const wantedCodes = [...resolveRoleTemplateCodes(entry), ...(opts.extraCodesByTemplate?.[entry.code] ?? [])];
    const wantedIds: string[] = [];
    const unknown: string[] = [];
    for (const c of wantedCodes) {
      const id = permIdByCode.get(c);
      if (id) wantedIds.push(id);
      else unknown.push(c);
    }
    if (unknown.length > 0) {
      // Katalogda olup DB'de olmayan izin — Faz 1 (permission-catalog) koşmadıysa
      // olur. Şablonu eksik kurmaktansa iz bırakıp devam et; bir sonraki boot
      // eksikleri tamamlar (bekçi bu durumu geliştirme anında zaten düşürür).
      uyari("role-templates", `'${entry.code}' için ${unknown.length} izin DB'de yok, atlandı: ${unknown.join(", ")}`,
      );
    }

    let row = byCode.get(entry.code);

    // Kodsuz ESKİ SEED satırını sahiplen — kimlik yalnız `LEGACY_TEMPLATE_NAME_TO_CODE`
    // üzerinden kurulur. ⚠️ Sahiplenmeyi `entry.name`e de açmak CAZİP ama YANLIŞ:
    // fabrika kendi "Muhasebe" şablonunu yaratmış olabilir ve o satır sessizce
    // sistem rolüne dönüşüp bizim izin listemizi ÜSTÜNE alırdı. Yeni roller için
    // ad çakışması varsa oluşturma atlanır (aşağıda), sessizce genişletilmez.
    if (!row) {
      const legacyName = legacyNameByCode.get(entry.code);
      const aday = legacyName ? codelessByFoldedName.get(foldNameForCompare(legacyName)) : undefined;
      if (aday) {
        await tx.permissionTemplate.update({
          where: { id: aday.id },
          data: { code: entry.code },
        });
        codelessByFoldedName.delete(foldNameForCompare(aday.name));
        row = { ...aday, code: entry.code };
        byCode.set(entry.code, row);
        adopted.push(entry.code);
        adoptedIds.add(aday.id);
      }
    }

    if (!row) {
      // Ad başka bir şablonda kullanılıyorsa create P2002 verirdi; sessiz
      // patlama yerine iz bırakıp atla (fabrika ya adını değiştirir ya da bu
      // rolü zaten kendisi kurmuştur).
      const adCakismasi = existing.some(
        (t) => foldNameForCompare(t.name) === foldNameForCompare(entry.name) && !adoptedIds.has(t.id),
      );
      if (adCakismasi) {
        uyari("role-templates", `'${entry.code}' oluşturulamadı — '${entry.name}' adı zaten kullanılıyor.`,
        );
        continue;
      }
      if (wantedIds.length === 0) {
        uyari("role-templates", `'${entry.code}' atlandı — hiçbir izni çözülemedi.`);
        continue;
      }
      const yeni = await tx.permissionTemplate.create({
        data: {
          code: entry.code,
          name: entry.name,
          description: entry.description,
          permissions: { create: wantedIds.map((permissionId) => ({ permissionId })) },
        },
        select: { id: true },
      });
      created.push(entry.code);
      byCode.set(entry.code, {
        id: yeni.id,
        code: entry.code,
        name: entry.name,
        isActive: true,
        permissions: wantedIds.map((permissionId) => ({ permissionId })),
      });
      continue;
    }

    // Var olan şablon: yalnız EKSİK izinleri ekle. Ad/açıklama/isActive EZİLMEZ.
    const r = await addMissingTemplateItemsTx(tx, { ...row, code: entry.code }, wantedIds, idToCode);
    if (r.added.length > 0) itemsAdded[entry.code] = r.added;
    spread.push(...r.spread);
  }

  const katalogKodlari = new Set(ROLE_TEMPLATE_CATALOG.map((e) => e.code));
  // Fabrikanın kendi şablonları: sahiplenilmemiş kodsuz satırlar + katalogdan
  // çıkarılmış kod taşıyan satırlar. İkisine de DOKUNULMAZ.
  const custom = existing
    .filter((t) => !adoptedIds.has(t.id) && (!t.code || !katalogKodlari.has(t.code)))
    .map((t) => t.name)
    .sort();

  return { total: ROLE_TEMPLATE_CATALOG.length, created, adopted, itemsAdded, custom, spread };
}

/**
 * Katalogdaki rolleri DB ile uzlaştırır. Var olanı EZMEZ, hiçbir şeyi SİLMEZ.
 * Doğrudan çağrılabilir (test/script) — sunucuya bağımlılığı yoktur.
 */
export async function reconcileRoleTemplates(opts: RoleTemplateReconcileOptions = {}): Promise<RoleTemplateReconcileResult> {
  // Çok-modelli yazım TEK tx'te; rapor/audit tx DIŞINDA (audit best-effort'tur,
  // tx'e girerse kendi hatasıyla uzlaştırmayı geri sarardı).
  const result = await prisma.$transaction((tx) => reconcileRoleTemplatesTx(tx, opts));
  const { created, adopted, itemsAdded, custom, spread } = result;

  if (spread.length > 0) {
    bilgi("role-templates", `Tam Yetki yayılımı: ${new Set(spread.map((s) => s.userId)).size} kullanıcıya ${spread.length} izin verildi.`);
    // Kullanıcı × izin başına bir ayak izi (panelin tekil grant iziyle aynı biçim); aktör = sistem.
    await AuditService.logMany(
      spread.map((s) => ({
        userId: undefined,
        action: "CREATE" as const,
        tableName: "USER_PERMISSION",
        recordId: s.userPermissionId,
        newData: { userId: s.userId, permissionCode: s.permissionCode, source: "ADMIN_FULL_AUTO_SPREAD" },
      })),
    );
  }

  const eklenenIzinSayisi = Object.values(itemsAdded).reduce((a, l) => a + l.length, 0);
  if (created.length === 0 && adopted.length === 0 && eklenenIzinSayisi === 0) {
    bilgi("role-templates", `${ROLE_TEMPLATE_CATALOG.length} rol güncel — değişiklik yok.`);
  } else {
    if (adopted.length > 0)
      bilgi("role-templates", `${adopted.length} eski şablon kodlandı: ${adopted.join(", ")}`);
    if (created.length > 0)
      bilgi("role-templates", `${created.length} YENİ rol oluşturuldu: ${created.join(", ")}`);
    for (const [code, izinler] of Object.entries(itemsAdded))
      bilgi("role-templates", `'${code}' şablonuna ${izinler.length} eksik izin eklendi: ${izinler.join(", ")}`);

    await AuditService.logEvent({
      category: "SYSTEM",
      action: "ROLE_TEMPLATE_CATALOG_RECONCILED",
      tableName: "permission_templates",
      payload: {
        total: ROLE_TEMPLATE_CATALOG.length,
        created,
        adopted,
        itemsAdded,
        spreadCount: spread.length,
      },
    });
  }
  if (custom.length > 0)
    bilgi("role-templates", `Fabrikanın kendi ${custom.length} şablonu korunuyor: ${custom.join(", ")}`);

  return result;
}
