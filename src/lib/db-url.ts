/**
 * Utilidades puras para a string de conexão do banco (sem dependências de runtime do Next).
 */

/** True quando a conexão aponta para um PostgreSQL local (sem SSL). Lê o host de fato, com ou sem credenciais. */
export function isLocalDatabaseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}
