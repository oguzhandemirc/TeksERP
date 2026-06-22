import "dotenv/config"; // .env yükle — diğer tüm importlardan ÖNCE (JWT_SECRET vb. modül-load anında okunur)
import "./lib/zod-locale"; // Zod tr locale
import os from "os";
import app from './app';
import { startArchiveScheduler } from './jobs/archive-scheduler';
import { AuditService } from './services/audit.service';

const PORT = process.env.PORT || 4000;
// 0.0.0.0 = tüm ağ arayüzlerinden dinle (tablet/diğer cihazlar LAN üzerinden erişebilsin).
// HOST env ile override edilebilir (örn. sadece localhost'a kısıtlamak için 127.0.0.1).
const HOST = process.env.HOST || "0.0.0.0";

/**
 * Sunucunun erişilebildiği yerel ağ (LAN) IPv4 adreslerini arayüz adıyla döner.
 * İç (loopback) ve IPv6 adresleri elenir.
 */
function getLanAddresses(): Array<{ iface: string; address: string }> {
    const out: Array<{ iface: string; address: string }> = [];
    const nets = os.networkInterfaces();
    for (const [iface, addrs] of Object.entries(nets)) {
        for (const net of addrs ?? []) {
            // Node 18+ family bazen number (4) bazen string ('IPv4') döner — ikisini de karşıla.
            const isIPv4 = net.family === "IPv4" || (net.family as unknown as number) === 4;
            if (isIPv4 && !net.internal) {
                out.push({ iface, address: net.address });
            }
        }
    }
    return out;
}

// =============================================================================
// TEK-PROCESS INVARIANT (load-bearing) — tek `app.listen`, cluster/PM2-cluster/
// worker_threads YOK. Şu bellek-içi mekanizmalar buna BAĞLI ve 2. worker/replica
// eklenince SESSİZCE bozulur:
//   - presence (lib/presence.ts) → her process kendi Map'i (sayım parçalanır)
//   - feature-flag cache (system-setting.service.ts) → invalidate process-local
//   - archive-scheduler (jobs/archive-scheduler.ts) → lastRun check-then-act çift-arşiv
// Yatay ölçeklenirse taşıma katmanı gerekir: presence/cache → Redis (pub/sub
// invalidation), scheduler → DB advisory lock veya ayrı tek worker. Bu varsayım
// LAN-only tek-sunucu kurulumda kasıtlıdır (ARCHITECTURE.md "Single-process").
// =============================================================================
const server = app.listen(Number(PORT), HOST, () => {
    const lan = getLanAddresses();

    console.log("");
    console.log("========================================================");
    console.log(`  TeksERP Backend ayakta  (port ${PORT}, host ${HOST})`);
    console.log("--------------------------------------------------------");
    console.log(`  Yerel  : http://localhost:${PORT}`);
    if (lan.length === 0) {
        console.log("  Ağ     : (aktif LAN IPv4 adresi bulunamadı)");
    } else {
        for (const { iface, address } of lan) {
            console.log(`  Ağ     : http://${address}:${PORT}   [${iface}]`);
        }
    }
    console.log(`  Swagger: http://localhost:${PORT}/api-docs`);
    console.log("========================================================");
    console.log("");

    startArchiveScheduler();

    void AuditService.logEvent({
        category: "SYSTEM",
        action: "STARTUP",
        payload: {
            port: Number(PORT),
            host: HOST,
            lanAddresses: lan.map((l) => l.address),
            env: process.env.APP_ENV ?? process.env.NODE_ENV ?? "development",
            nodeVersion: process.version,
        },
    });
});

// L (düşük bulgu): graceful shutdown — eskiden hiç handler yoktu, restart'ta
// (nssm/servis güncellemesi, Ctrl+C) uçuştaki istekler TCP düzeyinde kopuyordu.
// server.close() yeni bağlantıyı reddedip mevcut istekleri bitirir; 5s'de
// kapanmazsa zorla çıkılır (asılı keep-alive bağlantıları sonsuza dek bekletmesin).
let shuttingDown = false;
function gracefulShutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} alındı — sunucu kapatılıyor (uçuştaki istekler bitiriliyor)...`);
    const forceTimer = setTimeout(() => {
        console.warn("Kapanış 5s'de tamamlanmadı — zorla çıkılıyor.");
        process.exit(1);
    }, 5000);
    forceTimer.unref();
    server.close(() => {
        console.log("Sunucu kapandı.");
        process.exit(0);
    });
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
