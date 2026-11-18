/** The largest upload accepted, in bytes. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface FileType {
  extension: string;
  /** The bytes every file of this type starts with ("magic number"). */
  signature: Uint8Array;
}

export const FILE_TYPES: Record<string, FileType> = {
  'image/png': { extension: 'png', signature: Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) },
  'image/jpeg': { extension: 'jpg', signature: Uint8Array.of(0xff, 0xd8, 0xff) },
  'application/pdf': { extension: 'pdf', signature: Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x2d) }, // %PDF-
};

export function startsWith(bytes: Uint8Array, signature: Uint8Array): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, i) => bytes[i] === byte);
}
