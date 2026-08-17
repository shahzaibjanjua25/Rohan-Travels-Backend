const crypto = require('crypto');
const config = require('../config/env');

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1:';
const IV_BYTES = 12; // GCM standard
const TAG_BYTES = 16;

/** True if the value has already been through `encrypt`. */
const isEncrypted = (value) => typeof value === 'string' && value.startsWith(PREFIX);

const getKey = () => {
  if (!config.encryptionKey) {
    throw new Error(
      'ENCRYPTION_KEY is not set. Required to store passenger identity documents. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(config.encryptionKey, 'hex');
};

/**
 * Authenticated encryption. GCM is used rather than CBC so tampering with the
 * ciphertext is detected on decrypt instead of yielding garbage plaintext.
 *
 * Output format: enc:v1:<base64(iv | authTag | ciphertext)>
 * The version tag leaves room to rotate algorithms without a migration guess.
 */
const encrypt = (plaintext) => {
  if (plaintext == null || plaintext === '') return plaintext;
  if (isEncrypted(plaintext)) return plaintext; // never double-encrypt

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
};

const decrypt = (payload) => {
  if (payload == null || payload === '') return payload;
  if (!isEncrypted(payload)) return payload; // legacy plaintext, pass through

  const raw = Buffer.from(payload.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
};

/** For display and logs: MW1234567 -> ••••••567 */
const maskIdentifier = (value, visible = 3) => {
  if (!value) return '';
  const s = String(value);
  if (s.length <= visible) return '•'.repeat(s.length);
  return '•'.repeat(s.length - visible) + s.slice(-visible);
};

module.exports = { encrypt, decrypt, isEncrypted, maskIdentifier };
