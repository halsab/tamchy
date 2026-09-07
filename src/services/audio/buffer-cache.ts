export function createBufferCache(maxBytes: number) {
  const buffers = new Map<string, AudioBuffer>();
  const size = (buffer: AudioBuffer) =>
    buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
  let bytes = 0;
  function remove(path: string) {
    const buffer = buffers.get(path);
    if (buffer) bytes -= size(buffer);
    buffers.delete(path);
  }
  return {
    get(path: string) {
      const buffer = buffers.get(path);
      if (buffer) {
        buffers.delete(path);
        buffers.set(path, buffer);
      }
      return buffer;
    },
    put(path: string, buffer: AudioBuffer, playingPath?: string) {
      remove(path);
      if (size(buffer) > maxBytes) return;
      buffers.set(path, buffer);
      bytes += size(buffer);
      while (bytes > maxBytes) {
        const oldest = [...buffers.keys()].find((key) => key !== playingPath);
        if (oldest === undefined) break;
        remove(oldest);
      }
    },
    bytes: () => bytes,
    clear() {
      buffers.clear();
      bytes = 0;
    },
  };
}
