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
// BEST-EFFORT: hata sunucuyu DÜŞÜRMEZ ama sessizce de yutulmaz.
// =============================================================================

import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import {
  ROLE_TEMPLATE_CATALOG,
  LEGACY_TEMPLATE_NAME_TO_CODE,
  resolveRoleTemplateCodes,
} from "../constants/role-template-catalog";
import { AuditService } from "../services/audit.service";
import { foldNameForCompare } from "../services/helpers/name-normalize.helper";

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
};

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
): Promise<RoleTemplateReconcileResult> {
  const permissions = await tx.permission.findMany({ select: { id: true, code: true } });
  const permIdByCode = new Map(permissions.map((p) => [p.code, p.id]));

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

  // Kod → eski ad (sahiplenme YALNIZ bu tabloyla yapılır, bkz. aşağıdaki not).
  const legacyNameByCode = new Map(
    Object.entries(LEGACY_TEMPLATE_NAME_TO_CODE).map(([name, code]) => [code, name]),
  );

  for (const entry of ROLE_TEMPLATE_CATALOG) {
    const wantedCodes = resolveRoleTemplateCodes(entry);
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
      console.warn(
        `[role-templates] '${entry.code}' için ${unknown.length} izin DB'de yok, atlandı: ${unknown.join(", ")}`,
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
        console.warn(
          `[role-templates] '${entry.code}' oluşturulamadı — '${entry.name}' adı zaten kullanılıyor.`,
        );
        continue;
      }
      if (wantedIds.length === 0) {
        console.warn(`[role-templates] '${entry.code}' atlandı — hiçbir izni çözülemedi.`);
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
    const hedef = row;
    const mevcut = new Set(hedef.permissions.map((p) => p.permissionId));
    const eksik = wantedIds.filter((id) => !mevcut.has(id));
    if (eksik.length > 0) {
      const res = await tx.permissionTemplateItem.createMany({
        data: eksik.map((permissionId) => ({ templateId: hedef.id, permissionId })),
        skipDuplicates: true, // eşzamanlı boot yarışında güvenli (@@id bileşik)
      });
      if (res.count > 0) {
        const idToCode = new Map(permissions.map((p) => [p.id, p.code]));
        itemsAdded[entry.code] = eksik.map((id) => idToCode.get(id) ?? id).sort();
      }
    }
  }

  const katalogKodlari = new Set(ROLE_TEMPLATE_CATALOG.map((e) => e.code));
  // Fabrikanın kendi şablonları: sahiplenilmemiş kodsuz satırlar + katalogdan
  // çıkarılmış kod taşıyan satırlar. İkisine de DOKUNULMAZ.
  const custom = existing
    .filter((t) => !adoptedIds.has(t.id) && (!t.code || !katalogKodlari.has(t.code)))
    .map((t) => t.name)
    .sort();

  return { total: ROLE_TEMPLATE_CATALOG.length, created, adopted, itemsAdded, custom };
}

/**
 * Katalogdaki rolleri DB ile uzlaştırır. Var olanı EZMEZ, hiçbir şeyi SİLMEZ.
 * Doğrudan çağrılabilir (test/script) — sunucuya bağımlılığı yoktur.
 */
export async function reconcileRoleTemplates(): Promise<RoleTemplateReconcileResult> {
  // Çok-modelli yazım TEK tx'te; rapor/audit tx DIŞINDA (audit best-effort'tur,
  // tx'e girerse kendi hatasıyla uzlaştırmayı geri sarardı).
  const result = await prisma.$transaction((tx) => reconcileRoleTemplatesTx(tx));
  const { created, adopted, itemsAdded, custom } = result;

  const eklenenIzinSayisi = Object.values(itemsAdded).reduce((a, l) => a + l.length, 0);
  if (created.length === 0 && adopted.length === 0 && eklenenIzinSayisi === 0) {
    console.log(`[role-templates] ${ROLE_TEMPLATE_CATALOG.length} rol güncel — değişiklik yok.`);
  } else {
    if (adopted.length > 0)
      console.log(`[role-templates] ${adopted.length} eski şablon kodlandı: ${adopted.join(", ")}`);
    if (created.length > 0)
      console.log(`[role-templates] ${created.length} YENİ rol oluşturuldu: ${created.join(", ")}`);
    for (const [code, izinler] of Object.entries(itemsAdded))
      console.log(`[role-templates] '${code}' şablonuna ${izinler.length} eksik izin eklendi: ${izinler.join(", ")}`);

    await AuditService.logEvent({
      category: "SYSTEM",
      action: "ROLE_TEMPLATE_CATALOG_RECONCILED",
      tableName: "permission_templates",
      payload: {
        total: ROLE_TEMPLATE_CATALOG.length,
        created,
        adopted,
        itemsAdded,
      },
    });
  }
  if (custom.length > 0)
    console.log(`[role-templates] Fabrikanın kendi ${custom.length} şablonu korunuyor: ${custom.join(", ")}`);

  return { total: ROLE_TEMPLATE_CATALOG.length, created, adopted, itemsAdded, custom };
}
