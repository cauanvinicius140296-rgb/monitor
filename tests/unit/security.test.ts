import { describe, expect, it } from "vitest";
import { parseUserProductUrl, canonicalizeUrl, isInternalHostname, UnsafeUrlError } from "@/lib/security/url";
import { bearerToken, secretsMatch } from "@/lib/security/secret";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { isLocalDatabaseUrl } from "@/lib/db-url";

describe("URLs de produtos (SSRF)", () => {
  it("aceita apenas HTTPS público", () => {
    expect(parseUserProductUrl("https://www.mercadolivre.com.br/produto-x/p/MLB1").hostname).toBe("www.mercadolivre.com.br");
    expect(() => parseUserProductUrl("http://www.mercadolivre.com.br/x")).toThrow(UnsafeUrlError);
    expect(() => parseUserProductUrl("ftp://exemplo.com/x")).toThrow(UnsafeUrlError);
    expect(() => parseUserProductUrl("não é url")).toThrow(UnsafeUrlError);
  });

  it("bloqueia redes internas e metadados de nuvem", () => {
    for (const u of [
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://10.0.0.5/x",
      "https://192.168.1.10/x",
      "https://172.16.4.2/x",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/x",
      "https://intranet.local/x",
    ]) {
      expect(() => parseUserProductUrl(u), u).toThrow(UnsafeUrlError);
    }
    expect(isInternalHostname("exemplo.com.br")).toBe(false);
  });

  it("bloqueia credenciais embutidas e portas não padrão", () => {
    expect(() => parseUserProductUrl("https://user:senha@exemplo.com.br/x")).toThrow(UnsafeUrlError);
    expect(() => parseUserProductUrl("https://exemplo.com.br:8443/x")).toThrow(UnsafeUrlError);
  });

  it("canonicaliza removendo rastreamento e fragmentos", () => {
    const c = canonicalizeUrl(new URL("https://WWW.Exemplo.com.br/produto/?utm_source=x&id=7#topo"));
    expect(c).toBe("https://exemplo.com.br/produto/?id=7");
  });
});

describe("segredos e tokens", () => {
  it("compara segredos em tempo constante e rejeita vazios", () => {
    expect(secretsMatch("abc123", "abc123")).toBe(true);
    expect(secretsMatch("abc124", "abc123")).toBe(false);
    expect(secretsMatch("abc", "abc123")).toBe(false);
    expect(secretsMatch("", "")).toBe(false);
    expect(secretsMatch(undefined, "abc")).toBe(false);
  });

  it("extrai o Bearer do cabeçalho", () => {
    expect(bearerToken("Bearer  tok123 ")).toBe("tok123");
    expect(bearerToken("Basic xyz")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});

describe("senhas", () => {
  it("gera hash scrypt que verifica a senha correta e rejeita outras", async () => {
    const stored = await hashPassword("senha-forte-123");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(stored).not.toContain("senha-forte-123");
    expect(await verifyPassword("senha-forte-123", stored)).toBe(true);
    expect(await verifyPassword("senha-errada-123", stored)).toBe(false);
    expect(await verifyPassword("x", "formato-invalido")).toBe(false);
  });

  it("recusa senhas curtas", async () => {
    await expect(hashPassword("curta")).rejects.toThrow();
  });
});

describe("conexão com o banco", () => {
  it("detecta host local mesmo com credenciais na URL", () => {
    expect(isLocalDatabaseUrl("postgresql://postgres:pw@127.0.0.1:5432/x")).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://u:p@localhost/x")).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://u:p@ep-x.sa-east-1.aws.neon.tech/x?sslmode=require")).toBe(false);
    expect(isLocalDatabaseUrl("não é url")).toBe(false);
  });
});
