import { timingSafeEqual, createHash } from "node:crypto";

/** Comparação de segredos em tempo constante (evita ataques por tempo de resposta). */
export function secretsMatch(provided: string | null | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  // Comparamos os hashes SHA-256 para que o tamanho não vaze e as entradas tenham o mesmo tamanho.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b) && provided.length === expected.length;
}

export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim().slice(0, 64);
  return (headers.get("x-real-ip") ?? "desconhecido").slice(0, 64);
}
