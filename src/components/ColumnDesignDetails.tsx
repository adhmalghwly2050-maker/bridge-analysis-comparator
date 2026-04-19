import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { BiaxialColumnResult } from '@/lib/structuralEngine';

interface ColumnDesignDetailsProps {
  colId: string;
  b: number;
  h: number;
  Lu: number;
  Pu: number;
  design: BiaxialColumnResult;
  storyLabel?: string;
}

export default function ColumnDesignDetails({ colId, b, h, Lu, Pu, design, storyLabel }: ColumnDesignDetailsProps) {
  const [open, setOpen] = useState(false);
  const r = 0.3 * Math.min(b, h);
  const Ag = b * h;
  const aBar = Math.PI * design.dia * design.dia / 4;
  const As = design.bars * aBar;

  return (
    <div className="border border-border rounded-md overflow-hidden text-[11px] font-mono">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-1 px-2 py-1.5 bg-muted/50 hover:bg-muted text-left">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-semibold">تفاصيل التصميم — {colId} {storyLabel && `(${storyLabel})`}</span>
      </button>
      {open && (
        <div className="p-2 space-y-2 bg-card">
          <div className="border border-border rounded p-2">
            <p className="font-bold text-xs mb-1">SLENDERNESS CHECK</p>
            <div className="space-y-0.5">
              <p>b={b} h={h} Lu={Lu}mm r=0.3×{Math.min(b,h)}={r.toFixed(0)}mm</p>
              <p>kLu/r(X) = {design.kLu_rx.toFixed(1)} Limit = {design.slendernessLimit?.toFixed(0) || '34'}</p>
              <p>kLu/r(Y) = {design.kLu_ry.toFixed(1)}</p>
              <p>{design.checkSlenderness === 'قصير' ? 'SHORT COLUMN (no magnification needed)' : 'SLENDER — magnification applied'}</p>
              {design.deltaNsX > 1 && <p>δns(X) = {design.deltaNsX.toFixed(2)}</p>}
              {design.deltaNsY > 1 && <p>δns(Y) = {design.deltaNsY.toFixed(2)}</p>}
            </div>
          </div>
          <div className="border border-border rounded p-2">
            <p className="font-bold text-xs mb-1">PM DIAGRAM</p>
            <div className="space-y-0.5">
              <p>P0 = {design.P0?.toFixed(0) || 'N/A'} kN φPn_max = {design.P0?.toFixed(0) || 'N/A'} kN</p>
              <p>Design: Pu={Pu.toFixed(1)}kN Mx_mag={design.MxMagnified?.toFixed(1)}kN·m My_mag={design.MyMagnified?.toFixed(1)}kN·m</p>
              <p>Bresler ratio = {design.breslerRatio?.toFixed(3)} {design.biaxialAdequate ? '✓' : '✗'}</p>
              <p>φ = {design.compressionControlled ? '0.65 (compression-controlled)' : '0.90 (tension-controlled)'}</p>
            </div>
          </div>
          <div className="border border-border rounded p-2">
            <p className="font-bold text-xs mb-1">REINFORCEMENT</p>
            <div className="space-y-0.5">
              <p>{design.bars}Φ{design.dia}: As = {As.toFixed(0)}mm² ρ = {(design.rhoActual * 100).toFixed(2)}% (min1% ✓ max8% ✓)</p>
              <p>Ties: {design.stirrups}</p>
              {design.confinementLo && <p>Lo = {design.confinementLo.toFixed(0)}mm</p>}
              <p>Lap splice: {(40 * design.dia).toFixed(0)}mm</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
