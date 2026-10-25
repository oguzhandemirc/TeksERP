import type { RouteObject } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { CustomReportBuilderPage } from "./CustomReportBuilderPage";
import { CustomReportRoute } from "./CustomReportRoute";
import { CustomReportViewPage } from "./CustomReportViewPage";
import { REPORT_ANY_PERMISSIONS, REPORT_BUILDER_PERMISSION } from "./custom-api";

/**
 * Özel raporlar (ekran kataloğunda `reports/ozel`): oluşturma/düzenleme `report:builder`; görüntüleme
 * herhangi bir rapor izni — tanımın görünürlüğünü ve blok izinlerini sunucu denetler.
 */
export const customReportRoutes: RouteObject[] = [
  {
    path: "reports/ozel/yeni",
    element: (
      <ProtectedRoute requirePermission={REPORT_BUILDER_PERMISSION}>
        <CustomReportRoute>
          <CustomReportBuilderPage key="yeni" />
        </CustomReportRoute>
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/ozel/:id/duzenle",
    element: (
      <ProtectedRoute requirePermission={REPORT_BUILDER_PERMISSION}>
        <CustomReportRoute>
          <CustomReportBuilderPage />
        </CustomReportRoute>
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/ozel/:id",
    element: (
      <ProtectedRoute requireAnyPermission={REPORT_ANY_PERMISSIONS}>
        <CustomReportRoute>
          <CustomReportViewPage />
        </CustomReportRoute>
      </ProtectedRoute>
    ),
  },
];
