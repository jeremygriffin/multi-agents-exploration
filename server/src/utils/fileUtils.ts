import { mkdir } from 'fs/promises';
import { join } from 'path';

const STORAGE_DIR = join(process.cwd(), 'storage');

export const ensureStorageDir = async (): Promise<string> => {
  await mkdir(STORAGE_DIR, { recursive: true });
  return STORAGE_DIR;
};

export const sanitizeFilename = (filename: string): string => {
  const base = filename.replace(/\\/g, '/').split('/').pop() ?? 'file';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
};

export const buildStoredFilename = (originalName: string, timestamp: number): string => {
  const safe = sanitizeFilename(originalName);
  return `${timestamp}_${safe}`;
};
