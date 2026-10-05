/**
 * Sunucunun yerel ağ (LAN) adresleri — açılış banner'ı ve mDNS ilanı için TEK kaynak.
 *
 * İkisi aynı listeyi kullanır; "banner doğru ama ilan yanlış arayüzü söylüyor"
 * ayrışması olmasın. Hangi adresin ağa DUYURULMAYACAĞI kararı da burada yaşar
 * (`lanExclusionOf`); karar adaptör adı ve adres sınıfına bakar, MAC'e bakmaz —
 * sanal makinede koşan sunucunun gerçek kartı da sanal MAC taşır.
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

/** Adresin ağa duyurulmama sebebi. */
export type LanExclusion = "link-local" | "virtual-adapter";

/**
 * Yalnız aynı makineden ya da hiç erişilemeyen adaptörlerin ad kalıpları.
 * Hyper-V'de yalnız Default Switch ve WSL elenir: harici sanal anahtar
 * ("vEthernet (Harici)") sunucunun GERÇEK LAN adresini taşır.
 */
const VIRTUAL_ADAPTER_PATTERNS: readonly RegExp[] = [
    /^vEthernet \((Default Switch|WSL\b.*)\)$/i,
    /VirtualBox/i,
    /^vboxnet\d+$/,
    /^VMware Network Adapter/i,
    /^vmnet\d+$/,
    /^docker\d*$/,
    /^br-[0-9a-f]{6,}$/,
    /^veth/,
    /^virbr\d+/,
    /^Tailscale$/i,
    /^tailscale\d*$/,
    /ZeroTier/i,
];

/**
 * Adres ağa duyurulmamalıysa sebebini, duyurulmalıysa `null` döner.
 * Kendi kendine atanmış adres (169.254/16, fe80::/10) DHCP alamamış ya da
 * bağlantısız karttır; sanal adaptör ağdaki başka cihazdan erişilemez.
 */
export function lanExclusionOf(iface: string, address: string): LanExclusion | null {
    const a = address.trim().toLowerCase();
    if (a.startsWith("169.254.") || /^fe[89ab][0-9a-f]:/.test(a)) return "link-local";
    if (VIRTUAL_ADAPTER_PATTERNS.some((re) => re.test(iface))) return "virtual-adapter";
    // macOS'ta Tailscale genel adlı bir utun kartıdır; ancak CGNAT aralığıyla birlikte ayırt edilir.
    if (/^utun\d+$/.test(iface) && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a)) return "virtual-adapter";
    return null;
}

/**
 * İç (loopback) olmayan bütün IPv4 adreslerini arayüz adıyla döner — elemeden.
 * Hiç LAN arayüzü yoksa boş dizi (sunucu yalnız localhost'ta koşuyor olabilir).
 */
export function getLanAddresses(
    nets: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): LanAddress[] {
    const out: LanAddress[] = [];
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

export interface LanPartition {
    /** Ağa duyurulan adresler. */
    usable: LanAddress[];
    /** Duyurulmayanlar — banner'da tanı için gösterilir. */
    excluded: Array<LanAddress & { reason: LanExclusion }>;
    /** Eleme hiç kullanılabilir adres bırakmadıysa `true`: bütün liste duyurulur. */
    fallback: boolean;
}

/**
 * Listeyi duyurulacak / duyurulmayacak diye ayırır. Eleme HİÇ adres bırakmazsa
 * bütün liste duyurulur — keşif, elemeden önceki davranıştan kötüye gitmez.
 */
export function partitionLanAddresses(list: LanAddress[]): LanPartition {
    const usable: LanAddress[] = [];
    const excluded: LanPartition["excluded"] = [];
    for (const l of list) {
        const reason = lanExclusionOf(l.iface, l.address);
        if (reason) excluded.push({ ...l, reason });
        else usable.push(l);
    }
    if (usable.length === 0 && excluded.length > 0) {
        return { usable: [...list], excluded: [], fallback: true };
    }
    return { usable, excluded, fallback: false };
}

/** mDNS kaydının bu modülün baktığı asgari şekli. */
export interface DnsRecordLike {
    type: string;
    data?: unknown;
}

/**
 * mDNS kayıt listesinden duyurulmaması gereken A/AAAA kayıtlarını çıkarır.
 * Geriye hiç A kaydı kalmazsa liste DEĞİŞMEDEN döner (fallback).
 */
export function filterAdvertisedRecords<T extends DnsRecordLike>(
    records: T[],
    nets: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): T[] {
    const drop = new Set<string>();
    for (const [iface, addrs] of Object.entries(nets)) {
        for (const net of addrs ?? []) {
            if (net.internal) continue;
            if (lanExclusionOf(iface, net.address)) drop.add(net.address.toLowerCase());
        }
    }
    if (drop.size === 0) return records;
    const isAddr = (r: T): boolean => r.type === "A" || r.type === "AAAA";
    const kept = records.filter(
        (r) => !(isAddr(r) && typeof r.data === "string" && drop.has(r.data.toLowerCase())),
    );
    if (!kept.some((r) => r.type === "A") && records.some((r) => r.type === "A")) return records;
    return kept;
}
