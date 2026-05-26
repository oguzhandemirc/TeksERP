import { Document, Page, View, Text, Image, StyleSheet, Font } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { format, isValid } from "date-fns";
import RobotoRegular from "@fontsource/roboto/files/roboto-latin-ext-400-normal.woff?url";
import RobotoMedium from "@fontsource/roboto/files/roboto-latin-ext-500-normal.woff?url";
import RobotoBold from "@fontsource/roboto/files/roboto-latin-ext-700-normal.woff?url";
import { workOrderTypeLabels } from "@/types/enums";
import type { WorkOrder, TravelerCard } from "./types";

/* Roboto latin-ext: Türkçe glyph'leri içerir (ı, ş, ğ, İ vs). Default Helvetica
   WinAnsi encoding ile bu karakterler düşüyor. */
Font.register({
  family: "Roboto",
  fonts: [
    { src: RobotoRegular, fontWeight: 400 },
    { src: RobotoMedium, fontWeight: 500 },
    { src: RobotoBold, fontWeight: 700 },
  ],
});

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
}

export function TravelerCardPdfDocument({ workOrder, card, qrDataUrl }: Props) {
  const sortedSteps = [...workOrder.steps].sort(
    (a, b) => a.stepSequence - b.stepSequence,
  );
  const orderLinks = workOrder.orderLinks ?? [];

  return (
    <Document title={`Refakat Kartı ${card.cardNumber}`} author="Adnan Şahin ERP">
      <Page size="A5" orientation="landscape" style={s.page}>
        {/* Header — her sayfada tekrar */}
        <View style={s.header} fixed>
          <View style={s.headerLeft}>
            <Text style={s.label}>REFAKAT KARTI · BATCH</Text>
            <Text style={s.batch}>{workOrder.batchNumber}</Text>
          </View>
          <View style={s.headerRight}>
            <Text style={s.label}>KART NO</Text>
            <Text style={s.cardNo}>{card.cardNumber}</Text>
            <Text style={s.meta}>
              v{card.version} · {fmtDateTime(card.printedAt)}
            </Text>
          </View>
        </View>

        {/* QR + Ürün özet */}
        <View style={s.main}>
          <View style={s.qrBlock}>
            <Image src={qrDataUrl} style={s.qrImage} />
            <Text style={s.barcode}>{card.barcode}</Text>
            <Text style={s.qrHint}>Tablet ile okut</Text>
          </View>

          <View style={s.infoCol}>
            {workOrder.targetItem && (
              <View style={s.product}>
                <Text style={s.label}>HEDEF ÜRÜN</Text>
                <View style={s.productLine}>
                  <Text style={s.productCode}>{workOrder.targetItem.code}</Text>
                  <Text style={s.productName}>{workOrder.targetItem.name}</Text>
                </View>
              </View>
            )}

            <View style={s.grid}>
              <Cell label="Renk" value={workOrder.targetColor?.name ?? "—"} />
              <Cell
                label="En"
                value={workOrder.width != null ? `${workOrder.width} cm` : "—"}
              />
              <Cell
                label="Hedef Metraj"
                value={`${fmtNum(workOrder.targetQuantity)} m`}
                highlight
                last
              />
              <Cell label="Kat Tipi" value={workOrder.foldType ?? "—"} bottom />
              <Cell label="Başlangıç" value={fmtDate(workOrder.plannedStartDate)} bottom />
              <Cell label="Bitiş" value={fmtDate(workOrder.plannedEndDate)} bottom last />
            </View>

            {workOrder.targetProperties && workOrder.targetProperties.length > 0 && (
              <View style={s.properties}>
                <Text style={s.label}>ÖZELLİKLER</Text>
                {workOrder.targetProperties.map((p) => (
                  <Text key={p.propertyId} style={s.chip}>
                    {p.property.name}
                  </Text>
                ))}
              </View>
            )}

            <View style={s.typeRow}>
              <Text style={s.label}>TİP</Text>
              <Text style={s.typeText}>
                {workOrderTypeLabels[workOrder.type]}
                {workOrder.routeTemplate ? ` · ${workOrder.routeTemplate.name}` : ""}
              </Text>
            </View>
          </View>
        </View>

        {/* Rota chain */}
        <View style={s.route} wrap={false}>
          <Text style={s.label}>ROTA</Text>
          <View style={s.routeList}>
            {sortedSteps.map((step, idx) => (
              <View key={step.id} style={s.routeStep}>
                <Text style={s.routeNum}>{step.stepSequence}</Text>
                <Text style={s.routeName}>{step.station?.name ?? "—"}</Text>
                {step.station?.type === "EXTERNAL" && (
                  <Text style={s.routeFason}>FASON</Text>
                )}
                {idx < sortedSteps.length - 1 && (
                  <Text style={s.routeArrow}>→</Text>
                )}
              </View>
            ))}
          </View>
        </View>

        {/* Bağlı siparişler — çok satırlı, otomatik wrap edilir */}
        {orderLinks.length > 0 ? (
          <View style={s.orders}>
            <Text style={s.ordersTitle} fixed>
              BAĞLI SİPARİŞLER ({orderLinks.length})
            </Text>
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
                  <Text style={[s.ordersCol, s.ordersNum]}>
                    {ol?.order?.orderNumber ?? "—"}
                  </Text>
                  <Text style={[s.ordersCol, s.ordersCustomer]}>
                    {ol?.order?.customer?.name ?? "—"}
                  </Text>
                  <Text style={[s.ordersCol, s.ordersItem]}>
                    {ol?.item?.name ?? "—"}
                  </Text>
                  <Text style={[s.ordersCol, s.ordersQty]}>
                    {fmtNum(link.allocatedQty)} m
                  </Text>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={s.emptyNote}>
            <Text style={s.emptyText}>Stoka üretim — bağlı sipariş yok</Text>
          </View>
        )}

        {/* Sayfa numarası — sadece >1 sayfa olursa anlamlı */}
        <Text
          style={s.pageNo}
          render={({ pageNumber, totalPages }) =>
            totalPages > 1 ? `Sayfa ${pageNumber}/${totalPages}` : ""
          }
          fixed
        />
      </Page>
    </Document>
  );
}

function Cell({
  label,
  value,
  highlight,
  last,
  bottom,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  last?: boolean;
  bottom?: boolean;
}) {
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

const COLORS = {
  ink: "#000",
  border: "#000",
  borderSoft: "#999",
  borderDot: "#bbb",
  mutedText: "#555",
  highlight: "#eee",
  fasonBg: "#ffc107",
  rowAlt: "#f7f7f7",
};

const s = StyleSheet.create({
  page: {
    paddingTop: 14,
    paddingBottom: 18,
    paddingHorizontal: 14,
    fontFamily: "Roboto",
    fontSize: 8.5,
    color: COLORS.ink,
  },

  /* Header */
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 4,
    marginBottom: 6,
  },
  headerLeft: { flex: 1 },
  headerRight: { alignItems: "flex-end", paddingLeft: 8 },
  label: {
    fontSize: 6,
    fontWeight: 700,
    color: COLORS.mutedText,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  batch: {
    fontSize: 18,
    fontWeight: 700,
    marginTop: 2,
    letterSpacing: -0.3,
  },
  cardNo: { fontSize: 12, fontWeight: 700, marginTop: 2 },
  meta: { fontSize: 7, color: COLORS.mutedText, marginTop: 2 },

  /* Main row */
  main: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 6,
  },
  qrBlock: {
    width: 130,
    alignItems: "center",
    borderWidth: 0.7,
    borderColor: COLORS.border,
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  qrImage: { width: 110, height: 110 },
  barcode: {
    marginTop: 4,
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: 0.3,
    textAlign: "center",
  },
  qrHint: { fontSize: 6, color: COLORS.mutedText, marginTop: 1 },

  infoCol: { flex: 1, gap: 4 },

  product: {},
  productLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 2,
  },
  productCode: {
    fontSize: 8,
    fontWeight: 700,
    backgroundColor: "#000",
    color: "#fff",
    paddingHorizontal: 4,
    paddingVertical: 1.5,
    borderRadius: 2,
  },
  productName: { fontSize: 10, fontWeight: 700 },

  /* Data grid */
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderWidth: 0.7,
    borderColor: COLORS.border,
  },
  cell: {
    width: "33.333%",
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  cellHighlight: { backgroundColor: COLORS.highlight },
  cellBorderRight: {
    borderRightWidth: 0.5,
    borderRightColor: COLORS.borderSoft,
  },
  cellBorderBottom: {
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.borderSoft,
  },
  cellLabel: {
    fontSize: 5.5,
    fontWeight: 700,
    color: COLORS.mutedText,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  cellValue: { fontSize: 9, fontWeight: 500, marginTop: 1 },

  /* Properties */
  properties: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 3,
    marginTop: 2,
  },
  chip: {
    fontSize: 7,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderRadius: 2,
    fontWeight: 500,
  },

  typeRow: {
    flexDirection: "row",
    gap: 4,
    alignItems: "baseline",
    marginTop: 1,
  },
  typeText: { fontSize: 7.5, color: "#333" },

  /* Route */
  route: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderTopWidth: 0.7,
    borderBottomWidth: 0.7,
    borderColor: COLORS.border,
    paddingVertical: 4,
    marginBottom: 5,
  },
  routeList: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 5,
    flex: 1,
  },
  routeStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  routeNum: {
    width: 11,
    height: 11,
    backgroundColor: "#000",
    color: "#fff",
    fontSize: 7,
    fontWeight: 700,
    textAlign: "center",
    paddingTop: 1.6,
    borderRadius: 5.5,
  },
  routeName: { fontSize: 8.5, fontWeight: 600, marginLeft: 1 },
  routeFason: {
    fontSize: 6,
    fontWeight: 700,
    backgroundColor: COLORS.fasonBg,
    color: "#000",
    paddingHorizontal: 2,
    paddingVertical: 0.5,
    borderRadius: 1.5,
    marginLeft: 1,
  },
  routeArrow: { color: COLORS.borderSoft, fontSize: 9, marginHorizontal: 1 },

  /* Orders */
  orders: { flex: 1 },
  ordersTitle: {
    fontSize: 7,
    fontWeight: 700,
    color: COLORS.mutedText,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  ordersHead: {
    flexDirection: "row",
    borderBottomWidth: 0.7,
    borderBottomColor: COLORS.border,
    paddingBottom: 2,
    marginBottom: 1,
  },
  ordersRow: {
    flexDirection: "row",
    paddingVertical: 2,
    borderBottomWidth: 0.3,
    borderBottomColor: COLORS.borderDot,
  },
  ordersCol: { fontSize: 8 },
  ordersNum: {
    width: 75,
    fontWeight: 700,
  },
  ordersCustomer: { width: 140, fontWeight: 500 },
  ordersItem: { flex: 1, color: "#333", paddingRight: 4 },
  ordersQty: {
    width: 55,
    textAlign: "right",
    fontWeight: 700,
  },

  emptyNote: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 0.5,
    borderColor: COLORS.borderDot,
    borderStyle: "dashed",
    padding: 8,
  },
  emptyText: {
    fontSize: 9,
    color: COLORS.mutedText,
    fontStyle: "italic",
  },

  pageNo: {
    position: "absolute",
    bottom: 6,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 6.5,
    color: COLORS.mutedText,
  },
});
