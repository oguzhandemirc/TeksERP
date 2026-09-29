// =============================================================================
// ROTA ENVANTERİ — Express uygulamasının route ağacını TAM YOLLA gezer (TEK KAYNAK)
// =============================================================================
// İki bekçi aynı ağacı okur: `test_route_auth_coverage` (kimlik kapsaması) ve
// `test_lisans_kapisi` (lisans kapısı sınıflaması). Yürüyücü eskiden ilkinin içindeydi;
// kopyalansaydı bir düzeltme (ör. mount öneki çözümü) yalnız birine girer, öteki eski
// mantıkla yeşil kalırdı — kopya bekçi, bekçilerin en kötü cinsidir.
//
// İKİ AYRI DÜZELTME BİRLİKTE YAŞAR (merge, 2026-09-01):
//  ① `onek` — anahtar TAM YOL olsun (muafiyet bir deseni değil TEK ucu affetsin).
//  ② `inheritedAuth/Count` — `router.use(verifyToken)` ile MİRAS alınan kimlik guard'ı
//     sayılsın; ticaret route'ları kimliği router seviyesinde kuruyor.
// İkisi birbirinden bağımsızdır; biri çıkarılırsa o sınıf hata geri döner.
//
// SAF: DB'ye yazmaz, HTTP isteği atmaz; yalnız Express route ağacını gezer.
// =============================================================================
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

export type RotaKatmani = {
  name?: string;
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ name: string }> };
  handle?: { stack?: RotaKatmani[] };
  /** Express 5 katmanı: mount önekini düz metin vermez, yalnız eşleştirici sunar. */
  match?: (path: string) => boolean;
  path?: string;
  /** `match` sonrası dolar: yakalanan parametreler. */
  params?: Record<string, string>;
};

export interface RotaBilgisi {
  /** `METOD[,METOD] /api/<mount>/<route>` — mount öneki dahil TAM YOL. */
  key: string;
  /** Büyük harf yöntemler (`GET`, `POST`…); Express `_all` kaydı `_ALL` olarak kalır. */
  methods: string[];
  /** Mount öneki dahil tam yol deseni (`/api/orders/:id`). */
  path: string;
  hasAuth: boolean;
  chainLength: number;
}

export interface RotaEnvanteri {
  routes: RotaBilgisi[];
  /** Öneki çözülemeyen (route taşıyan) mount sayısı — >0 ise anahtarlar eksik yol taşır. */
  cozulemeyen: number;
}

/** `src` kökü: bu dosya `scripts/lib/` altında. */
const SRC_KOKU = join(__dirname, "..", "..", "src");

/**
 * MOUNT ÖNEKİ ADAYLARI — `app.use("/api/x", router)` ve `router.use("/y", alt)`
 * satırlarından toplanır. Express 5 katmanı öneki düz metin TAŞIMAZ (`layer.path`
 * ancak `match()` çağrıldıktan sonra dolar, `regexp` yoktur); bu yüzden önek,
 * adayları katmanın kendi eşleştiricisine sorarak çözülür.
 */
export function mountAdaylari(): string[] {
  const dosyalar: string[] = [join(SRC_KOKU, "app.ts")];
  const gez = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) gez(p);
      else if (e.name.endsWith(".ts")) dosyalar.push(p);
    }
  };
  gez(join(SRC_KOKU, "routes"));
  const set = new Set<string>();
  for (const f of dosyalar) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\.use\(\s*["'`](\/[^"'`]*)["'`]/g)) set.add(m[1]);
  }
  // Uzun önek önce denenir: "/api" kısa öneki "/api/admin/devices"i gölgelemesin.
  return [...set].sort((a, b) => b.length - a.length);
}

export function yolBirlestir(onek: string, yol: string): string {
  return `${onek}${yol}`.replace(/\/{2,}/g, "/");
}

/** Uygulamanın route ağacını gezer; her route için tam yol + kimlik zinciri. */
export function rotaEnvanteri(app: unknown): RotaEnvanteri {
  const out: RotaBilgisi[] = [];
  const adaylar = mountAdaylari();
  let cozulemeyen = 0;
  /**
   * @param inheritedAuth üstteki router katmanlarından `router.use(verifyToken)`
   *   ile miras alınan kimlik guard'ı var mı.
   */
  const walk = (layers: RotaKatmani[], onek: string, inheritedAuth: boolean, inheritedCount: number): void => {
    // Bu seviyedeki `router.use(...)` katmanları — route TANIMLARINDAN ÖNCE gelenler
    // sonrakileri korur. Express sırayı korur; tek geçişte biriktirilir.
    let levelAuth = inheritedAuth;
    let levelCount = inheritedCount;
    for (const l of layers) {
      if (l.route) {
        const methods = Object.keys(l.route.methods)
          .filter((m) => l.route!.methods[m])
          .map((m) => m.toUpperCase());
        const tamYol = yolBirlestir(onek, l.route.path);
        out.push({
          key: `${methods.join(",")} ${tamYol}`,
          methods,
          path: tamYol,
          hasAuth: levelAuth || l.route.stack.some((s) => s.name === "verifyToken"),
          chainLength: levelCount + l.route.stack.length,
        });
      } else if (l.handle?.stack) {
        // Önek, katmanın KENDİ deseni olan adaydır: tamamen tüketilir (`l.path === aday`) ve her
        // parametre kendi adını yakalar. İlk eşleşen aday yanlıştır: `/api/admin` katmanı
        // `/api/admin/db-copies`i, `/:customerId` katmanı `/api/...`yi, "/" bağlı router her adayı eşler.
        let alt = "";
        let cozuldu = false;
        if (typeof l.match === "function") {
          for (const c of adaylar) {
            try {
              if (!l.match(c)) continue;
              const desenin = Object.entries(l.params ?? {}).every(([k, v]) => v === `:${k}`);
              if (l.path === c && desenin) {
                alt = c;
                cozuldu = true;
                break;
              }
              if (l.path === "") cozuldu = true; // "/" bağlı: önek yok
            } catch {
              /* eşleştirici bu adayı reddetti */
            }
          }
        }
        if (!cozuldu && l.handle.stack.some((x) => x.route)) cozulemeyen++;
        walk(l.handle.stack, yolBirlestir(onek, alt), levelAuth, levelCount);
      } else if (l.name === "verifyToken") {
        // `router.use(verifyToken)` — bundan SONRAKİ her route korumalı.
        levelAuth = true;
        levelCount += 1;
      } else if (levelAuth) {
        // Kimlikten SONRA gelen router seviyesi guard'lar (örn. `requireFinanceEnabled`)
        // da etkin zincire dahildir.
        levelCount += 1;
      }
    }
  };
  walk((app as { router: { stack: RotaKatmani[] } }).router.stack, "", false, 0);
  return { routes: out, cozulemeyen };
}

/**
 * Desenden somut ÖRNEK yol: `:param` → `x1`, `{*yol}` → `a/b`. Lisans kapısı gerçek istek
 * yolunu sınıflar; bekçi her route'u bu örnekle kapının KENDİ sınıflayıcısına sorar.
 */
export function ornekYol(desen: string): string {
  return desen.replace(/\{\*[A-Za-z0-9_]+\}/g, "a/b").replace(/:[A-Za-z0-9_]+/g, "x1");
}
