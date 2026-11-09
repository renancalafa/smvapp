# Notificações push — Etapa 1

O que existe hoje: o usuário logado ativa as notificações em cada aparelho pela tela **Conta**, vê o estado, envia uma notificação de teste para o próprio aparelho e desativa. A Etapa 2 Fase A implementa o dispatcher do outbox (`dispatchPending`, `after()`, corte `DISPATCH_AFTER`), **desligado por padrão**. Lista aberta, votação e lembrete ainda não são enfileirados.

Sem migration: o modelo `PushSubscription` (endpoint único, `p256dh`, `auth`, `userAgent`, `lastSuccessAt`, índice por `userId`) já cobre tudo. O teste não grava `Notification`, porque o enum `NotificationType` não tem um tipo de teste e o envio é direto.

## Como funciona

| Parte | Arquivo |
| --- | --- |
| Validação pura (inscrição, hosts permitidos, payload) | `src/domain/push/subscription.ts` |
| Gravar, remover, contar, enviar teste (`web-push` + VAPID) | `src/server/modules/notifications/push.ts` |
| Regras das ações (login, dono, entrada) | `src/server/modules/notifications/handlers.ts` |
| Server Actions | `src/server/modules/notifications/actions.ts` |
| Dispatcher do outbox | `src/server/modules/notifications/dispatch.ts` |
| `after()` pós-commit | `src/server/modules/notifications/schedule.ts` |
| Tela Conta | `src/app/(app)/account/push-settings.tsx` |
| Service worker (`push`, `notificationclick`) | `public/sw.js` |

- **Permissão**: só é pedida no clique de "Ativar notificações", e `Notification.requestPermission()` é o primeiro `await` do clique (o iOS ignora pedidos fora do gesto).
- **Vários aparelhos**: uma linha por endpoint, todas ligadas ao usuário logado. Se outra pessoa entrar no mesmo navegador e ativar, a inscrição passa para a conta dela. Ao abrir a tela Conta com notificações ativas, o aparelho é religado à conta atual.
- **Dono**: remover e testar filtram por `(userId da sessão, endpoint)`. O endpoint que o cliente manda só localiza o aparelho entre as inscrições do próprio usuário; não há como escolher destinatário.
- **Hosts permitidos**: o servidor faz POST no endpoint, então só aceita HTTPS dos serviços de push conhecidos (FCM, Mozilla, Apple, WNS), sem porta nem credenciais na URL. Um navegador com outro serviço de push recebe "inscrição inválida"; nesse caso, acrescente o host em `PUSH_SERVICE_HOSTS` / `PUSH_SERVICE_HOST_SUFFIXES`.
- **Sair (logout explícito)**: os botões "Sair" (`src/components/logout-form.tsx`) cancelam a inscrição deste navegador (`pushSubscription.unsubscribe()`, no máximo 3 s) e mandam o endpoint junto com o logout; o servidor apaga só a linha `(usuário da sessão, endpoint)` antes de revogar a sessão. Outros aparelhos continuam recebendo. Qualquer falha nessa limpeza é só registrada no log: o logout acontece igual. Fechar o app, sessão expirada ou senha redefinida pelo ADMIN **não** removem inscrições.
- **Intervalo do teste**: no máximo um teste a cada 30 s por usuário e aparelho, contando também envios que falharam. O controle fica no banco, sem migration: cada teste grava `PUSH_TEST_SENT` no `AuditLog` (entidade `PushSubscription`), e a checagem roda numa transação com `FOR UPDATE` na inscrição, então cliques simultâneos em instâncias diferentes da Vercel não passam os dois.
- **Inscrições expiradas**: resposta 404 ou 410 do serviço de push apaga a linha e avisa o usuário para ativar de novo. Outras falhas (5xx, rede, tempo limite de 10 s) mantêm a inscrição e mostram erro.
- **Payload**: só `{ title, body, url }`, com título até 80 caracteres, texto até 180 e `url` sempre um caminho interno. O service worker repete essas regras: payload ausente, JSON inválido ou tipos errados mostram um aviso genérico ("SMV"), e URL de outra origem vira `/`.
- **Clique**: foca uma janela já aberta na mesma URL; senão navega uma janela do SMV para a URL; senão abre uma nova.
- **Cache e offline**: inalterados. O SW continua sem interceptar `/api/*`, POST, RSC e outras origens.

## Variáveis de ambiente

| Nome | Onde é lida | Observação |
| --- | --- | --- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | servidor (passada à tela Conta) | Pública por natureza. |
| `VAPID_PRIVATE_KEY` | só servidor | **Secreta.** Nunca com prefixo `NEXT_PUBLIC_`. |
| `VAPID_SUBJECT` | só servidor | `mailto:voce@dominio` ou `https://…`. Os serviços de push usam para contato. |

Se faltar qualquer uma (ou o subject não começar com `mailto:`/`https://`), o push fica desligado: a tela Conta mostra "ainda não foram configuradas no servidor".

Variáveis `NEXT_PUBLIC_*` podem ser embutidas no build. Depois de criar ou trocar as chaves, **refaça o deploy**.

### Gerar o par de chaves

```bash
npx web-push generate-vapid-keys
```

A saída tem "Public Key" e "Private Key". Gere **um par por ambiente** e guarde a privada só no gerenciador de segredos da Vercel (ou no `.env` local, que não é versionado).

Trocar o par invalida todas as inscrições existentes: os serviços de push passam a recusar o envio com 401/403 (não 404/410, então a linha antiga não é apagada sozinha). A tela Conta trata isso:

- ao abrir, compara a chave com que a inscrição do navegador foi criada (`options.applicationServerKey`) à chave atual. Se for outra, o aparelho aparece como **"Precisa ser reativado"**, com o botão "Ativar notificações", e a inscrição velha não é religada à conta;
- "Ativar" cancela a inscrição antiga no navegador, cria uma nova com a chave atual e manda as duas ao servidor. O servidor grava a nova e apaga a antiga na mesma transação, e só se a antiga for do próprio usuário; outros aparelhos não mudam;
- navegador que não informa a chave da inscrição é tratado como chave igual (senão pediria reativação a cada visita). Nesse caso raro, o usuário precisa tocar em Desativar e depois em Ativar.

Rotação segura:

1. Gere o par novo fora de terminais com histórico compartilhado ou registrado.
2. Na Vercel, substitua `NEXT_PUBLIC_VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` juntas (o `VAPID_SUBJECT` pode ficar) e refaça o deploy.
3. Avise os usuários para abrir a tela Conta e tocar em "Ativar notificações". Até lá, esses aparelhos não recebem nada.
4. Opcional, depois de um tempo: apague as inscrições que ninguém reativou (`DELETE FROM "PushSubscription" WHERE "updatedAt" < '<data do deploy>'`).

Uma chave privada vazada antes de qualquer inscrição real não exige nada além de descartá-la: o par não fica registrado em nenhum serviço.

## Testes automatizados

```bash
npm run check:push      # banco local, transação desfeita; envio falso
npm run check:sw-push   # public/sw.js num contexto vm; sem banco nem navegador
npm run check:push-client  # lógica do navegador (troca de chave, reinscrição) com PushManager falso
```

`check:push` recusa rodar se `DATABASE_URL` não for localhost.

## Teste manual local

O service worker só é registrado em produção (`next dev` remove registros), então use `npm run build` e `npm start`. `localhost` conta como contexto seguro, então HTTP serve no Chrome, Edge e Firefox do próprio computador.

> **Atenção:** `.env.production.local` aponta `DATABASE_URL` para o Neon de produção, e `next build`/`next start` carregam esse arquivo. Defina `DATABASE_URL` no shell (variáveis do processo têm prioridade) para não gravar inscrições de teste em produção.

```powershell
$env:DATABASE_URL = "postgresql://pelada_dev:pelada_dev@localhost:5432/pelada_dev"
$env:NEXT_PUBLIC_VAPID_PUBLIC_KEY = "<public key>"
$env:VAPID_PRIVATE_KEY = "<private key>"
$env:VAPID_SUBJECT = "mailto:voce@exemplo.com"
npm run build
npm start
```

1. Abra `http://localhost:3000`, entre e vá em **Conta**.
2. "Notificações" deve mostrar Permissão "Ainda não pedida" e Este aparelho "Desativado".
3. Clique em **Ativar notificações** e permita. Estado: "Recebendo notificações"; Aparelhos ativos: 1.
4. Clique em **Enviar notificação de teste**. A notificação chega em segundos; clicar nela abre ou foca `/account`.
5. Abra outro navegador (ex.: Firefox), entre com a mesma conta e ative. Aparelhos ativos: 2. O teste de cada navegador só chega nele.
6. Clique em **Enviar notificação de teste** de novo logo em seguida: aparece "Aguarde N s…". Depois de 30 s volta a enviar.
7. **Desativar notificações** volta para "Desativado" e reduz a contagem.
8. Ative de novo e clique em **Sair**. Entre outra vez: na Conta, este aparelho aparece "Desativado" e a contagem caiu 1; o outro navegador continua recebendo testes.
9. Offline continua igual: DevTools → Network → Offline e navegue; deve aparecer "Sem conexão".

Inscrição expirada (404/410) é difícil de provocar à mão, porque o navegador some com o botão de teste quando perde a inscrição; o caso está coberto por `npm run check:push`.

No DevTools (Application → Service workers) há o botão **Push**, que manda um payload de texto puro: ele deve mostrar o aviso genérico "SMV", o que confirma o tratamento de payload inválido.

Celular Android ou iPhone não alcança `localhost`; teste nesses aparelhos com o deploy (HTTPS).

## Produção

1. Gere um par de chaves só para produção.
2. Na Vercel (Settings → Environment Variables, ambiente Production): `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (marque como Sensitive) e `VAPID_SUBJECT`.
3. Refaça o deploy.
4. Smoke test: ative em um Android (Chrome) e em um iPhone instalado, envie o teste em cada um e confirme que o clique abre `/account`.

Preview deployments têm outra origem: as inscrições feitas lá são separadas. Se o Preview usar o mesmo banco de produção, elas também ficam nesse banco; prefira não configurar VAPID em Preview, ou use um banco separado.

## iPhone e iPad

- iOS/iPadOS **16.4 ou mais recente**.
- O SMV precisa estar **instalado na Tela de Início** (Safari → Compartilhar → Adicionar à Tela de Início) e aberto pelo ícone. Em aba do Safari a API de push não existe; a tela Conta mostra a instrução de instalação no lugar dos botões.
- A permissão só aparece após tocar em "Ativar notificações".
- Se o usuário negar, o iOS não pergunta de novo: é preciso liberar em Ajustes → Notificações → SMV. A tela mostra essa instrução.
- Remover o app da Tela de Início apaga a inscrição; ao reinstalar, ative de novo.

## Limitações conhecidas

- **Logout só limpa com JavaScript**: sem JS (ou se o navegador travar ao ler a inscrição), o logout acontece sem limpar o push. Se o navegador não conseguir cancelar a inscrição, a linha do banco é apagada mesmo assim, mas a inscrição local sobrevive; quem entrar depois nesse navegador e abrir a tela Conta a vê como ativa na própria conta.
- **Sessão encerrada por outros meios** (expirada, senha redefinida, outro login no mesmo navegador): o aparelho continua inscrito na conta anterior até alguém desativar ou outra conta ativar nele.
- **Histórico de testes no AuditLog**: o intervalo usa linhas `PUSH_TEST_SENT`, no máximo duas por minuto por aparelho. O AuditLog não é lido em nenhuma tela hoje; se um dia for, filtre essa ação.
- **`pushsubscriptionchange` não é tratado**: se o navegador renovar a inscrição sozinho, o servidor só descobre quando o usuário abrir a tela Conta (que religa a inscrição atual) ou quando o envio antigo der 404/410.
- **Envio síncrono**: o teste é enviado dentro da Server Action. Os envios automáticos usam o outbox e `after()` (Etapa 2, Fase A).

## Etapa 2, Fase A — dispatcher (desligado por padrão)

O outbox `Notification` / `NotificationDelivery` já existia. A Fase A drena esse outbox **depois** do commit (`after()`), com claim atômico, lote limitado e corte obrigatório. Tipos enfileirados incluem `LIST_OPENED`, `WAITLIST_PROMOTED`, `SESSION_CANCELLED` e `PRIORITY_REMINDER` (lembrete do prazo dos mensalistas sem resposta). O envio só acontece se o dispatcher estiver ligado.

| Variável | Efeito |
| --- | --- |
| `PUSH_DISPATCH_ENABLED` | Só `"true"` liga. Qualquer outra coisa (inclusive ausente) é kill switch. |
| `DISPATCH_AFTER` | ISO-8601 obrigatório. Notificações com `createdAt` anterior **nunca** são enviadas. |

Os dois precisam estar certos **e** as chaves VAPID configuradas. Sem isso, `dispatchPending()` é no-op. Não ative em produção sem definir `DISPATCH_AFTER` no instante da ativação (senão o outbox antigo seria enviado).

```bash
npm run check:dispatch   # banco local, transação desfeita + um teste concorrente limpo ao final
```

`check:dispatch` recusa rodar se `DATABASE_URL` não for localhost.

O filtro opcional `onlyNotificationId` em `dispatchPending` e o tooling local
`npm run check:smoke-dispatch` / `scripts/smoke-dispatch.ts` servem para testes
isolados do outbox sem ligar o dispatcher global.

## Vercel Hobby

- O teste não depende de cron: roda na própria requisição e leva poucas centenas de milissegundos, dentro do limite de duração de funções de qualquer plano.
- **Cron no Hobby roda no máximo uma vez por dia**, sem horário preciso. O dispatcher da Fase A envia com `after()` na requisição que gerou o evento (ou na leitura preguiçosa / tick); o cron só reforça o drain e os reenvios.
- Lotes pequenos (10 envios, concorrência 3, orçamento de 8 s, timeout de 4 s por envio) cabem no tempo de função do Hobby.
- O plano Hobby é para uso pessoal, não comercial. Se o SMV virar SaaS (PROJECT.md, seção 1), será preciso o Pro.
- Confira os limites atuais na documentação da Vercel antes de planejar a próxima etapa; eles mudam com o tempo.
