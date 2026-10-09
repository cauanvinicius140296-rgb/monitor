# Relatório por fase

Cada fase traz: o que foi implementado, arquivos principais, como testar, variáveis de ambiente e limitações. Estado em 2026-10-09.

Legenda: **Concluída** = implementada e testada neste repositório. **Parcial** = implementada com lacunas declaradas.

---

## Fase 1 — Fundação · Concluída

**Implementado**

- Projeto Next.js (App Router) com TypeScript, Drizzle ORM e PostgreSQL (Neon).
- Migrations reproduzíveis (`drizzle/0000_fundacao.sql`) e script idempotente de aplicação.
- Tabelas: `users`, `sessions`, `stores`, `products`, `offers`, `price_history`, `monitoring_jobs`, `monitoring_runs`, `alerts`, `alert_states`, `shopping_lists`, `shopping_list_items`, `purchases`, `settings`, `rate_limits`. Índices e unicidade (ex.: uma oferta por URL/chave de deduplicação por produto).
- Login do administrador com hash scrypt, sessão em cookie HTTP-only (token guardado como SHA-256), rotas protegidas e limite de tentativas por IP e por e-mail.
- Cadastro, edição e status de produtos com validação no servidor (Zod); detecção de possível duplicata por GTIN ou marca+modelo, exigindo confirmação.
- Ofertas manuais (preço, frete, disponibilidade) com validação de URL (https, sem endereços internos).
- Painel inicial e navegação em português brasileiro, layout responsivo.

**Arquivos principais:** `src/db/*`, `src/lib/auth/*`, `src/lib/security/*`, `src/lib/validation/schemas.ts`, `src/lib/services/products.ts`, `src/lib/services/offers.ts`, `src/app/login/*`, `src/app/(app)/layout.tsx`, `src/app/(app)/produtos/*`, `src/app/actions/{auth,products,offers}.ts`, `scripts/migrate.ts`, `scripts/create-admin.ts`, `drizzle.config.ts`.

**Como testar**

```bash
npm run db:migrate
DATABASE_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run admin:create
npm run dev    # entrar em /login, cadastrar um produto e uma oferta manual
npm run test:unit
npm run test:integration   # inclui products-offers.test.ts e actions.test.ts
```

**Variáveis:** `DATABASE_URL`, `SESSION_SECRET`, `APP_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (só no `admin:create`), `DATABASE_POOL_MAX` (opcional).

**Limitações:** sem recuperação de senha (o administrador troca a senha rodando `admin:create` de novo).

---

## Fase 2 — Coleta · Concluída (Mercado Livre)

**Implementado**

- Adaptador do Mercado Livre pela API oficial (`GET https://api.mercadolibre.com/items/{id}`), com token opcional (`MERCADO_LIVRE_ACCESS_TOKEN`). Extrai preço, moeda, disponibilidade, título, imagem e atributos quando disponíveis.
- Erros classificados: não encontrado e não autorizado (sem repetir), limite de requisições e indisponibilidade (com repetição controlada).
- Coleta em lote com: lote máximo, limite por loja por execução, intervalo mínimo por oferta, pausa entre requisições à mesma loja, orçamento de tempo por execução e tempo limite por requisição.
- **Circuit breaker por loja dentro da execução** (`SOURCE_CIRCUIT_THRESHOLD = 3`): após 3 falhas de fonte seguidas, as demais ofertas da loja são adiadas sem novas requisições. Adicionado nesta etapa e coberto por teste.
- Trava de execução no banco (`monitoring_jobs`): cron e coleta manual nunca rodam ao mesmo tempo; a trava expira sozinha.
- Histórico append-only em `price_history`; falhas registradas em `monitoring_runs` e por oferta/loja (`consecutive_failures`, `last_error`).
- Endpoint `POST /api/cron/monitor` protegido por `Authorization: Bearer <CRON_SECRET>` (sem segredo configurado, responde 503; com segredo errado, 401).
- Agendador: `.github/workflows/monitor-cron.yml`, a cada 6 horas, com secrets `APP_URL` e `CRON_SECRET`. Vercel Cron não foi usado porque o plano Hobby só permite uma execução por dia.
- Botões "Consultar fontes agora" (painel) e "Atualizar agora" (produto). Script `npm run monitor:run` para rodar pelo terminal.
- Página **Fontes** com falhas por loja e registros de coleta.

**Arquivos principais:** `src/lib/adapters/{types,registry,mercado-livre}.ts`, `src/lib/monitoring/{collector,lock,observations,selection}.ts`, `src/lib/services/identify.ts`, `src/app/api/cron/monitor/route.ts`, `src/app/actions/collection.ts`, `src/components/run-collection-button.tsx`, `src/app/(app)/fontes/page.tsx`, `scripts/run-monitor.ts`, `.github/workflows/monitor-cron.yml`.

**Como testar**

```bash
npm run test:integration   # collector.test.ts (11 testes): coleta, falhas, circuit breaker, cooldown, trava, alertas
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/monitor
```

Em produção: GitHub → Actions → "Monitoramento de preços" → Run workflow.

**Variáveis:** `CRON_SECRET` (aplicação e GitHub), `APP_URL` (GitHub), `MERCADO_LIVRE_ACCESS_TOKEN` (opcional), `COLETA_*` (opcionais; ver `.env.example`).

**Limitações**

- A chamada real à API do Mercado Livre **não foi testada** neste ambiente: o acesso de saída é restrito e `api.mercadolibre.com` não está liberado. Os testes usam um adaptador falso que simula respostas. Valide com uma oferta real após o deploy.
- Custo de frete ao CEP não vem no item; sem o valor informado, o frete fica como desconhecido.
- O deploy na Vercel e o disparo do workflow na URL publicada não foram verificados nesta etapa.

---

## Fase 3 — Análise · Concluída

**Implementado**

- Gráfico de histórico (Recharts) com filtros 24 h, 7 dias, 30 dias, 90 dias e tudo.
- Métricas do produto: preço atual (melhor oferta), menor e maior observado, média, variação percentual e data do menor. O texto deixa claro que "menor" é do período monitorado.
- "Menor observado" usa o **valor comparável** (preço + frete, quando o frete é conhecido), o mesmo critério da comparação de ofertas.
- Comparação por loja: preço, frete, total estimado, disponibilidade, última atualização, link e diferenças em R$ e %. Ofertas não são agrupadas por nome semelhante.
- Correspondência de oferta com confirmação manual (confirmado, em revisão) quando não há GTIN/modelo/código confirmável.
- Preço-alvo, orçamento máximo e referência de comparação configurável.
- Alertas: preço-alvo, orçamento, queda percentual (limiar configurável, padrão 5% de nova queda para re-alertar) e oportunidade em outra loja. Alerta de preço-alvo dispara uma vez por patamar, sem repetir enquanto o estado não muda.
- Indicador de confiança com sinais (queda expressiva, histórico insuficiente, preço desatualizado, dados inconsistentes, frete desconhecido, indisponível). Não classifica fraude. Preço igual ou abaixo de 60% da mediana do histórico (queda de 40% ou mais) limita a confiança a "média" e pede confirmação do preço.
- Lista de compras por cômodo (Cozinha, Lavanderia, Sala, Quarto, Banheiro, Escritório, Outros), quantidades, orçamento planejado, soma, economia potencial vs. referência, total atingido, comprados e orçamento restante. Registro de compra com valor pago e economia realizada (separada da potencial).
- Central de alertas com marcar como lido, arquivar e voltar a não lido; "marcar todos como lidos".
- Configurações com precedência padrão < variável de ambiente < valor salvo no banco.

**Arquivos principais:** `src/lib/analysis/*` (history, matching, references, series, shopping, product-query, alerts-engine, confidence), `src/lib/monitoring/alerts-service.ts`, `src/lib/repos/{catalog,dashboard,settings-repo}.ts`, `src/lib/services/{purchases,shopping-list}.ts`, `src/components/price-chart.tsx`, `src/app/(app)/{alertas,lista,configuracoes}/*`, `src/app/actions/{alerts,list,purchases,settings}.ts`.

**Como testar**

```bash
npm run test:unit          # analysis, alerts-engine, matching, money-periods-settings
npm run test:integration   # read-models.test.ts (catálogo, filtros, painel), actions.test.ts (alertas, lista, compras)
RADAR_DEMO_SEED=1 DATABASE_URL=... npm run seed:demo   # somente dev: produto [DEMO] com 31 dias de histórico simulado
```

**Variáveis:** nenhuma obrigatória além das da Fase 1. Limites de alerta e coleta podem vir de `COLETA_*`.

**Limitações**

- Sem histórico suficiente, as métricas mostram menos pontos e a confiança cai; isso é intencional.
- Gráfico e tabelas não foram conferidos visualmente em navegador de testes. As páginas renderizam sem erro com dados reais e demo (verificado por requisições autenticadas).

---

## Fase 4 — Expansão · Parcial

**Implementado**

- Arquitetura de adaptadores: `PriceSourceAdapter` com `key`, `storeSlug`, `mode`, `automated`, `requirements`, `isConfigured`, `parseUrl` e `fetchOffer`. Novas lojas entram no registro sem alterar a coleta.
- Amazon Brasil, Magalu e Fast Shop: o link é reconhecido para cadastro (`createPendingAdapter`), com o requisito de credencial/acesso descrito. **Não consultam a loja** e a atualização de preço é manual.

**Arquivos principais:** `src/lib/adapters/{types,registry,pending}.ts`, `src/lib/stores-catalog.ts`, `.env.example` (seção de lojas pendentes), `docs/implantacao.md` (seção 5).

**Como testar:** cadastrar um link da Amazon, Magalu ou Fast Shop e confirmar que a oferta é criada como manual, sem tentativa de coleta.

**Limitações (pendências para integração)**

- **Amazon Brasil:** exige verificar as condições de acesso à API de afiliados antes de implementar. Não há credenciais configuradas.
- **Magalu:** exige verificar a documentação oficial do programa de parceiros/API.
- **Fast Shop:** não há integração verificada.
- Nenhuma dessas integrações foi declarada concluída, pois não foram testadas com acesso real.

---

## Fase 5 — Preparação Black Friday · Parcial

**Implementado**

- Suíte de testes: 70 unitários e 52 de integração (PostgreSQL efêmero), cobrindo cadastro/edição, persistência, coleta com dados simulados, cálculos percentuais, duplicatas, histórico, alertas, fontes indisponíveis, proteção de endpoints, ações de servidor e execução agendada. Total de 122 testes passando.
- CI em `.github/workflows/ci.yml`: tipos, testes unitários, testes de integração e build.
- Endpoint `GET /api/health` (verifica o banco; não expõe detalhes).
- Segurança: validação de URL contra SSRF (testada nas ações), rate limit em login, criação de oferta, identificação por link e coleta manual; segredos somente em variáveis de ambiente.
- Scripts de backup e restauração (`scripts/backup.sh`, `scripts/restore.sh`), com confirmação explícita para restaurar.
- Dados demo isolados (`source='demo'`, excluídos da coleta, exigem `RADAR_DEMO_SEED=1`).
- Guia de implantação com checklist, diagnóstico de falhas e credenciais por loja (`docs/implantacao.md`).

**Arquivos principais:** `tests/unit/*`, `tests/integration/*`, `vitest.config.ts`, `.github/workflows/ci.yml`, `src/app/api/health/route.ts`, `scripts/{backup,restore,seed-demo}.*`, `docs/implantacao.md`.

**Como testar**

```bash
npm test           # unitários + integração
npm run build
bash scripts/backup.sh   # requer DATABASE_URL e pg_dump instalado
```

**Variáveis:** as de todas as fases; `RADAR_DEMO_SEED` somente em dev/teste.

**Limitações e pendências**

- **Backup não executado:** os scripts foram validados quanto à sintaxe e às proteções, mas `pg_dump`/`pg_restore` não estavam disponíveis no ambiente. Faça um teste de restauração antes da Black Friday.
- **Carga e desempenho:** não há teste de carga nem medição de tempo de resposta sob uso intenso.
- **Navegador:** não há teste de ponta a ponta (login pelo formulário, cadastro pela tela). Os fluxos foram testados nas ações de servidor e nas páginas autenticadas.
- **Deploy:** a publicação na Vercel e o disparo do agendador na URL pública precisam ser feitos e verificados pelo usuário seguindo `docs/implantacao.md`.
- **Monitoramento externo:** não há alerta de falha fora da aplicação além do próprio workflow do GitHub (que falha e notifica quando a coleta retorna erro).
- **Recomendação para a semana da Black Friday:** rodar uma coleta manual de ponta a ponta, conferir o painel de fontes, fazer um backup e uma restauração de teste.
