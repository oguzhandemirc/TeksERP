import { printHtmlReported } from './printHtml';
import { apiClient } from './api';

// =============================================================================
// Fason çeki listesi (KUMAŞ İRSALİYESİ) basımı — backend'in TEK KAYNAK HTML'inden.
// Tüm cihazlar (mobil + Electron) bu aynı HTML'i basar → format her yerde aynı.
// Kullanıcı yazdırma diyaloğunu iptal ederse expo-print throw edebilir; çağıran
// tarafta yakalanır (sessiz geçilir).
// =============================================================================
export async function printFasonCeki(dispatchId: string): Promise<void> {
  const res = await apiClient.get<string>(
    `/printed-documents/SUBCONTRACTOR_DISPATCH/${dispatchId}/html`,
    { responseType: 'text', headers: { Accept: 'text/html' } },
  );
  const html = typeof res.data === 'string' ? res.data : String(res.data);
  // Sonuç (belirsiz · iptal · hata) Yazdırma geçmişine raporlanır; iş ucu yok.
  await printHtmlReported(
    { html },
    { subjectKind: 'FASON_CEKI', docType: 'SUBCONTRACTOR_DISPATCH', subjectTable: 'subcontractor_dispatches', subjectId: dispatchId },
  );
}
