import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Copy, Layers } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { Story } from '@/lib/structuralEngine';

interface StorySelectorProps {
  stories: Story[];
  selectedStoryId: string;
  onSelectStory: (id: string) => void;
  onAddStory: () => void;
  onRemoveStory: (id: string) => void;
  onUpdateStory: (id: string, updates: Partial<Story>) => void;
  onCopyElements: (fromId: string, toId: string) => void;
  compact?: boolean;
}

export function StorySelector({
  stories, selectedStoryId, onSelectStory, onAddStory, onRemoveStory,
  onUpdateStory, onCopyElements, compact = false,
}: StorySelectorProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-1 bg-muted/50 rounded px-2 py-1">
        <Layers size={14} className="text-muted-foreground shrink-0" />
        <select
          value={selectedStoryId}
          onChange={e => onSelectStory(e.target.value)}
          className="bg-transparent text-xs font-medium border-none outline-none cursor-pointer text-foreground"
        >
          <option value="__ALL__">جميع الأدوار</option>
          {stories.map(s => (
            <option key={s.id} value={s.id}>{s.label} ({s.height}mm)</option>
          ))}
        </select>
        <Badge variant="secondary" className="text-[9px] shrink-0">{stories.length} أدوار</Badge>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Layers size={16} className="text-muted-foreground" />
        <span className="text-sm font-medium">الأدوار ({stories.length})</span>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onAddStory}>
          <Plus size={12} />إضافة دور
        </Button>
      </div>
      <div className="flex gap-1 flex-wrap">
        <Button
          size="sm"
          variant={selectedStoryId === '__ALL__' ? 'default' : 'outline'}
          className="h-7 text-xs"
          onClick={() => onSelectStory('__ALL__')}
        >
          الكل
        </Button>
        {stories.map(s => (
          <Button
            key={s.id}
            size="sm"
            variant={selectedStoryId === s.id ? 'default' : 'outline'}
            className="h-7 text-xs"
            onClick={() => onSelectStory(s.id)}
          >
            {s.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

interface StoryManagerProps {
  stories: Story[];
  selectedStoryId: string;
  onSelectStory: (id: string) => void;
  onAddStory: () => void;
  onRemoveStory: (id: string) => void;
  onUpdateStory: (id: string, updates: Partial<Story>) => void;
  onCopyElements: (fromId: string, toId: string) => void;
}

export function StoryManager({
  stories, selectedStoryId, onSelectStory, onAddStory, onRemoveStory,
  onUpdateStory, onCopyElements,
}: StoryManagerProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold">إدارة الأدوار</span>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={onAddStory}>
          <Plus size={14} />إضافة دور
        </Button>
      </div>
      <div className="space-y-2">
        {stories.map((s, i) => (
          <div key={s.id} className={`flex items-center gap-2 p-2 rounded border ${s.id === selectedStoryId ? 'border-primary bg-primary/5' : 'border-border'}`}>
            <Button size="sm" variant={s.id === selectedStoryId ? 'default' : 'ghost'} className="h-7 text-xs" onClick={() => onSelectStory(s.id)}>
              {s.label}
            </Button>
            <Input
              value={s.label}
              onChange={e => onUpdateStory(s.id, { label: e.target.value })}
              className="h-7 w-28 text-xs"
            />
            <Input
              type="number"
              value={s.height}
              onChange={e => onUpdateStory(s.id, { height: parseFloat(e.target.value) || 3200 })}
              className="h-7 w-20 text-xs font-mono"
              title="ارتفاع الدور (مم)"
            />
            <span className="text-[10px] text-muted-foreground">مم</span>
            {i > 0 && (
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => onCopyElements(stories[0].id, s.id)} title="نسخ عناصر الدور الأول">
                <Copy size={12} />
              </Button>
            )}
            {stories.length > 1 && (
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => onRemoveStory(s.id)}>
                <Trash2 size={12} />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
