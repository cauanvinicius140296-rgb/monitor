
/** Lê uma variável de ambiente opcional (string vazia é tratada como ausente). */
export function env(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Lê uma variável obrigatória e falha com mensagem clara (sem expor o valor). */
export function requireEnv(name: string): string {
  const value = env(name);
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function getSessionSecret(): string {
  const secret = requireEnv("SESSION_SECRET");
  if (secret.length < 32) {
    throw new Error("SESSION_SECRET deve ter pelo menos 32 caracteres.");
  }
  return secret;
}

export function getAppUrl(): string {
  return (env("APP_URL") ?? "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * Guarda de execução: módulos que acessam segredos ou o banco não podem ser
 * executados no navegador. Componentes client devem importar apenas tipos/funções puras.
 */
export function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new Error("Módulo de servidor carregado no navegador. Isto não é permitido.");
  }
}
