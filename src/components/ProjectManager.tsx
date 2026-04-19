import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Plus, FolderOpen, Save, Download, Upload, Trash2, Copy,
  FileText, Calendar, Building2, AlertTriangle, Check
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface SavedProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  slabCount: number;
  storyCount: number;
  data: any; // serialized AppState
}

const STORAGE_KEY = 'gde_projects';
const ACTIVE_KEY = 'gde_active_project';

function generateId() {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getSavedProjects(): SavedProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveProjects(projects: SavedProject[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

function getActiveProjectId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

function setActiveProjectId(id: string | null) {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
}

interface ProjectManagerProps {
  currentState: any;
  onLoadProject: (data: any) => void;
  onNewProject: () => void;
  storyCount: number;
  slabCount: number;
}

export default function ProjectManager({
  currentState, onLoadProject, onNewProject, storyCount, slabCount
}: ProjectManagerProps) {
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [activeProjectId, setActiveId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [saveAsName, setSaveAsName] = useState('');

  useEffect(() => {
    setProjects(getSavedProjects());
    setActiveId(getActiveProjectId());
  }, []);

  const showMsg = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 2500);
  };

  // Get serializable state (exclude undoStack and UI-only fields)
  const getSerializableState = useCallback(() => {
    const { undoStack, modalOpen, selectedElement, elemPropsOpen, diagramOpen, diagramData, savedMessage, elemPropsFrameId, elemPropsAreaId, ...rest } = currentState;
    return {
      ...rest,
      _exportVersion: 2,
      _exportDate: new Date().toISOString(),
    };
  }, [currentState]);

  // Create new project
  const handleNewProject = () => {
    if (!newProjectName.trim()) return;
    const proj: SavedProject = {
      id: generateId(),
      name: newProjectName.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      slabCount: 0,
      storyCount: 1,
      data: null, // will be filled on first save
    };
    const updated = [proj, ...projects];
    saveProjects(updated);
    setProjects(updated);
    setActiveId(proj.id);
    setActiveProjectId(proj.id);
    setNewProjectName('');
    setShowNewDialog(false);
    onNewProject();
    showMsg('تم إنشاء مشروع جديد ✓');
  };

  // Save current project
  const handleSave = () => {
    if (!activeProjectId) {
      setShowSaveAs(true);
      return;
    }
    const updated = projects.map(p => {
      if (p.id === activeProjectId) {
        return {
          ...p,
          updatedAt: new Date().toISOString(),
          slabCount,
          storyCount,
          data: getSerializableState(),
        };
      }
      return p;
    });
    saveProjects(updated);
    setProjects(updated);
    showMsg('تم حفظ المشروع ✓');
  };

  // Save as new project
  const handleSaveAs = () => {
    if (!saveAsName.trim()) return;
    const proj: SavedProject = {
      id: generateId(),
      name: saveAsName.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      slabCount,
      storyCount,
      data: getSerializableState(),
    };
    const updated = [proj, ...projects];
    saveProjects(updated);
    setProjects(updated);
    setActiveId(proj.id);
    setActiveProjectId(proj.id);
    setSaveAsName('');
    setShowSaveAs(false);
    showMsg('تم حفظ المشروع كنسخة جديدة ✓');
  };

  // Open project
  const handleOpen = (proj: SavedProject) => {
    if (!proj.data) {
      showMsg('المشروع فارغ - لم يتم حفظ بيانات بعد');
      return;
    }
    setActiveId(proj.id);
    setActiveProjectId(proj.id);
    onLoadProject(proj.data);
    showMsg(`تم فتح: ${proj.name}`);
  };

  // Delete project
  const handleDelete = (id: string) => {
    const updated = projects.filter(p => p.id !== id);
    saveProjects(updated);
    setProjects(updated);
    if (activeProjectId === id) {
      setActiveId(null);
      setActiveProjectId(null);
    }
    setDeleteConfirm(null);
    showMsg('تم حذف المشروع');
  };

  // Backup (download as JSON)
  const handleBackup = (proj: SavedProject) => {
    const blob = new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${proj.name.replace(/\s+/g, '_')}_backup.json`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
    showMsg('تم تنزيل النسخة الاحتياطية ✓');
  };

  // Backup all projects
  const handleBackupAll = () => {
    const blob = new Blob([JSON.stringify(projects, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `all_projects_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
    showMsg('تم تنزيل نسخة احتياطية لجميع المشاريع ✓');
  };

  // Import project from file
  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target?.result as string);
          // Check if it's an array (all projects backup) or single project
          if (Array.isArray(parsed)) {
            // Import all projects, avoiding duplicates by id
            const existingIds = new Set(projects.map(p => p.id));
            const newProjects = parsed.filter((p: SavedProject) => !existingIds.has(p.id));
            const updated = [...newProjects, ...projects];
            saveProjects(updated);
            setProjects(updated);
            showMsg(`تم استيراد ${newProjects.length} مشروع ✓`);
          } else if (parsed.id && parsed.name) {
            // Single project
            const exists = projects.find(p => p.id === parsed.id);
            if (exists) {
              parsed.id = generateId(); // assign new id to avoid collision
            }
            const updated = [parsed, ...projects];
            saveProjects(updated);
            setProjects(updated);
            showMsg(`تم استيراد: ${parsed.name} ✓`);
          } else {
            showMsg('ملف غير صالح');
          }
        } catch {
          showMsg('خطأ في قراءة الملف');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // Quick save current work to active project
  const handleQuickSave = () => {
    if (activeProjectId) {
      handleSave();
    } else {
      setShowSaveAs(true);
    }
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  };

  return (
    <div className="page-content p-4 space-y-4" dir="rtl">
      {/* Status message */}
      {message && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-accent text-accent-foreground px-4 py-2 rounded-xl shadow-lg text-sm font-bold flex items-center gap-2 animate-in fade-in">
          <Check size={16} /> {message}
        </div>
      )}

      {/* Active project indicator */}
      <div className="section-card">
        <div className="section-card-header">
          <Building2 size={18} className="text-accent" />
          <span>المشروع الحالي</span>
        </div>
        <div className="section-card-content">
          {activeProjectId ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-foreground">
                  {projects.find(p => p.id === activeProjectId)?.name || 'مشروع غير محفوظ'}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {storyCount} أدوار · {slabCount} بلاطات
                </p>
              </div>
              <Button onClick={handleQuickSave} size="sm" className="gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90">
                <Save size={14} /> حفظ
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">لا يوجد مشروع نشط - احفظ عملك الحالي</p>
              <Button onClick={() => setShowSaveAs(true)} size="sm" variant="outline" className="gap-1.5">
                <Save size={14} /> حفظ باسم
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => setShowNewDialog(true)} className="btn-primary-action gap-2">
          <Plus size={18} /> مشروع جديد
        </button>
        <button onClick={handleImport} className="btn-secondary-action gap-2">
          <Upload size={18} /> استيراد نسخة
        </button>
      </div>

      {projects.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={handleBackupAll} variant="outline" size="sm" className="gap-1.5 text-xs">
            <Download size={14} /> نسخة احتياطية للكل
          </Button>
        </div>
      )}

      {/* Projects list */}
      <div className="section-card">
        <div className="section-card-header">
          <FolderOpen size={18} className="text-accent" />
          <span>المشاريع المحفوظة</span>
          <Badge variant="secondary" className="mr-auto text-[10px]">{projects.length}</Badge>
        </div>
        <div className="section-card-content space-y-3">
          {projects.length === 0 ? (
            <div className="text-center py-8">
              <FolderOpen size={40} className="mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">لا توجد مشاريع محفوظة</p>
              <p className="text-xs text-muted-foreground mt-1">أنشئ مشروعاً جديداً أو استورد نسخة احتياطية</p>
            </div>
          ) : (
            projects.map(proj => (
              <div
                key={proj.id}
                className={`rounded-xl border p-3 transition-all ${
                  proj.id === activeProjectId
                    ? 'border-accent bg-accent/5 shadow-sm'
                    : 'border-border bg-card hover:border-accent/30'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-sm truncate">{proj.name}</h3>
                      {proj.id === activeProjectId && (
                        <Badge className="bg-accent text-accent-foreground text-[9px] px-1.5 py-0">نشط</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar size={11} /> {formatDate(proj.updatedAt)}
                      </span>
                      <span>{proj.storyCount} أدوار</span>
                      <span>{proj.slabCount} بلاطات</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Button
                    size="sm"
                    variant={proj.id === activeProjectId ? "default" : "outline"}
                    className="flex-1 h-8 text-xs gap-1"
                    onClick={() => handleOpen(proj)}
                    disabled={proj.id === activeProjectId}
                  >
                    <FolderOpen size={13} /> {proj.id === activeProjectId ? 'مفتوح' : 'فتح'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1"
                    onClick={() => handleBackup(proj)}
                  >
                    <Download size={13} />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1 text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteConfirm(proj.id)}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* New Project Dialog */}
      <AlertDialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>مشروع جديد</AlertDialogTitle>
            <AlertDialogDescription>
              أدخل اسم المشروع الجديد. سيتم البدء ببيانات افتراضية.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            placeholder="اسم المشروع..."
            value={newProjectName}
            onChange={e => setNewProjectName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleNewProject()}
            className="text-right"
            autoFocus
          />
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogAction onClick={handleNewProject} disabled={!newProjectName.trim()}>
              إنشاء
            </AlertDialogAction>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Save As Dialog */}
      <AlertDialog open={showSaveAs} onOpenChange={setShowSaveAs}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حفظ المشروع</AlertDialogTitle>
            <AlertDialogDescription>
              أدخل اسماً للمشروع لحفظه.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            placeholder="اسم المشروع..."
            value={saveAsName}
            onChange={e => setSaveAsName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveAs()}
            className="text-right"
            autoFocus
          />
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogAction onClick={handleSaveAs} disabled={!saveAsName.trim()}>
              حفظ
            </AlertDialogAction>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle size={20} className="text-destructive" />
              حذف المشروع
            </AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف هذا المشروع؟ لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogAction
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              حذف
            </AlertDialogAction>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
