// =============================================================================
// BEKÇİ — `document-template:read` / `:write` (belge tasarım yüzeyi)
// =============================================================================
// NE KORUYOR: 2026-08-05'te Tanımlar → Çıktılar altındaki DÖRT ekran (Belge
// Şablonları · Refakat Kartı · Refakat Kartı Şablonları · Serbest Belgeler)
// düz `admin:settings`ten AYRILDI. Şablonu düzenleyen büro personeline artık
// oturum politikasını, yedek saatini, cihaz onayını ve log arşivini açmadan
// yetki verilebiliyor.
//
// BEŞ SESSİZ BOZULMA YOLU VAR, BEŞİ DE BURADA KİLİTLİ:
//   1. ANAHTAR-KAPSAMLI GUARD ÇÖKER — `PATCH /api/feature-flags` sistemin TÜM
//      ayarlarını taşır ama belge ekranları da oraya yazar. Guard gövdedeki
//      anahtarlara bakar: yalnız belge anahtarları varsa dar izin yeter. Bu
//      dal düz `requireAnyPermission`a çevrilirse şablon tasarımcısı sessizce
//      oturum ömrünü ve yedek saatini de değiştirebilir hale gelir; hiçbir
//      test kırılmaz, hiçbir log çıkmaz.
//   2. `admin:settings` OR'DAN DÜŞER — o an sahadaki HİÇ KİMSE (admin dahil)
//      bu dört ekranı açamaz: boot uzlaştırması izin satırını DB'ye getirir
//      ama kimseye ATAMAZ. Kilitlenmeye karşı tek emniyet supabı odur.
//   3. YETKİ GENİŞLER — kod `admin:` alanına taşınırsa `admin:*` wildcard'ı
//      onu vermeye başlar ve "dar izin" yönetici yetkisine dönüşür.
//   4. READ, WRITE'I KAPSAMAYI BIRAKIR — panelden yalnız "düzenleme" kutusunu
//      işaretleyen admin, ekranı hiç AÇAMAYAN bir kullanıcı üretir.
//   5. İKİ PROJE AYRIŞIR — Electron backend'i import EDEMEZ, listeyi kendi
//      sabitinde taşır. Tek harflik fark = kart görünür, route /forbidden'a
//      düşer (ya da tersi) ve sebebi hiçbir yerde yazmaz.
//
// Salt-okunur: fixture/yazma yok, ortamdaki veriye bağımlı değil (satırın DB'de
// olduğunu `test_permission_catalog.ts` doğrular — katalog ⊆ DB).
// Koşum: npx tsx scripts/test_document_template_permission.ts
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";
import { matchesPermission } from "../src/middlewares/rbac.middleware";
import {
  DOCUMENT_DESIGN_READ,
  DOCUMENT_DESIGN_WRITE,
  DOCUMENT_DESIGN_FLAG_KEYS,
} from "../src/constants/document-design";
import featureFlagRouter from "../src/routes/feature-flag.routes";
import freeDocumentRouter from "../src/routes/free-document.routes";
import documentProfileRouter from "../src/routes/document-profile.routes";
import travelerTemplateRouter from "../src/routes/traveler-template.routes";
import travelerCardRouter from "../src/routes/traveler-card.routes";
import printedDocumentRouter from "../src/routes/printed-document.routes";

const READ_KOD = "document-template:read";
const WRITE_KOD = "document-template:write";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Route zinciri koşturucu (test_workstation_permission.ts ile aynı sözleşme).
// Zincir konvansiyonu: [verifyToken, ...yetki middleware'leri, controller].
// Konvansiyon bozulursa `null` döner ve test DÜŞER — sessizce "geçti" demek
// bu bekçiyi süse çevirirdi.
// ─────────────────────────────────────────────────────────────────────────────
type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{
      name: string;
      handle: (req: Request, res: Response, next: NextFunction) => void;
    }>;
  };
};

function yetkiVerirMi(
  router: unknown,
  method: "get" | "post" | "put" | "patch" | "delete",
  routePath: string,
  permissions: string[],
  body: unknown = {},
): boolean | null {
  const layers = (router as { stack: RouteLayer[] }).stack;
  const layer = layers.find((l) => l.route?.path === routePath && l.route.methods[method]);
  if (!layer?.route) return null;
  const zincir = layer.route.stack;
  if (zincir.length < 3 || zincir[0]!.name !== "verifyToken") return null;

  const req = { user: { permissions }, body } as unknown as Request;
  const res = {} as Response;
  for (const halka of zincir.slice(1, -1)) {
    // ⚠️ AYAR ŞİFRESİ KAPISI BU HARNESS'IN KONUSU DEĞİL (2026-09-03 / P3).
    // `requireSettingsPassword` bir YETKİ kapısı değil NİYET kapısıdır (izin
    // zincirinin ARDINA takılır) ve tasarımı gereği ASENKRONDUR — kendi DB
    // okumasını yapar, yani `next`i aynı tick'te çağırmaz. Bu döngü "next aynı
    // tick'te çağrıldı mı" ile ölçtüğü için onu zincire dahil etmek, izin
    // kararı DOĞRUYKEN bile `false` üretirdi (yanlış kırmızı). Kapının kendi
    // bekçisi ayrıdır: `test_settings_password.ts`.
    if (halka.handle.name === "requireSettingsPassword") continue;
    let hata: unknown;
    let cagrildi = false;
    halka.handle(req, res, ((e?: unknown) => {
      cagrildi = true;
      hata = e;
    }) as NextFunction);
    if (!cagrildi || hata) return false;
  }
  return true;
}

const SADECE_READ = [READ_KOD];
const SADECE_WRITE = [WRITE_KOD];
const SADECE_ADMIN = ["admin:settings"];
const ALAKASIZ = ["order:read"];

// ── 1) Katalog satırları ─────────────────────────────────────────────────────
console.log("\n=== 1) İzin kataloğu ===");
for (const kod of [READ_KOD, WRITE_KOD]) {
  const satir = PERMISSION_CATALOG.find((p) => p.code === kod);
  check(`Katalogda satır var: ${kod}`, Boolean(satir));
  check(
    `Kategori 'web' (yönetim yetkisi DEĞİL): ${kod}`,
    satir?.category === "web",
    // Electron `hasAdminAccess` yalnız admin:users/admin:settings/admin:* koduna
    // bakar → bu kodu taşıyan kişi "Yönetim" menüsünü ve Sistem hub'ını GÖRMEZ.
    `category=${satir?.category}`,
  );
  check(`Açıklama dolu: ${kod}`, Boolean(satir?.description?.trim()));
}

// ── 2) Yetki genişlemesi yok ─────────────────────────────────────────────────
console.log("\n=== 2) Yetki genişlemesi yok ===");
check(
  "'document-template:write' 'admin:settings' yerine GEÇMEZ",
  !matchesPermission(SADECE_WRITE, "admin:settings"),
);
check(
  "'document-template:write' 'admin:users' yerine GEÇMEZ",
  !matchesPermission(SADECE_WRITE, "admin:users"),
);
check(
  "'document-template:write' 'label-template:write' yerine GEÇMEZ (etiket stüdyosu ayrı)",
  !matchesPermission(SADECE_WRITE, "label-template:write"),
);
check(
  "Kodlar 'admin:' alanında DEĞİL → 'admin:*' wildcard'ı bunları VERMEZ",
  !READ_KOD.startsWith("admin:") &&
    !WRITE_KOD.startsWith("admin:") &&
    !matchesPermission(["admin:*"], READ_KOD) &&
    !matchesPermission(["admin:*"], WRITE_KOD),
);
check(
  "'document-template:read' tek başına YAZMA vermez",
  !DOCUMENT_DESIGN_WRITE.some((p) => matchesPermission(SADECE_READ, p)),
);

// ── 3) Küme sözleşmesi ───────────────────────────────────────────────────────
console.log("\n=== 3) İzin kümeleri ===");
check(
  "READ kümesi 'admin:settings' içerir (kilitlenmeye karşı emniyet supabı)",
  DOCUMENT_DESIGN_READ.includes("admin:settings"),
);
check(
  "WRITE kümesi 'admin:settings' içerir (aynı gerekçe)",
  DOCUMENT_DESIGN_WRITE.includes("admin:settings"),
);
check(
  "READ kümesi WRITE kodunu da içerir (yazabilen okuyabilir — tuzak kapatıldı)",
  DOCUMENT_DESIGN_READ.includes(WRITE_KOD),
);
check(
  "WRITE kümesi READ kodunu içermez (okuyan yazamaz)",
  !DOCUMENT_DESIGN_WRITE.includes(READ_KOD),
);
check(
  "Her iki küme de katalogdaki kodlardan oluşur (yazım hatası yok)",
  [...DOCUMENT_DESIGN_READ, ...DOCUMENT_DESIGN_WRITE].every((kod) =>
    PERMISSION_CATALOG.some((p) => p.code === kod),
  ),
);

// ── 4) Dört route yüzeyi — okuma/yazma ayrımı ────────────────────────────────
console.log("\n=== 4) Route zincirleri (okuma / yazma) ===");

type Senaryo = {
  ad: string;
  router: unknown;
  method: "get" | "post" | "put" | "patch" | "delete";
  yol: string;
  yazmaMi: boolean;
};
const SENARYOLAR: Senaryo[] = [
  { ad: "GET /api/free-documents", router: freeDocumentRouter, method: "get", yol: "/", yazmaMi: false },
  { ad: "POST /api/free-documents", router: freeDocumentRouter, method: "post", yol: "/", yazmaMi: true },
  { ad: "DELETE /api/free-documents/:id", router: freeDocumentRouter, method: "delete", yol: "/:id", yazmaMi: true },
  { ad: "GET /api/traveler-templates", router: travelerTemplateRouter, method: "get", yol: "/", yazmaMi: false },
  { ad: "POST /api/traveler-templates", router: travelerTemplateRouter, method: "post", yol: "/", yazmaMi: true },
  { ad: "POST /api/traveler-templates/:id/default", router: travelerTemplateRouter, method: "post", yol: "/:id/default", yazmaMi: true },
  { ad: "PUT /api/document-profiles/:id", router: documentProfileRouter, method: "put", yol: "/:id", yazmaMi: true },
  // CANLI ÖNİZLEME UÇLARI (2026-09-10): ekranı AÇAN izinle aynı kümede olmalılar.
  // İkisi de bir kez `admin:settings`te unutuldu; refakat kartınınki 2026-08-05'te,
  // belge şablonununki prod log'unda 403 olarak görülene kadar (6 günde 4 kez) kaldı.
  { ad: "POST /api/traveler-cards/sample-html", router: travelerCardRouter, method: "post", yol: "/sample-html", yazmaMi: false },
  { ad: "POST /api/printed-documents/:docType/sample-html", router: printedDocumentRouter, method: "post", yol: "/:docType/sample-html", yazmaMi: false },
];

let zincirOkunan = 0;
for (const s of SENARYOLAR) {
  const admin = yetkiVerirMi(s.router, s.method, s.yol, SADECE_ADMIN);
  check(`${s.ad} — zincir okunabildi (konvansiyon korunuyor)`, admin !== null);
  if (admin === null) continue;
  zincirOkunan++;

  // (a) admin:settings HER YERDE geçmeye devam eder — bu bekçinin en kritik
  //     maddesi: OR'dan düşerse saha kilitlenir.
  check(`${s.ad} — 'admin:settings' GEÇER (mevcut kullanıcılar bozulmadı)`, admin === true);

  // (b) yazma izni yazma uçlarında geçer, okuma uçlarında da geçer (READ ⊇ WRITE)
  check(
    `${s.ad} — 'document-template:write' GEÇER`,
    yetkiVerirMi(s.router, s.method, s.yol, SADECE_WRITE) === true,
  );

  // (c) salt-okuma izni: okuma ucunda GEÇER, yazma ucunda REDDEDİLİR
  const readSonuc = yetkiVerirMi(s.router, s.method, s.yol, SADECE_READ);
  check(
    `${s.ad} — 'document-template:read' ${s.yazmaMi ? "REDDEDİLİR" : "GEÇER"}`,
    readSonuc === !s.yazmaMi,
  );

  // (d) alakasız izin her durumda reddedilir
  check(
    `${s.ad} — alakasız izin REDDEDİLİR`,
    yetkiVerirMi(s.router, s.method, s.yol, ALAKASIZ) === false,
  );
}
// Körlük zemini: bir refactor router şeklini değiştirirse yukarıdaki döngü
// sıfır senaryo üzerinde vakumen yeşil kalırdı.
check(
  "Körlük zemini — en az 8 route zinciri gerçekten okundu",
  zincirOkunan >= 8,
  `okunan=${zincirOkunan}/${SENARYOLAR.length}`,
);

// ── 5) ANAHTAR-KAPSAMLI GUARD — PATCH /api/feature-flags ─────────────────────
console.log("\n=== 5) PATCH /api/feature-flags — anahtar-kapsamlı guard ===");
const patchIzin = (permissions: string[], body: unknown) =>
  yetkiVerirMi(featureFlagRouter, "patch", "/", permissions, body);

check("Zincir okunabildi", patchIzin(SADECE_ADMIN, { documentsConfig: {} }) !== null);

// (a) YALNIZ belge anahtarları → dar izin YETER
check(
  "Yalnız documentsConfig → 'document-template:write' GEÇER",
  patchIzin(SADECE_WRITE, { documentsConfig: {} }) === true,
);
check(
  "Yalnız travelerCardConfig → 'document-template:write' GEÇER",
  patchIzin(SADECE_WRITE, { travelerCardConfig: {} }) === true,
);
check(
  "İkisi birlikte → 'document-template:write' GEÇER",
  patchIzin(SADECE_WRITE, { documentsConfig: {}, travelerCardConfig: {} }) === true,
);

// (b) Tek yabancı anahtar bile → admin:settings ŞART. Bu, bekçinin varlık
//     sebebi: guard düz OR'a çevrilirse aşağıdaki üç kontrol kırmızı verir.
check(
  "documentsConfig + sessionDurationMinutes → dar izin REDDEDİLİR (kaçak yok)",
  patchIzin(SADECE_WRITE, { documentsConfig: {}, sessionDurationMinutes: 60 }) === false,
);
check(
  "Yalnız sistem bayrağı → dar izin REDDEDİLİR",
  patchIzin(SADECE_WRITE, { kk1DuplicateGuardEnabled: true }) === false,
);
check(
  "companyLetterhead (firma KİMLİĞİ, şablon değil) → dar izin REDDEDİLİR",
  patchIzin(SADECE_WRITE, { companyLetterhead: {} }) === false,
);
check(
  "backupHour → dar izin REDDEDİLİR",
  patchIzin(SADECE_WRITE, { backupHour: 3 }) === false,
);

// (c) FAIL-CLOSED sınır durumları
check(
  "BOŞ gövde → dar izin REDDEDİLİR (fail-closed)",
  patchIzin(SADECE_WRITE, {}) === false,
);
check(
  "Gövde yok (undefined) → dar izin REDDEDİLİR",
  patchIzin(SADECE_WRITE, undefined) === false,
);
check(
  "Tanınmayan anahtar ('__proto__') → dar izin REDDEDİLİR",
  patchIzin(SADECE_WRITE, JSON.parse('{"__proto__": 1}')) === false,
);

// (d) admin:settings her gövdede geçer + salt-okuma hiçbirinde geçmez
check(
  "'admin:settings' belge gövdesinde GEÇER",
  patchIzin(SADECE_ADMIN, { documentsConfig: {} }) === true,
);
check(
  "'admin:settings' sistem gövdesinde GEÇER (bozulmadı)",
  patchIzin(SADECE_ADMIN, { backupHour: 3 }) === true,
);
check(
  "'document-template:read' belge gövdesinde bile REDDEDİLİR (okuma yazamaz)",
  patchIzin(SADECE_READ, { documentsConfig: {} }) === false,
);

// (e) Anahtar kümesinin kendisi — dar ve kasıtlı
check(
  "DOCUMENT_DESIGN_FLAG_KEYS tam olarak iki anahtar taşır",
  DOCUMENT_DESIGN_FLAG_KEYS.size === 2,
  [...DOCUMENT_DESIGN_FLAG_KEYS].join(", "),
);
check(
  "Firma kimliği anahtarları kümede DEĞİL",
  !DOCUMENT_DESIGN_FLAG_KEYS.has("companyName") &&
    !DOCUMENT_DESIGN_FLAG_KEYS.has("companyLetterhead"),
);

// ── 6) Electron aynası — ayrı proje, import edemez ───────────────────────────
console.log("\n=== 6) Electron sabitleri (ayrı proje) ===");
const ELECTRON_KOK = path.resolve(__dirname, "../../Electron/src");
const ELECTRON_PERMS = path.join(ELECTRON_KOK, "lib/permissions.ts");

/** `export const AD = [ "a", "b" ];` → ["a","b"] (yoksa null). */
function electronDizi(kaynak: string, ad: string): string[] | null {
  const m = new RegExp(`export const ${ad}\\s*=\\s*\\[([^\\]]*)\\]`).exec(kaynak);
  if (!m) return null;
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

if (!fs.existsSync(ELECTRON_PERMS)) {
  // Backend tek başına dağıtılabilir; dosya yoksa bölüm atlanır ama SESSİZ
  // değil — kapsam boşluğu ekranda görünür.
  console.log(`⚠️  Electron kaynağı bulunamadı, ayna kontrolü atlandı: ${ELECTRON_PERMS}`);
} else {
  const kaynak = fs.readFileSync(ELECTRON_PERMS, "utf8");
  const eRead = electronDizi(kaynak, "DOCUMENT_DESIGN_READ");
  const eWrite = electronDizi(kaynak, "DOCUMENT_DESIGN_WRITE");
  check("Electron DOCUMENT_DESIGN_READ okunabildi", eRead !== null);
  check("Electron DOCUMENT_DESIGN_WRITE okunabildi", eWrite !== null);
  check(
    "READ listesi backend ile BİREBİR aynı",
    JSON.stringify(eRead) === JSON.stringify(DOCUMENT_DESIGN_READ),
    `electron=${JSON.stringify(eRead)}`,
  );
  check(
    "WRITE listesi backend ile BİREBİR aynı",
    JSON.stringify(eWrite) === JSON.stringify(DOCUMENT_DESIGN_WRITE),
    `electron=${JSON.stringify(eWrite)}`,
  );
}

// ── 7) Electron: KART ile ROUTE hizası ───────────────────────────────────────
// Ayrışırlarsa kullanıcı kartı GÖRÜR, tıklar, /forbidden'a düşer (ya da tersi:
// kart görünmez ama adres çalışır). İkisi de sebebini söylemez.
console.log("\n=== 7) Electron kart ↔ route hizası ===");
const ROUTES_TSX = path.join(ELECTRON_KOK, "routes/content-routes.tsx");
const TILES_TS = path.join(ELECTRON_KOK, "pages/Definitions/tile-config.ts");
const YOLLAR = [
  "definitions/document-templates",
  "definitions/traveler-card",
  "definitions/traveler-card-studio",
  "definitions/free-documents",
];

if (!fs.existsSync(ROUTES_TSX) || !fs.existsSync(TILES_TS)) {
  console.log("⚠️  Electron route/tile kaynağı bulunamadı, hiza kontrolü atlandı");
} else {
  const routes = fs.readFileSync(ROUTES_TSX, "utf8");
  const tiles = fs.readFileSync(TILES_TS, "utf8");
  for (const yol of YOLLAR) {
    // path: "…" ile bir sonraki `path:` arasındaki blokta guard'ı ara.
    const i = routes.indexOf(`path: "${yol}"`);
    const blok = i < 0 ? "" : routes.slice(i, i + 400);
    check(
      `route ${yol} → requireAnyPermission={DOCUMENT_DESIGN_READ}`,
      i >= 0 && /requireAnyPermission=\{DOCUMENT_DESIGN_READ\}/.test(blok),
    );
    const ti = tiles.indexOf(`to: "/${yol}"`);
    const tblok = ti < 0 ? "" : tiles.slice(ti, ti + 200);
    check(
      `kart /${yol} → permissionAny: DOCUMENT_DESIGN_READ`,
      ti >= 0 && /permissionAny:\s*DOCUMENT_DESIGN_READ/.test(tblok),
    );
  }
  check(
    "Hub filtresi permissionAny'i gerçekten uyguluyor",
    /hasAnyPermission\(t\.permissionAny\)/.test(
      fs.readFileSync(path.join(ELECTRON_KOK, "pages/Definitions/DefinitionsHubPage.tsx"), "utf8"),
    ),
  );
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
