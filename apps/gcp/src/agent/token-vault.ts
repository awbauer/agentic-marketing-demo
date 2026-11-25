/**
 * Seals MCP OAuth material (tokens, client secrets, PKCE verifiers) before it enters the agent's
 * SQLite image, because that image is copied to object storage on every snapshot. AES-GCM with the
 * storage key as additional data, so a sealed value cannot be replayed under another key.
 */
export interface TokenVaultEnv {
  TOKEN_ENCRYPTION_KEY?: string;
  ENVIRONMENT?: string;
}

export class TokenEncryptionUnavailableError extends Error {
  constructor() {
    super(
      "MCP OAuth tokens cannot be stored: TOKEN_ENCRYPTION_KEY is not set. Set it to a base64-encoded 32-byte key (only ENVIRONMENT=local may store tokens unencrypted).",
    );
    this.name = "TokenEncryptionUnavailableError";
  }
}

const SEALED_PREFIX = "aesgcm:v1:";
const PLAIN_PREFIX = "plain:";

export class TokenVault {
  readonly #key: Promise<CryptoKey> | null;
  readonly #allowPlaintext: boolean;

  constructor(env: TokenVaultEnv) {
    const raw = env.TOKEN_ENCRYPTION_KEY?.trim();
    this.#key = raw ? importKey(raw) : null;
    this.#allowPlaintext = env.ENVIRONMENT === "local";
    // An unusable key must fail loudly when first used, not when the process boots.
    this.#key?.catch(() => {});
  }

  /** Whether `seal` will succeed; checked before an OAuth flow starts so it fails before redirecting. */
  get canStore() {
    return this.#key !== null || this.#allowPlaintext;
  }

  async seal(value: unknown, binding: string): Promise<string> {
    const json = JSON.stringify(value);
    if (!this.#key) {
      if (!this.#allowPlaintext) throw new TokenEncryptionUnavailableError();
      return `${PLAIN_PREFIX}${json}`;
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encode(binding) },
      await this.#key,
      encode(json),
    );
    return `${SEALED_PREFIX}${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
  }

  async open<T>(sealed: string, binding: string): Promise<T> {
    if (sealed.startsWith(PLAIN_PREFIX)) {
      if (!this.#allowPlaintext)
        throw new Error("Refusing an unencrypted MCP credential outside ENVIRONMENT=local.");
      return JSON.parse(sealed.slice(PLAIN_PREFIX.length)) as T;
    }
    if (!sealed.startsWith(SEALED_PREFIX))
      throw new Error("Unrecognized sealed credential format.");
    if (!this.#key) throw new TokenEncryptionUnavailableError();
    const [ivText, dataText] = sealed.slice(SEALED_PREFIX.length).split(".");
    if (!ivText || !dataText) throw new Error("Malformed sealed credential.");
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(ivText), additionalData: encode(binding) },
      await this.#key,
      fromBase64(dataText),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  }
}

async function importKey(base64: string) {
  const bytes = fromBase64(base64);
  if (bytes.length !== 32)
    throw new Error(`TOKEN_ENCRYPTION_KEY must decode to 32 bytes; it decodes to ${bytes.length}.`);
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function encode(text: string) {
  return new TextEncoder().encode(text);
}

function toBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(text: string) {
  return new Uint8Array(Buffer.from(text, "base64"));
}
