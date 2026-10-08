import React from 'react';
import { Crop, ScrollText, Mic, Film, Sparkles, Download } from 'lucide-react';
import { StudioTab } from '../types';

interface StudioShellProps {
  currentTab: StudioTab;
  onTabChange: (tab: StudioTab) => void;
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
  onExportClick?: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: { id: StudioTab; label: string; icon: React.FC<{ className?: string }>; hint: string }[] = [
  { id: 'recorte', label: 'Recorte', icon: Crop, hint: 'Quadros' },
  { id: 'roteiro', label: 'Roteiro', icon: ScrollText, hint: 'Texto & IA' },
  { id: 'narracao', label: 'Narração', icon: Mic, hint: 'Áudio & TTS' },
  { id: 'montagem', label: 'Montagem', icon: Film, hint: 'Timeline' },
];

export const StudioShell: React.FC<StudioShellProps> = ({
  currentTab,
  onTabChange,
  title,
  subtitle,
  actions,
  onExportClick,
  children,
}) => {
  return (
    <div className="flex min-h-screen bg-surface text-foreground font-sans">
      {/* Lateral Menu (84px width matching the model) */}
      <aside className="sticky top-0 hidden h-screen w-[84px] shrink-0 flex-col items-center gap-2 border-r border-sidebar-border bg-sidebar py-4 md:flex select-none">
        {/* Brand Icon */}
        <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-primary text-primary-foreground shadow-md shadow-primary/20">
          <Sparkles className="h-5 w-5" />
        </div>

        {/* Navigation Items */}
        {NAV_ITEMS.map((item) => {
          const isActive = currentTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`group flex w-[68px] flex-col items-center gap-1 rounded-lg px-1 py-3 text-sidebar-foreground transition-colors ${
                isActive
                  ? 'bg-sidebar-accent text-primary'
                  : 'hover:bg-sidebar-accent/60 hover:text-foreground'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="font-display text-[11px] font-semibold tracking-wide">
                {item.label}
              </span>
              <span className="text-[10px] text-muted-foreground">{item.hint}</span>
            </button>
          );
        })}
      </aside>

      {/* Main Workspace Viewport */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-20 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-bold tracking-tight text-foreground">
              {title}
            </h1>
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {actions}

            <button
              onClick={onExportClick}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 shadow-sm"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Exportar</span>
            </button>
          </div>
        </header>

        {/* Mobile Navigation bar */}
        <nav className="flex gap-1 border-b border-border bg-sidebar px-2 py-2 md:hidden">
          {NAV_ITEMS.map((item) => {
            const isActive = currentTab === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-xs font-semibold ${
                  isActive
                    ? 'bg-sidebar-accent text-primary'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Content Area */}
        <main className="min-w-0 flex-1 flex flex-col">{children}</main>
      </div>
    </div>
  );
};
