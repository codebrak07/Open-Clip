import crypto from 'crypto';

// Use standard AES-256-GCM encryption with fixed key length (pad/hash key derived from secret)
const ENCRYPTION_KEY = crypto.createHash('sha256').update(process.env.SECRET_KEY || 'openclip-default-secret-key-2026').digest();
const ALGORITHM = 'aes-256-gcm';

export function encryptText(plainText: string): string {
  if (!plainText) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptText(encryptedText: string): string {
  if (!encryptedText) return '';
  if (!encryptedText.includes(':')) return encryptedText; // Fallback if plain
  const parts = encryptedText.split(':');
  if (parts.length !== 3) return encryptedText;
  
  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
