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

app.listen(Number(PORT), HOST, () => {
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
