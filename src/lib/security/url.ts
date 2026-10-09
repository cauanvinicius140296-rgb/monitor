/**
 * Validação de URLs fornecidas pelo usuário.
 *
 * Regras de segurança:
 * - Apenas HTTPS, sem credenciais embutidas e sem portas não padrão.
 * - Hosts literais de IP privado/loopback/link-local e nomes internos são recusados.
 * - O sistema NÃO busca URLs arbitrárias: a coleta só ocorre em adaptadores com
 *   host de API fixo. `assertSafeExternalUrl` existe para qualquer futura busca
 *   de URL informada pelo usuário.
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const MAX_URL_LENGTH = 2048;

/** Verifica se um endereço IPv4 literal pertence a faixas privadas, loopback ou especiais. */
export function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast e reservados
  return false;
}

/** Verifica IPv6 literal de loopback, unique-local, link-local ou mapeado para IPv4 privado. */
export function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h.includes(":")) return false;
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // fc00::/7
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return true; // fe80::/10
  const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (mapped && isPrivateIPv4(mapped[1])) return true;
  return false;
}

export function isInternalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (!h.includes(".")) return true; // nome de uma só label (ex.: "intranet")
  if (isPrivateIPv4(h) || isPrivateIPv6(h)) return true;
  return false;
}

/** Valida uma URL de produto informada pelo usuário. Lança UnsafeUrlError se inválida. */
export function parseUserProductUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new UnsafeUrlError("Informe a URL do produto.");
  if (trimmed.length > MAX_URL_LENGTH) throw new UnsafeUrlError("URL muito longa.");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new UnsafeUrlError("URL inválida. Cole o endereço completo, começando com https://");
  }
  if (url.protocol !== "https:") throw new UnsafeUrlError("Apenas URLs HTTPS são aceitas.");
  if (url.username || url.password) throw new UnsafeUrlError("URLs com usuário/senha não são aceitas.");
  if (url.port && url.port !== "443") throw new UnsafeUrlError("Porta não padrão não é aceita.");
  if (isInternalHostname(url.hostname)) throw new UnsafeUrlError("Endereço de rede interna não é permitido.");
  return url;
}

/** Garante que uma URL externa aponta para um host público. Use antes de qualquer busca futura. */
export function assertSafeExternalUrl(raw: string): URL {
  return parseUserProductUrl(raw);
}

/** Normaliza o host removendo "www." para comparação com domínios cadastrados. */
export function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

export function hostMatchesDomain(hostname: string, domain: string): boolean {
  const host = normalizeHost(hostname);
  const d = domain.toLowerCase().replace(/^www\./, "");
  return host === d || host.endsWith(`.${d}`);
}

/** Remove parâmetros de rastreamento e fragmentos para uma URL estável. */
export function canonicalizeUrl(url: URL): string {
  const clean = new URL(url.toString());
  clean.hash = "";
  const toDrop: string[] = [];
  clean.searchParams.forEach((_v, k) => {
    if (/^(utm_|fbclid|gclid|mc_|ref|_ga|pf_rd_|pd_rd_|sr=|qid|ts)/i.test(k)) toDrop.push(k);
  });
  toDrop.forEach((k) => clean.searchParams.delete(k));
  clean.hostname = normalizeHost(clean.hostname);
  return clean.toString().replace(/\/+$/, "");
}
