import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedSecret {
  ciphertext: string;
  nonce: string;
  tag: string;
}

function requireKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Credential encryption requires a 32-byte key.');
}

export function encryptSecret(plaintext: string, key: Buffer): EncryptedSecret {
  requireKey(key);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

export function decryptSecret(secret: EncryptedSecret, key: Buffer): string {
  requireKey(key);
  try {
    const nonce = Buffer.from(secret.nonce, 'base64');
    const tag = Buffer.from(secret.tag, 'base64');
    if (nonce.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted record.');
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Stored credentials could not be decrypted. Restore the original deployment encryption key.');
  }
}
