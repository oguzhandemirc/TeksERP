/**
 * Sunucunun erişilebildiği yerel ağ (LAN) IPv4 adresleri.
 *
 * Eskiden `server.ts` içinde özel bir fonksiyondu ve tek işi açılış banner'ını
 * basmaktı. Servis keşfi (mDNS ilanı) aynı listeye ihtiyaç duyduğu için buraya
 * taşındı — iki yerde iki kopya, "banner doğru ama ilan yanlış arayüzü söylüyor"
 * sınıfı bir ayrışmanın davetiyesiydi.
 *
 * `netmask` alanı keşif için eklendi: istemci tarafındaki alt ağ taraması hangi
 * dilimi tarayacağını maskeden çözer. Banner onu kullanmaz.
 */
import os from "os";

export interface LanAddress {
    /** Ağ arayüzünün işletim sistemindeki adı ("Ethernet", "en0" …). */
    iface: string;
    /** IPv4 adresi. */
    address: string;
    /** Alt ağ maskesi ("255.255.255.0"). */
    netmask: string;
}

/**
 * Aktif LAN IPv4 adreslerini arayüz adıyla döner. İç (loopback) ve IPv6
 * adresleri elenir. Hiç LAN arayüzü yoksa boş dizi döner (hata değil — sunucu
 * yalnız localhost'ta koşuyor olabilir).
 */
export function getLanAddresses(): LanAddress[] {
    const out: LanAddress[] = [];
    const nets = os.networkInterfaces();
    for (const [iface, addrs] of Object.entries(nets)) {
        for (const net of addrs ?? []) {
            // Node 18+ family bazen number (4) bazen string ('IPv4') döner — ikisini de karşıla.
            const isIPv4 = net.family === "IPv4" || (net.family as unknown as number) === 4;
            if (isIPv4 && !net.internal) {
                out.push({ iface, address: net.address, netmask: net.netmask });
            }
        }
    }
    return out;
}

/**
 * Arayüz kümesinin değişip değişmediğini ucuz karşılaştırmak için parmak izi.
 * mDNS ilanı, kablo takılıp çıkarıldığında / DHCP adresi değiştiğinde yeniden
 * yayınlanmak zorunda; her turda tam listeyi kıyaslamak yerine bu metin kıyaslanır.
 */
export function lanFingerprint(list: LanAddress[]): string {
    return list
        .map((l) => `${l.iface}|${l.address}|${l.netmask}`)
        .sort()
        .join(",");
}
