# Implantação do Radar de Preços

Guia para colocar o Radar no ar (Neon + Vercel + GitHub Actions) e manter a operação: credenciais, agendador, backup e diagnóstico.

O sistema roda no servidor. O computador pessoal não precisa estar ligado: a coleta é disparada por um agendador externo (GitHub Actions) que chama a aplicação publicada.

> **Ordem recomendada:** 1) banco no Neon, 2) variáveis de ambiente, 3) migrations e administrador, 4) deploy na Vercel, 5) secrets no GitHub, 6) teste da coleta, 7) backup.

---

## 1. Banco de dados (PostgreSQL no Neon)

1. Crie um projeto no Neon (região sa-east-1 se disponível) e **um banco novo** chamado `radar_precos`. Não reutilize o banco de outro projeto (por exemplo, do Radar TCG).
2. Copie a connection string **pooled** (PgBouncer) para a aplicação, no formato:
   `postgresql://USUARIO:SENHA@ep-xxxx-pooler.sa-east-1.aws.neon.tech/radar_precos?sslmode=require`
3. Guarde a string somente no painel da Vercel e em `.env.local` (desenvolvimento). Nunca no código.
4. Aplique as migrations (idempotente, pode ser repetido):

```bash
DATABASE_URL="postgresql://..." npm run db:migrate
```

5. Crie o administrador (a senha é pedida ou vem de `ADMIN_PASSWORD` apenas no momento da execução):

```bash
DATABASE_URL="postgresql://..." ADMIN_EMAIL="voce@exemplo.com" ADMIN_PASSWORD="senha-forte" npm run admin:create
```

A senha é guardada como hash (scrypt). Trocar a senha: execute o comando de novo com a nova senha.

---

## 2. Variáveis de ambiente

Modelo completo em `.env.example` (sem segredos). Variáveis usadas pela aplicação:

| Variável | Obrigatória | Onde | Função |
| --- | --- | --- | --- |
| `DATABASE_URL` | sim | Vercel, GitHub (só se usar scripts), `.env.local` | Conexão com o Neon (`sslmode=require`). |
| `SESSION_SECRET` | sim | Vercel, `.env.local` | Segredo de sessão, 32+ caracteres (`openssl rand -base64 48`). |
| `APP_URL` | sim | Vercel, `.env.local` | URL pública, sem barra final. |
| `CRON_SECRET` | sim para agendar | Vercel **e** GitHub Secrets | Autentica o agendador em `/api/cron/monitor` (24+ caracteres). |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | só no `admin:create` | terminal | Criação do administrador. |
| `MERCADO_LIVRE_ACCESS_TOKEN` | não | Vercel | Token da API do Mercado Livre, se a leitura for recusada sem token. |
| `DATABASE_POOL_MAX` | não (padrão 5) | Vercel | Conexões por instância. |
| `COLETA_LOTE_MAXIMO`, `COLETA_MAX_POR_LOJA`, `COLETA_INTERVALO_MINIMO_HORAS`, `COLETA_TIMEOUT_MS`, `COLETA_ORCAMENTO_TEMPO_MS` | não | Vercel | Limites da coleta. Precedência: padrão < env < Configurações salvas. |
| `RADAR_DEMO_SEED` | **nunca em produção** | só dev/teste | Confirma a criação de dados demo (`npm run seed:demo`). |

Gerar segredos:

```bash
openssl rand -base64 48   # SESSION_SECRET
openssl rand -hex 32      # CRON_SECRET
```

---

## 3. Deploy na Vercel

1. Importe o repositório `cauanvinicius140296-rgb/monitor` na Vercel (framework: Next.js; build: `npm run build`).
2. Cadastre as variáveis da seção 2 em **Settings → Environment Variables** (Production e Preview).
3. Faça o deploy. Depois confira `https://SEU-APP/api/health` (deve responder `{"ok":true}`).

**Por que o agendador não fica na Vercel:** o plano Hobby da Vercel permite cron de no máximo **uma execução por dia** por job. A coleta a cada 6 horas exige o plano Pro ou um agendador externo. Por isso o padrão deste projeto é o GitHub Actions (`.github/workflows/monitor-cron.yml`). Os limites de cron da Vercel mudam com o tempo: confira a documentação atual antes de qualquer mudança.

Limite de duração: o endpoint de coleta declara `maxDuration = 300` s e para sozinho ao atingir `COLETA_ORCAMENTO_TEMPO_MS` (padrão 240 s). Confirme o limite do seu plano.

---

## 4. Agendador (GitHub Actions)

Workflow: `.github/workflows/monitor-cron.yml`.

- Roda a cada 6 horas (`17 */6 * * *`, UTC) e pode ser disparado manualmente em **Actions → Monitoramento de preços → Run workflow**.
- Chama `POST {APP_URL}/api/cron/monitor` com `Authorization: Bearer <CRON_SECRET>`.
- Resposta 401 = segredo errado; 503 = `CRON_SECRET` ausente/curto na Vercel; 500 = falha interna (ver diagnóstico).

Configurar no GitHub (**Settings → Secrets and variables → Actions → New repository secret**):

- `APP_URL`: a mesma URL pública da Vercel.
- `CRON_SECRET`: exatamente o valor cadastrado na Vercel.

Observações:

- Agendamentos só rodam na branch padrão (`main`). Antes do merge, use o disparo manual.
- O GitHub pode pausar agendamentos em repositórios sem atividade por um longo período. Se a coleta parar, verifique a aba Actions e reative o workflow se necessário.
- A aplicação também impede execuções concorrentes (trava em `monitoring_jobs`); um disparo manual enquanto outro roda apenas recebe uma resposta de "já em execução".

---

## 5. Credenciais de APIs e status das lojas

| Loja | Status | Requisito |
| --- | --- | --- |
| Mercado Livre | **Coleta automática** via API oficial (`GET /items/{id}`) | Opcional: `MERCADO_LIVRE_ACCESS_TOKEN`. Se a API recusar (401/403), crie um app em https://developers.mercadolivre.com.br e siga a documentação de autenticação e permissões. |
| Amazon Brasil | Reconhece o link; **sem coleta automática** | Não integrado. Confirme na documentação oficial as condições de acesso antes de implementar. |
| Magalu | Reconhece o link; **sem coleta automática** | Não integrado. Confirme na documentação oficial do programa de parceiros/API. |
| Fast Shop | Reconhece o link; **sem coleta automática** | Não integrado. Não há integração verificada nesta entrega. |

Regras do projeto: o Radar não contorna CAPTCHA, autenticação obrigatória, limites de acesso nem proteções das lojas. Quando uma fonte não permite leitura automática, o preço é atualizado manualmente e a origem fica registrada como manual.

Mercado Livre e frete: o item não informa o custo de frete ao CEP. Sem essa informação, a oferta é marcada como "frete desconhecido" e o total estimado não é usado para comparação.

---

## 6. Backup e restauração

Os scripts usam `pg_dump` e `pg_restore`. Instale um cliente PostgreSQL com versão igual ou superior à do servidor (confira a versão do PostgreSQL no painel do Neon).

```bash
# Backup (cria backups/radar-AAAAMMDDTHHMMSSZ.dump e verifica o índice)
DATABASE_URL="postgresql://...?sslmode=require" ./scripts/backup.sh

# Restauração: sempre primeiro em um banco/branch NOVO e de teste
TARGET_DATABASE_URL="postgresql://...?sslmode=require" RESTAURAR_CONFIRMAR=sim \
  ./scripts/restore.sh backups/radar-AAAAMMDDTHHMMSSZ.dump
```

Boas práticas:

- O arquivo `.dump` contém dados pessoais, histórico e hashes de senha. Guarde-o em local privado (disco criptografado, nuvem privada). A pasta `backups/` e `*.dump` já estão no `.gitignore`.
- Faça backup antes de cada mudança de schema e, para a Black Friday, pelo menos uma vez por semana.
- Neon também oferece branches e histórico de restauração no próprio painel; confira o plano.
- **Status de verificação:** os scripts foram validados quanto à sintaxe e às proteções (ausência de URL, de `pg_dump` e de confirmação). A execução real do `pg_dump` e do `pg_restore` ainda não foi testada neste ambiente, pois o cliente PostgreSQL não estava disponível. Faça um teste de restauração antes de depender do backup.

---

## 7. Diagnóstico de falhas

| Sintoma | Onde olhar | Causa provável / ação |
| --- | --- | --- |
| `/api/health` retorna 503 | Logs da Vercel | Banco inacessível: confira `DATABASE_URL`, o status do Neon e `sslmode=require`. |
| Workflow retorna HTTP 401 | Log do Actions | `CRON_SECRET` diferente entre GitHub e Vercel. Atualize o secret e redeploy. |
| Workflow retorna HTTP 503 | Resposta JSON | `CRON_SECRET` ausente na Vercel ou com menos de 24 caracteres. |
| Workflow retorna HTTP 500 | Página **Fontes** e **Registros de coleta** no painel | Erro interno. A resposta não expõe detalhes; a causa fica em `monitoring_runs`. |
| Fonte com falhas no painel | Página **Fontes** | Falhas consecutivas registradas por loja (`consecutive_failures`, `last_error`). Dentro de uma rodada, após 3 falhas de fonte seguidas, as demais ofertas da loja são adiadas (circuit breaker); na rodada seguinte a loja volta a ser consultada. |
| Mercado Livre recusa (401/403) | Registros de coleta | Token ausente/expirado ou permissões. Ver seção 5. |
| Preço "desatualizado" | Painel | Oferta sem coleta bem-sucedida dentro da janela configurada. |
| Coleta "já em execução" | Registros de coleta | Execução anterior ainda ativa ou travada. A trava expira sozinha (`locked_until`). |

Diagnóstico rápido pelo terminal (com `DATABASE_URL` configurado):

```bash
npm run monitor:run    # executa uma rodada de coleta e imprime o resumo JSON
```

---

## 8. Checklist de publicação

- [ ] Banco Neon criado (projeto separado do Radar TCG).
- [ ] `npm run db:migrate` executado sem erro.
- [ ] Administrador criado; login testado no navegador.
- [ ] Variáveis da Vercel cadastradas; `/api/health` = ok.
- [ ] Secrets `APP_URL` e `CRON_SECRET` no GitHub.
- [ ] Disparo manual do workflow concluído com HTTP 200.
- [ ] Primeiro backup gerado e restauração de teste concluída.
- [ ] Nenhum `SEED`/demo em produção (`RADAR_DEMO_SEED` ausente).
