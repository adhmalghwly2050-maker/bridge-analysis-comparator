import React, { useState, useCallback } from 'react';
import { Bot, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PlanUploadPanel from './PlanUploadPanel';
import ValidationPreview from './ValidationPreview';
import { AIAssistantState, GeneratedModel, PlanAnalysisResult } from './types';
import { analyzePlan, generateDefaultAnalysis } from './planAnalyzer';
import { generateModelFromAnalysis } from './modelGenerator';
import { Slab } from '@/lib/structuralEngine';

interface AIAssistantPanelProps {
  onModelGenerated: (slabs: Slab[]) => void;
  onClose: () => void;
}

export default function AIAssistantPanel({ onModelGenerated, onClose }: AIAssistantPanelProps) {
  const [state, setState] = useState<AIAssistantState>({
    step: 'upload',
    uploadedImage: null,
    fileName: null,
    analysisResult: null,
    error: null,
  });

  const [generatedModel, setGeneratedModel] = useState<GeneratedModel | null>(null);

  const handleImageUpload = useCallback(async (dataUrl: string, fileName: string) => {
    setState(prev => ({ ...prev, step: 'analyzing', uploadedImage: dataUrl, fileName }));

    try {
      const result = await analyzePlan(dataUrl);
      const model = generateModelFromAnalysis(result);

      setState(prev => ({ ...prev, step: 'preview', analysisResult: result }));
      setGeneratedModel(model);
    } catch (err) {
      setState(prev => ({
        ...prev,
        step: 'upload',
        error: 'فشل تحليل المخطط. يرجى المحاولة مرة أخرى.\nFailed to analyze plan. Please try again.',
      }));
    }
  }, []);

  const handleGridInput = useCallback((xSpacing: number[], ySpacing: number[]) => {
    setState(prev => ({ ...prev, step: 'analyzing' }));

    try {
      const result = generateDefaultAnalysis(xSpacing, ySpacing);
      const model = generateModelFromAnalysis(result);

      setState(prev => ({ ...prev, step: 'preview', analysisResult: result }));
      setGeneratedModel(model);
    } catch (err) {
      setState(prev => ({
        ...prev,
        step: 'upload',
        error: 'فشل توليد النموذج. يرجى التحقق من المدخلات.\nFailed to generate model. Please check inputs.',
      }));
    }
  }, []);

  const handleAccept = useCallback((model: GeneratedModel) => {
    // Convert to Slab[] for the main app
    const slabs: Slab[] = model.slabs.map(s => ({
      id: s.id,
      x1: s.x1,
      y1: s.y1,
      x2: s.x2,
      y2: s.y2,
    }));

    onModelGenerated(slabs);
  }, [onModelGenerated]);

  const handleReject = useCallback(() => {
    setState({
      step: 'upload',
      uploadedImage: null,
      fileName: null,
      analysisResult: null,
      error: null,
    });
    setGeneratedModel(null);
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b border-border bg-card shrink-0">
        <Button variant="ghost" size="sm" onClick={onClose} className="min-h-[36px]">
          <ArrowLeft size={16} />
        </Button>
        <Bot size={20} className="text-accent" />
        <div>
          <h2 className="text-sm font-semibold">المساعد الإنشائي الذكي</h2>
          <p className="text-[10px] text-muted-foreground">AI Structural Assistant</p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {['upload', 'analyzing', 'preview', 'complete'].map((step, i) => (
            <div
              key={step}
              className={`w-2 h-2 rounded-full transition-colors ${
                state.step === step || ['upload', 'analyzing', 'preview', 'complete'].indexOf(state.step) > i
                  ? 'bg-accent'
                  : 'bg-muted'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {state.error && (
          <div className="m-4 p-3 rounded bg-destructive/10 border border-destructive/20 text-xs text-destructive">
            {state.error}
          </div>
        )}

        {(state.step === 'upload' || state.step === 'analyzing') && (
          <PlanUploadPanel
            onImageUpload={handleImageUpload}
            onGridInput={handleGridInput}
            isAnalyzing={state.step === 'analyzing'}
          />
        )}

        {state.step === 'preview' && state.analysisResult && generatedModel && (
          <ValidationPreview
            analysisResult={state.analysisResult}
            generatedModel={generatedModel}
            uploadedImage={state.uploadedImage}
            onAccept={handleAccept}
            onReject={handleReject}
          />
        )}
      </div>
    </div>
  );
}
