// =============================================================================
// BEKÇİ — Mobil ekran izni ↔ çağırdığı uçların guard'ı (2026-08-17)
// =============================================================================
// SORU: "Bu ekranın TEK yetkisini taşıyan operatör, ekranın çağırdığı her ucu
// açabiliyor mu?"
//
// Neden var: 2026-08-17 saha bulgusu — Tambur ekranı renk ve kumaş listelerini
// çağırıyordu ama `GET /api/colors` ve `GET /api/items` guard'ları
// `mobile:tambur`u KABUL ETMİYORDU. Yalnız Tambur yetkisi taşıyan operatör
// manuel top ekleme / alan düzeltme akışında SESSİZ 403 alıyordu; ekran hata
// göstermiyor, liste boş geliyordu. Servis-katmanı testleri bunu göremez
// (izin kontrolü route katmanında).
//
// YÖNTEM (statik): mobil ekran dizini → import ettiği servisler → o ekranın
// çağırdığı servis METOTLARI → metodun içindeki uç yolu → app.ts mount tablosu
// ile route dosyası → o yoldaki guard'ın izin listesi.
//
// Metot bazlı çözümleme ŞART: servis dosyası paylaşılıyor (roll.service'i 6 ekran
// import ediyor). Dosya bazlı okusaydık her ekran, servisin TÜM uçlarını ister
// görünür ve bekçi gürültüden kullanılamaz hale gelirdi.
//
// KÖRLÜK ZEMİNİ: çözülemeyen çağrı normaldir (dinamik yol, yardımcı sarmalayıcı)
// ve testi DÜŞÜRMEZ — ama toplamda çok az çağrı çözülürse tarayıcı bozulmuş
// demektir ve test o zaman DÜŞER. "İhlal bulunamadı" ile "hiçbir şeye
// bakılmadı" aynı yeşile çıkmasın.
// =============================================================================

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..", "..");
const BACKEND = path.join(ROOT, "Teks-Erp");
const MOBILE = path.join(ROOT, "mobil");

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detail ? `\n     ${detail}` : ""}`);
  }
}

const read = (p: string): string => fs.readFileSync(p, "utf8");
const exists = (p: string): boolean => fs.existsSync(p);

// ── 1. Mobil ekran kataloğu: key → izin ──────────────────────────────────────

interface Screen {
  key: string;
  permission: string;
}

function readScreens(): Screen[] {
  const src = read(path.join(MOBILE, "src", "types", "permissions.ts"));
  const start = src.indexOf("MOBILE_SCREENS");
  if (start < 0) return [];
  const body = src.slice(start);
  const out: Screen[] = [];
  const re = /key:\s*'([^']+)'\s*,\s*\n\s*permission:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push({ key: m[1], permission: m[2] });
  return out;
}

// ── 2. Backend mount tablosu: "/api/<seg>" → route dosyası ───────────────────

function readMounts(): Map<string, string> {
  const appSrc = read(path.join(BACKEND, "src", "app.ts"));
  // import xxxRoutes from "./routes/yyy.routes";
  const importRe = /import\s+(?:\{\s*([A-Za-z0-9_]+)\s*\}|([A-Za-z0-9_]+))\s+from\s+"(\.\/routes\/[^"]+)"/g;
  const varToFile = new Map<string, string>();
  let im: RegExpExecArray | null;
  while ((im = importRe.exec(appSrc))) {
    const name = im[1] ?? im[2];
    varToFile.set(name, im[3]);
  }
  const mounts = new Map<string, string>();
  const useRe = /app\.use\(\s*"\/api\/([A-Za-z0-9-]+)"\s*,\s*([A-Za-z0-9_]+)\s*\)/g;
  let um: RegExpExecArray | null;
  while ((um = useRe.exec(appSrc))) {
    const file = varToFile.get(um[2]);
    if (!file) continue;
    const abs = path.join(BACKEND, "src", `${file.replace(/^\.\//, "")}.ts`);
    if (exists(abs)) mounts.set(um[1], abs);
  }
  return mounts;
}

// ── 3. Route dosyasındaki guard'lar ──────────────────────────────────────────

interface RouteGuard {
  method: string;
  routePath: string;
  permissions: string[] | null; // null → izin guard'ı yok (public/verifyToken-only)
}

/** `const X = ["a","b"] as const;` biçimindeki yerel izin kümelerini çözer. */
function readLocalArrays(src: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /const\s+([A-Z0-9_]+)\s*=\s*\[([^\]]*)\]\s*as\s+const/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const values = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    out.set(m[1], values);
  }
  return out;
}

function readRoutes(file: string): RouteGuard[] {
  const src = read(file);
  const locals = readLocalArrays(src);
  const out: RouteGuard[] = [];
  const re = /router\.(get|post|put|patch|delete)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // Çağrının gövdesini parantez dengeleyerek al (çok satırlı guard'lar var).
    let i = re.lastIndex;
    let depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
    const call = src.slice(re.lastIndex, i - 1);
    const pathMatch = call.match(/^\s*"([^"]*)"/);
    if (!pathMatch) continue;
    let permissions: string[] | null = null;
    const guardMatch = call.match(/require(?:Any)?Permission\s*\(([^)]*)\)/);
    if (guardMatch) {
      permissions = [];
      for (const lit of guardMatch[1].matchAll(/"([^"]+)"/g)) permissions.push(lit[1]);
      for (const spread of guardMatch[1].matchAll(/\.\.\.([A-Z0-9_]+)/g)) {
        const vals = locals.get(spread[1]);
        if (vals) permissions.push(...vals);
      }
    }
    out.push({ method: m[1], routePath: pathMatch[1], permissions });
  }
  return out;
}

/**
 * Yol segmentini kanonikleştirir. Şablon parçası (`${...}`) İKİ ayrı anlama gelir:
 *   `/rolls/${id}` → segment tümüyle dinamik → `:p`
 *   `/items${qs}`  → sabit segmentin SONUNA eklenen sorgu dizesi → `items`
 * İkisini ayırmazsak mount araması ("items${buildQueryString(params)}") boşa düşer.
 */
function normalizeSegment(s: string): string {
  const cut = s.indexOf("${");
  const head = cut < 0 ? s : s.slice(0, cut);
  if (head.startsWith(":") || head === "*" || head === "") return ":p";
  return head;
}

/** "/rolls/:id/history" → "/:p/history" biçimine indirger (segment sayısı + sabitler korunur). */
function normalizePath(p: string): string {
  const clean = p.split("?")[0].replace(/\/+$/, "");
  const segs = clean.split("/").filter(Boolean);
  return "/" + segs.map(normalizeSegment).join("/");
}

// ── 4. Mobil servis metotları → uç yolu ──────────────────────────────────────

/** Servis dosyasındaki bir metodun gövdesini kabaca çıkarır. */
function methodBody(serviceSrc: string, method: string): string | null {
  const re = new RegExp(`\\n\\s{2}${method}\\s*[:(<]`);
  const m = serviceSrc.match(re);
  if (!m || m.index === undefined) return null;
  const start = m.index;
  // Sonraki üst-seviye özelliğe (2 boşluk girintili `ad:` / `ad(`) kadar al.
  const rest = serviceSrc.slice(start + 3);
  const next = rest.search(/\n {2}[A-Za-z_][A-Za-z0-9_]*\s*[:(<]/);
  return next < 0 ? serviceSrc.slice(start) : serviceSrc.slice(start, start + 3 + next);
}

interface Call {
  method: string;
  urlPath: string;
}

/** Metot gövdesindeki apiClient.<verb>(`/yol`) çağrılarını çıkarır. */
function extractCalls(body: string): Call[] {
  const out: Call[] = [];
  // Jenerik parametre iç içe olabilir (`get<PaginatedResponse<Item>>`) — `[^>]*`
  // ilk `>`de durup eşleşmeyi düşürüyordu; parantez dışındaki her şeyi al.
  // `apiClient\n  .get<…>(` biçimi yaygın → nokta çevresinde boşluk serbest.
  const re = /apiClient\s*\.\s*(get|post|put|patch|delete)\s*(?:<[^()]*>)?\s*\(\s*([`'"])([^`'"]*)\2/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const raw = m[3];
    if (!raw.startsWith("/")) continue;
    out.push({ method: m[1], urlPath: raw });
  }
  return out;
}

// ── 5. Ekran → çağrılan servis metotları ─────────────────────────────────────

function walk(dir: string): string[] {
  if (!exists(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

interface Usage {
  screen: Screen;
  serviceFile: string;
  methodName: string;
  call: Call;
}

function collectUsages(screens: Screen[]): { usages: Usage[]; unresolved: number } {
  const usages: Usage[] = [];
  let unresolved = 0;
  const serviceCache = new Map<string, string>();

  for (const screen of screens) {
    const dir = path.join(MOBILE, "src", "screens", "Modules", screen.key);
    const files = walk(dir);
    if (files.length === 0) continue;

    for (const f of files) {
      const src = read(f);
      // import { xService } from '../../../services/x.service';
      const importRe = /import\s+\{([^}]+)\}\s+from\s+'([^']*services\/[A-Za-z0-9_.-]+)'/g;
      let im: RegExpExecArray | null;
      while ((im = importRe.exec(src))) {
        const names = im[1]
          .split(",")
          .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
          .filter((s) => /^[a-z][A-Za-z0-9_]*Service$/.test(s));
        if (names.length === 0) continue;
        const rel = im[2].replace(/^.*services\//, "");
        const abs = path.join(MOBILE, "src", "services", `${rel}.ts`);
        if (!exists(abs)) continue;
        if (!serviceCache.has(abs)) serviceCache.set(abs, read(abs));
        const serviceSrc = serviceCache.get(abs)!;

        for (const svc of names) {
          // Parantez ARAMA: `queryFn: batchService.getNumberState` gibi
          // REFERANS geçişleri de bir çağrıdır ve react-query onları çalıştırır.
          // `\\(` şartı varken bu biçim sessizce taranmıyordu (2026-08-17'de
          // yeni eklenen bir uç tam bu yüzden bekçinin gözünden kaçtı).
          // Metot olmayan referanslar zaten `methodBody`/`extractCalls`
          // aşamasında elenir.
          const callRe = new RegExp(`${svc}\\.([A-Za-z0-9_]+)`, "g");
          let cm: RegExpExecArray | null;
          const seen = new Set<string>();
          while ((cm = callRe.exec(src))) {
            const methodName = cm[1];
            if (seen.has(methodName)) continue;
            seen.add(methodName);
            const body = methodBody(serviceSrc, methodName);
            if (!body) {
              unresolved++;
              if (process.env.DEBUG_SCAN) console.log(`   · gövde yok: ${path.basename(abs)}#${methodName}`);
              continue;
            }
            const calls = extractCalls(body);
            if (calls.length === 0) {
              unresolved++;
              if (process.env.DEBUG_SCAN) console.log(`   · uç yok: ${path.basename(abs)}#${methodName}`);
              continue;
            }
            for (const call of calls) usages.push({ screen, serviceFile: abs, methodName, call });
          }
        }
      }
    }
  }
  return { usages, unresolved };
}

// ── 6. Doğrulama ─────────────────────────────────────────────────────────────

/**
 * Bilinçli muaflar. Her satır GEREKÇELİ olmalı; muaf olan uç, ekranın yetkisiyle
 * açılmıyor ama bu KASITLI (ör. ayrı bir yetki gerçekten isteniyor).
 */
const EXEMPT: { screen: string; path: string; why: string }[] = [
  {
    screen: "mobile:kk1",
    path: "GET /",
    why: "Renk listesi YALNIZ yarı mamul modunda çağrılır; o mod ayrı bir yetenek yetkisine bağlı (`mobile:kk1-yari-mamul`). Yetkisiz operatörde renk seçici hiç çizilmez, uç de çağrılmaz.",
  },
  {
    screen: "mobile:kk1",
    path: "POST /quick-create",
    why: "Saha içi desen oluşturma ayrı bir YETENEK yetkisi (`mobile:kk1-desen`) — her KK1 operatörü ürün kartı açamasın.",
  },
  // ── Tambur ekranının EK yetenek yetkileri (2026-08-17'de burada belgelendi) ──
  // Ekranın ana yetkisi `mobile:tambur`; aşağıdaki dört aksiyon BİLİNÇLİ olarak
  // ayrı yetki ister. "Ekran açılıyor ama şu tuş çalışmıyor" sorusunun cevabı
  // burasıdır — katalogda ayrı ayrı aranmak yerine tek yerde duruyor.
  {
    screen: "mobile:tambur",
    path: "POST /manual/bring",
    why: "Manuel top getirme — `mobile:tambur-duzelt` (stok/iş emri düzeltmesi sayılır).",
  },
  {
    screen: "mobile:tambur",
    path: "POST /manual/bring-preview",
    why: "Manuel top getirme önizlemesi — `mobile:tambur-duzelt`.",
  },
  {
    screen: "mobile:tambur",
    path: "POST /manual/produce",
    why: "Refakat kartsız bitmiş top üretme — `mobile:tambur-duzelt`.",
  },
  {
    screen: "mobile:tambur",
    path: "POST /manual/roll",
    why: "Manuel top ekleme — `mobile:tambur-duzelt`.",
  },
  {
    screen: "mobile:tambur",
    path: "PATCH /order-lines/:p",
    why: "Etikette müşteri ürün adı düzenleme — `label:edit` (etiket içeriği değiştiriyor, üretim kararı değil).",
  },
  // ── "Sipariş Bağla" ailesi (2026-08-19) — Tambur üst şeridi ─────────────────
  // Ekranın ana yetkisi `mobile:tambur` ama bu dört uç `workorder:write` ister
  // ve bu BİLİNÇLİ: uyumsuz siparişi iş emrine bağlamak bir PLANLAMA kararıdır,
  // okutma işi değil. Arayüz aynı kapıyı uyguluyor — düğme
  // `canLinkOrders = hasPermission('workorder:write')` arkasında çizilir
  // (`TamburScreen.tsx:438`), yani düz `mobile:tambur` operatörü düğmeyi HİÇ
  // görmez ve ucu HİÇ çağırmaz. Kapı ekranda kapalıysa uçta 403 arıza değildir.
  // ⚠️ Bu muafın geçerliliği o `canLinkOrders` satırına BAĞLI: düğme bir gün
  // koşulsuz çizilirse muaf yalanlaşır ve saha 403 görür.
  {
    screen: "mobile:tambur",
    path: "GET /:p",
    why: "İş emri detayı — Sipariş Bağla sayfası açılırken okunur; düğme workorder:write arkasında.",
  },
  {
    screen: "mobile:tambur",
    path: "GET /:p/linkable-order-lines",
    why: "Bağlanabilir sipariş kalemleri — yalnız Sipariş Bağla sheet'i çağırır (workorder:write).",
  },
  {
    screen: "mobile:tambur",
    path: "POST /:p/order-links",
    why: "Sipariş bağlama — planlama kararı, workorder:write. Arayüzde aynı kapı.",
  },
  {
    screen: "mobile:tambur",
    path: "DELETE /:p/order-links/:p",
    why: "Bağ sökme — bağlamanın tersi, aynı yetki (workorder:write).",
  },
  {
    screen: "mobile:tambur",
    path: "POST /:p/order-links/override",
    why: "Uyumsuz bağlama onayı — SÜPERVİZÖR yetkisi; sheet içinde ayrıca roll:manual-adjust aranır (TamburOrderLinkSheet.tsx:72).",
  },
  {
    screen: "mobile:tambur",
    path: "POST /manual/send-to-dye",
    why: "Topu boyaya geri gönderme — stok/iş emri düzeltmesi sayılır (`mobile:tambur-duzelt` ∨ `roll:manual-adjust`), `POST /manual/bring` ile aynı gerekçe.",
  },
  {
    screen: "mobile:tambur",
    path: "POST /manual/send-to-dye-preview",
    why: "Yukarıdakinin YAN ETKİSİZ önizlemesi — aynı ekranda, aynı düğmenin arkasında, aynı yetkiyle çağrılır. Önizlemeyi ayrı (daha gevşek) bir kapıya koymak, kararı verecek bilgiyi yetkisiz kişiye açardı.",
  },
];

function main(): void {
  const screens = readScreens();
  check(`Mobil ekran kataloğu okundu (${screens.length} ekran)`, screens.length >= 10);

  const mounts = readMounts();
  check(`app.ts mount tablosu okundu (${mounts.size} kök)`, mounts.size >= 30);

  const { usages, unresolved } = collectUsages(screens);
  // Körlük zemini: tarayıcı bozulursa "ihlal yok" diye yeşil kalmasın.
  check(
    `Çözümlenen ekran→uç çağrısı: ${usages.length} (çözülemeyen ${unresolved})`,
    usages.length >= 120,
    usages.length < 120
      ? "Tarayıcı büyük olasılıkla bozuldu (import/servis biçimi değişmiş olabilir)."
      : undefined
  );

  const routeCache = new Map<string, RouteGuard[]>();
  const exemptUsed = new Set<number>();
  const violations: string[] = [];
  let verified = 0;
  let skipped = 0;

  for (const u of usages) {
    const segs = u.call.urlPath.split("?")[0].split("/").filter(Boolean);
    if (segs.length === 0) {
      skipped++;
      continue;
    }
    // Kök segment de kanonikleştirilmeli: `/items${buildQueryString(params)}`
    // ham hâliyle mount tablosunda BULUNMAZ ve çağrı sessizce atlanırdı.
    const routeFile = mounts.get(normalizeSegment(segs[0]));
    if (!routeFile) {
      skipped++;
      continue;
    }
    if (!routeCache.has(routeFile)) routeCache.set(routeFile, readRoutes(routeFile));
    const routes = routeCache.get(routeFile)!;
    const wanted = normalizePath("/" + segs.slice(1).join("/"));
    const match = routes.find(
      (r) => r.method === u.call.method && normalizePath(r.routePath) === wanted
    );
    if (!match) {
      skipped++;
      continue;
    }
    if (match.permissions === null) {
      verified++;
      continue; // izin guard'ı yok → herkes açar
    }
    const label = `${u.call.method.toUpperCase()} ${wanted}`;
    if (match.permissions.includes(u.screen.permission)) {
      verified++;
      continue;
    }
    // Wildcard (`mobile:*`) taşıyan guard'lar da geçerli sayılır.
    if (match.permissions.includes("mobile:*")) {
      verified++;
      continue;
    }
    const exemptIdx = EXEMPT.findIndex(
      (e) => e.screen === u.screen.permission && e.path === label
    );
    if (exemptIdx >= 0) {
      exemptUsed.add(exemptIdx);
      verified++;
      continue;
    }
    violations.push(
      `${u.screen.key} (${u.screen.permission}) → ${label} · guard: [${match.permissions.join(", ")}] · kaynak: ${path.basename(u.serviceFile)}#${u.methodName}`
    );
  }

  check(
    `Guard doğrulanan uç sayısı: ${verified} (eşleşmeyen ${skipped})`,
    verified >= 80,
    verified < 80 ? "Yol eşleştirme bozulmuş olabilir." : undefined
  );

  const unique = [...new Set(violations)].sort();
  check(
    unique.length === 0
      ? "Her mobil ekran, çağırdığı uçları KENDİ yetkisiyle açabiliyor"
      : `${unique.length} ekran/uç eşleşmezliği`,
    unique.length === 0,
    unique.length > 0 ? unique.join("\n     ") : undefined
  );

  // Muaf listesi bayatlığa karşı denetlenir: artık uygulanmayan bir muaf,
  // ileride doğacak GERÇEK bir ihlali sessizce kapsam dışında tutar.
  const dead = EXEMPT.filter((_, i) => !exemptUsed.has(i)).map((e) => `${e.screen} → ${e.path}`);
  check(
    dead.length === 0 ? `Muaf listesi güncel (${EXEMPT.length} satır)` : `${dead.length} ÖLÜ muaf satırı`,
    dead.length === 0,
    dead.length > 0 ? dead.join("\n     ") : undefined
  );
  for (const e of EXEMPT) {
    console.log(`   ℹ️  Muaf: ${e.screen} → ${e.path} — ${e.why}`);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
