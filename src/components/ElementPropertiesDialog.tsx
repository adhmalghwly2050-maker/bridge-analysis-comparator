import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import type { FrameElement, AreaElement, StructuralNode } from '@/structural/model/types';

interface EndRelease {
  ux: boolean; uy: boolean; uz: boolean;
  rx: boolean; ry: boolean; rz: boolean;
}

interface SlabPropsData {
  thickness: number;
  finishLoad: number;
  liveLoad: number;
  cover: number;
}

interface ElementPropertiesDialogProps {
  open: boolean;
  onClose: () => void;
  frame?: FrameElement | null;
  area?: AreaElement | null;
  nodeI?: StructuralNode | null;
  nodeJ?: StructuralNode | null;
  slabProps?: SlabPropsData | null;
  onSave: (data: {
    frameId?: number;
    areaId?: number;
    b?: number;
    h?: number;
    thickness?: number;
    finishLoad?: number;
    liveLoad?: number;
    cover?: number;
    nodeIRestraints?: EndRelease;
    nodeJRestraints?: EndRelease;
  }) => void;
  onDelete?: (data: { frameId?: number; areaId?: number }) => void;
}

export default function ElementPropertiesDialog({
  open, onClose, frame, area, nodeI, nodeJ, slabProps, onSave, onDelete
}: ElementPropertiesDialogProps) {
  const [b, setB] = useState(0);
  const [h, setH] = useState(0);
  const [thickness, setThickness] = useState(0);
  const [finishLoad, setFinishLoad] = useState(0);
  const [liveLoad, setLiveLoad] = useState(0);
  const [cover, setCover] = useState(0);
  const [releaseI, setReleaseI] = useState<EndRelease>({ ux: false, uy: false, uz: false, rx: false, ry: false, rz: false });
  const [releaseJ, setReleaseJ] = useState<EndRelease>({ ux: false, uy: false, uz: false, rx: false, ry: false, rz: false });
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setConfirmDelete(false);
    if (frame) {
      setB(frame.b || 200);
      setH(frame.h || 400);
    }
    if (area) {
      setThickness(area.thickness);
    }
    if (slabProps && area) {
      setFinishLoad(slabProps.finishLoad);
      setLiveLoad(slabProps.liveLoad);
      setCover(slabProps.cover);
      setThickness(slabProps.thickness);
    }
    if (nodeI) setReleaseI({ ...nodeI.restraints });
    if (nodeJ) setReleaseJ({ ...nodeJ.restraints });
  }, [frame, area, nodeI, nodeJ, slabProps]);

  const handleSave = () => {
    if (frame) {
      onSave({
        frameId: frame.id,
        b, h,
        nodeIRestraints: releaseI,
        nodeJRestraints: releaseJ,
      });
    } else if (area) {
      onSave({ areaId: area.id, thickness, finishLoad, liveLoad, cover });
    }
    onClose();
  };

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    if (onDelete) {
      if (frame) onDelete({ frameId: frame.id });
      else if (area) onDelete({ areaId: area.id });
    }
    onClose();
  };

  const handleClose = () => {
    setConfirmDelete(false);
    onClose();
  };

  const isBeam = frame?.type === 'beam';
  const isColumn = frame?.type === 'column';
  const isArea = !!area;

  const title = isBeam ? `خصائص الجسر B${frame?.id}` :
    isColumn ? `خصائص العمود C${frame?.id}` :
    isArea ? `خصائص البلاطة A${area?.id}` : 'خصائص العنصر';

  const elementTypeLabel = isBeam ? 'الجسر' : isColumn ? 'العمود' : 'البلاطة';

  const ReleaseToggle = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-mono">{label}</span>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            تعديل خصائص وأبعاد العنصر وحرية الأطراف
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Dimensions */}
          {(isBeam || isColumn) && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-foreground">الأبعاد (مم)</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">العرض b</label>
                  <Input type="number" value={b} onChange={e => setB(Number(e.target.value))} className="h-10 font-mono text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">الارتفاع h</label>
                  <Input type="number" value={h} onChange={e => setH(Number(e.target.value))} className="h-10 font-mono text-sm" />
                </div>
              </div>
              {nodeI && (
                <div className="text-xs text-muted-foreground">
                  <span>الطول: </span>
                  <span className="font-mono">
                    {nodeI && nodeJ ? Math.sqrt((nodeJ.x - nodeI.x) ** 2 + (nodeJ.y - nodeI.y) ** 2 + (nodeJ.z - nodeI.z) ** 2).toFixed(3) : '—'} م
                  </span>
                </div>
              )}
            </div>
          )}

          {isArea && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-foreground">خصائص البلاطة</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">السماكة (مم)</label>
                  <Input type="number" value={thickness} onChange={e => setThickness(Number(e.target.value))} className="h-10 font-mono text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">الغطاء (مم)</label>
                  <Input type="number" value={cover} onChange={e => setCover(Number(e.target.value))} className="h-10 font-mono text-sm" />
                </div>
              </div>
              
              <h4 className="text-sm font-semibold text-foreground mt-3">الأحمال المسلطة</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">أحمال التشطيب (kN/m²)</label>
                  <Input type="number" value={finishLoad} onChange={e => setFinishLoad(Number(e.target.value))} className="h-10 font-mono text-sm" step="0.1" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">الحمل الحي (kN/m²)</label>
                  <Input type="number" value={liveLoad} onChange={e => setLiveLoad(Number(e.target.value))} className="h-10 font-mono text-sm" step="0.1" />
                </div>
              </div>

              <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">الوزن الذاتي</span>
                  <span className="font-mono">{(thickness / 1000 * 25).toFixed(2)} kN/m²</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">إجمالي الحمل الميت</span>
                  <span className="font-mono">{(thickness / 1000 * 25 + finishLoad).toFixed(2)} kN/m²</span>
                </div>
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-muted-foreground">الحمل النهائي (1.2D + 1.6L)</span>
                  <span className="font-mono">{(1.2 * (thickness / 1000 * 25 + finishLoad) + 1.6 * liveLoad).toFixed(2)} kN/m²</span>
                </div>
              </div>
            </div>
          )}

          {/* End releases for frames - ETABS style */}
          {frame && nodeI && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                تحرير الطرف I (بداية العنصر)
                <Badge variant="outline" className="text-[10px]">N{frame.nodeI}</Badge>
              </h4>
              <p className="text-[10px] text-muted-foreground">U = إزاحة (قوة)، R = دوران (عزم) — مثل ETABS</p>
              <div className="grid grid-cols-3 gap-2 bg-muted/50 rounded-lg p-3">
                {([
                  { key: 'ux', label: 'U1', desc: 'محوري' },
                  { key: 'uy', label: 'U2', desc: 'قص رئيسي' },
                  { key: 'uz', label: 'U3', desc: 'قص ثانوي' },
                  { key: 'rx', label: 'R1', desc: 'لَي' },
                  { key: 'ry', label: 'R2', desc: 'عزم M22' },
                  { key: 'rz', label: 'R3', desc: 'عزم M33' },
                ] as const).map(({ key, label, desc }) => (
                  <div key={`i-${key}`} className="flex flex-col items-center gap-0.5">
                    <ReleaseToggle label={`${label}`}
                      value={releaseI[key]}
                      onChange={v => setReleaseI(prev => ({ ...prev, [key]: v }))} />
                    <span className="text-[8px] text-muted-foreground">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {frame && nodeJ && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                تحرير الطرف J (نهاية العنصر)
                <Badge variant="outline" className="text-[10px]">N{frame.nodeJ}</Badge>
              </h4>
              <div className="grid grid-cols-3 gap-2 bg-muted/50 rounded-lg p-3">
                {([
                  { key: 'ux', label: 'U1', desc: 'محوري' },
                  { key: 'uy', label: 'U2', desc: 'قص رئيسي' },
                  { key: 'uz', label: 'U3', desc: 'قص ثانوي' },
                  { key: 'rx', label: 'R1', desc: 'لَي' },
                  { key: 'ry', label: 'R2', desc: 'عزم M22' },
                  { key: 'rz', label: 'R3', desc: 'عزم M33' },
                ] as const).map(({ key, label, desc }) => (
                  <div key={`j-${key}`} className="flex flex-col items-center gap-0.5">
                    <ReleaseToggle label={`${label}`}
                      value={releaseJ[key]}
                      onChange={v => setReleaseJ(prev => ({ ...prev, [key]: v }))} />
                    <span className="text-[8px] text-muted-foreground">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ETABS instability warnings */}
          {frame && (() => {
            const warnings: string[] = [];
            if (releaseI.ux && releaseJ.ux) warnings.push('⚠️ لا يمكن تحرير U1 (محوري) من كلا الطرفين — عدم استقرار');
            if (releaseI.uy && releaseJ.uy) warnings.push('⚠️ لا يمكن تحرير U2 (قص) من كلا الطرفين — عدم استقرار');
            if (releaseI.uz && releaseJ.uz) warnings.push('⚠️ لا يمكن تحرير U3 (قص) من كلا الطرفين — عدم استقرار');
            if (releaseI.rx && releaseJ.rx) warnings.push('⚠️ لا يمكن تحرير R1 (لَي) من كلا الطرفين — عدم استقرار');
            if (releaseI.ry && releaseJ.ry && (releaseI.uz || releaseJ.uz))
              warnings.push('⚠️ R2 من كلا الطرفين مع U3 — عدم استقرار');
            if (releaseI.rz && releaseJ.rz && (releaseI.uy || releaseJ.uy))
              warnings.push('⚠️ R3 من كلا الطرفين مع U2 — عدم استقرار');
            if (warnings.length === 0) return null;
            return (
              <div className="space-y-1 bg-destructive/10 border border-destructive/30 rounded-lg p-3">
                {warnings.map((w, i) => (
                  <p key={i} className="text-xs text-destructive font-medium">{w}</p>
                ))}
              </div>
            );
          })()}

          {/* Delete confirmation message */}
          {confirmDelete && (
            <div className="bg-destructive/10 border border-destructive/40 rounded-lg p-3">
              <p className="text-sm text-destructive font-medium text-center">
                ⚠️ هل أنت متأكد من حذف {elementTypeLabel}؟
              </p>
              <p className="text-xs text-muted-foreground text-center mt-1">
                اضغط "حذف العنصر" مرة أخرى للتأكيد
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:gap-0">
          {/* Delete button - shown when onDelete is provided */}
          {onDelete && (
            <Button
              variant={confirmDelete ? "destructive" : "outline"}
              onClick={handleDelete}
              className={`min-h-[44px] sm:mr-auto border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground ${confirmDelete ? '' : 'hover:border-destructive'}`}
            >
              {confirmDelete ? '⚠️ تأكيد الحذف' : '🗑️ حذف العنصر'}
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose} className="min-h-[44px]">إلغاء</Button>
            <Button onClick={handleSave} className="min-h-[44px]">حفظ التغييرات</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
