/**
 * ChunkedMemoryBuffer
 *
 * Gerenciador de memória paginada em blocos de 8 MB para o mp4-muxer.
 * 
 * Substitui o ArrayBufferTarget tradicional por StreamTarget, eliminando
 * completamente o erro fatal "RangeError: Array buffer allocation failed".
 * 
 * Por que isso é necessário?
 * O ArrayBufferTarget tenta alocar um único ArrayBuffer contíguo de 1 GB a 2 GB+
 * (dobrando de 2 em 2), o que estoura o limite máximo de alocação de chunk
 * contíguo do motor V8/Chromium.
 * 
 * Já o ChunkedMemoryBuffer:
 * 1. Aloca apenas pequenos blocos de 8 MB sob demanda conforme os dados chegam.
 * 2. Suporta escrita e remendos de cabeçalho em qualquer posição (ex.: box mdat).
 * 3. Cria o Blob final passando a lista de blocos para `new Blob(chunks)`, que
 *    é montado nativamente pelo navegador sem exigir memória contígua.
 */
export class ChunkedMemoryBuffer {
  readonly chunkSize: number;
  private chunks = new Map<number, Uint8Array>();
  private totalLength = 0;

  constructor(chunkSize = 8 * 1024 * 1024) {
    this.chunkSize = chunkSize;
  }

  /**
   * Escreve dados na posição especificada.
   * Suporta dados que cruzam a fronteira entre blocos e escritas retroativas (patches).
   */
  write(data: Uint8Array, position: number): void {
    let offset = 0;
    while (offset < data.byteLength) {
      const currentPos = position + offset;
      const chunkIndex = Math.floor(currentPos / this.chunkSize);
      const chunkOffset = currentPos % this.chunkSize;
      const bytesToWrite = Math.min(data.byteLength - offset, this.chunkSize - chunkOffset);

      let chunk = this.chunks.get(chunkIndex);
      if (!chunk) {
        chunk = new Uint8Array(this.chunkSize);
        this.chunks.set(chunkIndex, chunk);
      }

      chunk.set(data.subarray(offset, offset + bytesToWrite), chunkOffset);
      offset += bytesToWrite;

      if (currentPos + bytesToWrite > this.totalLength) {
        this.totalLength = currentPos + bytesToWrite;
      }
    }
  }

  /**
   * Retorna o tamanho total dos dados gravados até o momento em bytes.
   */
  get size(): number {
    return this.totalLength;
  }

  /**
   * Converte os blocos gravados em um Blob final com o tipo MIME especificado.
   */
  toBlob(mimeType = 'video/mp4'): Blob {
    if (this.totalLength === 0) {
      return new Blob([], { type: mimeType });
    }

    const parts: Uint8Array[] = [];
    const numChunks = Math.ceil(this.totalLength / this.chunkSize);

    for (let i = 0; i < numChunks; i++) {
      const chunk = this.chunks.get(i);
      if (!chunk) {
        parts.push(new Uint8Array(this.chunkSize));
        continue;
      }
      if (i === numChunks - 1) {
        const lastChunkSize = this.totalLength - (i * this.chunkSize);
        parts.push(chunk.subarray(0, lastChunkSize));
      } else {
        parts.push(chunk);
      }
    }

    return new Blob(parts as BlobPart[], { type: mimeType });
  }

  /**
   * Libera as referências dos blocos para o Garbage Collector.
   */
  clear(): void {
    this.chunks.clear();
    this.totalLength = 0;
  }
}
