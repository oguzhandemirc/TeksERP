// Teklif ve standart maliyet satır metinleri (ekranlar + testler). Para YALNIZ `.finans`tan aynen; istemci hesap yapmaz.
import type { ProjectionRecord } from "../../api/wire";
import { formatDate, formatMoney } from "../../lib/format";
import { COST_GROUPS, STANDARD_COST_STATUS } from "../../lib/labels/teklif";
import { recordStatus } from "../../lib/labels/uretim";
import { asObj, str } from "../siparis/OrderRow";

/** Teklif tarihleri takvim günüdür: saat dilimiyle kaydırılmaz, `YYYY-MM-DD` dilimi basılır. */
const day = (v: unknown): string => formatDate(typeof v === "string" ? v.slice(0, 10) : v);

/** Satır metinleri; tutar `.finans` yoksa YOK (toplam/maliyetten türetilmez). */
export function quoteRowText(r: ProjectionRecord) {
  const k = asObj(r.kayit);
  const f = r.finans ? asObj(r.finans) : null;
  const no = str(k.no) ?? "—";
  const rev = typeof k.revizyon === "number" && k.revizyon > 1 ? `/R${k.revizyon}` : "";
  return {
    title: str(k.musteriAdi) ?? `${no}${rev}`,
    line: `${str(k.musteriAdi) ? `${no}${rev} · ` : ""}${day(k.tarih)} · geçerlilik ${day(k.gecerlilik)}`,
    value: f && f.toplamTutar != null ? formatMoney(f.toplamTutar, str(k.doviz) ?? "TRY") : undefined,
    expired: k.suresiDoldu === true,
  };
}

/** Satır metinleri; maliyet `.finans` yoksa YOK. Gruplar yalnız fabrika gönderdiyse, sırası `COST_GROUPS`. */
export function standardCostRowText(r: ProjectionRecord) {
  const k = asObj(r.kayit);
  const f = r.finans ? asObj(r.finans) : null;
  const groups = f ? COST_GROUPS.filter((g) => f[g.key] != null).map((g) => `${g.label} ${formatMoney(f[g.key], "TRY")}`) : [];
  return {
    title: str(k.urunAdi) ?? "—",
    line: `Sürüm ${typeof k.surum === "number" ? k.surum : "—"} · ${recordStatus(STANDARD_COST_STATUS, k.durum).label} · ${formatDate(k.hesapTarihi)}`,
    groups: groups.join(" · "),
    value: f && f.metreMaliyetiTl != null ? `${formatMoney(f.metreMaliyetiTl, "TRY")}/m` : undefined,
  };
}
