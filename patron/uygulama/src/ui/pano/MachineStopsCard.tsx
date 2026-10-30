// Üretim sekmesi "Makineler neden durdu?" kartı (D4-A4b, ister 5.5): fabrikanın `rapor-katalogu` anlığında
// `production/makine-duruslari` varsa rapor isteme ekranını açar; yoksa (eski fabrika sürümü ya da duruş takibi
// kapalı) nötr boş durum; katalog hatası ayrı metin + "Tekrar dene". İzin yoksa kart hiç çizilmez ve katalog çekilmez (koşulsuz 403 sorgusu atılmaz).
import { useRouter } from "expo-router";
import { reportTitle } from "../../lib/labels/finans";
import { catalogEntries, requestable } from "../../lib/reports";
import { useSession } from "../../state/session";
import { useRemote } from "../../state/useRemote";
import { ReportTile } from "../raporlar/parts";
import { SectionHeader } from "../SectionHeader";
import { Empty, LoadingSkeleton } from "../StateViews";
import { EMPTY_ICON } from "../icons";

export const MACHINE_STOPS_REPORT_KEY = "production/makine-duruslari";

export function MachineStopsCard() {
  const { api, permissions } = useSession();
  const router = useRouter();
  const allowed = requestable(MACHINE_STOPS_REPORT_KEY, permissions);
  const catalog = useRemote(allowed ? "anlik:rapor-katalogu" : null, () => api.snapshot("rapor-katalogu"));
  if (!allowed) return null;
  const entry = catalogEntries(catalog.data?.veri).find((e) => e.anahtar === MACHINE_STOPS_REPORT_KEY);
  const title = entry?.baslik ?? reportTitle(MACHINE_STOPS_REPORT_KEY);
  const rawQuestion: unknown = entry ? (entry as { soru?: unknown }).soru : undefined;
  const question = typeof rawQuestion === "string" && rawQuestion !== "" ? rawQuestion : undefined;

  return (
    <>
      <SectionHeader title="Makineler neden durdu?" domain="uretim" testID="bolum-makine-duruslari" />
      {catalog.loading && !catalog.data ? <LoadingSkeleton rows={1} /> : null}
      {entry ? (
        <ReportTile
          anahtar={MACHINE_STOPS_REPORT_KEY}
          baslik={title}
          soru={question}
          onPress={() => router.push({ pathname: "/raporlar/yeni", params: { anahtar: MACHINE_STOPS_REPORT_KEY } } as never)}
        />
      ) : catalog.error && !catalog.data ? (
        <Empty
          text="Fabrikadan rapor kataloğu henüz gelmedi"
          domain="uretim"
          icon={EMPTY_ICON.bekliyor}
          actionLabel="Tekrar dene"
          onAction={catalog.reload}
          testID="makine-duruslari-katalog-hata"
        />
      ) : catalog.data ? (
        <Empty
          text="Makine duruşları raporu bu fabrikada açık değil ya da fabrika güncellenince gelir"
          domain="uretim"
          icon={EMPTY_ICON.bekliyor}
          testID="makine-duruslari-yok"
        />
      ) : null}
    </>
  );
}
