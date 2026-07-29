// =============================================================================
// TeksERP - Color (Renk Kataloğu) Service
// =============================================================================
// Renk kataloğu firmaya (müşteriye) özel atama taşır: bir renk bir veya birden
// fazla müşteriye atanabilir. Atama M:N olarak CustomerColorAlias tablosunda
// `assigned=true` ile tutulur. `assigned` (renk formundan atama) ile `alias`
// (müşteri panelinden özel ad) BAĞIMSIZ iki sinyaldir — aynı satırda yan yana
// durabilir. Atama eklerken alias'a dokunulmaz; atama kaldırırken alias varsa
// satır korunur (assigned=false), yoksa silinir.
//
// Aktif/pasif = renk geneli (Color.isActive). Atama bazında aktif/pasif YOK.
// =============================================================================

import { Request } from "express";
import prisma from "../lib/prisma";
import { BaseService } from "./base.service";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import {
  normalizeColorName,
  foldColorNameForCompare,
} from "./helpers/name-normalize.helper";

const TABLE_ALIAS = "CUSTOMER_COLOR_ALIAS";

/** Renk kodu (#RRGGBB) format guard — bare BaseController Zod taşımadığından serviste.
 *  Boş/verilmemiş hex serbest (UI rozeti opsiyonel); verildiyse biçim zorunlu. */
function assertValidHex(rest: Record<string, unknown>): void {
  if (
    typeof rest.hex === "string" &&
    rest.hex.trim() &&
    !/^#[0-9A-Fa-f]{6}$/.test(rest.hex.trim())
  ) {
    throw AppError.badRequest("Geçersiz renk kodu (beklenen biçim: #RRGGBB)");
  }
}

export class ColorService extends BaseService {
  /**
   * Aynı İSİMLİ ikinci renge izin verme (kod zaten @unique). Kontrol normalize
   * edilmiş ad üzerinden — "mavi" / "Mavi" / "MAVİ" hepsi "MAVİ"ye normalleştiği
   * için büyük/küçük harf varyantları da yakalanır. Pasif kayıt da sayılır:
   * aynı adla ikinci satır açmak yerine mevcut pasif renk aktifleştirilmeli
   * (yoksa restore anında görünmez mükerrer doğar).
   */
  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    if (!name) return;
    // Ayraç-duyarsız karşılaştırma: canlıdaki eski tireli adlar ("KREM-GÜMÜŞ",
    // "055-BEYAZ") yeni boşluklu yazımla ("KREM GÜMÜŞ", "beyaz 055") aynı
    // anahtara düşer — normalize artık boşluğu koruduğundan exact-eq yetmez.
    const target = foldColorNameForCompare(name);
    const candidates = await prisma.color.findMany({
      where: excludeId ? { id: { not: excludeId } } : {},
      select: { name: true, code: true, isActive: true },
    });
    const existing = candidates.find(
      (c) => foldColorNameForCompare(c.name) === target,
    );
    if (!existing) return;
    throw AppError.conflict(
      existing.isActive
        ? `'${name}' adında bir renk zaten var (kod: ${existing.code}). Aynı renk ikinci kez eklenemez.`
        : `'${name}' adında PASİF bir renk zaten var (kod: ${existing.code}). Yenisini eklemek yerine mevcut rengi aktifleştirin.`,
    );
  }
  /**
   * Picker scope süzgeci (her ikisi de `property:read` izniyle, müşteri-alias
   * iznine gerek YOK):
   *   - `?scope=public` → bir/birden fazla müşteriye ATANMIŞ (`assigned=true`)
   *     renkler DIŞLANIR. Müşteriye özel renk yalnızca o müşterinin "Müşteri
   *     Renkleri" (pinned) bölümünde görünmeli; başka müşterinin / müşterisiz
   *     bağlamın genel kataloğunda çıkmamalı.
   *   - `?assignedTo=<customerId>` → SADECE o müşteriye atanmış renkler. Picker
   *     pinned bölümü bunu kullanır (eskiden `customer-alias:read` gerektiren
   *     alias endpoint'i kullanılıyordu → o izni olmayan satışçı müşteri rengini
   *     hiç seçemiyordu; bu kaynak `property:read` ile çalışır).
   *
   * Renk yönetim sayfası hiçbirini göndermez → tüm renkleri görmeye devam eder.
   */
  protected extraWhere(req: Request): Record<string, unknown> | undefined {
    if (req.query.scope === "public") {
      return { customerAliases: { none: { assigned: true } } };
    }
    const assignedTo = req.query.assignedTo;
    if (typeof assignedTo === "string" && assignedTo.length > 0) {
      return {
        customerAliases: { some: { assigned: true, customerId: assignedTo } },
      };
    }
    return undefined;
  }

  /**
   * Color create — standart CRUD (BaseService) + `customerIds` müşteri ataması.
   * customerIds payload'dan ayrılır (yoksa Prisma bilinmeyen alan hatası verir),
   * renk oluşturulduktan sonra atamalar senkronlanır.
   */
  async create(
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const { customerIds, customerAliases, rest } = splitCustomerIds(data);

    // Saha #13: renk adı standardı — BÜYÜK + sayı blokları başta, boşluk korunur
    // ("beyaz 055" → "055 BEYAZ").
    if (typeof rest.name === "string") {
      const name = normalizeColorName(rest.name);
      rest.name = name;
      // Aynı isimli renk mükerrerliği yazımdan ÖNCE reddedilir (409). uniqueField
      // reactivate yolu (aynı code'lu pasif kayıt) diriltilecek kaydın KENDİ
      // adına takılmasın — pasif kod-eşi hariç tutulur (item.create emsali).
      const passiveCodeMatch =
        typeof rest.code === "string" && rest.code.length > 0
          ? await prisma.color.findFirst({
              where: { code: rest.code, isActive: false },
              select: { id: true },
            })
          : null;
      await this.assertNameAvailable(name, passiveCodeMatch?.id);
    }
    assertValidHex(rest);

    // F41: müşteri doğrulaması renk yazımından ÖNCE (yarım renk + orphan public önle).
    if (customerIds !== undefined) {
      await this.assertCustomersAssignable(customerIds);
    }

    const res = await super.create(rest, userId);
    const color = res.data as { id: string } | null;

    if (color && customerIds !== undefined) {
      await this.syncCustomerAssignments(color.id, customerIds, customerAliases, userId);
      (res.data as Record<string, unknown>).customerIds = dedupe(customerIds);
    }

    return res;
  }

  /**
   * Color update — standart CRUD + `customerIds` senkron. customerIds tanımsızsa
   * atamalara DOKUNULMAZ (restore'un `{ isActive: true }` PATCH'i atamaları
   * silmesin diye kritik).
   */
  async update(
    id: string,
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const { customerIds, customerAliases, rest } = splitCustomerIds(data);

    // Saha #13: renk adı standardı (create ile aynı normalize).
    if (typeof rest.name === "string") {
      const name = normalizeColorName(rest.name);
      rest.name = name;
      // Kontrol yalnız ad GERÇEKTEN değişirken (fold bazında) — canlıdaki
      // fold-eş tarihsel çiftler salt hex/atama düzenlemesinde 409'a takılmasın
      // (form her kayıtta name gönderir). Kayıt yoksa kontrol atlanır (404 yolu).
      const current = await prisma.color.findUnique({
        where: { id },
        select: { name: true },
      });
      if (
        current &&
        foldColorNameForCompare(name) !== foldColorNameForCompare(current.name)
      ) {
        await this.assertNameAvailable(name, id);
      }
    }
    assertValidHex(rest);

    // F41: müşteri doğrulaması renk yazımından ÖNCE.
    if (customerIds !== undefined) {
      await this.assertCustomersAssignable(customerIds);
    }

    // rest boşsa gereksiz audit/no-op update üretme — mevcut kaydı çek.
    const res =
      Object.keys(rest).length > 0
        ? await super.update(id, rest, userId)
        : await super.findById(id);

    const color = res.data as { id: string } | null;

    if (color && customerIds !== undefined) {
      await this.syncCustomerAssignments(color.id, customerIds, customerAliases, userId);
      (res.data as Record<string, unknown>).customerIds = dedupe(customerIds);
    }

    return res;
  }

  /**
   * findById — renge ATANMIŞ (assigned=true) müşteri id'lerini ekler (edit formu
   * prefill için). Sadece müşteri panelinden ad verilmiş ama atanmamış satırlar
   * (assigned=false) buraya dahil edilmez — yoksa renk o müşteriye atanmış gibi
   * görünür.
   */
  async findById(id: string): Promise<ApiResponse<unknown>> {
    const res = await super.findById(id);
    if (res.success && res.data) {
      const rows = await prisma.customerColorAlias.findMany({
        where: { colorId: id, assigned: true },
        select: { customerId: true, alias: true },
      });
      const data = res.data as Record<string, unknown>;
      data.customerIds = rows.map((r) => r.customerId);
      // Atanmış müşterilerin özel adları (renk formu prefill — adı temizlemeden
      // düzenleyebilsin diye). Sadece dolu alias'lar.
      data.customerAliases = Object.fromEntries(
        rows.filter((r) => r.alias).map((r) => [r.customerId, r.alias as string]),
      );
    }
    return res;
  }

  // ===========================================================================
  // Müşteri atama senkronu — replace semantiği, `assigned` bayrağı üzerinden.
  // Atama (assigned) ile özel ad (alias) BAĞIMSIZ: aynı satırda yan yana durur.
  //   - Atama eklerken: satır yoksa oluştur, varsa assigned=true yap.
  //   - Atama kaldırırken: alias varsa satırı KORU (assigned=false), aksi halde
  //     (sadece atama olan boş satır) sil.
  //
  // `aliasByCustomer` (renk formundan girilen "müşterideki ad") OPSİYONEL ve
  // NON-CLOBBERING: yalnızca map'te AÇIKÇA bulunan müşterilerin alias'ı yazılır
  // (boş → null). Map'te olmayan müşterinin (örn. müşteri panelinden girilmiş)
  // adına DOKUNULMAZ. Atama kaldırılan müşteri de map'te olmaz → adı korunur.
  // ===========================================================================
  /**
   * F41: Atanacak müşterilerin var + aktif olduğunu doğrular — RENK YAZIMINDAN
   * ÖNCE çağrılır (doğrulama hatasında yarım renk + atamasız public sızıntısı
   * oluşmasın). M-23: isActive da doğrulanır (pasif müşteriye exclusive atanan
   * renk tüm picker'lardan kaybolurdu). Boşsa no-op.
   */
  private async assertCustomersAssignable(rawCustomerIds: string[]): Promise<void> {
    const customerIds = dedupe(rawCustomerIds);
    if (customerIds.length === 0) return;
    const found = await prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, name: true, isActive: true },
    });
    if (found.length !== customerIds.length) {
      throw AppError.badRequest("Bazı müşteriler bulunamadı");
    }
    const inactive = found.find((c) => !c.isActive);
    if (inactive) {
      throw AppError.badRequest(`'${inactive.name}' müşterisi pasif — renk atanamaz`);
    }
  }

  private async syncCustomerAssignments(
    colorId: string,
    rawCustomerIds: string[],
    aliasByCustomer: Record<string, string> | undefined,
    userId?: string,
  ): Promise<void> {
    const customerIds = dedupe(rawCustomerIds);
    const aliasMap = normalizeAliasMap(aliasByCustomer);

    // F41: doğrulama tek kaynaktan (create/update önünde erken de çağrılır).
    await this.assertCustomersAssignable(customerIds);

    const existing = await prisma.customerColorAlias.findMany({
      where: { colorId },
      select: { customerId: true, assigned: true, alias: true },
    });
    const assignedSet = new Set(
      existing.filter((e) => e.assigned).map((e) => e.customerId),
    );
    const rowByCustomer = new Map(existing.map((e) => [e.customerId, e]));
    const targetSet = new Set(customerIds);

    // Hedefte olup şu an ATANMAMIŞ olanlar → eklenecek.
    const toAdd = customerIds.filter((cid) => !assignedSet.has(cid));
    // Şu an atanmış olup hedefte olmayanlar → kaldırılacak.
    const toRemove = [...assignedSet].filter((cid) => !targetSet.has(cid));

    // Eklenenleri "yeni satır" (hiç kayıt yok) vs "var olan adlı satırı işaretle"
    // diye ayır; kaldırılanları "adlı satır → koru" vs "boş satır → sil" diye ayır.
    const toCreate = toAdd.filter((cid) => !rowByCustomer.has(cid));
    const toMarkAssigned = toAdd.filter((cid) => rowByCustomer.has(cid));
    const toKeepUnassigned = toRemove.filter((cid) => {
      const r = rowByCustomer.get(cid);
      return Boolean(r?.alias && r.alias.trim());
    });
    const toDelete = toRemove.filter((cid) => !toKeepUnassigned.includes(cid));

    // Var olan satırlarda alias değişimi (yeni create edilenler aşağıda inline
    // yazılır). Sadece map'te açıkça verilmiş + değeri farklı olanlar.
    const aliasUpdates = customerIds
      .filter((cid) => aliasMap.has(cid) && rowByCustomer.has(cid))
      .map((cid) => ({ cid, alias: aliasMap.get(cid) ?? null }))
      .filter(({ cid, alias }) => (rowByCustomer.get(cid)?.alias ?? null) !== alias);

    if (
      toAdd.length === 0 &&
      toRemove.length === 0 &&
      aliasUpdates.length === 0
    ) {
      return;
    }

    await prisma.$transaction(async (tx) => {
      // pg adapter: tx içinde Promise.all yasak — seri çalıştır.
      if (toDelete.length > 0) {
        await tx.customerColorAlias.deleteMany({
          where: { colorId, customerId: { in: toDelete } },
        });
      }
      if (toKeepUnassigned.length > 0) {
        await tx.customerColorAlias.updateMany({
          where: { colorId, customerId: { in: toKeepUnassigned } },
          data: { assigned: false },
        });
      }
      if (toMarkAssigned.length > 0) {
        await tx.customerColorAlias.updateMany({
          where: { colorId, customerId: { in: toMarkAssigned } },
          data: { assigned: true },
        });
      }
      if (toCreate.length > 0) {
        await tx.customerColorAlias.createMany({
          // F271: existing-set tx-DIŞI okunuyor; iki eşzamanlı renk-formu kaydı
          // aynı (colorId,customerId) satırını eklerse 500 yerine sessiz merge.
          skipDuplicates: true,
          data: toCreate.map((customerId) => ({
            customerId,
            colorId,
            alias: aliasMap.has(customerId) ? aliasMap.get(customerId) ?? null : null,
            assigned: true,
          })),
        });
      }
      // Renk formundan girilen "müşterideki ad" güncellemeleri (seri).
      for (const { cid, alias } of aliasUpdates) {
        await tx.customerColorAlias.updateMany({
          where: { colorId, customerId: cid },
          data: { alias },
        });
      }
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE_ALIAS,
      recordId: colorId,
      newData: {
        colorId,
        added: toAdd,
        removed: toRemove,
        aliasUpdated: aliasUpdates.map((a) => a.cid),
      },
    });
  }
}

// =============================================================================
// Local helpers
// =============================================================================

function splitCustomerIds(data: Record<string, unknown>): {
  customerIds: string[] | undefined;
  customerAliases: Record<string, string> | undefined;
  rest: Record<string, unknown>;
} {
  const rest = { ...data };
  const raw = rest.customerIds;
  delete rest.customerIds;
  const rawAliases = rest.customerAliases;
  delete rest.customerAliases;
  const customerIds = Array.isArray(raw) ? (raw as string[]) : undefined;
  const customerAliases =
    rawAliases && typeof rawAliases === "object" && !Array.isArray(rawAliases)
      ? (rawAliases as Record<string, string>)
      : undefined;
  return { customerIds, customerAliases, rest };
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Renk formundan gelen { customerId: ad } map'ini normalize eder: boş/whitespace
 * ad → null (özel ad yok). Sadece map'te bulunan müşteriler döner (non-clobbering).
 */
function normalizeAliasMap(
  raw: Record<string, string> | undefined,
): Map<string, string | null> {
  const m = new Map<string, string | null>();
  if (!raw) return m;
  for (const [cid, val] of Object.entries(raw)) {
    const t = typeof val === "string" ? val.trim() : "";
    m.set(cid, t.length === 0 ? null : t);
  }
  return m;
}
