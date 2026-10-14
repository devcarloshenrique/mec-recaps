import React, { useState, useRef } from 'react';
import {
  FolderUp,
  X,
  Plus,
  ArrowUpDown,
  RotateCcw,
  Check,
  CheckSquare,
  Square,
  Trash2,
} from 'lucide-react';
import type { ChapterItem } from '../types';

interface ChaptersDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  chapters: ChapterItem[];
  currentChapterId: string;
  onSelectChapter: (id: string) => void;
  onSelectPageNumber: (page: number) => void;
  onAddChapter?: () => void;
  onUploadFolder: (files: FileList | File[]) => void;
  onSortChapters?: (mode: 'asc' | 'desc' | 'reverse') => void;
  onDeleteChapter?: (chapterId: string) => boolean;
  onDeleteChapters?: (ids: string[]) => void;
  onClearAllChapters?: () => Promise<void>;
}

export const ChaptersDrawer: React.FC<ChaptersDrawerProps> = ({
  isOpen,
  onClose,
  chapters,
  currentChapterId,
  onSelectChapter,
  onSelectPageNumber,
  onAddChapter,
  onUploadFolder,
  onSortChapters,
  onDeleteChapter,
  onDeleteChapters,
  onClearAllChapters,
}) => {
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const [isBulkSelectMode, setIsBulkSelectMode] = useState(false);
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set());
  const [isFolderDragging, setIsFolderDragging] = useState(false);
  const [isClearAllModalOpen, setIsClearAllModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleApplySort = (mode: 'asc' | 'desc' | 'reverse') => {
    if (mode !== 'reverse') {
      setSortDirection(mode);
    }
    onSortChapters?.(mode);
    setIsSortDropdownOpen(false);
  };

  const handleToggleSelectChapter = (id: string) => {
    setSelectedChapterIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAllChapters = () => {
    if (selectedChapterIds.size === chapters.length) {
      setSelectedChapterIds(new Set());
    } else {
      setSelectedChapterIds(new Set(chapters.map((c) => c.id)));
    }
  };

  const handleConfirmBulkDelete = () => {
    if (selectedChapterIds.size === 0) return;
    if (confirm(`Excluir os ${selectedChapterIds.size} capítulos selecionados?`)) {
      onDeleteChapters?.(Array.from(selectedChapterIds));
      setSelectedChapterIds(new Set());
      setIsBulkSelectMode(false);
    }
  };

  const handleRequestDeleteChapter = (e: React.MouseEvent, ch: ChapterItem) => {
    e.stopPropagation();
    if (confirm(`Tem certeza que deseja excluir o capítulo "${ch.label}"?`)) {
      onDeleteChapter?.(ch.id);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex animate-in fade-in duration-200">
      {/* Hidden File Input for Folder Import */}
      <input
        ref={fileInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is standard for folder picker
        webkitdirectory=""
        directory=""
        multiple
        onChange={(e) => {
          if (e.target.files) onUploadFolder(e.target.files);
        }}
        className="hidden"
      />

      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/70 backdrop-blur-xs transition-opacity"
      />

      {/* Sliding Drawer Container */}
      <div className="relative w-84 max-w-[85vw] bg-[#161720] border-r border-white/10 shadow-2xl flex flex-col justify-between z-10 animate-in slide-in-from-left duration-200">
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="border-b border-white/10 px-4 py-3 flex items-center justify-between shrink-0">
            <div>
              <p className="font-display text-xs font-bold tracking-widest text-white uppercase">
                Capítulos ({chapters.length})
              </p>
              <p className="text-[10px] text-muted-foreground">Gerenciador de capítulos</p>
            </div>
            <div className="flex items-center gap-1.5">
              {onAddChapter && (
                <button
                  type="button"
                  onClick={() => onAddChapter()}
                  className="flex items-center gap-1 rounded-lg bg-primary/20 text-primary hover:bg-primary hover:text-primary-foreground px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer"
                  title="Adicionar novo capítulo"
                >
                  <Plus className="h-3 w-3" />
                  <span>Novo</span>
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Quick Management Toolbar: Sort & Bulk Actions */}
          {chapters.length > 0 && (
            <div className="px-2.5 py-1.5 border-b border-white/10 bg-background/40 flex items-center justify-between gap-1 text-[11px] shrink-0">
              {/* Sort Menu / Toggle */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsSortDropdownOpen((prev) => !prev)}
                  className="flex items-center gap-1 px-1.5 py-1 rounded bg-secondary/80 hover:bg-secondary text-foreground text-[11px] font-semibold transition-colors border border-border/50 cursor-pointer"
                  title="Ordenar capítulos (Crescente, Decrescente, Inverter)"
                >
                  <ArrowUpDown className="h-3 w-3 text-primary" />
                  <span>{sortDirection === 'asc' ? '1→N' : 'N→1'}</span>
                </button>

                {isSortDropdownOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-0 top-7 z-40 w-44 rounded-lg bg-card border border-border shadow-xl p-1 animate-in fade-in text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => handleApplySort('asc')}
                      className={`w-full text-left px-2 py-1.5 rounded flex items-center justify-between hover:bg-secondary transition-colors cursor-pointer ${
                        sortDirection === 'asc' ? 'text-primary font-bold bg-primary/10' : 'text-foreground'
                      }`}
                    >
                      <span>1 → N (Crescente)</span>
                      {sortDirection === 'asc' && <Check className="h-3 w-3" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplySort('desc')}
                      className={`w-full text-left px-2 py-1.5 rounded flex items-center justify-between hover:bg-secondary transition-colors cursor-pointer ${
                        sortDirection === 'desc' ? 'text-primary font-bold bg-primary/10' : 'text-foreground'
                      }`}
                    >
                      <span>N → 1 (Decrescente)</span>
                      {sortDirection === 'desc' && <Check className="h-3 w-3" />}
                    </button>
                    <div className="h-[1px] bg-border my-1" />
                    <button
                      type="button"
                      onClick={() => handleApplySort('reverse')}
                      className="w-full text-left px-2 py-1.5 rounded flex items-center gap-1.5 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>Inverter Ordem Atual</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Bulk Actions: Select Mode & Clear All */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsBulkSelectMode((prev) => !prev);
                    setSelectedChapterIds(new Set());
                  }}
                  className={`p-1 rounded transition-colors cursor-pointer ${
                    isBulkSelectMode
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                  }`}
                  title={isBulkSelectMode ? 'Sair do modo de seleção' : 'Selecionar capítulos para excluir'}
                >
                  <CheckSquare className="h-3.5 w-3.5" />
                </button>

                {onClearAllChapters && (
                  <button
                    type="button"
                    onClick={() => setIsClearAllModalOpen(true)}
                    className="flex items-center gap-1 px-1.5 py-1 rounded text-red-400 hover:text-red-300 hover:bg-red-500/15 transition-colors font-medium text-[11px] cursor-pointer"
                    title="Limpar todos os capítulos em massa"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>Limpar</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Bulk Select Action Bar */}
          {isBulkSelectMode && chapters.length > 0 && (
            <div className="bg-primary/10 border-b border-primary/20 px-2.5 py-1.5 flex items-center justify-between text-xs animate-in fade-in shrink-0">
              <button
                type="button"
                onClick={handleSelectAllChapters}
                className="flex items-center gap-1.5 text-[11px] font-medium text-foreground hover:text-primary transition-colors cursor-pointer"
              >
                {selectedChapterIds.size === chapters.length && chapters.length > 0 ? (
                  <CheckSquare className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <Square className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span>Todos ({selectedChapterIds.size}/{chapters.length})</span>
              </button>

              <button
                type="button"
                onClick={handleConfirmBulkDelete}
                disabled={selectedChapterIds.size === 0}
                className="px-2 py-0.5 rounded bg-red-500 text-white font-semibold text-[10px] disabled:opacity-30 disabled:pointer-events-none hover:bg-red-600 transition-colors shadow-xs cursor-pointer"
              >
                Excluir ({selectedChapterIds.size})
              </button>
            </div>
          )}

          {/* Chapters List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {chapters.length === 0 ? (
              <div className="p-4 text-center my-4 space-y-3">
                <div className="w-10 h-10 rounded-full bg-secondary mx-auto flex items-center justify-center text-muted-foreground">
                  <FolderUp className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-foreground">Sem Capítulos</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Nenhum capítulo importado ainda. Carregue sua pasta com as páginas do manhwa.
                  </p>
                </div>
                <div className="pt-2 flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    <FolderUp className="h-3.5 w-3.5" />
                    <span>Importar Pasta</span>
                  </button>
                  {onAddChapter && (
                    <button
                      type="button"
                      onClick={() => onAddChapter()}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-secondary text-foreground text-xs font-medium hover:bg-secondary/80 transition-colors cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>+ Novo Capítulo</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              chapters.map((ch) => {
                const isSelected = ch.id === currentChapterId;
                const isBulkChecked = selectedChapterIds.has(ch.id);
                const pct = Math.round(((ch.done || 0) / Math.max(1, ch.pages)) * 100);

                return (
                  <div
                    key={ch.id}
                    onClick={() => {
                      if (isBulkSelectMode) {
                        handleToggleSelectChapter(ch.id);
                      } else {
                        onSelectChapter(ch.id);
                        onSelectPageNumber(1);
                        onClose();
                      }
                    }}
                    className={`group relative w-full rounded-xl px-3 py-2.5 text-left transition-all cursor-pointer border ${
                      isSelected
                        ? 'bg-card border-white/10 text-white shadow-md shadow-black/40 ring-1 ring-white/5'
                        : isBulkChecked
                        ? 'bg-primary/5 border-primary/30 text-white'
                        : 'border-transparent text-muted-foreground hover:bg-white/[0.03] hover:text-white'
                    }`}
                  >
                    {isSelected && (
                      <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_8px_var(--color-primary)]" />
                    )}
                    <div className="flex items-center justify-between gap-1">
                      {isBulkSelectMode && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleSelectChapter(ch.id);
                          }}
                          className="mr-1 text-primary focus:outline-none shrink-0"
                        >
                          {isBulkChecked ? (
                            <CheckSquare className="h-4 w-4 text-primary" />
                          ) : (
                            <Square className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                      )}

                      <span
                        className={`truncate text-sm font-semibold flex-1 ${
                          isSelected ? 'text-primary' : 'text-foreground'
                        }`}
                      >
                        {ch.label}
                      </span>

                      {/* Check if fully completed */}
                      {pct === 100 && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      )}

                      {/* Delete Chapter Button */}
                      {!isBulkSelectMode && (
                        <button
                          type="button"
                          onClick={(e) => handleRequestDeleteChapter(e, ch)}
                          className="opacity-0 group-hover:opacity-100 hover:opacity-100 p-1 text-muted-foreground hover:text-red-400 hover:bg-red-500/15 rounded transition-all shrink-0 ml-1"
                          title={`Excluir ${ch.label}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <p className="mt-0.5 text-[11px] text-muted-foreground flex items-center justify-between">
                      <span>{ch.done || 0}/{ch.pages} páginas</span>
                      <span className="font-mono text-[10px]">{pct}%</span>
                    </p>

                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Drag & Drop Import Folder Box */}
        <div className="p-3 border-t border-white/10 shrink-0">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsFolderDragging(true);
            }}
            onDragLeave={() => setIsFolderDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsFolderDragging(false);
              if (e.dataTransfer.files) onUploadFolder(e.dataTransfer.files);
            }}
            className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed py-3.5 text-xs text-muted-foreground transition-colors cursor-pointer ${
              isFolderDragging
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-white/10 hover:border-primary hover:text-primary'
            }`}
          >
            <FolderUp className="h-4 w-4" />
            <span className="font-semibold text-[11px]">Importar pasta de capítulos</span>
            <span className="text-[10px] opacity-70">Arraste ou clique</span>
          </button>
        </div>
      </div>

      {/* Confirmation Modal for Clear All Chapters */}
      {isClearAllModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="relative w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-destructive/10 border border-destructive/30 flex items-center justify-center text-destructive">
                <Trash2 className="h-4 w-4" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-foreground">Limpar Todos os Capítulos?</h4>
                <p className="text-[11px] text-muted-foreground">Esta ação removerá todos os {chapters.length} capítulos.</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setIsClearAllModalOpen(false)}
                className="px-3 py-1.5 rounded-md text-xs font-medium hover:bg-secondary text-foreground"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  setIsClearAllModalOpen(false);
                  await onClearAllChapters?.();
                  onClose();
                }}
                className="px-3 py-1.5 rounded-md text-xs font-semibold bg-destructive hover:bg-destructive/90 text-destructive-foreground shadow-xs"
              >
                Limpar Tudo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
