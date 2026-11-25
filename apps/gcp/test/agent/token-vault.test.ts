import { describe, expect, it } from "vitest";
import { TokenEncryptionUnavailableError, TokenVault } from "../../src/agent/token-vault";

const KEY = Buffer.alloc(32, 1).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 2).toString("base64");
const tokens = { access_token: "very-secret-access-token", refresh_token: "very-secret-refresh" };

describe("TokenVault", () => {
  it("round-trips tokens with AES-GCM and never stores them in clear", async () => {
    const vault = new TokenVault({ TOKEN_ENCRYPTION_KEY: KEY, ENVIRONMENT: "production" });
    const sealed = await vault.seal(tokens, "mcp:salesforce:tokens");
    expect(sealed.startsWith("aesgcm:v1:")).toBe(true);
    expect(sealed).not.toContain("very-secret");
    expect(await vault.open(sealed, "mcp:salesforce:tokens")).toEqual(tokens);
    // A fresh IV each time, so equal tokens do not produce equal ciphertexts.
    expect(await vault.seal(tokens, "mcp:salesforce:tokens")).not.toBe(sealed);
  });

  it("rejects a sealed value moved to another key or opened with another secret", async () => {
    const vault = new TokenVault({ TOKEN_ENCRYPTION_KEY: KEY });
    const sealed = await vault.seal(tokens, "mcp:a:tokens");
    await expect(vault.open(sealed, "mcp:b:tokens")).rejects.toThrow();
    await expect(
      new TokenVault({ TOKEN_ENCRYPTION_KEY: OTHER_KEY }).open(sealed, "mcp:a:tokens"),
    ).rejects.toThrow();
  });

  it("refuses to store tokens without a key outside local development", async () => {
    const vault = new TokenVault({ ENVIRONMENT: "production" });
    expect(vault.canStore).toBe(false);
    await expect(vault.seal(tokens, "k")).rejects.toBeInstanceOf(TokenEncryptionUnavailableError);
    await expect(new TokenVault({}).seal(tokens, "k")).rejects.toThrow(
      "TOKEN_ENCRYPTION_KEY is not set",
    );
  });

  it("stores plaintext only for ENVIRONMENT=local, and nowhere else will read it back", async () => {
    const local = new TokenVault({ ENVIRONMENT: "local" });
    const plain = await local.seal(tokens, "k");
    expect(await local.open(plain, "k")).toEqual(tokens);
    await expect(
      new TokenVault({ ENVIRONMENT: "production", TOKEN_ENCRYPTION_KEY: KEY }).open(plain, "k"),
    ).rejects.toThrow("Refusing an unencrypted");
  });

  it("rejects a key that is not 32 bytes", async () => {
    const vault = new TokenVault({ TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") });
    await expect(vault.seal(tokens, "k")).rejects.toThrow("must decode to 32 bytes");
  });
});
