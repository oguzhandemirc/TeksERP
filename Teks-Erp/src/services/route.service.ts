// =============================================================================
// TeksERP - Route (Rota Şablonu) Service
// =============================================================================
// Route = WorkOrder adımlarının klonlandığı yeniden-kullanılabilir kaynak şablon.
// Bare BaseController Zod taşımadığından (createInitialEntry/ProductRecipeService
// deseni) nested RouteStep referanslarının soft-delete giriş guard'ını + sequence
// geçerliliğini serviste doğrularız. (WO yolundaki assertRouteRefsActive'in
// master-data CRUD karşılığı — pasif istasyon/kategori/fason şablona sızmasın.)
// =============================================================================

import prisma from "../lib/prisma";
import { BaseService, type BaseServiceConfig } from "./base.service";
import { stepCanApplyColor, stepCanApplyProperty } from "./helpers/step-capability.helper";
import { assertTargetablePropertyIds } from "./helpers/targetable-property.helper";
import { AppError } from "../utils/app-error";
import { assertStationsRoutable } from "./helpers/station-routable.helper";
import type { ApiResponse } from "../types/api.types";

/**
 * Route servis konfigürasyonu — TEK KAYNAK. Hem canlı wiring (route.routes.ts)
 * hem regresyon testi (scripts/test_route_firm_roundtrip.ts) buradan tüketir.
 * Amaç: Saha #14 fason firma (`plannedSubcontractorId`) round-trip'i, biri
 * `defaultInclude`'dan `plannedSubcontractor`'ı düşürürse SESSİZCE bozulmasın —
 * test gerçek config'i doğrular.
 */
export const ROUTE_SERVICE_CONFIG: BaseServiceConfig = {
  modelName: "route",
  tableName: "ROUTE",
  searchFields: ["name"],
  nestedCreateFields: ["steps"],
  defaultInclude: {
    steps: {
      include: {
        station: {
          include: {
            defaultCategory: {
              select: {
                id: true,
                code: true,
                name: true,
                // Hızlı İş Emri "Gelişmiş" renk/özellik uygulaması, rotanın bu adımı
                // gerçekten uygulayıp uygulayamayacağını bu bayraklardan ölçer
                // (sadece kategori atanmış olması yetmez — appliesColor/Property gerekir).
                appliesColor: true,
                appliesProperty: true,
              },
            },
          },
        },
        // Saha #14: rota şablonunda saklı fason firması — istemci kayıtlı firmanın
        // adını ayrı sorgu olmadan gösterebilsin. (Scalar plannedSubcontractorId
        // zaten include ile dönüyor; bu yalnız adı ekler.)
        plannedSubcontractor: { select: { id: true, name: true } },
        // 2026-08-06: adımın şablon hedefi (renk + özellikler). İstemci rotayı
        // iş emrine uygularken bu iki alanı hedef alanlara kopyalar; ADI da
        // dönmeli, yoksa panel her adım için ayrı renk/özellik sorgusu atardı.
        plannedColor: { select: { id: true, code: true, name: true, hex: true } },
        plannedProperties: {
          select: {
            propertyId: true,
            // valueType: istemciler "rotayı uygula" birleşiminde SEÇİM (CHOICE)
            // tiplileri süzer (Q1) — hedef listesine CHOICE sızarsa WO create
            // 400 verir; süzgü hatayı en erken noktada keser.
            property: { select: { id: true, code: true, name: true, valueType: true } },
          },
        },
      },
      orderBy: { sequence: "asc" },
    },
  },
  uniqueField: "code",
  duplicateNameField: "name",
  entityLabel: "rota",
  // Kod backend-authoritative: `ROT+GGAAYY+NNNN` günlük sıralı (istemci kodu yok sayılır).
  autoCode: { series: "routeTemplate" },
};

interface IncomingStep {
  stationId?: string;
  requiredCategoryId?: string | null;
  plannedSubcontractorId?: string | null;
  sequence?: number;
  defaultNotes?: string | null;
  /** "Fasona renksiz git" — iş emri açılışında WorkOrderStep'e klonlanır. */
  dispatchWithoutColor?: boolean;
  /** 2026-08-06: adımın şablon hedefi. `plannedPropertyIds` DÜZ ID DİZİSİDİR — */
  plannedColorId?: string | null;
  /** serviste `{ create: [{ propertyId }] }` nested write'ına ÇEVRİLİR (aşağı). */
  plannedPropertyIds?: string[];
  /** Çeviri sonrası oluşan Prisma nested write — istemciden GELMEZ (allowlist reddeder). */
  plannedProperties?: { create: { propertyId: string }[] };
}

export class RouteService extends BaseService {
  // F209: rota adımında izinli alanlar — nested create çocukları sanitizeWriteData'yı
  // baypas eder; yalnız bunlar geçer (mass-assignment kapatılır).
  //
  // ⚠️ `plannedPropertyIds` bilinçli olarak DÜZ BİR ID DİZİSİDİR, ham Prisma
  // nested write DEĞİL. İstemciye `{ create: [...] }` yazdırmak, tam da bu
  // allowlist'in kapattığı ilişki-manipülasyonu kapısını yeniden açardı
  // (`{ connect: ... }` / `{ deleteMany: ... }` de aynı yoldan geçerdi).
  private static readonly ALLOWED_STEP_KEYS = new Set([
    "stationId",
    "sequence",
    "defaultNotes",
    "requiredCategoryId",
    "plannedSubcontractorId",
    "plannedColorId",
    "plannedPropertyIds",
    // "Fasona renksiz git" (2026-08-17 ekru kuralı) — şablon adımında da yaşar,
    // iş emri açılışında WorkOrderStep'e klonlanır. 2026-08-25'e kadar allowlist'te
    // YOKTU: şablona kaydetmek 400 verirdi, dolayısıyla miras yolu da hiç kurulamadı.
    "dispatchWithoutColor",
  ]);

  /** Dizi-form VE nested-write ({create:[...]}) formundan step nesnelerini çıkarır. */
  private extractSteps(rawSteps: unknown): IncomingStep[] | null {
    if (Array.isArray(rawSteps)) return rawSteps as IncomingStep[];
    if (rawSteps && typeof rawSteps === "object") {
      const create = (rawSteps as Record<string, unknown>).create;
      if (Array.isArray(create)) return create as IncomingStep[];
      if (create && typeof create === "object") return [create as IncomingStep];
    }
    return null;
  }

  private async validateSteps(data: Record<string, unknown>): Promise<void> {
    if (!("steps" in data) || data.steps == null) return;
    const steps = this.extractSteps(data.steps);
    if (steps === null) {
      throw AppError.badRequest(
        "Rota adımları geçersiz biçimde (dizi veya { create: [...] } bekleniyor)",
      );
    }
    if (steps.length === 0) return;

    // F209: mass-assignment guard — nested create çocukları için izinli-alan kontrolü.
    for (const s of steps) {
      for (const k of Object.keys(s as Record<string, unknown>)) {
        if (!RouteService.ALLOWED_STEP_KEYS.has(k)) {
          throw AppError.badRequest(`Rota adımında izin verilmeyen alan: ${k}`);
        }
      }
    }

    // sequence: pozitif tam sayı + tekrarsız
    const seqs = steps.map((s) => s.sequence);
    if (seqs.some((s) => typeof s !== "number" || !Number.isInteger(s) || (s as number) <= 0)) {
      throw AppError.badRequest("Rota adımı sırası (sequence) pozitif tam sayı olmalı");
    }
    if (new Set(seqs).size !== seqs.length) {
      throw AppError.badRequest("Rota adımı sıraları tekrarlı olamaz");
    }

    const pick = (key: keyof IncomingStep): string[] => [
      ...new Set(
        steps
          .map((s) => s[key])
          .filter((x): x is string => typeof x === "string" && x.length > 0)
      ),
    ];

    const stationIds = pick("stationId");
    if (stationIds.length > 0) {
      const found = await prisma.station.findMany({
        where: { id: { in: stationIds }, isActive: true },
        select: { id: true },
      });
      if (found.length !== stationIds.length) throw AppError.badRequest("Rota adımında bulunmayan veya pasif istasyon var");
      // Tezgah rotada adım değildir — tür kapısı ayrı ve adlı (400 STATION_NOT_ROUTABLE).
      await assertStationsRoutable(prisma, stationIds);
    }

    const categoryIds = pick("requiredCategoryId");
    if (categoryIds.length > 0) {
      const found = await prisma.subcontractorCategory.findMany({
        where: { id: { in: categoryIds }, isActive: true },
        select: { id: true },
      });
      if (found.length !== categoryIds.length) {
        throw AppError.badRequest("Rota adımında bulunmayan veya pasif kategori var");
      }
    }

    const subcontractorIds = pick("plannedSubcontractorId");
    if (subcontractorIds.length > 0) {
      const found = await prisma.subcontractor.findMany({
        where: { id: { in: subcontractorIds }, isActive: true },
        select: { id: true },
      });
      if (found.length !== subcontractorIds.length) {
        throw AppError.badRequest("Rota adımında bulunmayan veya pasif fason firma var");
      }
    }

    // Planlanan fason firma, adımın gerektirdiği kategoride hizmet vermeli —
    // planStep (workorder.service) ve fason sevk (subcontractor.service) bu
    // kuralı zaten dayatıyor; şablon yazım yolu asimetrik biçimde atlıyordu.
    // Yalnız İKİ alan da dolu adımlar denetlenir (tek bulk sorgu, perf kuralı).
    const catPairs = steps
      .map((s) => ({ sub: s.plannedSubcontractorId, cat: s.requiredCategoryId }))
      .filter((p): p is { sub: string; cat: string } =>
        typeof p.sub === "string" && p.sub.length > 0 &&
        typeof p.cat === "string" && p.cat.length > 0,
      );
    if (catPairs.length > 0) {
      const links = await prisma.subcontractorToCategory.findMany({
        where: { OR: catPairs.map((p) => ({ subcontractorId: p.sub, categoryId: p.cat })) },
        select: { subcontractorId: true, categoryId: true },
      });
      const have = new Set(links.map((l) => `${l.subcontractorId}:${l.categoryId}`));
      if (catPairs.some((p) => !have.has(`${p.sub}:${p.cat}`))) {
        throw AppError.badRequest(
          "Rota adımında seçilen fason firma, adımın gerektirdiği kategoride hizmet vermiyor",
        );
      }
    }

    await this.applyStepTargets(steps);
  }

  /**
   * Adımın ŞABLON HEDEFİ (renk + özellikler): doğrula, sonra düz id dizisini
   * Prisma nested write'ına çevir. `validateSteps`'in son adımı — çeviri
   * doğrulamadan SONRA yapılır, yoksa reddedilmesi gereken bir id nested
   * write'ın içine gömülür ve buradaki allowlist'in anlamı kalmaz.
   *
   * ⚠️ Hedef bir ÖNERİDİR: iş emri açılışında istemci bu değerleri hedef
   * alanlara kopyalar, operatör değiştirebilir. Bu yüzden burada "sipariş
   * kalemiyle uyumlu mu" gibi bir kontrol YOK — o soru WO create'e aittir ve
   * şablon yazılırken hangi siparişe bağlanacağı henüz bilinmez.
   */
  private async applyStepTargets(steps: IncomingStep[]): Promise<void> {
    const colorIds = [
      ...new Set(
        steps
          .map((s) => s.plannedColorId)
          .filter((x): x is string => typeof x === "string" && x.length > 0),
      ),
    ];

    const propertyIds = new Set<string>();
    for (const s of steps) {
      const raw = s.plannedPropertyIds;
      if (raw === undefined || raw === null) continue;
      if (
        !Array.isArray(raw) ||
        raw.some((id) => typeof id !== "string" || id.length === 0)
      ) {
        throw AppError.badRequest(
          "Rota adımının hedef özellik listesi geçersiz (id dizisi bekleniyor)",
        );
      }
      for (const id of raw) propertyIds.add(id);
    }

    if (colorIds.length === 0 && propertyIds.size === 0) {
      // Hiç hedef yok — eski istemciler (ve hedefsiz rotalar) tek ek sorgu bile
      // koşturmaz; nested write da üretilmez, gövde bayt-bayt eskisi gibi gider.
      this.stripTargetInput(steps);
      return;
    }

    if (colorIds.length > 0) {
      const found = await prisma.color.findMany({
        where: { id: { in: colorIds }, isActive: true },
        select: { id: true },
      });
      if (found.length !== colorIds.length) {
        throw AppError.badRequest("Rota adımında bulunmayan veya pasif renk var");
      }
    }

    if (propertyIds.size > 0) {
      const ids = [...propertyIds];
      const found = await prisma.fabricProperty.findMany({
        where: { id: { in: ids }, isActive: true },
        select: { id: true },
      });
      if (found.length !== ids.length) {
        throw AppError.badRequest("Rota adımında bulunmayan veya pasif özellik var");
      }
      // SEÇİM tipli özellik rota şablonu hedefi olamaz (denetim Q2) — şablon
      // uygulanınca WO hedef listesine kopyalanır ve oradaki guard'a çarpar;
      // hatayı kaynağında (şablon kaydında) söylemek daha dürüst.
      await assertTargetablePropertyIds(ids, "rota adımı hedef özelliği");
    }

    // İstasyon yeteneği — panel yalnız uygulanabilir olanları gösteriyor, ama
    // API'ye doğrudan gelen sapma sessizce kaydedilmemeli: "zımpara adımına MAVİ"
    // yazan bir şablon iş emrini renk uygulamayan bir rotayla açtırırdı.
    // ⚠️ RENK KISITI İSTASYON LİSTESİNDEN OKUNMAZ (2026-08-02 kuralı): yalnız
    // "bu adım renk uygulayan bir kategoride mi" sorulur. Özellik ise gerçek
    // proses kısıtıdır → StationProperty listesine bakılır.
    const targeted = steps.filter(
      (s) =>
        (typeof s.plannedColorId === "string" && s.plannedColorId.length > 0) ||
        (s.plannedPropertyIds?.length ?? 0) > 0,
    );
    const stationIds = [
      ...new Set(
        targeted.map((s) => s.stationId).filter((x): x is string => typeof x === "string" && x.length > 0),
      ),
    ];
    if (stationIds.length > 0) {
      const stations = await prisma.station.findMany({
        where: { id: { in: stationIds } },
        select: {
          id: true,
          name: true,
          kind: true,
          appliesColor: true,
          appliesProperty: true,
          defaultCategory: { select: { appliesColor: true, appliesProperty: true } },
          propertyCapabilities: { select: { propertyId: true } },
        },
      });
      const byId = new Map(stations.map((st) => [st.id, st]));

      // Adımlarda AÇIKÇA seçilmiş fason kategorileri (istasyonun varsayılanından
      // farklı olabilir — sevk edilecek hizmeti planlamacı adımda belirler).
      const stepCatIds = [
        ...new Set(targeted.map((s) => s.requiredCategoryId).filter((c): c is string => !!c)),
      ];
      const stepCats =
        stepCatIds.length > 0
          ? await prisma.subcontractorCategory.findMany({
              where: { id: { in: stepCatIds } },
              select: { id: true, appliesColor: true, appliesProperty: true },
            })
          : [];
      const catById = new Map(stepCats.map((c) => [c.id, c]));

      for (const s of targeted) {
        const station = s.stationId ? byId.get(s.stationId) : undefined;
        if (!station) continue; // stationId doğrulaması yukarıda yapıldı
        // ⚠️ Eski hâli bileşikti: `hasDefaultCategory && canApplyColor` — çünkü
        // kategorisiz istasyonda `canApplyColor` "bilinmiyor → serbest" anlamında
        // true doğuyordu. 2026-08-10'da yetenek `Station`'ın kendi alanına taşındı
        // ve bayrak DÜRÜST oldu; bileşik koşul tek yükleme indi. Yüklem
        // `stepCanApplyColor` — rota adımı, WO guard'ı ve renk kilidi ONU paylaşır.
        //
        // ⚠️ ADIMIN KATEGORİSİ DE OKUNUR. Yalnız istasyona bakılsaydı, kategorisi
        // BOYA olan bir fason boyahane adımı (istasyonun kendi bayrağı henüz
        // açılmamışsa) reddedilirdi — ölçüldü, `test_route_step_targets` bunu
        // yakaladı. Adımda kategori seçilmemişse istasyonun VARSAYILAN kategorisi
        // kullanılır: rota şablonunda `requiredCategoryId` opsiyoneldir ve
        // planlamacı boş bıraktığında niyeti "istasyonun her zamanki hizmeti"dir.
        const stepCat = s.requiredCategoryId
          ? (catById.get(s.requiredCategoryId) ?? station.defaultCategory)
          : station.defaultCategory;
        if (
          typeof s.plannedColorId === "string" &&
          s.plannedColorId.length > 0 &&
          !stepCanApplyColor(station, stepCat)
        ) {
          throw AppError.badRequest(
            `'${station.name}' adımı renk uygulamıyor — hedef renk seçilemez`,
          );
        }
        const wanted = s.plannedPropertyIds ?? [];
        if (wanted.length > 0) {
          if (!stepCanApplyProperty(station, stepCat)) {
            throw AppError.badRequest(
              `'${station.name}' adımı özellik uygulamıyor — hedef özellik seçilemez`,
            );
          }
          const capable = new Set(station.propertyCapabilities.map((c) => c.propertyId));
          if (wanted.some((id) => !capable.has(id))) {
            throw AppError.badRequest(
              `'${station.name}' adımının yetenek listesinde olmayan bir özellik seçildi`,
            );
          }
        }
      }
    }

    this.stripTargetInput(steps);
  }

  /**
   * `plannedPropertyIds` (istemci sözleşmesi) → `plannedProperties.create`
   * (Prisma). Boş/eksik dizi nested write ÜRETMEZ: `{ create: [] }` göndermek
   * de çalışırdı ama gövdeye anlamsız bir operatör yazar ve "hiç dokunmadım"
   * ile "hepsini temizledim" ayrımını gölgeler — adımlar zaten her kayıtta
   * silinip yeniden yazıldığı için boş dizi doğal olarak "hiçbiri" demektir.
   */
  private stripTargetInput(steps: IncomingStep[]): void {
    for (const s of steps) {
      const ids = s.plannedPropertyIds;
      delete s.plannedPropertyIds;
      const unique = [...new Set(ids ?? [])];
      if (unique.length > 0) {
        s.plannedProperties = { create: unique.map((propertyId) => ({ propertyId })) };
      }
    }
  }

  async create(data: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    await this.validateSteps(data);
    return super.create(data, userId);
  }

  async update(id: string, data: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    await this.validateSteps(data);
    return super.update(id, data, userId);
  }
}
