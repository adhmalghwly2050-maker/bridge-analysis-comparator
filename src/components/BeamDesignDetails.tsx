import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Check, X } from 'lucide-react';
import type { FlexureResult, ShearResult, DeflectionResult } from '@/lib/structuralEngine';

interface BeamDesignDetailsProps {
  beamId: string;
  b: number;
  h: number;
  span: number;
  fc: number;
  fy: number;
  flexLeft: FlexureResult;
  flexMid: FlexureResult;
  flexRight: FlexureResult;
  shear: ShearResult;
  deflection: DeflectionResult;
  Mu_max: number;
  Vu: number;
  governingCombo?: string;
}

export default function BeamDesignDetails({
  beamId, b, h, span, fc, fy, flexLeft, flexMid, flexRight, shear, deflection, Mu_max, Vu, governingCombo,
}: BeamDesignDetailsProps) {
  const [open, setOpen] = useState(false);
  const d = h - 46;
  const beta1 = fc <= 28 ? 0.85 : Math.max(0.65, 0.85 - 0.05 * (fc - 28) / 7);
  const rhoMin = Math.max(0.25 * Math.sqrt(fc) / fy, 1.4 / fy);
  const rhoMax = 0.85 * beta1 * fc / fy * 0.003 / (0.003 + 0.005);
  const Ru = Mu_max * 1e6 / (0.9 * b * d * d);
  const As_req = flexMid.As;
  const aBar = Math.PI * flexMid.dia * flexMid.dia / 4;
  const As_prov = flexMid.bars * aBar;
  const a = As_prov * fy / (0.85 * fc * b);
  const c = a / beta1;
  const epsilonT = c > 0 ? 0.003 * (d - c) / c : 0.03;
  const tensionControlled = epsilonT > 0.005;
  const Ec = 4700 * Math.sqrt(fc);
  const n = 200000 / Ec;
  const fr = 0.62 * Math.sqrt(fc);
  const Ig = b * h * h * h / 12;
  const Mcr = fr * Ig / (h / 2) / 1e6;
  const sMax = shear.Vs <= (1 / 3) * Math.sqrt(fc) * b * d / 1000 ? Math.min(d / 2, 600) : Math.min(d / 4, 300);

  return (
    <div className="border border-border rounded-md overflow-hidden text-[11px] font-mono">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-1 px-2 py-1.5 bg-muted/50 hover:bg-muted text-left">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-semibold">تفاصيل التصميم — {beamId}</span>
      </button>
      {open && (
        <div className="p-2 space-y-2 bg-card">
          {/* Flexure */}
          <div className="border border-border rounded p-2">
            <p className="font-bold text-xs mb-1">FLEXURE DETAILS</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-0.5">
              <span>fc={fc}MPa</span><span>fy={fy}MPa</span>
              <span>β₁={beta1.toFixed(2)}</span><span>φ=0.90</span>
              <span>b={b}mm</span><span>d={d}mm</span>
              <span>h={h}mm</span><span>cover=40mm</span>
            </div>
            <div className="mt-1 space-y-0.5">
              <p>Mu_max = {Mu_max.toFixed(1)} kN·m {governingCombo && <span className="text-muted-foreground">[{governingCombo}]</span>}</p>
              <p>ρ_min = {rhoMin.toFixed(5)} ρ_max = {rhoMax.toFixed(5)} ρ_used = {flexMid.rho?.toFixed(5) || 'N/A'}</p>
              <p>Ru = {Ru.toFixed(2)} MPa</p>
              <p>Required As = {As_req.toFixed(0)} mm² → {flexMid.bars}Φ{flexMid.dia} = {As_prov.toFixed(0)} mm²</p>
              <p>εt = {epsilonT.toFixed(4)} {tensionControlled ? <span className="text-green-600">(Tension-controlled ✓ εt {'>'} 0.005)</span> : <span className="text-amber-600">(Compression-controlled)</span>}</p>
              <p>Compression steel: {flexMid.rho && flexMid.rho > rhoMax ? 'REQUIRED' : 'NOT REQUIRED'} (ρ {'<'} ρmax)</p>
            </div>
          </div>
          {/* Shear */}
          <div className="border border-border rounded p-2">
            <p className="font-bold text-xs mb-1">SHEAR DETAILS</p>
            <div className="space-y-0.5">
              <p>Vu = {Math.abs(Vu).toFixed(1)} kN @ d from face</p>
              <p>Vc (simplified) = {shear.Vc_simplified?.toFixed(1) || shear.Vc.toFixed(1)} kN</p>
              <p>Vc (Table 22.5.5.1) = {shear.Vc_detailed?.toFixed(1) || 'N/A'} kN {shear.Vc_detailed && shear.Vc_detailed > (shear.Vc_simplified || 0) ? '← governing' : ''}</p>
              <p>Vs required = {shear.Vs.toFixed(1)} kN Vs max = {((2/3) * Math.sqrt(fc) * b * d / 1000).toFixed(1)} kN {shear.Vs <= (2/3) * Math.sqrt(fc) * b * d / 1000 ? '✓' : '✗'}</p>
              <p>Stirrups: {shear.stirrups} (s_max = {sMax.toFixed(0)}mm)</p>
            </div>
          </div>
          {/* Deflection */}
          <div className="border border-border rounded p-2">
            <p className="font-bold text-xs mb-1">DEFLECTION DETAILS</p>
            <div className="space-y-0.5">
              <p>Ec = {Ec.toFixed(0)} MPa n = Es/Ec = {n.toFixed(2)}</p>
              <p>fr = {fr.toFixed(2)} MPa Ig = {(Ig/1e6).toFixed(0)}×10⁶ mm⁴ Mcr = {Mcr.toFixed(1)} kN·m</p>
              <p>Δ = {deflection.deflection.toFixed(1)} mm Limit {deflection.limitUsed} = {deflection.allowableDeflection.toFixed(1)} mm {deflection.isServiceable ? <span className="text-green-600">✓</span> : <span className="text-red-600">✗</span>}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
