import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import apiClient from "@/services/apiClient";

// =============================================================================
// BENZER KAYIT UYARISI — mükerreri REDDETMEK yerine ÖNLEMEK (2026-08-19)
// =============================================================================
// Mükerrer ad kontrolü bugüne kadar yalnız KAYDET'e basınca çarpıyordu ve yalnız
// katlanmış ad BİREBİR aynıysa. Sahadaki mükerrerlerin çoğu ise birebir aynı
// değil YAKIN: canlı veride "Moda Tekstil" ve "MODA TEKSTİL" İKİSİ DE AKTİF
// müşteri olarak duruyor. Bu bileşen kullanıcı adı YAZARKEN "şunlar zaten var"
// diye gösterir — sektörde standart olan yol (SAP BP, CRM'ler).
//
// ⚠️ ENGEL DEĞİLDİR ve öyle yapılmamalı: aynı grubun iki şirketi meşru olarak
// benzer adlıdır. Kullanıcı listeyi görür, kararı kendisi verir.
//
// ⚠️ Sunucu tarafı da OKUR-YAZMAZ: `GET /api/<varlık>/similar-names`. Uç yalnız
// yazma izniyle korunuyor (var olan adları listeliyor, kayıt açacak kişiye lazım).
// =============================================================================

export interface SimilarName {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  score: number;
}

interface Props {
  /** API yolu: "customers", "items", "colors", "stations"… */
  entity: string;
  /** Formda o an yazılı olan ad. */
  name: string;
  /** Düzenlemede kaydın kendisi "benzer" diye gösterilmesin. */
  excludeId?: string;
  /** Kapsamlı tekillikte (makine → istasyon) aramayı daraltır. */
  scope?: string;
}

export function SimilarNamesWarning({ entity, name, excludeId, scope }: Props) {
  const [rows, setRows] = useState<SimilarName[]>([]);
  const trimmed = name.trim();

  useEffect(() => {
    // 3 harften kısa terimde her şey "benzer" çıkar; sunucu da boş döner ama
    // isteği hiç göndermemek daha ucuz.
    if (trimmed.length < 3) {
      setRows([]);
      return;
    }
    let alive = true;
    // Yazarken her tuşta sorgu atmamak için gecikme. 400 ms: kullanıcı kelimeyi
    // bitirsin ama kaydet'e basmadan uyarıyı görsün.
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ name: trimmed });
      if (excludeId) qs.set("excludeId", excludeId);
      if (scope) qs.set("scope", scope);
      apiClient
        .get<{ data: SimilarName[] }>(`/api/${entity}/similar-names?${qs.toString()}`)
        .then((r) => {
          if (alive) setRows(r.data?.data ?? []);
        })
        // ⚠️ SESSİZ YUT: bu bir YARDIMCI uyarıdır. Uç 403/404 dönse bile form
        // çalışmaya devam etmeli — kullanıcıyı yazamaz hâle getirmek, önlemeye
        // çalıştığımız sorundan büyük zarar olurdu.
        .catch(() => {
          if (alive) setRows([]);
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [entity, trimmed, excludeId, scope]);

  // Birebir aynı ad ayrı vurgulanır: o "benzer" değil, KESİN mükerrerdir ve
  // kaydet'e basılırsa sunucu zaten 409 döndürecek.
  const exact = useMemo(() => rows.filter((r) => r.score >= 0.999), [rows]);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-800 dark:bg-amber-950/40">
      <div className="flex items-center gap-1.5 font-medium text-amber-900 dark:text-amber-200">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {exact.length > 0 ? "Bu ad zaten kayıtlı" : "Benzer kayıtlar var"}
      </div>
      <ul className="mt-1 space-y-0.5 text-amber-900/90 dark:text-amber-200/90">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-1.5">
            <span className="font-medium">{r.name}</span>
            {r.code && <span className="font-mono text-[11px] opacity-70">{r.code}</span>}
            {!r.isActive && <span className="opacity-70">(pasif)</span>}
            {r.score >= 0.999 && <span className="font-medium">— aynı ad</span>}
          </li>
        ))}
      </ul>
      <div className="mt-1 opacity-80">Aynı kaydı ikinci kez açmıyorsanız devam edebilirsiniz.</div>
    </div>
  );
}
