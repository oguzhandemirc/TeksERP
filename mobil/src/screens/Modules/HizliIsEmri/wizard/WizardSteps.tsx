import React from 'react';

import SharedWizardSteps from '../../../../components/WizardSteps';

// =============================================================================
// Hızlı İş Emri'nin adım şeridi. Görsel/etkileşim tamamen ortak bileşende
// (`components/WizardSteps`) — burada yalnız BU sihirbazın başlıkları yaşar.
//
// Dosya duruyor çünkü `STEP_TITLES` NewWorkOrderView'in adım sayısı/etiketi
// kaynağıdır (`STEP_TITLES.length - 1` ile sınırlama, Appbar alt başlığı).
// =============================================================================

export const STEP_TITLES = ['TOPLAR', 'ÜRETİM', 'ONAY'] as const;

interface Props {
  current: number; // 0-tabanlı
  /** Tamamlanmış (geride kalan) adıma dokunarak dönülebilir; ileri atlanamaz. */
  onGoTo: (index: number) => void;
}

export default function WizardSteps({ current, onGoTo }: Props) {
  return <SharedWizardSteps titles={STEP_TITLES} current={current} onGoTo={onGoTo} />;
}
