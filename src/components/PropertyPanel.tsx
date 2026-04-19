import React, { useState } from 'react';
import type { StructuralNode, FrameElement, AreaElement } from '@/structural/model/types';
import { ChevronUp, ChevronDown, X } from 'lucide-react';

interface PropertyPanelProps {
  selectedNode?: StructuralNode | null;
  selectedFrame?: FrameElement | null;
  selectedArea?: AreaElement | null;
  onNodeRestraintChange?: (nodeId: number, restraints: StructuralNode['restraints']) => void;
  modelStats?: { nodes: number; beams: number; columns: number; areas: number };
  onClose?: () => void;
}

export default function PropertyPanel({
  selectedNode, selectedFrame, selectedArea, onNodeRestraintChange, modelStats, onClose
}: PropertyPanelProps) {
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const hasSelection = selectedNode || selectedFrame || selectedArea;

  const content = (
    <div className="space-y-4">
      {/* Model Stats */}
      {modelStats && (
        <div className="space-y-2">
          <span className="property-label">إحصائيات النموذج</span>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>العقد<span className="property-value ml-2">{modelStats.nodes}</span></div>
            <div>الجسور<span className="property-value ml-2">{modelStats.beams}</span></div>
            <div>الأعمدة<span className="property-value ml-2">{modelStats.columns}</span></div>
            <div>البلاطات<span className="property-value ml-2">{modelStats.areas}</span></div>
          </div>
        </div>
      )}

      {/* Selected Node */}
      {selectedNode && (
        <div className="space-y-2">
          <span className="property-label">عقدة #{selectedNode.id}</span>
          <div className="space-y-1 text-xs">
            <div>X<span className="property-value ml-2">{selectedNode.x.toFixed(3)} م</span></div>
            <div>Y<span className="property-value ml-2">{selectedNode.y.toFixed(3)} م</span></div>
            <div>Z<span className="property-value ml-2">{selectedNode.z.toFixed(3)} م</span></div>
          </div>
          <span className="property-label">القيود</span>
          <div className="flex flex-wrap gap-1">
            {(['ux', 'uy', 'uz', 'rx', 'ry', 'rz'] as const).map(dof => (
              <button key={dof}
                onClick={() => onNodeRestraintChange?.(selectedNode.id, {
                  ...selectedNode.restraints,
                  [dof]: !selectedNode.restraints[dof],
                })}
                className={`text-[10px] font-mono px-2 py-1.5 rounded border transition-colors min-h-[44px] min-w-[44px] ${
                  selectedNode.restraints[dof]
                    ? 'bg-accent text-accent-foreground border-accent'
                    : 'bg-muted text-muted-foreground border-border'
                }`}
              >
                {dof.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Selected Frame */}
      {selectedFrame && (
        <div className="space-y-2">
          <span className="property-label">
            {selectedFrame.type === 'beam' ? 'جسر' : 'عمود'} #{selectedFrame.id}
          </span>
          <div className="space-y-1 text-xs">
            <div>النوع<span className="property-value ml-2">{selectedFrame.type === 'beam' ? 'جسر' : 'عمود'}</span></div>
            <div>عقدة I<span className="property-value ml-2">N{selectedFrame.nodeI}</span></div>
            <div>عقدة J<span className="property-value ml-2">N{selectedFrame.nodeJ}</span></div>
            <div>المقطع<span className="property-value ml-2">S{selectedFrame.sectionId}</span></div>
            {selectedFrame.b && selectedFrame.h && (
              <div>الأبعاد<span className="property-value ml-2">{selectedFrame.b}×{selectedFrame.h} مم</span></div>
            )}
          </div>
        </div>
      )}

      {/* Selected Area */}
      {selectedArea && (
        <div className="space-y-2">
          <span className="property-label">بلاطة #{selectedArea.id}</span>
          <div className="space-y-1 text-xs">
            <div>العقد<span className="property-value ml-2">{selectedArea.nodeIds.join(', ')}</span></div>
            <div>السماكة<span className="property-value ml-2">{selectedArea.thickness} مم</span></div>
          </div>
        </div>
      )}

      {/* Nothing selected */}
      {!selectedNode && !selectedFrame && !selectedArea && (
        <div className="text-center py-8">
          <p className="text-xs text-muted-foreground">اختر عنصراً لعرض خصائصه</p>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop: fixed right panel */}
      <div className="hidden md:block w-72 lg:w-80 border-l border-border bg-card p-3 overflow-y-auto shrink-0">
        <h3 className="text-sm font-semibold text-foreground mb-3">الخصائص</h3>
        {content}
      </div>

      {/* Mobile: slide-up drawer */}
      {hasSelection && (
        <div className={`md:hidden fixed bottom-14 left-0 right-0 z-40 bg-card border-t border-border rounded-t-xl shadow-lg transition-transform duration-300 ${
          mobileExpanded ? 'max-h-[70vh]' : 'max-h-32'
        } overflow-y-auto`}>
          <div className="flex items-center justify-between px-4 py-2 border-b border-border sticky top-0 bg-card">
            <h3 className="text-sm font-semibold text-foreground">الخصائص</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setMobileExpanded(!mobileExpanded)}
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                {mobileExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              </button>
              {onClose && (
                <button onClick={onClose} className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center">
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
          <div className="px-4 py-2">
            {content}
          </div>
        </div>
      )}
    </>
  );
}
