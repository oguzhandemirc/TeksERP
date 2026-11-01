// Finans listesi satırları: kayıt → `ListRow` görünümü. Tutar `.finans` alt satırından, para birimi kaydın `doviz`inden;
// alt satır yanıtta yoksa hesap o alanı göremiyor demektir → değer yerine kilit (tutar hiç basılmaz). Aritmetik yok.
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text, View } from "react-native";
import type { ProjectionRecord } from "../../api/wire";
import { formatDate, formatMoney } from "../../lib/format";
import {
  CASH_TXN_KIND,
  CHEQUE_DOC_TYPE,
  CHEQUE_DOC_TYPE_LOWER,
  CHEQUE_KIND,
  CHEQUE_STATUS,
  FINANCE_LOCKED_TEXT,
  INVOICE_STATUS,
  INVOICE_TYPE,
  PAYMENT_DIRECTION,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
} from "../../lib/labels/finans";
import { recordTitle } from "../../lib/present";
import type { ProjectionRowView } from "../data";
import { useTokens } from "../theme-context";
import { typography } from "../tokens";

type Obj = Readonly<Record<string, unknown>>;

const obj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const dict = (d: Readonly<Record<string, string>>, v: unknown): string | undefined => (typeof v === "string" ? (d[v] ?? v) : undefined);

/** Kaydın para birimi; fabrika vermediyse boş (simge uydurulmaz). */
export function recordCurrency(kayit: unknown): string {
  return str(obj(kayit).doviz) ?? "";
}

/** `.finans` alanının para birimli metni; alt satır yoksa `null` (= izin yok, kilit). */
export function financeAmount(r: ProjectionRecord, field: string): string | null {
  if (r.finans === undefined) return null;
  const v = obj(r.finans)[field];
  const cur = recordCurrency(r.kayit);
  return cur === "" ? formatMoney(v, "").trimEnd() : formatMoney(v, cur);
}

/** İzinsiz tutarın yeri: kilit ikonu; ekran okuyucu tam cümleyi duyar. */
export function LockedAmount({ testID }: { readonly testID?: string }) {
  const t = useTokens();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }} accessible accessibilityLabel={FINANCE_LOCKED_TEXT} testID={testID}>
      <Ionicons name="lock-closed" size={14} color={t.textMuted} />
      <Text style={{ ...typography.footnote, color: t.textMuted }}>Gizli</Text>
    </View>
  );
}

function amountView(r: ProjectionRecord, field: string, sign?: string): Pick<ProjectionRowView, "value" | "accessory"> {
  const a = financeAmount(r, field);
  if (a === null) return { accessory: <LockedAmount testID={`kilit-${r.id}`} /> };
  return { value: sign && a !== "—" ? `${sign} ${a}` : a };
}

const join = (...parts: (string | undefined | false)[]) => parts.filter((x): x is string => typeof x === "string" && x !== "").join(" · ");

export function kasaRow(r: ProjectionRecord): ProjectionRowView {
  const k = obj(r.kayit);
  return {
    title: str(k.ad) ?? recordTitle(r.kayit),
    subtitle: join(str(k.kod), "Kasa", k.aktif === false && "Pasif"),
    icon: "cash-outline",
    domain: "finans",
    ...amountView(r, "bakiye"),
  };
}

export function bankaRow(r: ProjectionRecord): ProjectionRowView {
  const k = obj(r.kayit);
  return {
    title: str(k.ad) ?? recordTitle(r.kayit),
    subtitle: join(str(k.banka), str(k.kod), k.aktif === false && "Pasif"),
    icon: "business-outline",
    domain: "finans",
    ...amountView(r, "bakiye"),
  };
}

export function cekRow(r: ProjectionRecord): ProjectionRowView {
  const k = obj(r.kayit);
  const kind = dict(CHEQUE_KIND, k.tur);
  const doc = kind ? dict(CHEQUE_DOC_TYPE_LOWER, k.belgeTuru) : dict(CHEQUE_DOC_TYPE, k.belgeTuru);
  const status = typeof k.durum === "string" ? CHEQUE_STATUS[k.durum] : undefined;
  const bounced = k.durum === "BOUNCED";
  return {
    title: str(k.belgeNo) ?? recordTitle(r.kayit),
    subtitle: join(kind && doc ? `${kind} ${doc}` : (kind ?? doc), status?.label ?? str(k.durum), str(k.vade) && `Vade ${formatDate(k.vade)}`),
    icon: k.tur === "ISSUED" ? "arrow-up-circle-outline" : "arrow-down-circle-outline",
    domain: "finans",
    ...amountView(r, "tutar"),
    valueTone: bounced ? "kritik" : undefined,
  };
}

export function faturaRow(r: ProjectionRecord): ProjectionRowView {
  const k = obj(r.kayit);
  const overdue = k.vadesiGecti === true;
  const cancelled = k.durum === "CANCELLED";
  return {
    title: str(k.belgeNo) ?? recordTitle(r.kayit),
    subtitle: join(dict(INVOICE_TYPE, k.tur), str(k.tarih) && formatDate(k.tarih), cancelled && INVOICE_STATUS.CANCELLED!.label, overdue && "Gecikmiş"),
    icon: "document-text-outline",
    domain: "finans",
    ...amountView(r, "genelToplam"),
    valueTone: overdue && !cancelled ? "kritik" : undefined,
  };
}

export function tahsilatRow(r: ProjectionRecord): ProjectionRowView {
  const k = obj(r.kayit);
  const dir = typeof k.yon === "string" ? PAYMENT_DIRECTION[k.yon] : undefined;
  const cancelled = k.durum === "CANCELLED";
  return {
    title: str(k.belgeNo) ?? recordTitle(r.kayit),
    subtitle: join(dir?.label ?? str(k.yon), dict(PAYMENT_METHOD, k.yontem), str(k.tarih) && formatDate(k.tarih), cancelled && PAYMENT_STATUS.CANCELLED!.label),
    icon: k.yon === "OUT" ? "arrow-up-circle-outline" : "arrow-down-circle-outline",
    domain: "finans",
    ...amountView(r, "tutar", dir?.sign),
  };
}

/** Kasa hareketi: başlık kategori (yoksa tür), işaret yönden; kategorisiz masraf "Kategorisiz" yazılmaz, türüyle görünür. */
export function kasaHareketiRow(r: ProjectionRecord): ProjectionRowView {
  const k = obj(r.kayit);
  const kind = dict(CASH_TXN_KIND, k.tur);
  const sign = typeof k.yon === "string" ? PAYMENT_DIRECTION[k.yon]?.sign : undefined;
  return {
    title: str(k.kategori)?.trim() || kind || recordTitle(r.kayit),
    subtitle: join(str(k.kategori) ? kind : undefined, str(k.belgeNo), str(k.tarih) && formatDate(k.tarih), k.durum === "CANCELLED" && PAYMENT_STATUS.CANCELLED!.label),
    icon: k.yon === "OUT" ? "arrow-up-circle-outline" : "arrow-down-circle-outline",
    domain: "finans",
    ...amountView(r, "tutar", sign),
  };
}
