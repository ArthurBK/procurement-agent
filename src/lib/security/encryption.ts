import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ENCRYPTION_VERSION = "v1";
const IV_BYTES = 12;

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptSecret(encryptedValue: string): string {
  const [version, ivValue, authTagValue, ciphertextValue] =
    encryptedValue.split(":");

  if (version !== ENCRYPTION_VERSION || !ivValue || !authTagValue || !ciphertextValue) {
    throw new Error("Encrypted secret format is invalid.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function getEncryptionKey(): Buffer {
  const configuredKey = process.env.ENCRYPTION_KEY?.trim();

  if (!configuredKey) {
    throw new Error("ENCRYPTION_KEY is not configured");
  }

  const decodedKey = decodeConfiguredKey(configuredKey);

  if (decodedKey.length === 32) {
    return decodedKey;
  }

  return createHash("sha256").update(configuredKey).digest();
}

function decodeConfiguredKey(configuredKey: string): Buffer {
  if (/^[a-f0-9]{64}$/i.test(configuredKey)) {
    return Buffer.from(configuredKey, "hex");
  }

  try {
    return Buffer.from(configuredKey, "base64");
  } catch {
    return Buffer.from(configuredKey, "utf8");
  }
}
