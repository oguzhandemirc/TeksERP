// Okuma servisi durumu rozeti (`GET /okuma/durum`). Servis yokken taslak elle/Excel'le sürer — rozet bunu söyler.
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { getReaderStatus, INCOMING_DOCUMENT_QUERY_KEY } from "./service";
import type { ReaderStatus } from "./types";

const TEXT: Record<ReaderStatus["service"], { label: string; variant: "default" | "secondary" | "destructive" | "outline"; hint: string }> = {
  var: { label: "Okuma servisi: çalışıyor", variant: "default", hint: "Fotoğraflar otomatik okunur." },
  yok: { label: "Okuma servisi: kurulu değil", variant: "outline", hint: "Taslağı elle ya da Excel'den doldurun." },
  erisilemiyor: { label: "Okuma servisi: erişilemiyor", variant: "destructive", hint: "Servis yanıt vermiyor; fotoğraflar kuyrukta bekler." },
  gecersiz: { label: "Okuma servisi: adres geçersiz", variant: "destructive", hint: "Genel Ayarlar'daki okuma servisi adresini düzeltin." },
};

export function ReaderStatusBadge() {
  const q = useQuery({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "okuma-durum"], queryFn: getReaderStatus, staleTime: 30_000 });
  if (!q.data) return null;
  if (q.data.serverOcrEnabled === false) {
    // Kapalıyken kuyruk okunmaz; bekleyen sayfa sayısı görünür (ayar açılınca okunur).
    const pending = q.data.pending ?? 0;
    return (
      <Badge variant="outline" title="Belgeyi yalnız tablet/telefon okur. Bekleyen sayfalar ayar açılınca okunur (Gelen Belge ayarları → Bilgisayarda ikinci okuma)." data-testid="reader-status">
        Bilgisayarda okuma: kapalı{pending > 0 ? ` · ${pending} sayfa bekliyor` : ""}
      </Badge>
    );
  }
  const t = TEXT[q.data.service] ?? TEXT.yok;
  const engine = q.data.engine ? ` (${q.data.engine}${q.data.version ? ` ${q.data.version}` : ""})` : "";
  return (
    <Badge variant={t.variant} title={t.hint} data-testid="reader-status">
      {t.label}
      {engine}
    </Badge>
  );
}
