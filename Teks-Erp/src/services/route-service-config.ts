// Rota servis konfigürasyonu — route.service.ts'ten bölündü (dosya boyu tavanı); servis aynı adla yeniden verir.
import type { BaseServiceConfig } from "./base.service";

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
        // Gülkesim 2026-11-02: adımın önerilen makinesi (yalnız öneri) — adı tek sorguda.
        plannedMachine: { select: { id: true, code: true, name: true } },
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
