// =============================================================================
// test_latency_middleware — GERÇEK Express üzerinde anahtar çözümü + abort ölçümü
// =============================================================================
// Koşum: npx tsx scripts/test_latency_middleware.ts
// Denetimde yakalanan iki gerçek kusurun regresyon kilidi:
//   1) Express'te req.baseUrl PATTERN değil eşleşen GERÇEK string'dir —
//      parametreli iç mount'larda (customer.routes `/:customerId/branches`
//      deseni) UUID anahtara sızıyordu → normalizasyon ':id' üretmeli.
//   2) Kök route ('/') hata yolunda anahtar 'GET /'e çöküyordu.
// Ek: istemci abort'u (finish gelmez) 499 ile ölçülmeli.

import express, { Request, Response, NextFunction } from "express";
import type { AddressInfo } from "net";
import { latencyMiddleware } from "../src/middlewares/latency.middleware";
import {
  latencySnapshot,
  resetLatencyStats,
  UNMATCHED_ROUTE_KEY,
} from "../src/services/latency-stats.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}`);
  }
}

const UUID = "11111111-2222-4333-8444-555555555555";

function buildApp() {
  const app = express();
  app.use(latencyMiddleware);

  // customer.routes deseni: parametreli İÇ mount (baseUrl'e gerçek UUID girer)
  const branches = express.Router({ mergeParams: true });
  branches.get("/", (_req, res) => {
    res.json({ ok: true });
  });
  branches.get("/err/:x", (_req, _res, next) => next(new Error("boom")));
  const customers = express.Router();
  customers.use("/:customerId/branches", branches);
  customers.get("/", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/customers", customers);

  // Kök route'u HATA fırlatan router (BaseController list deseninde 5xx)
  const orders = express.Router();
  orders.get("/", (_req, _res, next) => next(new Error("boom")));
  app.use("/api/orders", orders);

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Abort senaryosu: istemci 50ms'de keser, cevap 400ms'de gelecekti.
  app.get("/api/slow", (_req, res) => {
    setTimeout(() => {
      try {
        res.json({ ok: true });
      } catch {
        /* soket kapandıysa sessiz */
      }
    }, 400);
  });

  // error handler (app-level — baseUrl geri sarılmış hâlde çalışır)
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

async function main(): Promise<void> {
  resetLatencyStats();
  const server = buildApp().listen(0);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const routes = () => latencySnapshot().routes.map((r) => r.route);

  try {
    // 1) Parametreli iç mount — BAŞARI yolu: UUID sızmamalı
    await fetch(`${base}/api/customers/${UUID}/branches`);
    check(
      "iç mount başarı: UUID yerine :id",
      routes().includes("GET /api/customers/:id/branches")
    );
    check("hiçbir anahtar UUID içermiyor", !routes().some((r) => r.includes(UUID)));

    // 2) Parametreli iç mount — HATA yolu (baseUrl geri sarılır). Önekteki
    // somut UUID ':id' olur; route pattern'inin kendi segmenti (:x) korunur.
    await fetch(`${base}/api/customers/${UUID}/branches/err/42`);
    check(
      "iç mount hata: önek + pattern korunur, değerler :id",
      routes().includes("GET /api/customers/:id/branches/err/:x")
    );

    // 3) Kök route HATA: 'GET /'e çökmemeli
    await fetch(`${base}/api/orders`);
    check("kök route hatası doğru anahtarda", routes().includes("GET /api/orders"));
    check("'GET /' çöküş kovası oluşmadı", !routes().includes("GET /"));

    // 4) Kök route başarı + query string etkisiz
    await fetch(`${base}/api/customers?page=1`);
    check("kök route başarı anahtarı", routes().includes("GET /api/customers"));

    // 5) App-level route: çift slash yok
    await fetch(`${base}/health`);
    check("app-level /health tekil ve doğru", routes().includes("GET /health"));
    check("çift-slash anahtar yok", !routes().some((r) => r.includes("//")));

    // 6) Eşleşmeyen path → (eşleşmeyen); ham path anahtar olmaz
    await fetch(`${base}/api/olmayan/${UUID}`);
    check(
      "404 → (eşleşmeyen) kovası",
      routes().includes(`GET ${UNMATCHED_ROUTE_KEY}`) &&
        !routes().some((r) => r.includes("olmayan"))
    );

    // 7) İstemci abort'u: finish gelmez → 499 ile yine de ölçülür
    const controller = new AbortController();
    const aborted = fetch(`${base}/api/slow`, { signal: controller.signal }).catch(() => null);
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    await aborted;
    await new Promise((r) => setTimeout(r, 500)); // geç res.json + close event'leri otursun
    const slow = latencySnapshot().routes.find((r) => r.route === "GET /api/slow");
    check("abort edilen istek ölçüldü", (slow?.count ?? 0) === 1);
    check("abort süresi ~kesim anı (<300ms)", (slow?.maxMs ?? 999) < 300);
    check("abort 5xx sayılmadı (499)", slow?.errCount === 0);

    // 8) 5xx errCount atribüsyonu doğru uçta
    const orders = latencySnapshot().routes.find((r) => r.route === "GET /api/orders");
    check("5xx errCount doğru uçta", orders?.errCount === 1);
  } finally {
    server.close();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(fail > 0 ? 1 : 0);
  }
}

void main();
