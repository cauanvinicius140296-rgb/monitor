export const ROOMS = ["Cozinha", "Lavanderia", "Sala", "Quarto", "Banheiro", "Escritório", "Outros"] as const;
export type Room = (typeof ROOMS)[number];

export const PRIORITY_LABELS: Record<string, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

export const STATUS_LABELS: Record<string, string> = {
  monitorando: "Monitorando",
  comprado: "Comprado",
  pausado: "Pausado",
  arquivado: "Arquivado",
};

export const AVAILABILITY_LABELS: Record<string, string> = {
  disponivel: "Disponível",
  indisponivel: "Indisponível",
  desconhecido: "Desconhecida",
};

export const MATCH_LABELS: Record<string, string> = {
  confirmado: "Confirmado",
  pendente: "Pendente",
  divergente: "Divergente",
};

export const CATEGORIES = [
  "Eletrodomésticos",
  "Móveis",
  "Eletrônicos",
  "Utensílios domésticos",
  "Decoração",
  "Casa e limpeza",
  "Outros",
] as const;
