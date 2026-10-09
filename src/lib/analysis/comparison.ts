/**
 * Ordenação de ofertas para comparação (função pura).
 *
 * Regras, na ordem:
 * 1. Ofertas ativas com preço comparável conhecido (preço + frete quando o frete é
 *    conhecido) vêm primeiro, em ordem crescente de total.
 * 2. Ofertas ativas sem preço conhecido vêm em seguida, em ordem alfabética de loja.
 * 3. Ofertas correspondentes como "divergente" (outro produto) ficam por último no
 *    grupo ativo: não fazem sentido na comparação, mas continuam visíveis para revisão.
 * 4. Ofertas desativadas ficam sempre no final, mantendo a mesma lógica interna.
 *
 * A ordenação nunca esconde informação: apenas reordena para leitura.
 */

export interface ComparableOffer {
  storeName: string;
  comparableCents: number | null;
  availability: "disponivel" | "indisponivel" | "desconhecido";
  matchStatus: "confirmado" | "pendente" | "divergente";
  isActive: boolean;
}

function offerRank(o: ComparableOffer): number {
  if (!o.isActive) return 4;
  if (o.matchStatus === "divergente") return 3;
  if (o.comparableCents === null) return 2;
  return 1;
}

export function sortOffersForComparison<T extends ComparableOffer>(offers: T[]): T[] {
  return [...offers].sort((a, b) => {
    const ra = offerRank(a);
    const rb = offerRank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 1) {
      const diff = (a.comparableCents ?? 0) - (b.comparableCents ?? 0);
      if (diff !== 0) return diff;
    }
    return a.storeName.localeCompare(b.storeName, "pt-BR");
  });
}
