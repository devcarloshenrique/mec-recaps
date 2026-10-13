import React from 'react';
import { Crop, ScrollText, Mic, Film, Download, Settings, Sliders } from 'lucide-react';
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
  { id: 'recorte', label: 'RECORTE', icon: Crop, hint: 'Quadros' },
  { id: 'roteiro', label: 'ROTEIRO', icon: ScrollText, hint: 'Texto & IA' },
  { id: 'narracao', label: 'NARRAÇÃO', icon: Mic, hint: 'Voz & TTS' },
  { id: 'montagem', label: 'TIMELINE', icon: Film, hint: 'Exportação' },
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
      {/* Lateral Menu (78px width matching the reference dock) */}
      <aside className="sticky top-0 hidden h-screen w-[78px] shrink-0 flex-col items-center justify-between border-r border-sidebar-border bg-sidebar py-3.5 md:flex select-none z-30">
        <div className="flex w-full flex-col items-center gap-3">
          {/* Brand Mark (4-dot neon grid inspired directly by the reference) */}
          <div
            className="group relative mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-card border border-white/10 shadow-lg shadow-black/50 transition-all hover:border-cyan-400/40 hover:scale-105 cursor-pointer"
            title="MEC Recap Studio"
          >
            <div className="grid grid-cols-2 gap-1.5 p-1">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
              <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-400 shadow-[0_0_8px_#e879f9]" />
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 shadow-[0_0_8px_#818cf8]" />
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
            </div>
          </div>

          {/* Navigation Items */}
          <div className="flex w-full flex-col items-center gap-1.5 px-1.5">
            {NAV_ITEMS.map((item) => {
              const isActive = currentTab === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`group relative flex w-full flex-col items-center gap-1 rounded-xl py-2.5 transition-all ${
                    isActive
                      ? 'bg-card text-white border border-white/10 shadow-md shadow-black/50 ring-1 ring-white/5'
                      : 'text-muted-foreground hover:bg-white/[0.04] hover:text-white'
                  }`}
                  title={`${item.label} · ${item.hint}`}
                >
                  {/* Active Neon Cyan Pill Indicator */}
                  {isActive && (
                    <span className="absolute -left-1.5 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_10px_var(--color-primary)]" />
                  )}

                  <Icon
                    className={`h-4.5 w-4.5 transition-transform group-hover:scale-110 ${
                      isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-white'
                    }`}
                  />
                  <span className="font-display text-[9.5px] font-bold tracking-wider uppercase">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Bottom Utility Shortcuts (Settings / Tools from reference) */}
        <div className="flex flex-col items-center gap-1 pt-3 border-t border-white/[0.06] w-full px-2 text-muted-foreground">
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/[0.05] hover:text-white transition-colors"
            title="Configurações do Studio"
          >
            <Settings className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/[0.05] hover:text-white transition-colors"
            title="Calibração de Enquadramento"
          >
            <Sliders className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {/* Main Workspace Viewport */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header (Inspired by reference topbar) */}
        <header className="sticky top-0 z-20 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border/80 bg-background/90 px-4 py-2.5 backdrop-blur-xl sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate font-display text-sm sm:text-base font-bold tracking-tight text-white">
                  {title}
                </h1>
                <span className="hidden md:inline-flex items-center rounded-md bg-white/[0.04] border border-white/10 px-2 py-0.5 text-[9.5px] font-mono font-semibold tracking-wider text-muted-foreground uppercase">
                  16:9 · RECAP HD
                </span>
              </div>
              <p className="truncate text-[11px] text-muted-foreground/80 mt-0.5">{subtitle}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
            {actions}

            {/* High-Contrast Primary CTA (Electric Cyan DOWNLOAD/EXPORTAR Button) */}
            <button
              onClick={onExportClick}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 px-3.5 py-1.5 sm:px-4 sm:py-2 text-xs font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition-all hover:shadow-cyan-400/40 hover:brightness-110 active:scale-[0.98] cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4 stroke-[2.5]" />
              <span className="tracking-tight uppercase">Exportar</span>
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
                    ? 'bg-card text-primary border border-white/10'
                    : 'text-sidebar-foreground hover:bg-white/[0.04]'
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
