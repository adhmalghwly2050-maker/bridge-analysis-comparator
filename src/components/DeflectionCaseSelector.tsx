import React from 'react';
import type { DeflectionCase } from '@/lib/structuralEngine';

interface DeflectionCaseSelectorProps {
  value: DeflectionCase;
  onChange: (v: DeflectionCase) => void;
}

const CASES: { key: DeflectionCase; ratio: number; desc: string; descAr: string }[] = [
  { key: 'A', ratio: 180, desc: 'Flat roofs, no brittle finish', descAr: 'أسقف مسطحة، بدون تشطيبات هشة' },
  { key: 'B', ratio: 240, desc: 'Floors, no brittle finish', descAr: 'أرضيات، بدون تشطيبات هشة' },
  { key: 'C', ratio: 360, desc: 'Floors supporting plaster/brittle finish', descAr: 'أرضيات تحمل تشطيبات هشة' },
  { key: 'D', ratio: 480, desc: 'Floors + roof, brittle finish critical', descAr: 'أرضيات + سقف، تشطيبات هشة حرجة' },
];

export default function DeflectionCaseSelector({ value, onChange }: DeflectionCaseSelectorProps) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">حد الترخيم (ACI Table 24.2.2)</label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
        {CASES.map(c => (
          <button
            key={c.key}
            onClick={() => onChange(c.key)}
            className={`text-left px-2 py-1.5 rounded border text-[11px] transition-colors ${
              value === c.key 
                ? 'border-primary bg-primary/10 font-medium' 
                : 'border-border hover:border-primary/50'
            }`}
          >
            <span className="font-bold">Case {c.key}</span> — L/{c.ratio}
            <br />
            <span className="text-muted-foreground">{c.descAr}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
