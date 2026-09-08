export function createPixelCache<
  T extends { data: Uint8Array | Uint8ClampedArray },
>(maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new Error('Некорректный бюджет пикселей');
  const entries = new Map<string, T>();
  let bytes = 0;
  function remove(key: string) {
    const value = entries.get(key);
    if (value) bytes -= value.data.byteLength;
    entries.delete(key);
  }
  return {
    remove,
    get(key: string) {
      const value = entries.get(key);
      if (value) {
        entries.delete(key);
        entries.set(key, value);
      }
      return value;
    },
    put(key: string, value: T) {
      remove(key);
      if (value.data.byteLength > maxBytes) return;
      entries.set(key, value);
      bytes += value.data.byteLength;
      while (bytes > maxBytes) remove(entries.keys().next().value!);
    },
    bytes: () => bytes,
    clear() {
      entries.clear();
      bytes = 0;
    },
  };
}
