import path from 'path';
import fs from 'fs';

export function getStoryOutputsDir(): string {
  const root = process.cwd().endsWith('backend') ? path.resolve(process.cwd(), '..') : process.cwd();
  const dir = path.resolve(root, 'backend/storage/outputs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveStoryFile(jobId: string, extensionOrSuffix: string): string {
  const dir = getStoryOutputsDir();
  const primary = path.join(dir, `${jobId}${extensionOrSuffix}`);
  if (fs.existsSync(primary)) return primary;

  // Also check nested backend/backend if spawned from subfolder
  const nested = path.resolve(dir, '../../backend/storage/outputs', `${jobId}${extensionOrSuffix}`);
  if (fs.existsSync(nested)) return nested;

  return primary;
}
