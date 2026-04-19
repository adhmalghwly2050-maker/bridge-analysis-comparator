import { Compass } from 'lucide-react';

interface AppHeaderProps {
  title?: string;
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
}

export default function AppHeader({ title = 'Structural Master', leftSlot, rightSlot }: AppHeaderProps) {
  return (
    <header className="app-header">
      {leftSlot || <div className="w-8 h-8 rounded-lg bg-primary-foreground/20 flex items-center justify-center shrink-0">
        <Compass size={18} />
      </div>}
      <h1 className="app-header-title flex-1 text-center">{title}</h1>
      {rightSlot || <div className="w-8 h-8 rounded-lg bg-primary-foreground/10 flex items-center justify-center shrink-0">
        <Compass size={16} />
      </div>}
    </header>
  );
}
