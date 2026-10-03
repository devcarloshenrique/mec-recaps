import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Download,
  FolderArchive,
  FileText,
  CheckCircle2,
  RefreshCw,
  Film,
  AlertCircle,
  Play,
  Volume2,
  VolumeX,
  Type,
  Sliders,
  Check,
  Smartphone,
  Monitor,
  Flame,
  Clock,
  StopCircle,
  FileSpreadsheet,
} from 'lucide-react';
import JSZip from 'jszip';
import { ChapterItem, FrameItem, SceneItem } from '../types';
import {
  exportRecap,
  ExportFormat,
  ExportResolution,
  EXPORT_RESOLUTIONS,
  ExportProgress,
  ExportResult,
} from '../utils/videoExporter';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  chapters: ChapterItem[];
  frames: FrameItem[];
  scenes: SceneItem[];
  initialFormat?: ExportFormat | string;
  onImportProject?: (projectData: {
    chapters: ChapterItem[];
    frames: FrameItem[];
    scenes: SceneItem[];
  }) => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  chapters,
  frames,
  scenes,
  initialFormat = 'mp4',
  onImportProject,
}) => {
  // Tabs: 'video' | 'shotcut' | 'zip' | 'script' | 'backup'
  const [activeTab, setActiveTab] = useState<'video' | 'zip' | 'script' | 'backup'>('video');

  // Format selection: 'mp4' | 'webm' | 'shotcut'
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('mp4');
  const [selectedResolution, setSelectedResolution] = useState<ExportResolution>('16:9');
  const [includeAudio, setIncludeAudio] = useState<boolean>(true);
  const [includeSubtitles, setIncludeSubtitles] = useState<boolean>(true);

  // Video Rendering / Export State
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ZIP State for standalone image pack
  const [isZipping, setIsZipping] = useState<boolean>(false);
  const [zipProgress, setZipProgress] = useState<number>(0);

  // Feedback Messages
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Scenes with ready audio
  const scenesWithAudioCount = scenes.filter((s) => s.audioBlob || s.audioUrl).length;

  // Cleanup object URLs on unmount or new result
  useEffect(() => {
    return () => {
      if (previewVideoUrl) {
        URL.revokeObjectURL(previewVideoUrl);
      }
    };
  }, [previewVideoUrl]);

  // Sync format when initialFormat changes or modal opens
  useEffect(() => {
    if (isOpen && initialFormat) {
      if (initialFormat === 'shotcut') {
        setSelectedFormat('shotcut');
      } else if (initialFormat === 'webm') {
        setSelectedFormat('webm');
      } else {
        setSelectedFormat('mp4');
      }
    }
  }, [isOpen, initialFormat]);

  if (!isOpen) return null;

  // Cancel ongoing export
  const handleCancelExport = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsExporting(false);
    setErrorMessage('Exportação cancelada.');
    setExportProgress(null);
  };

  // Main Export Handler
  const handleStartExport = async () => {
    if (frames.length === 0) {
      setErrorMessage('Nenhum quadro na timeline para exportar.');
      return;
    }

    setIsExporting(true);
    setExportProgress({
      currentFrame: 0,
      totalFrames: frames.length,
      percentage: 1,
      message: 'Iniciando pipeline de exportação...',
      elapsedSeconds: 0,
    });
    setSuccessMessage(null);
    setErrorMessage(null);

    if (previewVideoUrl) {
      URL.revokeObjectURL(previewVideoUrl);
      setPreviewVideoUrl(null);
    }
    setExportResult(null);

    abortControllerRef.current = new AbortController();

    try {
      const result = await exportRecap({
        format: selectedFormat,
        frames,
        scenes,
        chapters,
        resolution: selectedResolution,
        fps: 30,
        includeAudio: includeAudio && scenesWithAudioCount > 0,
        includeSubtitles,
        signal: abortControllerRef.current.signal,
        onProgress: (progress) => {
          setExportProgress(progress);
        },
      });

      setExportResult(result);

      if (result.format === 'mp4' || result.format === 'webm') {
        const url = URL.createObjectURL(result.blob);
        setPreviewVideoUrl(url);
      }

      // Auto trigger native download
      triggerDownload(result.blob, result.filename);

      setSuccessMessage(
        result.format === 'shotcut'
          ? 'Pacote de projeto Shotcut (.mlt + mídias em ZIP) gerado e baixado com sucesso!'
          : `Vídeo ${result.format.toUpperCase()} renderizado e baixado com sucesso!`
      );
    } catch (err: any) {
      if (err.message !== 'Exportação cancelada.' && err.message !== 'Renderização cancelada.') {
        console.error('Erro na exportação:', err);
        setErrorMessage(`Falha na exportação: ${err.message || 'Erro inesperado'}`);
      }
    } finally {
      setIsExporting(false);
      abortControllerRef.current = null;
    }
  };

  // Trigger browser download without opening new windows
  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  // Export standalone image zip pack
  const handleExportZip = async () => {
    if (frames.length === 0) {
      setErrorMessage('Nenhum quadro disponível para exportar no pacote ZIP.');
      return;
    }

    setIsZipping(true);
    setZipProgress(10);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      const zip = new JSZip();

      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const chapter = chapters.find((c) => c.id === frame.chapterId) || chapters[0];
        const chapterName = chapter?.label?.replace(/[/\\?%*:|"<>]/g, '_') || 'Geral';
        const chapterFolder = zip.folder(chapterName) || zip;

        try {
          let blob = frame.blob;
          if (!blob) {
            const res = await fetch(frame.src);
            blob = await res.blob();
          }
          const filename = `${String(i + 1).padStart(3, '0')}_${(frame.label || 'quadro').replace(/\s+/g, '_')}.jpg`;
          chapterFolder.file(filename, blob);
        } catch {}

        setZipProgress(10 + Math.round(((i + 1) / frames.length) * 70));
      }

      const scriptContent = scenes
        .map((s) => `[${s.title}] (${s.duration})\nVoz: ${s.voice}\n${s.text}\n`)
        .join('\n---\n\n');
      zip.file('Roteiro_Narracao.txt', scriptContent);

      const zipBlob = await zip.generateAsync({ type: 'blob' }, (meta) => {
        setZipProgress(80 + Math.round(meta.percent * 0.2));
      });

      triggerDownload(zipBlob, `Recap_Imagens_Quadros_${new Date().toISOString().slice(0, 10)}.zip`);
      setSuccessMessage('Pacote de imagens ZIP baixado com sucesso!');
    } catch (err: any) {
      setErrorMessage(`Erro ao gerar ZIP: ${err.message || 'Falha inesperada'}`);
    } finally {
      setIsZipping(false);
    }
  };

  // Download script text
  const handleDownloadScript = () => {
    const scriptContent = scenes
      .map((s) => `[${s.title}] (${s.duration})\nVoz: ${s.voice}\n${s.text}\n`)
      .join('\n---\n\n');
    const blob = new Blob([scriptContent], { type: 'text/plain;charset=utf-8' });
    triggerDownload(blob, `Roteiro_Recap_${new Date().toISOString().slice(0, 10)}.txt`);
    setSuccessMessage('Roteiro de narração baixado em .txt!');
  };

  // Export JSON project backup
  const handleExportProjectJson = () => {
    const data = {
      name: 'Mec-Recap Studio Backup',
      exportedAt: new Date().toISOString(),
      chapters,
      frames,
      scenes,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    triggerDownload(blob, `Backup_Projeto_Recap_${new Date().toISOString().slice(0, 10)}.json`);
    setSuccessMessage('Backup do projeto exportado em .json!');
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-3 sm:p-5 animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-3xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 bg-muted/20 shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center text-primary shadow-xs">
              <Film className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
                Central de Exportação de Vídeo & Projeto
              </h2>
              <p className="text-xs text-muted-foreground">
                Renderização nativa acelerada por GPU ou pacote de edição externa para Shotcut
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isExporting}
            className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center border-b border-border px-6 bg-secondary/30 shrink-0 overflow-x-auto">
          <button
            onClick={() => setActiveTab('video')}
            className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'video'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Film className="h-4 w-4" />
            <span>Exportar Vídeo / Projeto</span>
          </button>

          <button
            onClick={() => setActiveTab('zip')}
            className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'zip'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <FolderArchive className="h-4 w-4" />
            <span>Pacote de Imagens ZIP</span>
          </button>

          <button
            onClick={() => setActiveTab('script')}
            className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'script'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileText className="h-4 w-4" />
            <span>Roteiro TXT</span>
          </button>

          <button
            onClick={() => setActiveTab('backup')}
            className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'backup'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span>Backup do Projeto</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Success / Error Banners */}
          {successMessage && (
            <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs font-semibold text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div className="flex items-center gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs font-semibold text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* TAB 1: VIDEO & SHOTCUT EXPORT */}
          {activeTab === 'video' && (
            <div className="space-y-6">
              {/* 1. FORMAT SELECTOR */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  1. Escolha o Formato de Saída
                </label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* MP4 Card */}
                  <div
                    onClick={() => !isExporting && setSelectedFormat('mp4')}
                    className={`relative flex flex-col p-4 rounded-xl border transition-all cursor-pointer select-none ${
                      selectedFormat === 'mp4'
                        ? 'border-primary bg-primary/10 shadow-md ring-1 ring-primary'
                        : 'border-border bg-card hover:bg-secondary/60'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-sm text-foreground flex items-center gap-1.5">
                        <Film className="h-4 w-4 text-primary" />
                        <span>MP4 (.mp4)</span>
                      </span>
                      <span className="text-[10px] font-bold text-primary bg-primary/20 px-2 py-0.5 rounded-full">
                        Recomendado
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Renderização offline acelerada por GPU via <strong>WebCodecs</strong> e multiplexador H.264 / AAC. Alta performance e compatibilidade total.
                    </p>
                  </div>

                  {/* WebM Card */}
                  <div
                    onClick={() => !isExporting && setSelectedFormat('webm')}
                    className={`relative flex flex-col p-4 rounded-xl border transition-all cursor-pointer select-none ${
                      selectedFormat === 'webm'
                        ? 'border-primary bg-primary/10 shadow-md ring-1 ring-primary'
                        : 'border-border bg-card hover:bg-secondary/60'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-sm text-foreground flex items-center gap-1.5">
                        <Flame className="h-4 w-4 text-amber-400" />
                        <span>WebM (.webm)</span>
                      </span>
                      <span className="text-[10px] font-bold text-amber-400 bg-amber-500/20 px-2 py-0.5 rounded-full">
                        Universal
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Gravação leve e compatível com todos os navegadores via <strong>MediaRecorder API</strong>. Excelente fallback sem travamentos.
                    </p>
                  </div>

                  {/* Shotcut MLT Card */}
                  <div
                    onClick={() => !isExporting && setSelectedFormat('shotcut')}
                    className={`relative flex flex-col p-4 rounded-xl border transition-all cursor-pointer select-none ${
                      selectedFormat === 'shotcut'
                        ? 'border-primary bg-primary/10 shadow-md ring-1 ring-primary'
                        : 'border-border bg-card hover:bg-secondary/60'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-sm text-foreground flex items-center gap-1.5">
                        <Sliders className="h-4 w-4 text-cyan-400" />
                        <span>Shotcut (.mlt + ZIP)</span>
                      </span>
                      <span className="text-[10px] font-bold text-cyan-400 bg-cyan-500/20 px-2 py-0.5 rounded-full">
                        Instantâneo
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Gera projeto XML com faixas <strong>V1 (fundo desfocado)</strong>, <strong>V2 (quadros)</strong> e <strong>A1 (áudio)</strong> empacotado em ZIP com as mídias.
                    </p>
                  </div>
                </div>
              </div>

              {/* 2. RESOLUTION / ASPECT RATIO */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  2. Resolução & Proporção
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div
                    onClick={() => !isExporting && setSelectedResolution('16:9')}
                    className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${
                      selectedResolution === '16:9'
                        ? 'border-primary bg-primary/10 ring-1 ring-primary'
                        : 'border-border bg-card hover:bg-secondary/60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Monitor className="h-5 w-5 text-primary" />
                      <div>
                        <p className="text-xs font-bold text-foreground">16:9 Full HD (1920×1080)</p>
                        <p className="text-[11px] text-muted-foreground">YouTube, Monitores e TVs</p>
                      </div>
                    </div>
                    {selectedResolution === '16:9' && <Check className="h-4 w-4 text-primary" />}
                  </div>

                  <div
                    onClick={() => !isExporting && setSelectedResolution('9:16')}
                    className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${
                      selectedResolution === '9:16'
                        ? 'border-primary bg-primary/10 ring-1 ring-primary'
                        : 'border-border bg-card hover:bg-secondary/60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Smartphone className="h-5 w-5 text-primary" />
                      <div>
                        <p className="text-xs font-bold text-foreground">9:16 Vertical (1080×1920)</p>
                        <p className="text-[11px] text-muted-foreground">Shorts, TikTok e Reels</p>
                      </div>
                    </div>
                    {selectedResolution === '9:16' && <Check className="h-4 w-4 text-primary" />}
                  </div>
                </div>
              </div>

              {/* 3. OPTIONS CHECKBOXES */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <label className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card/60 cursor-pointer hover:bg-secondary/40 transition-colors">
                  <input
                    type="checkbox"
                    checked={includeAudio}
                    disabled={isExporting}
                    onChange={(e) => setIncludeAudio(e.target.checked)}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <div className="flex items-center gap-2">
                    {includeAudio ? (
                      <Volume2 className="h-4 w-4 text-primary" />
                    ) : (
                      <VolumeX className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div>
                      <p className="text-xs font-semibold text-foreground">Incluir Narração / Áudio</p>
                      <p className="text-[10px] text-muted-foreground">
                        {scenesWithAudioCount} cena(s) com áudio pronto
                      </p>
                    </div>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card/60 cursor-pointer hover:bg-secondary/40 transition-colors">
                  <input
                    type="checkbox"
                    checked={includeSubtitles}
                    disabled={isExporting || selectedFormat === 'shotcut'}
                    onChange={(e) => setIncludeSubtitles(e.target.checked)}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <div className="flex items-center gap-2">
                    <Type className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-xs font-semibold text-foreground">Legendas na Imagem</p>
                      <p className="text-[10px] text-muted-foreground">
                        {selectedFormat === 'shotcut'
                          ? 'Desativado no Shotcut (editável na timeline)'
                          : 'Estilo cinematográfico semi-transparente'}
                      </p>
                    </div>
                  </div>
                </label>
              </div>

              {/* PROGRESS BAR & ACTIVE STATUS */}
              {isExporting && exportProgress && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3 animate-fade-in shadow-inner">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-foreground flex items-center gap-2">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
                      <span>{exportProgress.message}</span>
                    </span>
                    <span className="font-mono font-bold text-primary text-sm">
                      {exportProgress.percentage}%
                    </span>
                  </div>

                  {/* Progress Bar with animated gradient */}
                  <div className="h-3 w-full rounded-full bg-secondary overflow-hidden border border-border/60">
                    <div
                      className="h-full bg-gradient-to-r from-primary/80 via-primary to-emerald-400 transition-all duration-150 rounded-full"
                      style={{ width: `${Math.min(100, Math.max(1, exportProgress.percentage))}%` }}
                    />
                  </div>

                  {/* Stats Row & Cancel Button */}
                  <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground font-mono pt-1">
                    <div className="flex items-center gap-4">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-primary/70" />
                        <span>Decorrido: {formatSeconds(exportProgress.elapsedSeconds)}</span>
                      </span>
                      {exportProgress.estimatedRemainingSeconds !== undefined && (
                        <span>
                          Restante: ~{formatSeconds(exportProgress.estimatedRemainingSeconds)}
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={handleCancelExport}
                      className="px-3 py-1 rounded bg-destructive/15 text-destructive hover:bg-destructive/25 text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <StopCircle className="h-3.5 w-3.5" />
                      <span>Cancelar</span>
                    </button>
                  </div>
                </div>
              )}

              {/* FINISHED RESULT CARD */}
              {exportResult && !isExporting && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                      <div>
                        <h4 className="text-xs font-bold text-foreground">Arquivo Pronto!</h4>
                        <p className="text-[11px] font-mono text-muted-foreground">
                          {exportResult.filename} · {(exportResult.blob.size / (1024 * 1024)).toFixed(2)} MB · {exportResult.duration.toFixed(1)}s
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => triggerDownload(exportResult.blob, exportResult.filename)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500 text-black hover:bg-emerald-400 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Baixar Novamente</span>
                    </button>
                  </div>

                  {previewVideoUrl && (
                    <div className="rounded-lg overflow-hidden border border-border bg-black max-h-56 flex items-center justify-center">
                      <video
                        src={previewVideoUrl}
                        controls
                        className="max-h-56 max-w-full"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* ACTION BUTTON */}
              {!isExporting && (
                <button
                  type="button"
                  onClick={handleStartExport}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground hover:opacity-90 active:scale-[0.99] transition-all cursor-pointer shadow-lg shadow-primary/20"
                >
                  <Download className="h-4.5 w-4.5" />
                  <span>
                    {selectedFormat === 'shotcut'
                      ? 'Gerar e Baixar Projeto Shotcut (.mlt + ZIP)'
                      : `Renderizar e Baixar Vídeo (.${selectedFormat.toUpperCase()})`}
                  </span>
                </button>
              )}
            </div>
          )}

          {/* TAB 2: STANDALONE IMAGES ZIP */}
          {activeTab === 'zip' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                    <FolderArchive className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Pacote Completo de Imagens dos Recortes</h3>
                    <p className="text-xs text-muted-foreground">
                      Baixe todas as imagens dos quadros recortados organizadas por pasta de capítulo.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs bg-secondary/30 p-3 rounded-lg border border-border/60">
                  <div>
                    <span className="text-muted-foreground">Total de Quadros:</span>{' '}
                    <strong className="text-foreground">{frames.length}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Capítulos:</span>{' '}
                    <strong className="text-foreground">{chapters.length}</strong>
                  </div>
                </div>

                {isZipping ? (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-mono text-muted-foreground">
                      <span>Compactando imagens...</span>
                      <span>{zipProgress}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-150"
                        style={{ width: `${zipProgress}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleExportZip}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-xs font-bold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer shadow-md"
                  >
                    <Download className="h-4 w-4" />
                    <span>Baixar Pacote de Imagens (.ZIP)</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: SCRIPT TXT */}
          {activeTab === 'script' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Roteiro Consolidado de Narração</h3>
                    <p className="text-xs text-muted-foreground">
                      Baixe o texto e tempo de todas as cenas formatados para leitura ou locução externa.
                    </p>
                  </div>
                </div>

                <div className="max-h-60 overflow-y-auto rounded-lg border border-border bg-black/40 p-3 text-xs font-mono text-muted-foreground space-y-2">
                  {scenes.map((s, idx) => (
                    <div key={s.id} className="border-b border-border/40 pb-2 last:border-b-0">
                      <p className="font-bold text-primary">
                        {idx + 1}. {s.title} ({s.duration})
                      </p>
                      <p className="text-foreground mt-0.5">{s.text || '(Sem narração)'}</p>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleDownloadScript}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-xs font-bold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer shadow-md"
                >
                  <Download className="h-4 w-4" />
                  <span>Baixar Roteiro (.TXT)</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: BACKUP JSON */}
          {activeTab === 'backup' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                    <FileSpreadsheet className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Backup de Metadados do Projeto</h3>
                    <p className="text-xs text-muted-foreground">
                      Arquivo JSON com as marcações de corte, durações e cenas para arquivamento.
                    </p>
                  </div>
                </div>

                <button
                  onClick={handleExportProjectJson}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-xs font-bold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer shadow-md"
                >
                  <Download className="h-4 w-4" />
                  <span>Baixar Backup do Projeto (.JSON)</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
