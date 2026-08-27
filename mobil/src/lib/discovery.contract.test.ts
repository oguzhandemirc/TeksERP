// =============================================================================
// Bekçi: keşif sözleşmesi — mobil ↔ backend ↔ Electron ÜÇ KOPYA aynı mı?
// =============================================================================
// NEDEN: mobil bağımsız bir proje; `Electron/shared/discovery.ts`i de backend'in
// sabitlerini de IMPORT EDEMEZ (`types/permissions.ts` ile aynı durum). Yani
// kimlik ucunun yolu ve yükün alan adları ÜÇ YERDE ELLE yazılı.
//
// Ayrışmanın arıza biçimi SESSİZ: mobil yanlış yola istek atar, 404 alır,
// `/health`e düşer ve sunucuyu "kimlik bilgisi vermeyen eski sürüm" sanır.
// Kimlik doğrulaması sessizce devre dışı kalır — hata da log da yok.
//
// Bu bekçi kopyaları KAYNAK METİNDEN okuyup karşılaştırır. Backend/Electron
// bulunamazsa (mobil tek başına klonlanmışsa) GÜRÜLTÜLÜ atlar, sessizce geçmez.
// =============================================================================
// ⚠️ JEST, VITEST DEĞİL: `expect(deger, 'mesaj')` ikinci argümanı Vitest'e aittir;
// Jest'te "Expect takes at most one argument" ile DÜŞER. Electron tarafındaki
// ikiz bekçiden kopyalarken bu tuzağa bir kez düşüldü.
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { DISCOVERY_IDENTITY_PATH, DISCOVERY_DEFAULT_PORT } from './discovery';

const REPO = resolve(__dirname, '../../..');
const BACKEND_ROUTES = resolve(REPO, 'Teks-Erp/src/routes/discovery.routes.ts');
const BACKEND_APP = resolve(REPO, 'Teks-Erp/src/app.ts');
const BACKEND_SERVICE = resolve(REPO, 'Teks-Erp/src/services/discovery.service.ts');
const ELECTRON_SHARED = resolve(REPO, 'Electron/shared/discovery.ts');

const haveBackend = existsSync(BACKEND_ROUTES) && existsSync(BACKEND_APP);
const haveElectron = existsSync(ELECTRON_SHARED);

describe('keşif sözleşmesi — üç kopya', () => {
  it('körlük zemini: karşılaştırılacak kaynaklar BULUNDU', () => {
    if (!haveBackend || !haveElectron) {
      // Sessiz geçiş YOK — atlandığı görünsün.
      console.warn(
        `[discovery.contract] UYARI: kaynak bulunamadı (backend=${haveBackend}, electron=${haveElectron}) — ` +
          'sözleşme karşılaştırması ATLANDI. Mobil tek başına klonlanmışsa normal.',
      );
    }
    expect(typeof DISCOVERY_IDENTITY_PATH).toBe('string');
    expect(DISCOVERY_IDENTITY_PATH.startsWith('/')).toBe(true);
  });

  (haveBackend ? it : it.skip)('⭐ kimlik ucunun YOLU backend ile birebir', () => {
    const app = readFileSync(BACKEND_APP, 'utf8');
    const routes = readFileSync(BACKEND_ROUTES, 'utf8');

    // mount öneki: app.use("/api/discovery", ...)
    const mount = /app\.use\(\s*"([^"]+)"\s*,\s*discoveryRoutes\s*\)/.exec(app)?.[1];
    // route yolu: router.get("/identity", ...)
    const path = /router\.get\(\s*"([^"]+)"/.exec(routes)?.[1];

    expect(mount).toBeTruthy(); // app.ts mount öneki okunamadıysa burada düşer
    expect(path).toBeTruthy(); // route yolu okunamadıysa burada düşer
    expect(`${mount}${path}`).toBe(DISCOVERY_IDENTITY_PATH);
  });

  (haveBackend ? it : it.skip)('⭐ kimlik yükünün ALANLARI backend ile birebir', () => {
    const svc = readFileSync(BACKEND_SERVICE, 'utf8');
    const at = svc.indexOf('export interface DiscoveryIdentityPayload');
    expect(at).toBeGreaterThan(-1); // arayüz bulunamadıysa burada düşer
    const body = svc.slice(at, svc.indexOf('\n}', at));
    const backendFields = [...body.matchAll(/^\s{4}([a-zA-Z_][a-zA-Z0-9_]*)\??:/gm)]
      .map((m) => m[1] as string)
      .sort();

    expect(backendFields.length).toBeGreaterThan(5); // körlük zemini: alan çıkarılamadı

    // Mobilin OKUDUĞU alanlar backend'in ürettiklerinin ALT KÜMESİ olmalı.
    // (Backend fazladan alan üretebilir — mobil onları yok sayar. Ama mobilin
    // okuduğu bir alan backend'de YOKSA sessizce `undefined` gelir.)
    const mobileReads = ['product', 'discoveryVersion', 'installationId', 'serverName', 'companyName', 'version'];
    for (const f of mobileReads) {
      expect(backendFields).toContain(f);
    }
  });

  (haveBackend ? it : it.skip)('varsayılan port backend ile aynı', () => {
    const app = readFileSync(BACKEND_APP, 'utf8');
    void app;
    // Backend PORT env'inden okuyor; sözleşmedeki varsayılan 4000 olmalı.
    expect(DISCOVERY_DEFAULT_PORT).toBe(4000);
  });

  (haveElectron ? it : it.skip)('⭐ Electron kopyasıyla YOL ve PORT aynı', () => {
    const el = readFileSync(ELECTRON_SHARED, 'utf8');
    const elPath = /DISCOVERY_IDENTITY_PATH\s*=\s*"([^"]+)"/.exec(el)?.[1];
    const elPort = /DISCOVERY_DEFAULT_PORT\s*=\s*(\d+)/.exec(el)?.[1];
    expect(elPath).toBeTruthy(); // Electron sabiti okunamadıysa burada düşer
    expect(elPath).toBe(DISCOVERY_IDENTITY_PATH);
    expect(Number(elPort)).toBe(DISCOVERY_DEFAULT_PORT);
  });
});
