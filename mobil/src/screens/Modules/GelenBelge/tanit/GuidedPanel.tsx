// Aşamalı tanıtma paneli (kabuk): aktif aşamanın içeriği — ① StageHeader · ② StageMap · ③ StageRules. Şerit ve Kaydet çubuğu
// kaydırmanın dışında (TeachModal).
import React from 'react';
import type { ScanWord, SuggestResult } from '../../../../types/inboundDocTeach';
import StageHeader from './StageHeader';
import StageMap from './StageMap';
import StageRules from './StageRules';
import { stageIssues, type Stage, type TapTarget } from './stages';
import type { TeachState } from './teachDraft';

interface Props {
  state: TeachState;
  words: readonly ScanWord[];
  onChange: (fn: (s: TeachState) => TeachState) => void;
  stage: Stage;
  target: TapTarget;
  onTarget: (t: TapTarget) => void;
  preview: { result: SuggestResult | null; fresh: boolean; error: string | null; blocked?: string | null };
  onAdoptSimilar?: (kod: string) => void;
}

export default function GuidedPanel({ state, words, onChange, stage, target, onTarget, preview, onAdoptSimilar }: Props) {
  const issues = stageIssues(state, words, stage);
  if (stage === 'TANIMA') return <StageHeader state={state} onChange={onChange} preview={preview} onAdoptSimilar={onAdoptSimilar} />;
  if (stage === 'ESLEME') return <StageMap state={state} words={words} onChange={onChange} target={target} onTarget={onTarget} preview={preview} issues={issues} />;
  return <StageRules state={state} words={words} onChange={onChange} target={target} onTarget={onTarget} preview={preview} issues={issues} />;
}
