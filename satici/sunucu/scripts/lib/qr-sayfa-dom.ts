// /q sayfasının betiğini Node `vm`inde SAHTE DOM ile koşturur — `test_qr_sayfasi` §4 kullanır.
// `test_` öneki yok → koşucu bunu bekçi saymaz. Gerçek ağ/tarayıcı yok: `fetch`, yerel depo,
// pano ve zamanlayıcı kaydedilir; sayfanın her açılışı ayrı bir betik koşumudur (parçalar yalnız
// ortak `depo` üzerinden taşınır — telefonda her QR yeni bir sekme açar).
import vm from "node:vm";
import { qrPageHtml } from "../../src/http/qr-page";

class SahteEleman {
  hidden = true;
  value = "";
  onclick: (() => void) | null = null;
  readonly attrs: Record<string, string> = {};
  children: SahteEleman[] = [];
  private metin = "";
  constructor(readonly tag: string) {}
  get textContent(): string {
    return this.metin;
  }
  set textContent(v: string) {
    this.metin = v;
    this.children = [];
  }
  appendChild(c: SahteEleman): void {
    this.children.push(c);
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = String(v);
  }
}

export interface SayfaKosumu {
  durum: string;
  fetchler: { url: string; body: { v?: number; zarf?: string } }[];
  qrSvgSayisi: number;
  qrYolu: string;
  qrBilgi: string;
  araclarGizli: boolean;
  yanit: string;
  kopyala: () => Promise<string | null>;
}

const IDLER = ["durum", "qr", "qr-bilgi", "araclar", "yanit", "kopyala", "onceki", "dur", "sonraki"];

/** Sayfayı `#<hash>` ile bir kez açar; `depo` açılışlar arasında paylaşılır (localStorage). */
export async function sayfayiAc(opts: {
  hash: string;
  depo: Map<string, string>;
  fetchYaniti?: { ok: boolean; text: string };
}): Promise<SayfaKosumu> {
  const betik = /<script>([\s\S]*)<\/script>/.exec(qrPageHtml())?.[1] ?? "";
  const els = Object.fromEntries(IDLER.map((id) => [id, new SahteEleman(id)])) as Record<string, SahteEleman>;
  const fetchler: SayfaKosumu["fetchler"] = [];
  let kopyalanan: string | null = null;
  const yanit = opts.fetchYaniti ?? { ok: true, text: '{"v":1}' };
  const ctx: Record<string, unknown> = {
    document: {
      getElementById: (id: string) => els[id] ?? null,
      createElementNS: (_ns: string, tag: string) => new SahteEleman(tag),
    },
    localStorage: {
      getItem: (k: string) => opts.depo.get(k) ?? null,
      setItem: (k: string, v: string) => void opts.depo.set(k, String(v)),
      removeItem: (k: string) => void opts.depo.delete(k),
    },
    location: { hash: `#${opts.hash}`, pathname: "/q" },
    history: { replaceState: () => undefined },
    fetch: (url: string, init: { body: string }) => {
      fetchler.push({ url, body: JSON.parse(init.body) as { v?: number; zarf?: string } });
      return Promise.resolve({ ok: yanit.ok, text: () => Promise.resolve(yanit.text) });
    },
    navigator: { clipboard: { writeText: (t: string) => ((kopyalanan = t), Promise.resolve()) } },
    setInterval: () => 1,
    clearInterval: () => undefined,
  };
  vm.createContext(ctx);
  vm.runInContext(betik, ctx);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  const svg = els.qr?.children[0];
  return {
    durum: els.durum?.textContent ?? "",
    fetchler,
    qrSvgSayisi: els.qr?.children.length ?? 0,
    qrYolu: svg?.children.find((c) => c.tag === "path")?.attrs.d ?? "",
    qrBilgi: els["qr-bilgi"]?.textContent ?? "",
    araclarGizli: els.araclar?.hidden ?? true,
    yanit: els.yanit?.value ?? "",
    kopyala: async () => {
      els.kopyala?.onclick?.();
      for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
      return kopyalanan;
    },
  };
}
