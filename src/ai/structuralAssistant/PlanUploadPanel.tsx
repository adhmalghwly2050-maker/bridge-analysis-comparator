import React, { useState, useCallback, useRef } from 'react';
import { Upload, FileImage, X, Loader2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface PlanUploadPanelProps {
  onImageUpload: (dataUrl: string, fileName: string) => void;
  onGridInput: (xSpacing: number[], ySpacing: number[]) => void;
  isAnalyzing: boolean;
}

export default function PlanUploadPanel({ onImageUpload, onGridInput, isAnalyzing }: PlanUploadPanelProps) {
  const [dragActive, setDragActive] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manual grid input
  const [gridXInput, setGridXInput] = useState('5, 5');
  const [gridYInput, setGridYInput] = useState('4, 4, 5');

  const handleFile = useCallback((file: File) => {
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      alert('يرجى تحميل ملف بصيغة PNG أو JPG أو PDF\nPlease upload a PNG, JPG, or PDF file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setPreviewUrl(dataUrl);
      setFileName(file.name);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  const handleUploadClick = () => {
    if (previewUrl && fileName) {
      onImageUpload(previewUrl, fileName);
    }
  };

  const handleGridGenerate = () => {
    const xSpacing = gridXInput.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n > 0);
    const ySpacing = gridYInput.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n > 0);
    if (xSpacing.length > 0 && ySpacing.length > 0) {
      onGridInput(xSpacing, ySpacing);
    }
  };

  return (
    <div className="space-y-4 p-4 max-w-2xl mx-auto">
      <div className="text-center mb-6">
        <h2 className="text-lg font-bold text-foreground">المساعد الإنشائي الذكي</h2>
        <h3 className="text-sm text-foreground">AI Structural Assistant</h3>
        <p className="text-xs text-muted-foreground mt-1">
          قم بتحميل مخطط معماري أو أدخل شبكة المحاور يدوياً
        </p>
        <p className="text-xs text-muted-foreground">
          Upload an architectural plan or enter grid axes manually
        </p>
      </div>

      {/* File Upload Area */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FileImage size={16} />
            تحميل المخطط المعماري / Upload Architectural Plan
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
              dragActive
                ? 'border-accent bg-accent/10'
                : 'border-border hover:border-accent/50'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.pdf"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />

            {previewUrl ? (
              <div className="space-y-3">
                <div className="relative inline-block">
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="max-h-48 mx-auto rounded border border-border"
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); setPreviewUrl(null); setFileName(null); }}
                    className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1"
                  >
                    <X size={12} />
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">{fileName}</p>
                <Button
                  onClick={(e) => { e.stopPropagation(); handleUploadClick(); }}
                  disabled={isAnalyzing}
                  className="min-h-[44px]"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 size={16} className="animate-spin mr-2" />
                      جاري التحليل... / Analyzing...
                    </>
                  ) : (
                    <>
                      <Wand2 size={16} className="mr-2" />
                      تحليل المخطط / Analyze Plan
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload size={32} className="mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  اسحب وأفلت المخطط هنا أو انقر للتحميل
                </p>
                <p className="text-xs text-muted-foreground">
                  Drag & drop or click to upload (PNG, JPG, PDF)
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Manual Grid Input */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Wand2 size={16} />
            إدخال شبكة المحاور يدوياً / Manual Grid Input
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              المسافات بين المحاور X (م) / X-axis spacings (m)
            </label>
            <Input
              value={gridXInput}
              onChange={(e) => setGridXInput(e.target.value)}
              placeholder="5, 5, 5"
              className="font-mono text-sm h-10"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              المسافات بين المحاور Y (م) / Y-axis spacings (m)
            </label>
            <Input
              value={gridYInput}
              onChange={(e) => setGridYInput(e.target.value)}
              placeholder="4, 4, 5"
              className="font-mono text-sm h-10"
            />
          </div>
          <Button
            onClick={handleGridGenerate}
            variant="outline"
            className="w-full min-h-[44px]"
            disabled={isAnalyzing}
          >
            {isAnalyzing ? (
              <><Loader2 size={16} className="animate-spin mr-2" />جاري التوليد...</>
            ) : (
              'توليد النموذج من الشبكة / Generate from Grid'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
