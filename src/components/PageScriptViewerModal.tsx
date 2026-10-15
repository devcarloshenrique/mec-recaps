import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  Copy,
  Check,
  Play,
  Square,
  Volume2,
  VolumeX,
  FileText,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  BookOpen,
  ScrollText,
  Layers,
  Loader2,
  Mic,
  Clock,
} from 'lucide-react';
import { SceneItem, FrameItem } from '../types';
import { registerCreatedUrl, revokeCreatedUrl } from '../utils/projectStorage';

export interface PageRowData {
  chapterId: string;
  chapterLabel: string;
  pageNumber: number;
  totalPages: number;
  rawPageUrl: string;
  frames: FrameItem[];
  scene: SceneItem;
}

interface PageScriptViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  chapterLabel: string;
  pageRows: PageRowData[];
  onUpdateScene: (scene: SceneItem) => void;
  onGeneratePageAudio?: (row: PageRowData) => void;
  generatingAudioPages?: Record<string, boolean>;
}

export const PageScriptViewerModal: React.FC<PageScriptViewerModalProps> = ({
  isOpen,
  onClose,
  chapterLabel,
  pageRows,
  onUpdateScene,
  onGeneratePageAudio,
  generatingAudioPages = {},
}) => {
  const [viewMode, setViewMode] = useState<'foco' | 'continuo'>('foco');
  const [selectedSceneId, setSelectedSceneId] = useState<string>(() => pageRows[0]?.scene.id || '');
  const [copiedFull, setCopiedFull] = useState(false);
  const [copiedSceneId, setCopiedSceneId] = useState<string | null>(null);
  const [playingSceneId, setPlayingSceneId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeBlobUrlRef = useRef<string | null>(null);

  // Garante linha válida selecionada
  useEffect(() => {
    if (pageRows.length > 0 && !pageRows.some((r) => r.scene.id === selectedSceneId)) {
      setSelectedSceneId(pageRows[0].scene.id);
    }
  }, [pageRows, selectedSceneId]);

  // Interrompe áudio ao fechar
  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (activeBlobUrlRef.current) {
      revokeCreatedUrl(activeBlobUrlRef.current);
      activeBlobUrlRef.current = null;
    }
    setPlayingSceneId(null);
  };

  useEffect(() => {
    if (!isOpen) {
      stopAudio();
    }
  }, [isOpen]);

  // Atalhos de teclado no modo foco
  useEffect(() => {
    if (!isOpen || viewMode !== 'foco') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignora se estiver digitando em textarea ou input
      if (['TEXTAREA', 'INPUT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      const currentIdx = pageRows.findIndex((r) => r.scene.id === selectedSceneId);
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (currentIdx > 0) {
          setSelectedSceneId(pageRows[currentIdx - 1].scene.id);
          stopAudio();
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (currentIdx >= 0 && currentIdx < pageRows.length - 1) {
          setSelectedSceneId(pageRows[currentIdx + 1].scene.id);
          stopAudio();
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, viewMode, selectedSceneId, pageRows, onClose]);

  // Estatísticas consolidadas do capítulo
  const stats = useMemo(() => {
    let totalWords = 0;
    let totalEstimatedSeconds = 0;
    let totalAudioSeconds = 0;
    let pagesWithAudio = 0;

    pageRows.forEach((r) => {
      const text = (r.scene.text || '').trim();
      const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
      totalWords += words;

      if (r.scene.audioDuration && r.scene.audioDuration > 0) {
        totalAudioSeconds += r.scene.audioDuration;
        pagesWithAudio++;
      } else {
        // Estima com base em 140 palavras/minuto (~2.33 palavras/s)
        totalEstimatedSeconds += words > 0 ? (words / 140) * 60 : 6.0;
      }
    });

    const totalSeconds = totalAudioSeconds + totalEstimatedSeconds;
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.round(totalSeconds % 60);

    return {
      totalWords,
      totalDurationFormatted: `${mins}m ${secs.toString().padStart(2, '0')}s`,
      pagesWithAudio,
      totalPages: pageRows.length,
    };
  }, [pageRows]);

  if (!isOpen) return null;

  // Linha da página selecionada
  const activeRow = pageRows.find((r) => r.scene.id === selectedSceneId) || pageRows[0];
  const activeIdx = activeRow ? pageRows.findIndex((r) => r.scene.id === activeRow.scene.id) : 0;

  // Copiar roteiro completo do capítulo
  const handleCopyFullScript = async () => {
    const fullText = pageRows
      .map((r) => {
        const pNum = String(r.pageNumber).padStart(2, '0');
        const text = (r.scene.text || '').trim() || '(Sem roteiro narrado nesta página)';
        return `=== ${r.chapterLabel} — PÁGINA ${pNum} ===\n${text}`;
      })
      .join('\n\n');

    try {
      await navigator.clipboard.writeText(fullText);
      setCopiedFull(true);
      setTimeout(() => setCopiedFull(false), 2000);
    } catch (err) {
      console.error('Falha ao copiar roteiro:', err);
    }
  };

  // Copiar texto da página individual
  const handleCopyPageScript = async (sceneId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSceneId(sceneId);
      setTimeout(() => setCopiedSceneId(null), 2000);
    } catch (err) {
      console.error('Falha ao copiar página:', err);
    }
  };

  // Tocar ou pausar áudio de uma página
  const handleTogglePlayAudio = (row: PageRowData) => {
    if (playingSceneId === row.scene.id) {
      stopAudio();
      return;
    }

    stopAudio();

    let playUrl = row.scene.audioUrl;
    if (!playUrl && row.scene.audioBlob) {
      playUrl = registerCreatedUrl(URL.createObjectURL(row.scene.audioBlob));
      activeBlobUrlRef.current = playUrl;
    }

    if (!playUrl) return;

    const audio = new Audio(playUrl);
    audioRef.current = audio;
    setPlayingSceneId(row.scene.id);

    audio.onended = () => {
      stopAudio();
    };

    audio.onerror = () => {
      stopAudio();
    };

    audio.play().catch(() => {
      stopAudio();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in">
      <div className="relative w-full max-w-5xl h-[90vh] max-h-[880px] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden select-none">
        {/* ======================================================== */}
        {/* CABEÇALHO CONSOLIDADO DO CAPÍTULO                        */}
        {/* ======================================================== */}
        <div className="px-5 py-3.5 border-b border-border bg-card/90 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <ScrollText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-foreground flex items-center gap-2 truncate">
                <span>Roteiro Consolidado</span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-secondary text-muted-foreground border border-border">
                  {chapterLabel}
                </span>
              </h2>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5 flex-wrap">
                <span>{stats.totalPages} páginas</span>
                <span>•</span>
                <span className="font-mono text-foreground font-semibold">{stats.totalWords} palavras</span>
                <span>•</span>
                <span className="font-mono text-foreground font-semibold">~{stats.totalDurationFormatted}</span>
                <span>•</span>
                <span className="inline-flex items-center gap-1 text-emerald-400 font-mono">
                  <Volume2 className="h-3 w-3" />
                  {stats.pagesWithAudio}/{stats.totalPages} com áudio
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Alternador de Modo de Visualização */}
            <div className="flex bg-secondary/80 p-0.5 rounded-lg border border-border">
              <button
                type="button"
                onClick={() => {
                  setViewMode('foco');
                  stopAudio();
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                  viewMode === 'foco'
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span>Página a Página</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode('continuo');
                  stopAudio();
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                  viewMode === 'continuo'
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                <span>Leitura Corrida</span>
              </button>
            </div>

            {/* Copiar Roteiro Completo */}
            <button
              type="button"
              onClick={handleCopyFullScript}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground border border-border text-xs font-bold transition-all cursor-pointer shadow-xs"
              title="Copiar todas as falas do capítulo para a área de transferência"
            >
              {copiedFull ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copiado!</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-primary" />
                  <span>Copiar Capítulo</span>
                </>
              )}
            </button>

            {/* Fechar Modal */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
              title="Fechar (Esc)"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* ======================================================== */}
        {/* CORPO: MODO FOCO (PÁGINA A PÁGINA)                       */}
        {/* ======================================================== */}
        {viewMode === 'foco' && activeRow && (
          <div className="flex-1 flex overflow-hidden">
            {/* Sidebar Esquerda: Lista de Páginas */}
            <div className="w-56 sm:w-64 border-r border-border bg-card/40 flex flex-col shrink-0 overflow-hidden">
              <div className="p-2.5 border-b border-border/60 text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                <span>Páginas</span>
                <span className="font-mono text-xs">{pageRows.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {pageRows.map((r, idx) => {
                  const isSel = r.scene.id === selectedSceneId;
                  const text = (r.scene.text || '').trim();
                  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
                  const hasAudio = Boolean(r.scene.audioDuration && r.scene.audioDuration > 0);
                  const isGenAudio = Boolean(generatingAudioPages[r.scene.id]);

                  return (
                    <button
                      key={r.scene.id}
                      type="button"
                      onClick={() => {
                        setSelectedSceneId(r.scene.id);
                        stopAudio();
                      }}
                      className={`w-full flex items-center justify-between p-2 rounded-xl text-left transition-all cursor-pointer border ${
                        isSel
                          ? 'bg-primary/20 border-primary/50 text-foreground font-bold shadow-xs'
                          : 'bg-card/40 hover:bg-secondary/60 border-transparent text-muted-foreground'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="font-mono text-xs text-primary font-bold">
                          {String(r.pageNumber).padStart(2, '0')}
                        </span>
                        <div className="flex flex-col truncate">
                          <span className="truncate text-xs font-semibold">
                            {r.chapterLabel}
                          </span>
                          <span className="truncate text-[10.5px] text-muted-foreground">
                            {words > 0 ? `${words} pal.` : '(Vazio)'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isGenAudio ? (
                          <Loader2 className="h-3 w-3 animate-spin text-primary" />
                        ) : hasAudio ? (
                          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded border border-emerald-500/20">
                            {r.scene.audioDuration?.toFixed(1)}s
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground/60">•</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Painel Central Amplo: Leitura, Edição e Áudio */}
            <div className="flex-1 flex flex-col overflow-hidden bg-background/50">
              {/* Barra de Ações da Página Atual */}
              <div className="px-6 py-3 border-b border-border bg-card/30 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={activeIdx <= 0}
                    onClick={() => {
                      if (activeIdx > 0) {
                        setSelectedSceneId(pageRows[activeIdx - 1].scene.id);
                        stopAudio();
                      }
                    }}
                    className="p-1.5 rounded-lg border border-border bg-secondary hover:bg-secondary/80 text-foreground disabled:opacity-30 cursor-pointer transition-colors"
                    title="Página Anterior (Seta Esquerda)"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>

                  <span className="text-xs font-bold font-mono px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-primary">
                    Pág. {String(activeRow.pageNumber).padStart(2, '0')} ({activeRow.chapterLabel}) · {activeIdx + 1} de {stats.totalPages}
                  </span>

                  <button
                    type="button"
                    disabled={activeIdx >= stats.totalPages - 1}
                    onClick={() => {
                      if (activeIdx < stats.totalPages - 1) {
                        setSelectedSceneId(pageRows[activeIdx + 1].scene.id);
                        stopAudio();
                      }
                    }}
                    className="p-1.5 rounded-lg border border-border bg-secondary hover:bg-secondary/80 text-foreground disabled:opacity-30 cursor-pointer transition-colors"
                    title="Próxima Página (Seta Direita)"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {/* Status e Controle de Áudio */}
                  {generatingAudioPages[activeRow.scene.id] ? (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 text-primary border border-primary/30 text-xs font-bold animate-pulse">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Gerando TTS...</span>
                    </div>
                  ) : activeRow.scene.audioBlob || activeRow.scene.audioUrl ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleTogglePlayAudio(activeRow)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-xs border ${
                          playingSceneId === activeRow.scene.id
                            ? 'bg-amber-500 text-black border-amber-400'
                            : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25'
                        }`}
                      >
                        {playingSceneId === activeRow.scene.id ? (
                          <>
                            <Square className="h-3.5 w-3.5 fill-current" />
                            <span>Parar Áudio</span>
                          </>
                        ) : (
                          <>
                            <Play className="h-3.5 w-3.5 fill-current" />
                            <span>Ouvir ({activeRow.scene.audioDuration?.toFixed(1)}s)</span>
                          </>
                        )}
                      </button>

                      {onGeneratePageAudio && (
                        <button
                          type="button"
                          onClick={() => onGeneratePageAudio(activeRow)}
                          className="p-1.5 rounded-lg border border-border bg-card hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                          title="Regerar síntese de voz TTS desta página"
                        >
                          <Mic className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ) : (
                    onGeneratePageAudio && (
                      <button
                        type="button"
                        onClick={() => onGeneratePageAudio(activeRow)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground border border-border text-xs font-bold transition-all cursor-pointer"
                        title="Gerar áudio neural TTS para esta página"
                      >
                        <Mic className="h-3.5 w-3.5 text-primary" />
                        <span>Gerar TTS</span>
                      </button>
                    )
                  )}

                  {/* Copiar Página */}
                  <button
                    type="button"
                    onClick={() => handleCopyPageScript(activeRow.scene.id, activeRow.scene.text || '')}
                    className="p-1.5 rounded-lg border border-border bg-secondary hover:bg-secondary/80 text-foreground transition-colors cursor-pointer"
                    title="Copiar texto desta página"
                  >
                    {copiedSceneId === activeRow.scene.id ? (
                      <Check className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Área Ampla de Leitura e Edição */}
              <div className="flex-1 p-6 flex flex-col gap-4 overflow-hidden relative">
                <textarea
                  value={activeRow.scene.text || ''}
                  onChange={(e) => {
                    const newText = e.target.value;
                    onUpdateScene({
                      ...activeRow.scene,
                      text: newText,
                    });
                  }}
                  placeholder="Nenhum roteiro gerado para esta página. Digite aqui ou gere na tela de Roteiro..."
                  className="w-full flex-1 bg-background/90 text-foreground text-sm sm:text-base p-6 rounded-2xl border border-border focus:outline-none focus:ring-2 focus:ring-primary/60 resize-none leading-relaxed font-sans shadow-inner placeholder:text-muted-foreground/40"
                />

                {/* Miniatura de Referência da Imagem no Canto */}
                {activeRow.rawPageUrl && (
                  <div className="absolute bottom-10 right-10 group">
                    <div className="h-28 w-20 rounded-xl overflow-hidden border-2 border-border/80 bg-black shadow-xl group-hover:scale-125 transition-transform duration-200">
                      <img
                        src={activeRow.rawPageUrl}
                        alt={`Página ${activeRow.pageNumber}`}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* CORPO: MODO LEITURA CORRIDA (SCRIPT CONTÍNUO)             */}
        {/* ======================================================== */}
        {viewMode === 'continuo' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-background/30">
            {pageRows.map((r) => {
              const text = (r.scene.text || '').trim();
              const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
              const hasAudio = Boolean(r.scene.audioDuration && r.scene.audioDuration > 0);
              const isGenAudio = Boolean(generatingAudioPages[r.scene.id]);

              return (
                <div
                  key={r.scene.id}
                  className="rounded-2xl border border-border bg-card/60 p-5 space-y-3 shadow-xs hover:border-border/80 transition-colors"
                >
                  <div className="flex items-center justify-between border-b border-border/60 pb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono font-bold text-xs px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-primary">
                        Página {String(r.pageNumber).padStart(2, '0')} ({r.chapterLabel})
                      </span>
                      <span className="text-xs font-mono text-muted-foreground">
                        {words} palavras · ~{Math.round((words / 140) * 60)}s
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {isGenAudio ? (
                        <div className="inline-flex items-center gap-1 text-xs text-primary font-bold animate-pulse">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Gerando...</span>
                        </div>
                      ) : hasAudio ? (
                        <button
                          type="button"
                          onClick={() => handleTogglePlayAudio(r)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                            playingSceneId === r.scene.id
                              ? 'bg-amber-500 text-black border-amber-400'
                              : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25'
                          }`}
                        >
                          {playingSceneId === r.scene.id ? (
                            <>
                              <Square className="h-3 w-3 fill-current" />
                              <span>Parar</span>
                            </>
                          ) : (
                            <>
                              <Play className="h-3 w-3 fill-current" />
                              <span>{r.scene.audioDuration?.toFixed(1)}s</span>
                            </>
                          )}
                        </button>
                      ) : (
                        onGeneratePageAudio && (
                          <button
                            type="button"
                            onClick={() => onGeneratePageAudio(r)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-secondary hover:bg-secondary/80 text-foreground border border-border"
                          >
                            <Mic className="h-3 w-3 text-primary" />
                            <span>TTS</span>
                          </button>
                        )
                      )}

                      <button
                        type="button"
                        onClick={() => handleCopyPageScript(r.scene.id, r.scene.text || '')}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary"
                        title="Copiar texto desta página"
                      >
                        {copiedSceneId === r.scene.id ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  <textarea
                    value={r.scene.text || ''}
                    rows={Math.max(3, Math.min(8, Math.ceil((text.length || 1) / 80)))}
                    onChange={(e) => {
                      const newText = e.target.value;
                      onUpdateScene({
                        ...r.scene,
                        text: newText,
                      });
                    }}
                    placeholder={`Texto da página ${r.pageNumber} (${r.chapterLabel})...`}
                    className="w-full bg-background/60 text-foreground text-sm p-3.5 rounded-xl border border-border/80 focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed font-sans shadow-inner resize-y"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
