import { deflateSync, inflateSync } from 'node:zlib';

/**
 * 压缩任意可序列化对象为 Buffer
 * 使用 zlib deflate 算法，压缩率通常在 50-70%
 * @param payload 要压缩的对象
 * @returns 压缩后的 Buffer
 * @throws 序列化或压缩失败时抛出异常
 */
export function compressToBuffer (payload: unknown): Buffer {
  const serialized = Buffer.from(JSON.stringify(payload), 'utf-8');
  return deflateSync(serialized);
}

/**
 * 解压 Buffer 并解析为对象
 * @param compressed 压缩后的 Buffer
 * @returns 解压并解析后的对象
 * @throws 解压或解析失败时抛出异常
 */
export function decompressToObject<T = unknown> (compressed: Buffer): T {
  const inflated = inflateSync(compressed);
  return JSON.parse(inflated.toString('utf-8')) as T;
}

/**
 * 安全解压，失败时返回 null
 * @param compressed 压缩后的 Buffer
 * @returns 解压后的对象，失败返回 null
 */
export function safeDecompress<T = unknown> (compressed: Buffer | null | undefined): T | null {
  if (!compressed) return null;
  try {
    return decompressToObject<T>(compressed);
  } catch {
    return null;
  }
}
