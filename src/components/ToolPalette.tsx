import React from 'react';
import {
  Box, Columns, Minus, Circle, MousePointer, Trash2, Move
} from 'lucide-react';

export type ToolType = 'select' | 'node' | 'beam' | 'column' | 'slab' | 'move' | 'delete';

interface ToolPaletteProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  mode: 'auto' | 'manual';
  onModeChange: (mode: 'auto' | 'manual') => void;
}

const tools: { id: ToolType; label: string; icon: any; manual?: boolean }[] = [
  { id: 'select', label: 'تحديد', icon: MousePointer },
  { id: 'slab', label: 'بلاطة', icon: Box },
  { id: 'beam', label: 'جسر', icon: Minus, manual: true },
  { id: 'column', label: 'عمود', icon: Columns, manual: true },
  { id: 'node', label: 'عقدة', icon: Circle, manual: true },
  { id: 'move', label: 'تحريك', icon: Move, manual: true },
  { id: 'delete', label: 'حذف', icon: Trash2 },
];

export default function ToolPalette({ activeTool, onToolChange, mode, onModeChange }: ToolPaletteProps) {
  return (
    <>
      {/* Desktop: vertical sidebar */}
      <div className="hidden md:flex flex-col w-48 border-r border-border bg-card p-3 gap-3 shrink-0">
        {/* Mode Toggle */}
        <div className="space-y-2">
          <span className="property-label">وضع النمذجة</span>
          <div className="flex gap-1">
            <button
              onClick={() => onModeChange('auto')}
              className={`flex-1 px-2 py-2 text-xs font-semibold rounded transition-colors min-h-[44px] ${
                mode === 'auto' ? 'mode-badge-auto' : 'bg-muted text-muted-foreground hover:bg-accent/20'
              }`}
            >
              تلقائي
            </button>
            <button
              onClick={() => onModeChange('manual')}
              className={`flex-1 px-2 py-2 text-xs font-semibold rounded transition-colors min-h-[44px] ${
                mode === 'manual' ? 'mode-badge-manual' : 'bg-muted text-muted-foreground hover:bg-accent/20'
              }`}
            >
              يدوي
            </button>
          </div>
        </div>

        {/* Tools */}
        <div className="space-y-1">
          <span className="property-label">الأدوات</span>
          {tools.map(tool => {
            const Icon = tool.icon;
            const disabled = tool.manual && mode === 'auto';
            return (
              <button
                key={tool.id}
                onClick={() => !disabled && onToolChange(tool.id)}
                disabled={disabled}
                className={`w-full tool-button min-h-[44px] ${
                  activeTool === tool.id ? 'tool-button-active' : ''
                } ${disabled ? 'opacity-30 cursor-not-allowed' : ''}`}
              >
                <Icon size={16 as any} />
                {tool.label}
              </button>
            );
          })}
        </div>

        {/* Info */}
        <div className="mt-auto">
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            {mode === 'auto'
              ? 'ارسم البلاطات وسيتم توليد الجسور والأعمدة تلقائياً'
              : 'أضف العناصر يدوياً: عقد، جسور، أعمدة'}
          </p>
        </div>
      </div>

      {/* Mobile: bottom horizontal toolbar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border px-2 py-1 flex gap-1 overflow-x-auto">
        {/* Mode toggle compact */}
        <button
          onClick={() => onModeChange(mode === 'auto' ? 'manual' : 'auto')}
          className={`shrink-0 px-3 py-2 text-[10px] font-semibold rounded min-h-[44px] min-w-[44px] ${
            mode === 'auto' ? 'mode-badge-auto' : 'mode-badge-manual'
          }`}
        >
          {mode === 'auto' ? 'تلقائي' : 'يدوي'}
        </button>
        <div className="w-px bg-border shrink-0" />
        {tools.map(tool => {
          const Icon = tool.icon;
          const disabled = tool.manual && mode === 'auto';
          return (
            <button
              key={tool.id}
              onClick={() => !disabled && onToolChange(tool.id)}
              disabled={disabled}
              className={`shrink-0 flex flex-col items-center justify-center px-2 py-1 rounded min-h-[44px] min-w-[44px] transition-colors ${
                activeTool === tool.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground'
              } ${disabled ? 'opacity-30' : ''}`}
            >
              <Icon size={18 as any} />
              <span className="text-[9px] mt-0.5">{tool.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
