import { FileText, Settings2, Compass, FolderOpen, Cpu } from 'lucide-react';

export type MainTab = 'reports' | 'inputs' | 'modeling' | 'projects' | 'solver';

interface BottomNavProps {
  activeTab: MainTab;
  onTabChange: (tab: MainTab) => void;
}

const tabs: { id: MainTab; label: string; icon: typeof FileText }[] = [
  { id: 'projects', label: 'PROJECTS', icon: FolderOpen },
  { id: 'inputs', label: 'INPUTS', icon: Settings2 },
  { id: 'modeling', label: 'MODELING', icon: Compass },
  { id: 'solver', label: 'SOLVER', icon: Cpu },
  { id: 'reports', label: 'REPORTS', icon: FileText },
];

export default function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return (
    <nav className="bottom-nav">
      {tabs.map(tab => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`bottom-nav-item ${isActive ? 'active' : ''}`}
          >
            <span className={isActive ? 'bottom-nav-icon' : ''}>
              <Icon size={20} strokeWidth={isActive ? 2.5 : 1.5} />
            </span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
