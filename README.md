# Radar de Preços

Aplicação web privada para acompanhar preços de produtos (foco na Black Friday 2026 e em outras datas), guardar o histórico, comparar ofertas por loja e avisar quando vale a pena comprar. Uso pessoal, em português brasileiro.

- **Coleta no servidor:** a consulta de preços roda na aplicação publicada, disparada por um agendador externo a cada 6 horas. Não é preciso deixar o computador ligado.
- **Histórico append-only:** cada observação de preço é gravada e nunca alterada.
- **Honestidade nos dados:** "menor preço" significa menor preço observado no período monitorado, não o menor histórico da loja. Economia potencial (referência) e economia realizada (compras registradas) são contabilizadas separadamente. Nada é classificado automaticamente como fraude.

Documentação:

- [`docs/implantacao.md`](docs/implantacao.md): Neon, variáveis, Vercel, agendador, credenciais de APIs, backup e diagnóstico.
- [`docs/fases.md`](docs/fases.md): o que foi implementado em cada fase, arquivos, como testar, variáveis e limitações.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · PostgreSQL (Neon) · Drizzle ORM · Recharts · Zod · Vitest.

## Funcionalidades

| Área | Situação |
| --- | --- |
| Login do administrador (hash scrypt, sessão em cookie HTTP-only, rate limit) | Implementado |
| Produtos: cadastro, edição, status (monitorando, pausado, comprado, arquivado), prioridade, preço-alvo e orçamento | Implementado |
| Cadastro por link (identificação automática quando a loja permite) com preenchimento manual como fallback | Implementado (Mercado Livre) |
| Detecção de possível duplicata (GTIN, marca+modelo) com confirmação explícita | Implementado |
| Ofertas por loja, preço manual, frete (com "frete desconhecido" quando não informado), disponibilidade | Implementado |
| Coleta automática via API oficial do Mercado Livre, com lote, limite por loja, retries controlados e circuit breaker | Implementado |
| Execução duplicada bloqueada por trava no banco; cron protegido por segredo | Implementado |
| Histórico de preços, gráficos 24h/7d/30d/90d/tudo, métricas (atual, menor, maior, média, variação %, data do menor) | Implementado |
| Comparação de ofertas (total estimado, diferença R$ e %, confirmação manual de correspondência) | Implementado |
| Alertas: preço-alvo, orçamento, queda percentual, oportunidade em outra loja; sem repetição enquanto o patamar não muda | Implementado |
| Indicador de confiança (sinais, sem classificação de fraude) | Implementado |
| Painel: indicadores, fontes com falhas, preços desatualizados, últimas atualizações | Implementado |
| Lista de compras por cômodo, orçamento, registro de compra com valor pago e economia realizada | Implementado |
| Configurações (intervalo, lote, limites, referência de comparação) | Implementado |
| Amazon Brasil, Magalu, Fast Shop | **Somente reconhecimento de link**; coleta automática não integrada (ver limitações) |
| Dados de demonstração | Apenas com `RADAR_DEMO_SEED=1` em dev/teste; marcados `[DEMO]`; nunca coletados |

## Estrutura

```
src/
  app/                    rotas (App Router): painel, produtos, alertas, lista, fontes, configurações, login
    actions/              server actions (validação no servidor)
    api/cron/monitor/     endpoint do agendador (Bearer CRON_SECRET)
    api/health/           verificação de disponibilidade
  components/             interface (formulários, gráfico, tabelas)
  db/                     schema Drizzle, cliente, bootstrap de dados base
  lib/
    adapters/             adaptadores de loja (Mercado Livre; pendentes para as demais)
    analysis/             matching, referências, séries, alertas, confiança, lista de compras
    auth/                 senha, sessão, login
    monitoring/           coleta em lote, trava, observações, alertas
    repos/                consultas de leitura (catálogo, painel, configurações)
    security/             validação de URL (sem SSRF), comparação de segredos
    services/             regras de negócio de produtos, ofertas, compras, lista
drizzle/                  migrations SQL reproduzíveis
scripts/                  migrate, create-admin, run-monitor, seed-demo, backup, restore
tests/unit/               testes unitários (dados simulados, sem rede nem banco)
tests/integration/        testes com PostgreSQL local efêmero (embedded-postgres)
.github/workflows/        agendador (monitor-cron.yml) e CI (ci.yml)
```

## Desenvolvimento local

Requisitos: Node.js 20.9+ (recomendado 22) e um PostgreSQL acessível.

```bash
npm install
cp .env.example .env.local      # preencha DATABASE_URL, SESSION_SECRET, APP_URL, CRON_SECRET
npm run db:migrate              # cria/atualiza as tabelas
DATABASE_URL=... ADMIN_EMAIL=voce@exemplo.com ADMIN_PASSWORD=... npm run admin:create
npm run dev                     # http://localhost:3000
```

Dados de demonstração (opcional, só para ver a interface):

```bash
RADAR_DEMO_SEED=1 DATABASE_URL=... npm run seed:demo
```

Os dados demo são marcados como `source='demo'`, aparecem com `[DEMO]` e são excluídos da coleta. Não use em produção.

## Testes

```bash
npm run typecheck          # tsc --noEmit
npm run test:unit          # cálculos, matching, alertas, adaptadores, segurança, formulários
npm run test:integration   # sobe um PostgreSQL efêmero próprio (porta 54399 ou RADAR_TEST_PG_PORT)
npm test                   # tudo
npm run build              # build de produção
```

Os testes de integração criam um cluster temporário em `.pgdata-test/`, aplicam as migrations de `drizzle/` e apagam o cluster ao final. Não usam o banco de produção nem a `DATABASE_URL` do ambiente.

O workflow `.github/workflows/ci.yml` executa tipos, testes e build a cada push e pull request.

## Operação

- Painel: `/`. Produtos: `/produtos` (busca, filtros por categoria, loja, prioridade, status e faixa de preço, ordenação e paginação). Detalhes: `/produtos/[id]`.
- Coleta manual: botão "Consultar fontes agora" no painel ou na página do produto.
- Coleta agendada: `.github/workflows/monitor-cron.yml`, a cada 6 horas (UTC). Configure os secrets `APP_URL` e `CRON_SECRET` no GitHub.
- Backup e restauração: `scripts/backup.sh` e `scripts/restore.sh` (detalhes em `docs/implantacao.md`).

## Segurança

- Rotas do painel exigem sessão; sem sessão, redirecionam para `/login`.
- O endpoint de coleta exige `Authorization: Bearer <CRON_SECRET>`. Sem segredo configurado, responde 503.
- URLs informadas pelo usuário passam por validação: apenas https e hosts públicos. Endereços internos (localhost, IPs privados, metadados de nuvem) são recusados.
- Ações sensíveis (login, criação de oferta, identificação por link) têm limite de tentativas no banco.
- Segredos somente em variáveis de ambiente. `.env*` é ignorado pelo Git, exceto `.env.example`.
- O Radar não contorna CAPTCHA, autenticação obrigatória, limites nem proteções de lojas.

## Limitações conhecidas

- Coleta automática apenas no Mercado Livre (API oficial). As demais lojas precisam de atualização manual até que a integração seja verificada na documentação oficial de cada uma.
- Frete ao CEP não é obtido automaticamente; sem o valor informado, a comparação usa "frete desconhecido".
- Os scripts de backup não foram executados neste ambiente (cliente `pg_dump` indisponível). Teste a restauração antes de depender deles.
- Não há teste de ponta a ponta no navegador nem teste de carga; o plano de Black Friday está em `docs/fases.md`.
