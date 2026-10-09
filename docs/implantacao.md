# Implantação do Radar de Preços

Guia para Neon + Vercel + GitHub Actions, incluindo o bootstrap inicial do banco e do administrador. O computador pessoal não precisa ficar ligado: a coleta é disparada por um agendador externo.

> **Ordem recomendada:** 1) criar o banco no Neon; 2) cadastrar os secrets do bootstrap no GitHub; 3) mesclar o PR e executar o workflow temporário na branch `main`; 4) configurar/confirmar as variáveis da Vercel e testar o login; 5) manter o workflow normal de monitoramento; 6) remover os secrets e o workflow temporário depois de confirmar o acesso.
>
> O workflow temporário só fica disponível para execução depois de ser mesclado na branch padrão. Nenhuma credencial deve ser enviada por chat, incluída no código ou impressa nos logs.

---

## 1. Banco de dados (PostgreSQL no Neon)

1. Crie um projeto Neon dedicado ao Radar (região `sa-east-1` se disponível) e use um banco novo, por exemplo `radar_precos`. Não reutilize o banco de outro projeto.
2. No painel do Neon, copie a connection string **pooled** (PgBouncer) do banco correto. Ela deve usar TLS (`sslmode=require`). O valor real contém usuário e senha: trate-o como credencial.
3. Use a mesma connection string pooled no secret temporário `DATABASE_URL` do GitHub Actions e na variável `DATABASE_URL` de **Production** na Vercel. Não a cole em arquivos versionados, issues, PRs ou chats.
4. Para Preview da Vercel, prefira criar uma branch/banco separado no Neon e cadastrar a URL desse banco no escopo Preview. Evite que deploys Preview de teste alterem o banco de produção.

O workflow temporário aplica as migrations e os dados básicos da aplicação. Não é necessário executar comandos localmente nem conceder acesso ao banco por endpoint público.

---

## 2. Bootstrap temporário pelo GitHub Actions

O arquivo `.github/workflows/bootstrap-admin-temporario.yml` existe apenas para o primeiro bootstrap. Ele é manual (`workflow_dispatch`), roda somente se selecionada a branch padrão e faz, **na mesma execução e em ordem**:

1. `npm run db:migrate` — aplica migrations e garante o catálogo básico;
2. `npm run admin:create` — cria a conta se ela ainda não existir.

Se a migration falhar, a etapa de administrador não é executada. O workflow não chama `seed:demo`, não cria dados de demonstração e não adiciona endpoint público de bootstrap.

### Cadastrar os secrets temporários

Depois do merge do PR na `main`, abra no GitHub:

**Repositório → Settings → Secrets and variables → Actions → New repository secret**

Cadastre estes três secrets, sem aspas:

| Nome do secret | Valor |
| --- | --- |
| `DATABASE_URL` | Connection string pooled do banco Neon criado acima. |
| `ADMIN_EMAIL` | E-mail que será usado como login do administrador. |
| `ADMIN_PASSWORD` | Senha forte com pelo menos 10 caracteres. Guarde-a em um gerenciador de senhas. |

O workflow recebe esses valores somente como variáveis de ambiente nas etapas necessárias. Os valores não são argumentos de comandos nem são impressos nos logs. Não configure `ADMIN_PASSWORD` como variável persistente da Vercel.

### Executar

1. Abra **Actions → Bootstrap temporário (banco e administrador) → Run workflow**.
2. Selecione `main`.
3. Deixe desmarcada a opção **confirm_existing_admin_password_reset** para a primeira tentativa normal.
4. Clique em **Run workflow** e aguarde as etapas de migrations e administrador concluírem.

O padrão é seguro: se já existir uma conta com o `ADMIN_EMAIL`, ela não será alterada; os logs informarão que nenhuma credencial foi modificada. Nesse caso, entre com a senha que a conta já usava.

Só marque **confirm_existing_admin_password_reset** se você quiser explicitamente substituir a senha da conta já existente pelo valor atual de `ADMIN_PASSWORD`. Essa confirmação é passada ao script por uma flag explícita; sem ela, o script não atualiza hashes nem datas da conta existente.

O script também mantém esse comportamento quando executado localmente: para redefinir a senha de uma conta existente, a confirmação deve ser explícita:

```bash
npm run admin:create -- --confirm-existing-password-reset
```

Após executar o bootstrap e confirmar o login, remova `ADMIN_EMAIL`, `ADMIN_PASSWORD` e o secret temporário `DATABASE_URL` das **Secrets and variables → Actions**. Em seguida, remova o arquivo `bootstrap-admin-temporario.yml` em um PR de limpeza. Não remova `APP_URL` ou `CRON_SECRET`: são usados pelo workflow normal de monitoramento a cada seis horas.

---

## 3. Variáveis de ambiente

Modelo sem credenciais reais em `.env.example`. Configure os escopos apropriados na Vercel e no GitHub:

| Variável | Obrigatória | Onde | Função |
| --- | --- | --- | --- |
| `DATABASE_URL` | Sim | Vercel Production; GitHub Actions só durante o bootstrap; `.env.local` local | Conexão pooled do Neon com TLS. Use banco/branch separado para Preview. |
| `SESSION_SECRET` | Sim | Vercel; `.env.local` local | Assina sessões, com pelo menos 32 caracteres. Gere um valor aleatório. |
| `APP_URL` | Sim em produção | Vercel; GitHub Actions para o monitoramento | URL pública canônica do app, sem barra final. |
| `CRON_SECRET` | Sim para agendar | Vercel **e** GitHub Actions | Autentica `/api/cron/monitor`; use o mesmo valor nos dois lugares (24+ caracteres). |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Só no bootstrap | GitHub Actions Secrets temporários; opcionalmente ambiente local | Criam a conta pelo script. Não são necessárias para executar a aplicação na Vercel. |
| `MERCADO_LIVRE_ACCESS_TOKEN` | Não | Vercel | Token opcional da API do Mercado Livre, caso a leitura seja recusada sem token. |
| `DATABASE_POOL_MAX` | Não (padrão 5) | Vercel | Máximo de conexões por instância. |
| `COLETA_LOTE_MAXIMO`, `COLETA_MAX_POR_LOJA`, `COLETA_INTERVALO_MINIMO_HORAS`, `COLETA_TIMEOUT_MS`, `COLETA_ORCAMENTO_TEMPO_MS` | Não | Vercel | Limites opcionais de coleta. |
| `RADAR_DEMO_SEED` | **Não configurar em produção** | Apenas desenvolvimento/testes | Confirma dados fictícios do comando `seed:demo`, que não é usado no bootstrap. |

Gere os segredos fora do chat e guarde-os em um gerenciador de senhas:

```bash
openssl rand -base64 48   # SESSION_SECRET
openssl rand -hex 32      # CRON_SECRET
```

---

## 4. Deploy e variáveis na Vercel

1. No painel Vercel, confirme que o projeto está conectado ao repositório `cauanvinicius140296-rgb/monitor` e usa Next.js (`npm run build`).
2. Em **Settings → Environment Variables**, cadastre para **Production**:
   - `DATABASE_URL`: URL pooled do Neon;
   - `SESSION_SECRET`: segredo aleatório com pelo menos 32 caracteres;
   - `APP_URL`: domínio público completo, sem barra final (por exemplo, o domínio de produção exibido no painel Vercel);
   - `CRON_SECRET`: segredo longo aleatório (24+ caracteres), igual ao secret do GitHub usado pelo agendador;
   - `MERCADO_LIVRE_ACCESS_TOKEN`, se a API exigir autenticação.
3. **Não** cadastre `ADMIN_PASSWORD` nem `ADMIN_EMAIL` na Vercel. Eles são usados somente pelo bootstrap manual.
4. Para Preview, use uma branch/banco Neon de teste e valores de sessão/cron próprios; não aponte um preview não confiável para o banco de produção.
5. Salve as variáveis e faça um novo deploy (ou redeploy) para que o ambiente publicado as carregue.
6. Abra `https://SEU-DOMINIO/api/health`; a resposta esperada é `{"ok":true}`. O healthcheck confirma conectividade com o banco, sem revelar detalhes.

O plano Hobby da Vercel pode limitar crons a uma execução por dia; a coleta a cada seis horas deste projeto é mantida pelo GitHub Actions, não pela Vercel. Confirme os limites atuais do seu plano antes de alterar a arquitetura. O endpoint da coleta tem `maxDuration = 300` segundos e o orçamento padrão é de 240 segundos.

---

## 5. Monitoramento normal (GitHub Actions a cada seis horas)

O workflow `.github/workflows/monitor-cron.yml` é separado do bootstrap e **não deve ser removido** durante a limpeza do workflow temporário. Ele permanece agendado para `17 */6 * * *` (UTC) e também aceita disparo manual.

Em **Settings → Secrets and variables → Actions**, mantenha estes repository secrets:

- `APP_URL`: domínio público de produção da Vercel, sem barra final;
- `CRON_SECRET`: exatamente o mesmo valor configurado na Vercel.

O workflow chama `POST {APP_URL}/api/cron/monitor` com `Authorization: Bearer <CRON_SECRET>`. Agendamentos rodam na branch padrão (`main`). Uma chamada manual enquanto outra coleta está em andamento pode retornar o estado de execução já ativa; a aplicação também tem uma trava no banco.

---

## 6. Testar o login do administrador

Depois que o bootstrap concluir e a Vercel estiver implantada com as variáveis corretas:

1. Abra `https://SEU-DOMINIO/login`.
2. Informe `ADMIN_EMAIL` e a senha definida em `ADMIN_PASSWORD` se o workflow criou a conta agora ou se você marcou a confirmação de redefinição.
3. Se o workflow informou que a conta já existia e a opção de redefinição ficou desmarcada, use a senha anterior dessa conta — o valor novo do secret não foi aplicado.
4. Ao entrar, o painel privado deve abrir. Confira também `https://SEU-DOMINIO/api/health` (`{"ok":true}`).

Se não conseguir entrar, confirme o resultado da etapa **Criar administrador** no GitHub Actions, confira se o e-mail corresponde ao login esperado e se o deploy Vercel usa o banco Neon que recebeu as migrations. Não cole a senha ou a connection string em logs, issues ou mensagens. Para substituir a senha de uma conta existente, atualize o secret `ADMIN_PASSWORD` e execute novamente o workflow marcando a confirmação explícita.

---

## 7. Credenciais de APIs e status das lojas

| Loja | Status | Requisito |
| --- | --- | --- |
| Mercado Livre | **Coleta automática** via API oficial (`GET /items/{id}`) | Opcional: `MERCADO_LIVRE_ACCESS_TOKEN`. Se a API recusar (401/403), crie um app em https://developers.mercadolivre.com.br e siga a documentação oficial de autenticação e permissões. |
| Amazon Brasil | Reconhece o link; **sem coleta automática** | Não integrado. Confirme na documentação oficial as condições de acesso antes de implementar. |
| Magalu | Reconhece o link; **sem coleta automática** | Não integrado. Confirme a documentação oficial do programa de parceiros/API. |
| Fast Shop | Reconhece o link; **sem coleta automática** | Não há integração verificada nesta entrega. |

O Radar não contorna CAPTCHA, autenticação obrigatória, limites de acesso ou proteções das lojas. Quando uma fonte não permite leitura automática, o preço é atualizado manualmente e a origem fica registrada como manual. O item do Mercado Livre não informa o custo de frete ao CEP; sem esse dado, o frete permanece desconhecido.

---

## 8. Backup e restauração

Os scripts usam `pg_dump` e `pg_restore`. Instale um cliente PostgreSQL com versão igual ou superior à do servidor (confira a versão no painel Neon).

```bash
# Backup (cria backups/radar-AAAAMMDDTHHMMSSZ.dump e verifica o índice)
DATABASE_URL="postgresql://...?sslmode=require" ./scripts/backup.sh

# Restauração: sempre primeiro em um banco/branch NOVO e de teste
TARGET_DATABASE_URL="postgresql://...?sslmode=require" RESTAURAR_CONFIRMAR=sim \
  ./scripts/restore.sh backups/radar-AAAAMMDDTHHMMSSZ.dump
```

Boas práticas:

- O arquivo `.dump` contém dados pessoais, histórico e hashes de senha. Guarde-o em local privado e criptografado. `backups/` e `*.dump` já estão no `.gitignore`.
- Faça backup antes de cada mudança de schema e, para a Black Friday, pelo menos uma vez por semana.
- Neon oferece branches e histórico de restauração; confira os limites do seu plano.
- Os scripts foram validados quanto à sintaxe e às proteções, mas a execução real de `pg_dump`/`pg_restore` precisa ser testada no seu ambiente antes de depender do backup.

---

## 9. Diagnóstico de falhas

| Sintoma | Onde olhar | Causa provável / ação |
| --- | --- | --- |
| Bootstrap falha antes das migrations | GitHub Actions | Confirme apenas se os secrets `DATABASE_URL`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` existem; os valores não aparecem nos logs. |
| Migration falha | Log da etapa **Aplicar migrations e dados básicos** | Confira no Neon a URL, o banco de destino, usuário/permissões e TLS (`sslmode=require`). A etapa do administrador não roda se a migration falhar. |
| Admin informa que a conta já existe | Log da etapa **Criar administrador** | Nenhuma senha foi alterada. Use a senha existente ou faça outra execução com a confirmação explícita se realmente deseja substituí-la. |
| `/api/health` retorna 503 | Logs da Vercel | Banco inacessível: confira `DATABASE_URL`, o status do Neon e `sslmode=require`. |
| Workflow de monitoramento retorna HTTP 401 | Log do Actions | `CRON_SECRET` diferente entre GitHub e Vercel. Atualize o secret e redeploy. |
| Workflow de monitoramento retorna HTTP 503 | Resposta JSON | `CRON_SECRET` ausente na Vercel ou com menos de 24 caracteres. |
| Workflow de monitoramento retorna HTTP 500 | Página **Fontes** e **Registros de coleta** | Erro interno registrado pela aplicação. |
| Fonte com falhas no painel | Página **Fontes** | Falhas consecutivas por loja; após 3 falhas na rodada, as demais ofertas da loja são adiadas até a rodada seguinte. |
| Mercado Livre recusa (401/403) | Registros de coleta | Token ausente/expirado ou permissões. Ver seção 7. |
| Preço "desatualizado" | Painel | Oferta sem coleta bem-sucedida dentro da janela configurada. |
| Coleta "já em execução" | Registros de coleta | Execução anterior ativa ou travada; a trava expira sozinha (`locked_until`). |

Diagnóstico rápido local (com `DATABASE_URL` definido):

```bash
npm run monitor:run
```

---

## 10. Checklist

- [ ] Banco PostgreSQL dedicado criado no Neon; connection string pooled com TLS.
- [ ] Secrets temporários `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` adicionados no GitHub.
- [ ] PR do workflow bootstrap mesclado e execução manual concluída na `main`.
- [ ] Login testado em `/login`; conta existente não foi redefinida sem confirmação explícita.
- [ ] Vercel configurada com `DATABASE_URL`, `SESSION_SECRET`, `APP_URL` e `CRON_SECRET`; `/api/health` = `{"ok":true}`.
- [ ] Secrets permanentes `APP_URL` e `CRON_SECRET` mantidos no GitHub; monitoramento continua a cada seis horas.
- [ ] Após confirmar o login, secrets temporários removidos do GitHub e workflow temporário removido em um PR de limpeza.
- [ ] Nenhum `RADAR_DEMO_SEED`/seed de demonstração em produção.
- [ ] Primeiro backup gerado e teste de restauração feito em banco separado.
