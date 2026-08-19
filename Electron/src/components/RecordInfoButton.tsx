import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import { safeFormat } from "@/lib/format";

/** Backend `record-info.service.ts` sözleşmesinin aynası. */
interface RecordActor {
  at: string;
  userId: string | null;
  userName: string | null;
  action?: string;
}
interface RecordInfo {
  created: RecordActor | null;
  lastChange: RecordActor | null;
  auditEmpty: boolean;
  /** Bilgi nereden geldi — kaynağı GİZLEMEK yerine söylüyoruz. */
  source?: "column" | "audit" | "archive" | "none";
}

interface Props {
  /** Audit tablo adı — backend allowlist'inden (WORK_ORDER, ORDER, ROLL…). */
  table: string;
  id: string;
  /** Kaydın KENDİ zaman damgaları — istemcide ZATEN var, sunucudan istenmez. */
  createdAt?: string | null;
  updatedAt?: string | null;
  className?: string;
}

const fmt = (v?: string | null) => (v ? safeFormat(v, "dd.MM.yyyy HH:mm") : "—");

/**
 * ⓘ — "bu kaydı kim oluşturdu, en son kim değiştirdi?" (2026-08-17 saha isteği)
 *
 * ── BACKENDİ YORMAYAN KURGU ─────────────────────────────────────────────────
 * · İstek YALNIZ açılışta atılır (`enabled: open`). Liste/detay payload'larına
 *   hiçbir alan eklenmedi — bilgiye yüz satırda bir kez bakılıyor.
 * · TARİHLER SUNUCUDAN İSTENMEZ: `createdAt`/`updatedAt` zaten ekrandaki
 *   kayıtta var, prop olarak geliyor. Sunucudan sadece KİM sorusunun cevabı
 *   gelir (audit'te iki indeksli sorgu).
 * · `staleTime: 5 dk` — aynı kayda tekrar bakmak yeni istek doğurmaz.
 *
 * ⚠️ 2026-08-19 — ÖNCE KOLON, SONRA AUDIT. Künye artık kaydın kendi
 * `createdById`/`updatedById` kolonlarında duruyor (Plan A) ve sunucu önce
 * oradan okuyor. Kolonu olmayan tablolarda (iş emri, sevkiyat — 2. faz)
 * audit'e düşülür; o yol artık ARŞİVİ DE tarar.
 *
 * Eskiden bilgi YALNIZ audit'ten geliyordu ve audit 6 ayda arşivlendiği için
 * eski kayıtta bu düğme SESSİZCE boş dönüyordu. Kaynağı göstermek o sınıf
 * hatayı görünür kılar: "kayıt yok" ile "arşivden bulundu" artık ayrı şeyler.
 */
export function RecordInfoButton({ table, id, createdAt, updatedAt, className }: Props) {
  const [open, setOpen] = useState(false);

  const q = useQuery({
    queryKey: ["record-info", table, id],
    queryFn: () =>
      apiClient
        .get<ApiResponse<RecordInfo>>(`/api/record-info/${table}/${id}`)
        .then((r) => r.data.data),
    enabled: open && Boolean(id),
    staleTime: 5 * 60_000,
  });

  const info = q.data;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={
            className ??
            "inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          }
          title="Kayıt bilgisi — kim oluşturdu, en son kim değiştirdi"
          aria-label="Kayıt bilgisi"
          onClick={(e) => e.stopPropagation()}
        >
          <Info className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-xs">
        <div className="space-y-2">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Oluşturulma
            </div>
            <div className="font-medium">{fmt(createdAt)}</div>
            <div className="text-muted-foreground">
              {q.isLoading ? "…" : (info?.created?.userName ?? "—")}
            </div>
          </div>
          <div className="border-t pt-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Son değişiklik
            </div>
            <div className="font-medium">{fmt(updatedAt)}</div>
            <div className="text-muted-foreground">
              {q.isLoading ? "…" : (info?.lastChange?.userName ?? "—")}
            </div>
          </div>

          {q.isLoading && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> yükleniyor
            </div>
          )}
          {q.isError && <div className="text-destructive">Bilgi alınamadı.</div>}
          {info?.auditEmpty && (
            <div className="rounded border border-dashed px-2 py-1 text-muted-foreground">
              İşlem kaydı bulunamadı — bu kayıt künye kolonları eklenmeden önce
              oluşturulmuş ve işlem kaydı da arşivlenmiş olabilir.
            </div>
          )}
          {/* Kaynak rozeti — yalnız audit/arşivden geldiğinde. Kolondan gelen
              bilgi "normal" durumdur, rozet göstermek gürültü olur. */}
          {info?.source === "archive" && (
            <div className="text-[10px] text-muted-foreground">arşivlenmiş işlem kaydından</div>
          )}
          {info?.source === "audit" && (
            <div className="text-[10px] text-muted-foreground">işlem kaydından</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
