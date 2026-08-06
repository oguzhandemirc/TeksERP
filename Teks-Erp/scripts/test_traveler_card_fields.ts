// =============================================================================
// TEST: Refakat kartı — ALAN BAZLI görünürlük + punto + kalınlık (tek tablo)
// Çalıştır: npx tsx scripts/test_traveler_card_fields.ts
// =============================================================================
// DB GEREKTİRMEZ — renderer + katalog + sanitize saf fonksiyonlardır.
//
// 2026-08-05'te kartın ayar yüzeyi TEK TABLOYA indirildi: her satırda solda
// görünürlük, sağında SAYISAL punto + kalınlık. Arkada İKİ DEPO var ve testin
// asıl işi ikisinin de aynı sözleşmeyi tutmasını sağlamak:
//   • `config.fields`      → tekil yüzeyler, CSS kuralı olarak basılır
//   • `config.specFields` … → tablo hücreleri, hücre-başına INLINE basılır
//
// Kilitlenen sözleşmeler:
//  §1 PARMAK İZİ. Ayara dokunulmamış kart BUGÜNKÜ çıktıyı bayt-bayt verir.
//  §2 KATALOG CANLI. Katalogdaki her seçicinin karşılığı basılan HTML'de var —
//     bir sınıf adı değişirse ayar hata/log ÜRETMEDEN ölü doğar.
//  §3 İZOLASYON. Bir alanı ayarlamak komşusuna dokunmaz.
//  §4 ÖNEK. `.sheet` çocukları `.sheet `, filigran `body ` ile öneklenir —
//     filigran `.sheet`in KARDEŞİ, `.sheet .wm` hiçbir şeyle eşleşmez.
//  §5 GLOBAL ÖLÇEK ÜSTÜNE BİNER. `calc()`/`var()` yasağının bekçisi: alan CSS'i
//     düz `Npx` basmazsa regex takılmaz ve genel ölçek TAM DA elle ayarlanan
//     alanlarda çalışmaz olur.
//  §6 GİZLEME. `hidden` → `display: none`; gizli alanda punto BASILMAZ.
//  §7 HÜCRE PUNTOSU. `px` kademenin üstünde; eski `sm/lg` kayıtları HÂLÂ okunur
//     (donmuş snapshot'lar bozulmamalı).
//  §9 KAYIT KAPISI. Ayar GERÇEK route şemasından (`updateSchema`) sağ çıkıyor.
//     `travelerCardConfig` düz `z.object` olduğu için şemaya yazılmayan anahtar
//     SESSİZCE atılır: panel "kaydedildi" der, uç 200 döner, DB boş kalır.
//
// NEGATİF SONDA — "kırmızı verebiliyor mu" KANITLANDI (2026-08-05, 5 sonda; her
// sondadan sonra dosya `diff` ile birebir geri yüklendiği doğrulandı):
//   ① `fieldTail` koşulsuz emit                  → 1 düştü (§1 parmak izi)
//   ② filigran öneki `.sheet ` yapıldı           → 3 düştü (§4)
//   ③ `hidden` → `display:none` dalı kaldırıldı  → 5 düştü (§6 + §9 uçtan uca)
//   ④ hücre `px`i yok sayıldı (kademeye düşüldü) → 4 düştü (§5 + §7 + §9)
//   ⑤ route şemasından `fields` satırı düştü     → 7 düştü (§9 — asıl tuzak)
//   ⑥ önizleme şeması "anahtar sayan" hâline döndürüldü → 3 düştü (§10)
// Bu dosyayı değiştirirsen aynı altısını TEKRARLA — kırmızı verdiği kanıtlanmamış
// bekçi, bekçi değil süstür.
// =============================================================================

import { renderTravelerCardHtml } from "../src/services/document-render/traveler-card.html";
import {
  TRAVELER_FIELDS,
  travelerFieldCss,
  resolveTravelerField,
  sanitizeTravelerFields,
} from "../src/services/document-render/traveler-card.fields";
import { DENSITY } from "../src/services/document-render/traveler-card.density";
import {
  normalizeTravelerCardConfig,
  type TravelerCardConfig,
} from "../src/services/system-setting.service";
// GERÇEK kapılar — kopyaları değil; şemaya yazılmayan anahtar burada yakalanır.
// §9 kayıt yolu (feature-flags PATCH), §10 önizleme yolu (sample-html POST).
import { updateSchema } from "../src/routes/feature-flag.routes";
import { sampleHtmlSchema } from "../src/controllers/traveler-card.controller";

let pass = 0,
  fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture — kartın TÜM bölümlerini dolduran snapshot (katalog taraması için her
// yüzeyin gerçekten basılması gerekir; boş bir kartta yarısı hiç çizilmez).
// ─────────────────────────────────────────────────────────────────────────────
function snap(config: Partial<TravelerCardConfig>): Parameters<typeof renderTravelerCardHtml>[0] {
  return {
    config: config as TravelerCardConfig,
    workOrderNumber: "IE0508260001",
    type: "STOCK_PRODUCTION",
    width: 150,
    targetQuantity: 800,
    targetWeight: 240,
    foldType: "4-KAT",
    plannedStartDate: "2026-08-05T06:00:00.000Z",
    plannedEndDate: "2026-08-09T06:00:00.000Z",
    routeTemplate: { name: "Boya + Tambur" },
    targetItem: { code: "STK-000123", name: "PATOS SÜET" },
    targetColor: { name: "LACİVERT", hex: "#1e3a8a" },
    targetProperties: [
      { propertyId: "p1", property: { name: "Su İticilik" } },
      { propertyId: "p2", property: { name: "Zımparalı" } },
    ],
    steps: [
      {
        id: "s1",
        stepSequence: 1,
        isUrgent: false,
        notes: "Boyahane talimatı: renk kartelasına birebir uyulacak.",
        station: { name: "BOYAHANE", type: "SUBCONTRACTOR" },
        plannedSubcontractor: { id: "sc1", name: "Yıldız Boyahane" },
      },
      {
        id: "s2",
        stepSequence: 2,
        isUrgent: false,
        notes: null,
        station: { name: "TAMBUR", type: "INTERNAL" },
        plannedSubcontractor: null,
      },
    ],
    orderLinks: [
      {
        orderLineId: "ol1",
        orderLine: {
          quantity: 500,
          order: { orderNumber: "SIP0508260001", customer: { name: "ÖRNEK TEKSTİL" } },
          item: { name: "PATOS SÜET" },
          color: { name: "LACİVERT" },
        },
      },
    ],
  };
}

const META = {
  cardNumber: "IE0508260001",
  barcode: "IE0508260001",
  version: 1,
  printedAt: "2026-08-05T09:00:00.000Z",
  // TASLAK filigranı — `.wm` yalnız bu dalda basılır, §2/§4 ona bakıyor.
  draft: true,
  batches: [
    {
      batchNumber: "P07",
      rollCount: 12,
      quantity: 812.5,
      dispatch: { dispatchNo: "FS0508260001", subcontractorName: "Yıldız Boyahane", moreCount: 0 },
    },
  ],
};

const render = (config: Partial<TravelerCardConfig>): string =>
  renderTravelerCardHtml(snap(config), META);

/**
 * Config'i kayıt kapısından geçirir — panelin yazdığı yolu birebir taklit eder.
 *
 * ⚠️ `pageSize: "A4"` AÇIKÇA verilir ve bu SÜS DEĞİL: iki katmanın varsayılanı
 * bilerek farklıdır (`traveler-card.density.ts`) — AYAR katmanı A5'e, RENDER
 * katmanı (alan taşımayan donmuş snapshot) A4'e çözer. Yazılmazsa
 * `normalizeTravelerCardConfig` A5, `render({})` ise A4 kalır ve aynı dosyadaki
 * beklentiler iki farklı yoğunluk profilini karşılaştırır. (Bu tuzak testi
 * yazarken fiilen ısırdı; yorum o yüzden burada.)
 */
const saved = (o: Record<string, unknown>): TravelerCardConfig =>
  normalizeTravelerCardConfig({ ...o, pageSize: "A4" });

const A4 = DENSITY.A4;
const A5 = DENSITY.A5;

console.log("\n=== §1 — PARMAK İZİ: ayara dokunulmamış kart değişmedi ===");
{
  const base = render({});
  check("`fields` yokken alan CSS'i bloğu HİÇ basılmaz", !base.includes("Alan bazlı yazı ayarı"));
  check("… ve `.sheet .` önekli tek kural yok", !base.includes(".sheet ."));
  check(`A4 firma adı ${A4.company}px`, base.includes(`.company { font-size: ${A4.company}px`));
  check(`A4 iş emri no ${A4.woNo}px`, base.includes(`.batch { font-size: ${A4.woNo}px`));
  check(`A4 özet tablo etiketi ${A4.cLbl}px`, base.includes(`.c-lbl { font-size: ${A4.cLbl}px`));
  check("hücrelerde inline stil yok (hepsi varsayılan)", !base.includes(`<div class="c-val" style=`));
  check("boş `fields` normalize'de düşürülür", saved({ fields: {} }).fields === undefined);
  check(
    "yalnız çöp taşıyan `fields` düşürülür",
    saved({ fields: { company: { size: "abc", weight: "kalın" } } }).fields === undefined,
  );
  check("bilinmeyen anahtar CSS üretmez", travelerFieldCss({ yokBoyleAlan: { size: 20 } }, A4) === "");
}

console.log("\n=== §2 — KATALOG CANLI: her seçicinin karşılığı basılıyor ===");
{
  const full = render({});
  const missing: string[] = [];
  for (const def of TRAVELER_FIELDS) {
    for (const sel of def.selector.split(",")) {
      const cls = sel.trim().split(/\s+/)[0]!;
      if (!full.includes(cls)) missing.push(`${def.key}:${cls}`);
    }
  }
  check(
    `katalogdaki ${TRAVELER_FIELDS.length} alanın seçicisi çıktıda var`,
    missing.length === 0,
    missing.length ? `EKSİK → ${missing.join(", ")}` : "",
  );
  check(
    "katalog anahtarları benzersiz",
    new Set(TRAVELER_FIELDS.map((f) => f.key)).size === TRAVELER_FIELDS.length,
  );
  // Körlük zemini: katalog boşalırsa yukarıdaki döngü vakumen yeşil kalırdı.
  check("körlük zemini — katalog en az 20 alan taşıyor", TRAVELER_FIELDS.length >= 20, `${TRAVELER_FIELDS.length}`);
  // ⚠️ Katalogda TABLO HÜCRESİ olmamalı: hücreler inline basılır ve CSS'i ezer;
  // katalog satırı eklemek kullanıcıya çalışmayan bir kutu gösterirdi.
  const cellSelectors = [".c-val", ".ord td", ".bat td"];
  const leaked = TRAVELER_FIELDS.filter((f) => cellSelectors.some((c) => f.selector.includes(c)));
  check("katalog tablo HÜCRESİ taşımıyor (inline depoya ait)", leaked.length === 0, leaked.map((f) => f.key).join(", "));
  const a4 = resolveTravelerField("woNo", undefined, A4);
  const a5 = resolveTravelerField("woNo", undefined, A5);
  check("taban punto sayfa boyutuna göre değişiyor", a4?.size === A4.woNo && a5?.size === A5.woNo, `${a4?.size} ↔ ${a5?.size}`);
}

console.log("\n=== §3 — İZOLASYON: bir alan komşusunu değiştirmiyor ===");
{
  const html = render(saved({ fields: { specLabel: { size: 12, weight: "black" } } }));
  check("özet tablo ETİKETİ override'ı basıldı", html.includes(".sheet .c-lbl { font-size: 12px; font-weight: 800; }"));
  check("firma adına dokunulmadı", !html.includes(".sheet .company {"));
  check(`… firma adı CSS'i hâlâ ${A4.company}px`, html.includes(`.company { font-size: ${A4.company}px`));

  const ord = render(saved({ fields: { orderHead: { size: 11 } } }));
  check("sipariş BAŞLIĞI override'ı basıldı", ord.includes(".sheet .ord th { font-size: 11px; }"));
  check("parti başlığına dokunulmadı", !ord.includes(".sheet .bat th {"));

  const wOnly = render(saved({ fields: { productName: { weight: "light" } } }));
  check("yalnız kalınlık → tek deklarasyon", wOnly.includes(".sheet .product-name { font-weight: 300; }"));
}

console.log("\n=== §4 — ÖNEK: .sheet çocuğu vs filigran (kardeş) ===");
{
  const html = render(saved({ fields: { watermark: { size: 40 }, company: { size: 18 } } }));
  check("filigran `body ` ile öneklendi", html.includes("body .wm { font-size: 40px; }"));
  check("filigran `.sheet ` ile ÖNEKLENMEDİ", !html.includes(".sheet .wm"));
  check("normal alan `.sheet ` ile öneklendi", html.includes(".sheet .company { font-size: 18px; }"));
  const multi = render(saved({ fields: { smallLabel: { size: 9 } } }));
  check("çok seçicili alanın her parçası öneklendi", multi.includes(".sheet .lbl, .sheet .p-lbl { font-size: 9px; }"));
}

console.log("\n=== §5 — GLOBAL ÖLÇEK override'ın ÜSTÜNE biner (calc() yasağı) ===");
{
  const html = render({ ...saved({ fields: { company: { size: 20 } } }), fontScale: 1.2 });
  check("override'lı punto genel ölçekle çarpıldı", html.includes(".sheet .company { font-size: 24px;"), "20 × 1.2");
  check("alan CSS'inde calc()/var() yok", !/\.sheet [^{]*\{[^}]*(calc\(|var\()/.test(html));
  const bold = render({ ...saved({ fields: { company: { weight: "medium" } } }), fontWeight: "bold" });
  check("override'lı kalınlık genel kaydırmayı aldı", bold.includes(".sheet .company { font-weight: 600; }"), "500 + 100");
  // Hücre inline puntosu da regex'e takılmalı — yoksa ölçek yarım çalışırdı.
  const cellScaled = render({
    ...saved({ specFields: { color: { show: true, px: 20 } } }),
    fontScale: 1.2,
  });
  check("hücre inline puntosu da ölçeklendi", cellScaled.includes("font-size: 24px"), "20 × 1.2");
}

console.log("\n=== §6 — GİZLEME: hidden → display:none ===");
{
  const html = render(saved({ fields: { watermark: { hidden: true }, cardMeta: { hidden: true } } }));
  check("gizli alan display:none aldı", html.includes(".sheet .card-meta { display: none; }"));
  check("filigran gizlemesi de `body ` önekli", html.includes("body .wm { display: none; }"));
  // Gizli alanda punto basmak ölü bayttır (görünmeyen şeyin boyu yok).
  const both = render(saved({ fields: { cardMeta: { hidden: true, size: 20, weight: "bold" } } }));
  check("gizli alanda punto/kalınlık BASILMAZ", !both.includes(".sheet .card-meta { font-size"));
  check("… yalnız display:none var", both.includes(".sheet .card-meta { display: none; }"));
  // `hidden: false` config'e YAZILMAZ (kutuyu açıp kapatan ölü kayıt bırakmasın).
  check("`hidden:false` saklanmaz", saved({ fields: { company: { hidden: false } } }).fields === undefined);
  // Gizleme tek başına da yeterli bir override'dır (sanitize düşürmemeli).
  const onlyHidden = saved({ fields: { company: { hidden: true } } });
  check("yalnız gizleme taşıyan alan KORUNUR", onlyHidden.fields?.company?.hidden === true);
}

console.log("\n=== §7 — HÜCRE PUNTOSU: px kademenin üstünde, eski kayıt hâlâ okunur ===");
{
  // Yeni yol: sayısal px.
  const pxHtml = render(saved({ specFields: { color: { show: true, px: 16, weight: "black" } } }));
  check("hücre px'i inline basıldı", pxHtml.includes(`<div class="c-val" style="font-size:16px;font-weight:900">`));

  // Eski yol: kademe (donmuş snapshot'lar bunu taşıyor) — HÂLÂ çalışmalı.
  const legacy = render({
    pageSize: "A4",
    specFields: { color: { show: true, size: "lg", weight: "bold" } },
  } as Partial<TravelerCardConfig>);
  check(`eski "lg" kademesi hâlâ okunuyor (${A4.specLg}px)`, legacy.includes(`font-size:${A4.specLg}px`));
  check('eski "bold" 800 olarak kaldı (canlı çıktı korundu)', legacy.includes("font-weight:800"));

  // px ile kademe birlikteyse px kazanır.
  const both = render({
    pageSize: "A4",
    specFields: { color: { show: true, size: "sm", px: 19 } },
  } as Partial<TravelerCardConfig>);
  check("px kademeyi ezer", both.includes("font-size:19px") && !both.includes(`font-size:${A4.specSm}px`));

  // "normal" kalınlık İNLİNE BASILMAZ → sütunun kendi CSS tabanı korunur.
  const normal = render(saved({ orderFields: { orderNumber: { show: true, weight: "normal" } } }));
  check('"normal" kalınlık inline basılmaz (sütun tabanı korunur)', !normal.includes("font-weight:400;"));

  // Görünürlük: kutu kapalıysa hücre hiç çizilmez.
  // ⚠️ Seçici DAR olmalı: düz `">Renk<"` sipariş tablosunun "Renk" SÜTUN
  // BAŞLIĞIYLA da eşleşir ve kontrol, hücre hâlâ basılırken bile kırmızı/yeşil
  // olabilir. Özet tablo etiketi kendi sınıfıyla aranır.
  const hiddenCell = render(saved({ specFields: { color: { show: false } } }));
  check('kapalı hücre basılmıyor', !hiddenCell.includes('class="c-lbl">Renk<'));
  check("… ama açıkken basılıyor (kontrol gerçekten ölçüyor)", render(saved({})).includes('class="c-lbl">Renk<'));

  // px sınırı KIRPILIR (400 değil).
  const clamped = saved({ specFields: { color: { show: true, px: 999 } } });
  check("hücre px'i üst sınıra kırpıldı", clamped.specFields.color.px === 48, `${clamped.specFields.color.px}`);
}

console.log("\n=== §8 — SANITIZE: clamp + kayıt kapısı ===");
{
  const big = sanitizeTravelerFields({ company: { size: 999 } });
  check("punto üst sınıra çekildi (48)", big?.company?.size === 48, `${big?.company?.size}`);
  const small = sanitizeTravelerFields({ company: { size: 1 } });
  check("punto alt sınıra çekildi (5)", small?.company?.size === 5, `${small?.company?.size}`);
  check("geçerli kalınlık korundu", sanitizeTravelerFields({ company: { weight: "black" } })?.company?.weight === "black");
  check("geçersiz kalınlık düşürüldü", sanitizeTravelerFields({ company: { weight: "kalın" } }) === undefined);
  const cfg = saved({ fields: { woNo: { size: 30, weight: "black" } } });
  check("normalize `fields`i saklıyor", cfg.fields?.woNo?.size === 30 && cfg.fields?.woNo?.weight === "black");
}

console.log("\n=== §9 — KAYIT KAPISI: ayar route şemasından SAĞ çıkıyor mu ===");
{
  // Bu projenin en pahalı sessiz hatası: iç nesne düz `z.object` olduğu için
  // şemaya YAZILMAYAN anahtar Zod tarafından atılır → panel "kaydedildi" der,
  // uç 200 döner, DB'ye hiçbir şey yazılmaz (`kk1DuplicateGuardEnabled` bu
  // delikten geçti). Bu yüzden GERÇEK route şeması çağrılır, kopyası değil.
  const base = normalizeTravelerCardConfig({ pageSize: "A4" });
  const parsed = updateSchema.parse({
    travelerCardConfig: {
      ...base,
      fields: { woNo: { size: 30, weight: "black" }, cardMeta: { hidden: true } },
      specFields: { ...base.specFields, color: { show: true, size: "md", weight: "black", px: 16 } },
    },
  });
  const f = parsed.travelerCardConfig?.fields;
  check("`fields` route şemasından geçti (atılmadı)", f != null);
  check("… punto korundu", f?.woNo?.size === 30, `${f?.woNo?.size}`);
  check("… kalınlık korundu", f?.woNo?.weight === "black");
  check("… gizleme korundu", f?.cardMeta?.hidden === true);
  check("hücre `px`i route şemasından geçti", parsed.travelerCardConfig?.specFields?.color?.px === 16);

  // Uçtan uca: parse → normalize (servisin `setFeatureFlags` yazma dalıyla aynı
  // çağrı) → renderer. Zincirin herhangi bir halkası koparsa kâğıt değişmez.
  const merged = normalizeTravelerCardConfig(parsed.travelerCardConfig as Record<string, unknown>);
  const html = render(merged);
  check("uçtan uca: başlık kâğıtta değişti", html.includes(".sheet .batch { font-size: 30px; font-weight: 800; }"));
  check("uçtan uca: gizleme kâğıtta uygulandı", html.includes(".sheet .card-meta { display: none; }"));
  check("uçtan uca: hücre puntosu kâğıtta uygulandı", html.includes(`style="font-size:16px;font-weight:900"`));

  let rejected = false;
  try {
    updateSchema.parse({ travelerCardConfig: { ...base, fields: { woNo: { weight: "kalın" } } } });
  } catch {
    rejected = true;
  }
  check("geçersiz kalınlık route'ta reddedildi (sessiz düşürme yok)", rejected);
}

console.log("\n=== §10 — ÖNİZLEME KAPISI: panelin gönderdiği her alan sağ çıkıyor mu ===");
{
  // 2026-08-06 saha bulgusu: önizleme ucunun Zod şeması anahtarları TEK TEK
  // sayıyordu ve `showBatches`/`batchFields`/`batchTotal`/`sections` o listeye
  // hiç eklenmemişti (backend'e sonradan geldiler). Düz `z.object` bilinmeyen
  // anahtarı SESSİZCE attığı için kullanıcı Partiler bölümünün puntosunu
  // değiştiriyor, önizleme değişmiyor, hata da çıkmıyordu.
  //
  // Bu kontrol PANELİN gönderdiği tam config'i gerçek önizleme şemasından
  // geçirir ve HİÇBİR anahtarın düşmediğini doğrular. Şema tekrar
  // anahtar-sayan bir `z.object`e çevrilirse burası kırmızı verir.
  const full = normalizeTravelerCardConfig({
    pageSize: "A4",
    fields: { woNo: { size: 30 }, cardMeta: { hidden: true } },
    specFields: { color: { show: true, px: 16 } },
    batchFields: { batchNumber: { show: true, px: 15 } },
    batchTotal: { show: true, px: 14 },
    sections: [{ key: "header", enabled: true }],
  });
  const parsed = sampleHtmlSchema.parse({ config: full });
  const got = (parsed.config ?? {}) as Record<string, unknown>;
  const dropped = Object.keys(full).filter((k) => !(k in got));
  check("önizleme şeması hiçbir config anahtarını düşürmüyor", dropped.length === 0, dropped.join(", "));
  // Körlük zemini: config boşalırsa yukarıdaki fark vakumen boş çıkardı.
  check("körlük zemini — config en az 15 anahtar taşıyor", Object.keys(full).length >= 15, `${Object.keys(full).length}`);

  // Uçtan uca: önizleme yolunun ÜRETTİĞİ HTML'de parti puntosu gerçekten var mı.
  const previewCfg = normalizeTravelerCardConfig(got);
  const html = render(previewCfg);
  check("parti hücresinin puntosu önizleme çıktısında", html.includes("font-size:15px"));
  check("parti toplamının puntosu önizleme çıktısında", html.includes("font-size:14px"));
  check("tekil alan puntosu önizleme çıktısında", html.includes(".sheet .batch { font-size: 30px; }"));
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===\n`);
process.exit(fail > 0 ? 1 : 0);
