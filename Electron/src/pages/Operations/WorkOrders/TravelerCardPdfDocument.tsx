import { Document, Page, View, Text, Image, StyleSheet, Font } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { format, isValid } from "date-fns";
import RobotoRegular from "@fontsource/roboto/files/roboto-latin-ext-400-normal.woff?url";
import RobotoMedium from "@fontsource/roboto/files/roboto-latin-ext-500-normal.woff?url";
import RobotoBold from "@fontsource/roboto/files/roboto-latin-ext-700-normal.woff?url";
import { workOrderTypeLabels } from "@/types/enums";
import type { WorkOrder, TravelerCard } from "./types";
import type { TravelerCardConfig } from "@/services/featureFlagService";

/* Roboto latin-ext: Türkçe glyph'leri içerir (ı, ş, ğ, İ vs). */
Font.register({
  family: "Roboto",
  fonts: [
    { src: RobotoRegular, fontWeight: 400 },
    { src: RobotoMedium, fontWeight: 500 },
    { src: RobotoBold, fontWeight: 700 },
  ],
});

/* Firma adı — Faz 3 "marka ayarları" panelinde konfigüre edilebilir olacak.
   Şimdilik sabit; snapshot'a girmez (her kart için aynı). */
const COMPANY_NAME = "Adnan Şahin Tekstil";

const fmtDate = (d: string | null | undefined, fallback = "—") => {
  if (!d) return fallback;
  const dt = new Date(d);
  return isValid(dt) ? format(dt, "dd.MM.yyyy") : fallback;
};
const fmtDateTime = (d: string) => {
  const dt = new Date(d);
  return isValid(dt) ? format(dt, "dd.MM.yyyy HH:mm") : "—";
};
const fmtNum = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n);

interface Props {
  workOrder: WorkOrder;
  card: TravelerCard;
  qrDataUrl: string;
  /** Marka/içerik ayarı — snapshot'tan gelir; yoksa varsayılan (hepsi açık). */
  config?: TravelerCardConfig;
}

export function TravelerCardPdfDocument({ workOrder, card, qrDataUrl, config }: Props) {
  const sortedSteps = [...workOrder.steps].sort((a, b) => a.stepSequence - b.stepSequence);
  const orderLinks = workOrder.orderLinks ?? [];
  const companyName = config?.companyName?.trim() || COMPANY_NAME;
  const addressLine = config?.addressLine?.trim() ?? "";
  const phone = config?.phone?.trim() ?? "";
  const showOperationGrid = config?.showOperationGrid !== false;
  const showNotes = config?.showNotes !== false;
  const showOrders = config?.showOrders !== false;
  const showProperties = config?.showProperties !== false;
  const footerNote = config?.footerNote?.trim() ?? "";

  return (
    <Document title={`Refakat Kartı ${card.cardNumber}`} author={companyName}>
      <Page size="A4" style={s.page}>
        {/* Üst bant: firma + belge başlığı + kart kimliği */}
        <View style={s.topbar} fixed>
          <View>
            <Text style={s.company}>{companyName}</Text>
            {(addressLine || phone) && (
              <Text style={s.companyMeta}>
                {[addressLine, phone].filter(Boolean).join("  ·  ")}
              </Text>
            )}
            <Text style={s.docTitle}>REFAKAT KARTI</Text>
          </View>
          <View style={s.topRight}>
            <Text style={s.label}>KART NO</Text>
            <Text style={s.cardNo}>{card.cardNumber}</Text>
            <Text style={s.meta}>v{card.version} · {fmtDateTime(card.printedAt)}</Text>
          </View>
        </View>

        {/* Kimlik + QR */}
        <View style={s.idRow}>
          <View style={s.idLeft}>
            <View style={s.batchRow}>
              <Text style={s.batch}>{workOrder.batchNumber}</Text>
            </View>
            <Text style={s.typeText}>
              {workOrderTypeLabels[workOrder.type]}
              {workOrder.routeTemplate ? ` · Rota: ${workOrder.routeTemplate.name}` : ""}
            </Text>
            {workOrder.targetItem && (
              <View style={s.productLine}>
                <Text style={s.productCode}>{workOrder.targetItem.code}</Text>
                <Text style={s.productName}>{workOrder.targetItem.name}</Text>
              </View>
            )}
          </View>
          <View style={s.qrBlock}>
            <Image src={qrDataUrl} style={s.qrImage} />
            <Text style={s.barcode}>{card.barcode}</Text>
            <Text style={s.qrHint}>Tablet ile okut</Text>
          </View>
        </View>

        {/* Spec grid */}
        <View style={s.grid}>
          <Cell label="Renk" value={workOrder.targetColor?.name ?? "—"} />
          <Cell label="En" value={workOrder.width != null ? `${workOrder.width} cm` : "—"} />
          <Cell label="Hedef Metraj" value={`${fmtNum(workOrder.targetQuantity)} m`} highlight last />
          <Cell label="Hedef Ağırlık" value={workOrder.targetWeight != null ? `${fmtNum(workOrder.targetWeight)} kg` : "—"} bottom />
          <Cell label="Kat Tipi" value={workOrder.foldType ?? "—"} bottom />
          <Cell label="Başlangıç" value={fmtDate(workOrder.plannedStartDate)} bottom />
          <Cell label="Bitiş" value={fmtDate(workOrder.plannedEndDate)} bottom last />
        </View>

        {showProperties && workOrder.targetProperties && workOrder.targetProperties.length > 0 && (
          <View style={s.properties}>
            <Text style={s.label}>ÖZELLİKLER:</Text>
            {workOrder.targetProperties.map((p) => (
              <Text key={p.propertyId} style={s.chip}>{p.property.name}</Text>
            ))}
          </View>
        )}

        {/* Operasyon kaydı (rota + imza grid) */}
        {showOperationGrid && (
        <>
        <Text style={s.sectionTitle}>OPERASYON KAYDI</Text>
        <View style={s.opTable}>
          <View style={s.opHead} fixed>
            <Text style={[s.opCol, s.opSeq]}>#</Text>
            <Text style={[s.opCol, s.opStation]}>İstasyon</Text>
            <Text style={[s.opCol, s.opOperator]}>Operatör</Text>
            <Text style={[s.opCol, s.opDate]}>Tarih</Text>
            <Text style={[s.opCol, s.opQty]}>Mt</Text>
            <Text style={[s.opCol, s.opQty]}>Fire</Text>
            <Text style={[s.opCol, s.opSign]}>İmza</Text>
          </View>
          {sortedSteps.map((step) => {
            const isFason = step.station?.type === "EXTERNAL";
            return (
              <View key={step.id} style={s.opRow} wrap={false}>
                <Text style={[s.opCol, s.opSeq]}>{step.stepSequence}</Text>
                <View style={[s.opCol, s.opStation]}>
                  <Text style={s.opStationName}>{step.station?.name ?? "—"}</Text>
                  {isFason && step.plannedSubcontractor && (
                    <Text style={s.opSub}>→ {step.plannedSubcontractor.name}</Text>
                  )}
                </View>
                <Text style={[s.opCol, s.opOperator]} />
                <Text style={[s.opCol, s.opDate]} />
                <Text style={[s.opCol, s.opQty]} />
                <Text style={[s.opCol, s.opQty]} />
                <Text style={[s.opCol, s.opSign]} />
              </View>
            );
          })}
        </View>
        </>
        )}

        {/* Talimatlar / Boyahane notu */}
        {showNotes && workOrder.dyehouseNote && (
          <View style={s.notes}>
            <Text style={s.label}>TALİMATLAR / BOYAHANE NOTU</Text>
            <Text style={s.notesText}>{workOrder.dyehouseNote}</Text>
          </View>
        )}

        {/* Bağlı siparişler */}
        {showOrders && (orderLinks.length > 0 ? (
          <View style={s.orders}>
            <Text style={s.sectionTitle}>BAĞLI SİPARİŞLER ({orderLinks.length})</Text>
            <View style={s.ordersHead} fixed>
              <Text style={[s.ordersCol, s.ordersNum]}>Sipariş No</Text>
              <Text style={[s.ordersCol, s.ordersCustomer]}>Müşteri</Text>
              <Text style={[s.ordersCol, s.ordersItem]}>Ürün</Text>
              <Text style={[s.ordersCol, s.ordersQty]}>Miktar</Text>
            </View>
            {orderLinks.map((link) => {
              const ol = link.orderLine;
              return (
                <View key={link.orderLineId} style={s.ordersRow} wrap={false}>
                  <Text style={[s.ordersCol, s.ordersNum]}>{ol?.order?.orderNumber ?? "—"}</Text>
                  <Text style={[s.ordersCol, s.ordersCustomer]}>{ol?.order?.customer?.name ?? "—"}</Text>
                  <Text style={[s.ordersCol, s.ordersItem]}>{ol?.item?.name ?? "—"}</Text>
                  <Text style={[s.ordersCol, s.ordersQty]}>{fmtNum(ol?.quantity)} m</Text>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={s.emptyNote}>
            <Text style={s.emptyText}>Stoğa üretim — bağlı sipariş yok</Text>
          </View>
        ))}

        {footerNote !== "" && (
          <View style={s.footerNote}>
            <Text style={s.footerNoteText}>{footerNote}</Text>
          </View>
        )}

        <Text
          style={s.pageNo}
          render={({ pageNumber, totalPages }) =>
            totalPages > 1 ? `Sayfa ${pageNumber}/${totalPages} · ${card.cardNumber}` : ""
          }
          fixed
        />
      </Page>
    </Document>
  );
}

function Cell({
  label, value, highlight, last, bottom,
}: { label: string; value: string; highlight?: boolean; last?: boolean; bottom?: boolean }) {
  const cellStyle: Style[] = [s.cell];
  if (highlight) cellStyle.push(s.cellHighlight);
  if (!last) cellStyle.push(s.cellBorderRight);
  if (!bottom) cellStyle.push(s.cellBorderBottom);
  return (
    <View style={cellStyle}>
      <Text style={s.cellLabel}>{label}</Text>
      <Text style={s.cellValue}>{value}</Text>
    </View>
  );
}

const C = {
  ink: "#000", border: "#000", soft: "#999", dot: "#bbb",
  muted: "#555", highlight: "#eee", rowAlt: "#f7f7f7", urgent: "#b91c1c",
};

const s = StyleSheet.create({
  page: { paddingTop: 22, paddingBottom: 26, paddingHorizontal: 26, fontFamily: "Roboto", fontSize: 9, color: C.ink },

  topbar: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
    borderBottomWidth: 1.2, borderBottomColor: C.border, paddingBottom: 6, marginBottom: 8,
  },
  company: { fontSize: 14, fontWeight: 700, letterSpacing: -0.2 },
  companyMeta: { fontSize: 7, color: C.muted, marginTop: 1 },
  docTitle: { fontSize: 8, fontWeight: 700, color: C.muted, letterSpacing: 1.5, marginTop: 1 },
  topRight: { alignItems: "flex-end" },
  label: { fontSize: 6.5, fontWeight: 700, color: C.muted, letterSpacing: 0.5, textTransform: "uppercase" },
  cardNo: { fontSize: 13, fontWeight: 700, marginTop: 1 },
  meta: { fontSize: 7.5, color: C.muted, marginTop: 1 },

  /* Kimlik + QR */
  idRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  idLeft: { flex: 1, paddingRight: 10 },
  batchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  batch: { fontSize: 22, fontWeight: 700, letterSpacing: -0.3 },
  typeText: { fontSize: 8.5, color: "#333", marginTop: 2 },
  productLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 5 },
  productCode: {
    fontSize: 9, fontWeight: 700, backgroundColor: "#000", color: "#fff",
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 2,
  },
  productName: { fontSize: 12, fontWeight: 700 },
  qrBlock: { width: 118, alignItems: "center", borderWidth: 0.8, borderColor: C.border, paddingVertical: 6, paddingHorizontal: 4 },
  qrImage: { width: 100, height: 100 },
  barcode: { marginTop: 4, fontSize: 9, fontWeight: 700, letterSpacing: 0.2, textAlign: "center" },
  qrHint: { fontSize: 6.5, color: C.muted, marginTop: 1 },

  /* Spec grid */
  grid: { flexDirection: "row", flexWrap: "wrap", borderWidth: 0.8, borderColor: C.border, marginBottom: 6 },
  cell: { width: "33.333%", paddingHorizontal: 6, paddingVertical: 4 },
  cellHighlight: { backgroundColor: C.highlight },
  cellBorderRight: { borderRightWidth: 0.5, borderRightColor: C.soft },
  cellBorderBottom: { borderBottomWidth: 0.5, borderBottomColor: C.soft },
  cellLabel: { fontSize: 6, fontWeight: 700, color: C.muted, letterSpacing: 0.4, textTransform: "uppercase" },
  cellValue: { fontSize: 10, fontWeight: 500, marginTop: 1.5 },

  /* Özellikler */
  properties: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4, marginBottom: 8 },
  chip: { fontSize: 7.5, borderWidth: 0.5, borderColor: C.border, paddingHorizontal: 4, paddingVertical: 1.5, borderRadius: 2, fontWeight: 500 },

  sectionTitle: { fontSize: 7.5, fontWeight: 700, color: C.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 3, marginTop: 2 },

  /* Operasyon kaydı tablosu */
  opTable: { borderWidth: 0.8, borderColor: C.border, marginBottom: 8 },
  opHead: { flexDirection: "row", backgroundColor: C.highlight, borderBottomWidth: 0.8, borderBottomColor: C.border },
  opRow: { flexDirection: "row", minHeight: 26, borderBottomWidth: 0.5, borderBottomColor: C.soft, alignItems: "stretch" },
  opCol: { fontSize: 8.5, paddingHorizontal: 5, paddingVertical: 4, borderRightWidth: 0.5, borderRightColor: C.soft },
  opSeq: { width: 22, textAlign: "center", fontWeight: 700 },
  opStation: { width: 130, justifyContent: "center" },
  opStationName: { fontSize: 9, fontWeight: 600 },
  opSub: { fontSize: 7, color: C.muted, marginTop: 1 },
  opOperator: { flex: 1 },
  opDate: { width: 58 },
  opQty: { width: 40 },
  opSign: { width: 60, borderRightWidth: 0 },

  /* Notlar */
  notes: { borderWidth: 0.8, borderColor: C.urgent, backgroundColor: "#fef2f2", borderRadius: 3, padding: 6, marginBottom: 8 },
  notesText: { fontSize: 10, marginTop: 2 },

  /* Siparişler */
  orders: {},
  ordersHead: { flexDirection: "row", borderBottomWidth: 0.8, borderBottomColor: C.border, paddingBottom: 2, marginBottom: 1 },
  ordersRow: { flexDirection: "row", paddingVertical: 2.5, borderBottomWidth: 0.3, borderBottomColor: C.dot },
  ordersCol: { fontSize: 8.5 },
  ordersNum: { width: 90, fontWeight: 700 },
  ordersCustomer: { width: 170, fontWeight: 500 },
  ordersItem: { flex: 1, color: "#333", paddingRight: 4 },
  ordersQty: { width: 60, textAlign: "right", fontWeight: 700 },

  emptyNote: { alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: C.dot, borderStyle: "dashed", padding: 10 },
  emptyText: { fontSize: 9.5, color: C.muted },

  /* Alt not */
  footerNote: { borderWidth: 0.5, borderColor: C.soft, borderRadius: 3, padding: 6, marginTop: 8 },
  footerNoteText: { fontSize: 8.5, color: C.muted },

  pageNo: { position: "absolute", bottom: 10, left: 0, right: 0, textAlign: "center", fontSize: 7, color: C.muted },
});
