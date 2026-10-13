import React, { useState, useRef, useEffect } from 'react';
import {
  Crop,
  ScrollText,
  Mic,
  Film,
  Download,
  Settings,
  Sliders,
  Save,
  Plus,
  FolderUp,
  RotateCcw,
  Sparkles,
  Trash2,
  HelpCircle,
  Maximize2,
  Grid,
  ArrowRightLeft,
  SlidersHorizontal,
  RefreshCw,
  AlertCircle,
  Info,
  Check,
} from 'lucide-react';
import { StudioTab } from '../types';

export interface StudioShellProps {
  currentTab: StudioTab;
  onTabChange: (tab: StudioTab) => void;
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
  onExportClick?: () => void;
  onNewProject?: () => void;
  onImportFolder?: () => void;
  onLoadDemo?: () => void;
  onSave?: () => void;
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt?: number | null;
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
  onNewProject,
  onImportFolder,
  onLoadDemo,
  onSave,
  saveStatus = 'saved',
  lastSavedAt,
  children,
}) => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const menuBarRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside or Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenu(null);
        setIsAboutModalOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const triggerShortcut = (key: string, options: { ctrlKey?: boolean; shiftKey?: boolean } = {}) => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        code: key === ' ' ? 'Space' : undefined,
        ctrlKey: options.ctrlKey,
        metaKey: options.ctrlKey,
        shiftKey: options.shiftKey,
        bubbles: true,
      })
    );
    setOpenMenu(null);
  };

  const handleMenuHover = (menuKey: string) => {
    if (openMenu !== null) {
      setOpenMenu(menuKey);
    }
  };

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
            onClick={() => triggerShortcut('p')}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/[0.05] hover:text-white transition-colors cursor-pointer"
            title="Janela Flutuante de Propriedades (P)"
          >
            <Sliders className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setIsAboutModalOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/[0.05] hover:text-white transition-colors cursor-pointer"
            title="Sobre o FrameBatch Studio"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {/* Main Workspace Viewport */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ======================================================== */}
        {/* TOP MENU BAR (Modeled directly after Adobe Photoshop)    */}
        {/* ======================================================== */}
        <header
          ref={menuBarRef}
          className="sticky top-0 z-40 h-10 w-full border-b border-border/80 bg-[#14151e] px-3 flex items-center justify-between text-xs select-none backdrop-blur-xl"
        >
          {/* Left: Top Menus (Arquivo, Editar, Imagem, Exibir, Janela, Ajuda) */}
          <div className="flex items-center gap-0.5 min-w-0">
            {/* Menu 1: Arquivo (File) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenMenu(openMenu === 'arquivo' ? null : 'arquivo')}
                onMouseEnter={() => handleMenuHover('arquivo')}
                className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                  openMenu === 'arquivo'
                    ? 'bg-white/15 text-white font-medium'
                    : 'text-gray-300 hover:text-white hover:bg-white/[0.08]'
                }`}
              >
                Arquivo
              </button>

              {openMenu === 'arquivo' && (
                <div className="absolute left-0 top-full mt-1 min-w-[240px] rounded-lg bg-[#181922]/98 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-black/80 p-1 text-xs text-foreground z-50 animate-fade-in select-none">
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      onNewProject?.();
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-primary/20 hover:text-white transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Novo Projeto...</span>
                    </div>
                    <kbd className="text-[10px] font-mono text-muted-foreground">Ctrl+N</kbd>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      onImportFolder?.();
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-primary/20 hover:text-white transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2">
                      <FolderUp className="h-3.5 w-3.5 text-cyan-400" />
                      <span>Importar Pasta de Capítulos...</span>
                    </div>
                    <kbd className="text-[10px] font-mono text-muted-foreground">Ctrl+O</kbd>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      onLoadDemo?.();
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-primary/20 hover:text-white transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2">
                      <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Carregar Projeto Demo (Exemplo)</span>
                    </div>
                  </button>

                  <div className="h-[1px] bg-white/10 my-1 mx-1.5" />

                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      onSave?.();
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-primary/20 hover:text-white transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Save className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Salvar Projeto no IndexedDB</span>
                    </div>
                    <kbd className="text-[10px] font-mono text-muted-foreground">Ctrl+S</kbd>
                  </button>

                  <div className="h-[1px] bg-white/10 my-1 mx-1.5" />

                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      onExportClick?.();
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-primary/20 hover:text-white transition-colors cursor-pointer text-left font-semibold text-cyan-300"
                  >
                    <div className="flex items-center gap-2">
                      <Download className="h-3.5 w-3.5 text-cyan-400" />
                      <span>Exportar Vídeo / Renderizar...</span>
                    </div>
                    <kbd className="text-[10px] font-mono text-muted-foreground">Ctrl+E</kbd>
                  </button>
                </div>
              )}
            </div>

            {/* Menu 2: Editar (Edit) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenMenu(openMenu === 'editar' ? null : 'editar')}
                onMouseEnter={() => handleMenuHover('editar')}
                className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                  openMenu === 'editar'
                    ? 'bg-white/15 text-white font-medium'
                    : 'text-gray-300 hover:text-white hover:bg-white/[0.08]'
                }`}
              >
                Editar
              </button>

              {openMenu === 'editar' && (
                <div className="absolute left-0 top-full mt-1 min-w-[240px] rounded-lg bg-[#181922]/98 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-black/80 p-1 text-xs text-foreground z-50 animate-fade-in select-none">
                  <button
                    type="button"
                    onClick={() => triggerShortcut('Enter')}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-primary/20 hover:text-white transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Crop className="h-3.5 w-3.5 text-primary" />
                      <span>Recortar Quadro Ativo</span>
                    </div>
                    <kbd className="text-[10px] font-mono text-muted-foreground">Enter</kbd>
                  </button>

                  <button
                    type="button"
                    onClick={() => triggerShortcut('x')}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-primary/20 hover:text-white transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      <span>Recortar Página Inteira</span>
                    </div>
                    <kbd className="text-[10px] font-mono text-muted-foreground">Shift+Enter / X</kbd>
                  </button>

                  <button
                    type="button"
                    onClick={() => triggerShortcut('d')}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-primary/20 hover:text-white transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                      <span>Auto-Detectar Quadros</span>
                    </div>
                    <kbd className="text-[10px] font-mono text-muted-foreground">D</kbd>
                  </button>

                  <div className="h-[1px] bg-white/10 my-1 mx-1.5" />

                  <button
                    type="button"
                    onClick={() => triggerShortcut('Delete')}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-rose-500/20 hover:text-rose-300 transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Excluir Seleção</span>
                    </div>
                    <kbd className="text-[10px] font-mono text-muted-foreground">Del</kbd>
                  </button>
                </div>
              )}
            </div>

            {/* Menu 3: Imagem (Image) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenMenu(openMenu === 'imagem' ? null : 'imagem')}
                onMouseEnter={() => handleMenuHover('imagem')}
                className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                  openMenu === 'imagem'
                    ? 'bg-white/15 text-white font-medium'
                    : 'text-gray-300 hover:text-white hover:bg-white/[0.08]'
                }`}
              >
                Imagem
              </button>

              {openMenu === 'imagem' && (
                <div className="absolute left-0 top-full mt-1 min-w-[240px] rounded-lg bg-[#181922]/98 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-black/80 p-1 text-xs text-foreground z-50 animate-fade-in select-none">
                  <button
                    type="button"
                    onClick={() => triggerShortcut('w')}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-primary/20 hover:text-white transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2">
                      <ArrowRightLeft className="h-3.5 w-3.5 text-primary" />
                      <span>100% Largura (Modo Manhwa)</span>
                    </div>
                    <kbd className="text-[10px] font-mono text-muted-foreground">W</kbd>
                  </button>

                  <button
                    type="button"
                    onClick={() => triggerShortcut('c', { shiftKey: true })}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-primary/20 hover:text-white transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Centralizar Enquadramento</span>
                    </div>
                    <kbd className="text-[10px] font-mono text-muted-foreground">Shift+C</kbd>
                  </button>

                  <button
                    type="button"
                    onClick={() => triggerShortcut('r')}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-primary/20 hover:text-white transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2">
                      <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Girar Orientação 90°</span>
                    </div>
                    <kbd className="text-[10px] font-mono text-muted-foreground">R</kbd>
                  </button>

                  <div className="h-[1px] bg-white/10 my-1 mx-1.5" />

                  <div className="px-2.5 py-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Proporção Padrão
                  </div>
                  <div className="px-2.5 py-1.5 text-xs text-white/90 flex items-center justify-between">
                    <span>16:9 · Recap HD Vídeo</span>
                    <Check className="h-3.5 w-3.5 text-primary" />
                  </div>
                </div>
              )}
            </div>

            {/* Menu 4: Exibir (View) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenMenu(openMenu === 'exibir' ? null : 'exibir')}
                onMouseEnter={() => handleMenuHover('exibir')}
                className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                  openMenu === 'exibir'
                    ? 'bg-white/15 text-white font-medium'
                    : 'text-gray-300 hover:text-white hover:bg-white/[0.08]'
                }`}
              >
                Exibir
              </button>

              {openMenu === 'exibir' && (
                <div className="absolute left-0 top-full mt-1 min-w-[220px] rounded-lg bg-[#181922]/98 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-black/80 p-1 text-xs text-foreground z-50 animate-fade-in select-none">
                  <button
                    type="button"
                    onClick={() => triggerShortcut('+')}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-primary/20 hover:text-white transition-colors cursor-pointer text-left"
                  >
                    <span>Aumentar Zoom</span>
                    <kbd className="text-[10px] font-mono text-muted-foreground">+</kbd>
                  </button>

                  <button
                    type="button"
                    onClick={() => triggerShortcut('-')}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-primary/20 hover:text-white transition-colors cursor-pointer text-left"
                  >
                    <span>Diminuir Zoom</span>
                    <kbd className="text-[10px] font-mono text-muted-foreground">-</kbd>
                  </button>

                  <button
                    type="button"
                    onClick={() => triggerShortcut('0', { ctrlKey: true })}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-primary/20 hover:text-white transition-colors cursor-pointer text-left"
                  >
                    <span>Ajustar à Tela</span>
                    <kbd className="text-[10px] font-mono text-muted-foreground">Ctrl+0</kbd>
                  </button>

                  <button
                    type="button"
                    onClick={() => triggerShortcut('1', { ctrlKey: true })}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-primary/20 hover:text-white transition-colors cursor-pointer text-left"
                  >
                    <span>Tamanho Real (100%)</span>
                    <kbd className="text-[10px] font-mono text-muted-foreground">Ctrl+1</kbd>
                  </button>

                  <div className="h-[1px] bg-white/10 my-1 mx-1.5" />

                  <button
                    type="button"
                    onClick={() => triggerShortcut('g')}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-primary/20 hover:text-white transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Grid className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Grade dos Terços</span>
                    </div>
                    <kbd className="text-[10px] font-mono text-muted-foreground">G</kbd>
                  </button>
                </div>
              )}
            </div>

            {/* Menu 5: Janela (Window) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenMenu(openMenu === 'janela' ? null : 'janela')}
                onMouseEnter={() => handleMenuHover('janela')}
                className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                  openMenu === 'janela'
                    ? 'bg-white/15 text-white font-medium'
                    : 'text-gray-300 hover:text-white hover:bg-white/[0.08]'
                }`}
              >
                Janela
              </button>

              {openMenu === 'janela' && (
                <div className="absolute left-0 top-full mt-1 min-w-[220px] rounded-lg bg-[#181922]/98 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-black/80 p-1 text-xs text-foreground z-50 animate-fade-in select-none">
                  <button
                    type="button"
                    onClick={() => triggerShortcut('p')}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-primary/20 hover:text-white transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2">
                      <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
                      <span>Painel de Propriedades</span>
                    </div>
                    <kbd className="text-[10px] font-mono text-muted-foreground">P</kbd>
                  </button>

                  <div className="h-[1px] bg-white/10 my-1 mx-1.5" />

                  <div className="px-2.5 py-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Espaços de Trabalho
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      onTabChange('recorte');
                      setOpenMenu(null);
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded transition-colors cursor-pointer text-left ${
                      currentTab === 'recorte' ? 'bg-primary/20 text-white font-semibold' : 'hover:bg-white/5 text-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Crop className="h-3.5 w-3.5 text-primary" />
                      <span>1. Recorte de Quadros</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onTabChange('roteiro');
                      setOpenMenu(null);
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded transition-colors cursor-pointer text-left ${
                      currentTab === 'roteiro' ? 'bg-primary/20 text-white font-semibold' : 'hover:bg-white/5 text-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <ScrollText className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>2. Roteiro e Contexto</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onTabChange('narracao');
                      setOpenMenu(null);
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded transition-colors cursor-pointer text-left ${
                      currentTab === 'narracao' ? 'bg-primary/20 text-white font-semibold' : 'hover:bg-white/5 text-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Mic className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>3. Narração e Voz TTS</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onTabChange('montagem');
                      setOpenMenu(null);
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded transition-colors cursor-pointer text-left ${
                      currentTab === 'montagem' ? 'bg-primary/20 text-white font-semibold' : 'hover:bg-white/5 text-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Film className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>4. Timeline e Montagem</span>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* Menu 6: Ajuda (Help) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenMenu(openMenu === 'ajuda' ? null : 'ajuda')}
                onMouseEnter={() => handleMenuHover('ajuda')}
                className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                  openMenu === 'ajuda'
                    ? 'bg-white/15 text-white font-medium'
                    : 'text-gray-300 hover:text-white hover:bg-white/[0.08]'
                }`}
              >
                Ajuda
              </button>

              {openMenu === 'ajuda' && (
                <div className="absolute left-0 top-full mt-1 min-w-[220px] rounded-lg bg-[#181922]/98 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-black/80 p-1 text-xs text-foreground z-50 animate-fade-in select-none">
                  <button
                    type="button"
                    onClick={() => triggerShortcut('?')}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-primary/20 hover:text-white transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2">
                      <HelpCircle className="h-3.5 w-3.5 text-primary" />
                      <span>Atalhos de Teclado...</span>
                    </div>
                    <kbd className="text-[10px] font-mono text-muted-foreground">?</kbd>
                  </button>

                  <div className="h-[1px] bg-white/10 my-1 mx-1.5" />

                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      setIsAboutModalOpen(true);
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-primary/20 hover:text-white transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Sobre o FrameBatch Studio</span>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Center: Current Document / Chapter Status Indicator (Photoshop title strip) */}
          <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-md bg-white/[0.03] border border-white/10 text-xs font-mono text-muted-foreground max-w-[450px]">
            <span className="text-white font-semibold truncate">{title}</span>
            <span className="text-white/20">|</span>
            <span className="text-muted-foreground/80 text-[11px] truncate">{subtitle}</span>
          </div>

          {/* Right: Auto-Save Status, Quick Save & Export Primary CTA */}
          <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
            {/* Auto-save status badge */}
            {saveStatus === 'saving' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-card/80 text-[11px] font-medium text-cyan-400 border border-cyan-400/20 shadow-sm animate-pulse">
                <RefreshCw className="h-3 w-3 animate-spin text-cyan-400" />
                <span className="hidden xl:inline">Salvando...</span>
              </span>
            )}
            {saveStatus === 'saved' && (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-[11px] font-semibold text-emerald-400 border border-emerald-500/20 shadow-sm"
                title={`Salvo no IndexedDB às ${new Date(lastSavedAt || Date.now()).toLocaleTimeString()}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
                <span className="hidden xl:inline">Salvo no IndexedDB</span>
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/10 text-[11px] font-semibold text-rose-400 border border-rose-500/20 shadow-sm">
                <AlertCircle className="h-3 w-3 text-rose-400" />
                <span className="hidden xl:inline">Erro ao Salvar</span>
              </span>
            )}

            {/* Quick Save Button */}
            <button
              type="button"
              onClick={onSave}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-card/80 px-2.5 py-1 text-xs font-semibold hover:bg-white/[0.06] hover:border-white/20 cursor-pointer text-white shadow-sm transition-all"
              title="Salvar alterações no IndexedDB agora (Ctrl+S)"
            >
              <Save className="h-3.5 w-3.5 text-cyan-400" />
              <span className="hidden sm:inline">Salvar</span>
            </button>

            {/* Custom actions (if passed) */}
            {actions}

            {/* High-Contrast Primary CTA (Electric Cyan EXPORTAR Button) */}
            <button
              onClick={onExportClick}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 px-3 py-1 sm:px-3.5 sm:py-1.5 text-xs font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition-all hover:shadow-cyan-400/40 hover:brightness-110 active:scale-[0.98] cursor-pointer"
              title="Exportar Vídeo / Renderizar (Ctrl+E)"
            >
              <Download className="h-3.5 w-3.5 stroke-[2.5]" />
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

      {/* About Modal */}
      {isAboutModalOpen && (
        <div
          onClick={() => setIsAboutModalOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-md w-full bg-[#181922] rounded-2xl border border-white/10 overflow-hidden shadow-2xl p-6 text-white space-y-4"
          >
            <div className="flex items-center gap-3">
              <div>
                <h3 className="text-base font-bold font-display">Recap Studio</h3>
                <p className="text-xs text-muted-foreground font-mono">16:9 RECAP HD</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Sistema profissional de enquadramento, extração, geração de roteiros de IA, síntese de voz e montagem de vídeos recap para manhwa e webtoon.
            </p>

            <div className="border-t border-white/10 pt-3 flex justify-end">
              <button
                onClick={() => setIsAboutModalOpen(false)}
                className="px-4 py-1.5 rounded-xl bg-primary text-primary-foreground font-semibold text-xs hover:opacity-90 transition-opacity cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
