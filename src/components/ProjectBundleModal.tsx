import React, { useState } from 'react';
import {
  X,
  Download,
  CheckCircle2,
  AlertCircle,
  Package,
  Zap,
  Layers,
  FileArchive,
  Loader2,
  HardDrive,
  Info,
} from 'lucide-react';
import { BundleMode, BundleProgress } from '../utils/projectBundle';

interface ProjectBundleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (mode: BundleMode) => Promise<void>;
  isProcessing: boolean;
  progress: BundleProgress | null;
  error: string | null;
  successFilename: string | null;
  stats: {
    chaptersCount: number;
    pagesCount: number;
    framesCount: number;
    scenesCount: number;
    audioCount: number;
  };
}

export const ProjectBundleModal: React.FC<ProjectBundleModalProps> = ({
  isOpen,
  onClose,
  onExport,
  isProcessing,
  progress,
  error,
  successFilename,
  stats,
}) => {
  const [selectedMode, setSelectedMode] = useState<BundleMode>('full');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in select-none">
      <div className="relative w-full max-w-xl rounded-2xl border border-white/10 bg-[#141620]/95 backdrop-blur-2xl shadow-2xl shadow-black/80 overflow-hidden ring-1 ring-white/5">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-md shadow-emerald-500/10">
              <FileArchive className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-base sm:text-lg font-bold text-white flex items-center gap-2">
                Salvar Arquivo de Projeto (.recap)
              </h2>
              <p className="text-xs text-muted-foreground">
                Exporte um pacote autocontido para trabalhar em outro computador ou compartilhar.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="rounded-lg p-2 text-muted-foreground hover:bg-white/10 hover:text-foreground transition-colors disabled:opacity-50 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {error && (
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-destructive/15 border border-destructive/30 text-destructive text-xs">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successFilename ? (
            <div className="space-y-4 py-3 text-center">
              <div className="mx-auto h-12 w-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white">Projeto Salvo com Sucesso!</h3>
                <p className="text-xs text-muted-foreground">
                  O download do arquivo <span className="font-mono text-cyan-300 font-semibold">{successFilename}</span> foi iniciado.
                </p>
              </div>
              <p className="text-[11px] text-gray-400 max-w-md mx-auto">
                Você pode levar este arquivo para qualquer máquina, abrir no Mec-Recaps e continuar exatamente de onde parou.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-6 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </div>
          ) : isProcessing ? (
            <div className="space-y-4 py-4">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-white flex items-center gap-2">
                  <Loader2 className="h-4 w-4 text-emerald-400 animate-spin" />
                  {progress?.message || 'Processando projeto...'}
                </span>
                <span className="font-mono text-emerald-400 font-bold">
                  {progress?.percentage || 0}%
                </span>
              </div>

              {/* Progress Track */}
              <div className="h-2.5 w-full bg-white/5 rounded-full overflow-hidden border border-white/10 p-[1px]">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 rounded-full transition-all duration-300 shadow-sm"
                  style={{ width: `${progress?.percentage || 0}%` }}
                />
              </div>

              <p className="text-[11px] text-muted-foreground text-center">
                Mantenha a janela aberta enquanto compactamos os arquivos de mídia.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Stats overview */}
              <div className="grid grid-cols-4 gap-2.5 p-3 rounded-xl bg-white/[0.03] border border-white/5 text-center">
                <div>
                  <div className="text-xs font-bold text-white">{stats.chaptersCount}</div>
                  <div className="text-[10px] text-muted-foreground">Capítulos</div>
                </div>
                <div>
                  <div className="text-xs font-bold text-white">{stats.pagesCount}</div>
                  <div className="text-[10px] text-muted-foreground">Páginas</div>
                </div>
                <div>
                  <div className="text-xs font-bold text-emerald-400">{stats.framesCount}</div>
                  <div className="text-[10px] text-muted-foreground">Quadros</div>
                </div>
                <div>
                  <div className="text-xs font-bold text-cyan-400">{stats.audioCount}</div>
                  <div className="text-[10px] text-muted-foreground">Áudios</div>
                </div>
              </div>

              {/* Mode Selection */}
              <div className="space-y-2.5">
                <label className="text-xs font-semibold text-gray-300">
                  Selecione o formato de empacotamento:
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Full Package */}
                  <div
                    onClick={() => setSelectedMode('full')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      selectedMode === 'full'
                        ? 'border-emerald-500/60 bg-emerald-500/10 shadow-lg shadow-emerald-500/5'
                        : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 mb-2">
                      <div
                        className={`h-7 w-7 rounded-lg flex items-center justify-center ${
                          selectedMode === 'full'
                            ? 'bg-emerald-500 text-black'
                            : 'bg-white/10 text-gray-400'
                        }`}
                      >
                        <Package className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white">Pacote Completo</div>
                        <div className="text-[10px] text-emerald-400 font-medium">Recomendado</div>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Inclui todas as páginas originais dos capítulos, recortes, timeline e narrações. Permite criar novos recortes na outra máquina.
                    </p>
                  </div>

                  {/* Compact Package */}
                  <div
                    onClick={() => setSelectedMode('compact')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      selectedMode === 'compact'
                        ? 'border-cyan-500/60 bg-cyan-500/10 shadow-lg shadow-cyan-500/5'
                        : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 mb-2">
                      <div
                        className={`h-7 w-7 rounded-lg flex items-center justify-center ${
                          selectedMode === 'compact'
                            ? 'bg-cyan-500 text-black'
                            : 'bg-white/10 text-gray-400'
                        }`}
                      >
                        <Zap className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white">Pacote Compacto</div>
                        <div className="text-[10px] text-cyan-400 font-medium">Super Leve</div>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Salva apenas os quadros já recortados, roteiro, áudios e timeline. Ignora páginas brutas não utilizadas para um arquivo menor.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/5 text-[11px] text-muted-foreground">
                <Info className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                <span>
                  O arquivo gerado terá a extensão <strong className="text-white">.recap</strong> e poderá ser aberto pelo menu ou arrastando para o estúdio.
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-medium text-gray-300 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => onExport(selectedMode)}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold transition-all shadow-lg shadow-emerald-500/20 cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Salvar Arquivo .recap</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
