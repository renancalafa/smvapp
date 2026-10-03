# Sistema de Gestão da Pelada

## 1. Visão geral

Aplicação web/PWA para gerenciamento de uma pelada semanal.

O sistema será inicialmente desenvolvido especificamente para uma única pelada, mas sua arquitetura deve evitar decisões que impeçam uma futura evolução para uma plataforma SaaS capaz de atender múltiplas peladas.

A aplicação deve ser prioritariamente mobile-first e utilizável como PWA em smartphones.

---

# 2. Perfis de usuário

Todos os usuários possuem conta própria.

### Autenticação no MVP

A autenticação do MVP é própria e simples, por usuário (username) e senha, com sessão persistida por cookie seguro.

No MVP NÃO existe:

- cadastro público;
- email obrigatório;
- login Google ou social;
- OAuth;
- recuperação de senha por email.

A senha nunca é armazenada em texto puro: o banco guarda somente o hash (passwordHash).

As sessões de login são próprias: o cookie (HttpOnly, Secure em produção, SameSite apropriado) carrega um token aleatório, e o banco guarda somente o hash desse token. Sessões expiram e podem ser revogadas.

Possíveis métodos futuros (fora do MVP):

- Google;
- outros provedores OAuth;
- integrações com WhatsApp.

### Criação de contas

Contas são criadas somente por ADMIN.

Não existe auto-cadastro público.

Ao criar a conta, o sistema gera uma senha temporária individual e aleatória. O username NUNCA é usado como senha padrão.

### Troca obrigatória de senha

Toda conta criada pelo ADMIN nasce com mustChangePassword = true.

No primeiro login com a senha temporária:

1. o usuário se autentica normalmente;
2. o sistema detecta mustChangePassword = true;
3. o acesso às funcionalidades normais fica bloqueado até a troca da senha;
4. após a troca bem-sucedida, mustChangePassword = false.

### Recuperação de senha

Não há recuperação de senha por email no MVP.

Se o jogador esquecer a senha:

1. um ADMIN redefine a senha, e o sistema gera uma nova senha temporária individual e aleatória;
2. a conta fica marcada como mustChangePassword = true;
3. todas as sessões ativas daquele usuário são revogadas;
4. no próximo login, o usuário é obrigado a trocar a senha antes de usar o sistema;
5. a redefinição gera AuditLog (sem registrar a senha).

Existem dois níveis de permissão:

### ADMIN

Pode:

- gerenciar jogadores;
- configurar a pelada;
- gerenciar sessões (criar sessão extraordinária, cancelar sessão);
- alterar notas;
- gerenciar presença (incluindo intervenção excepcional na fila e registro de presença real);
- escolher FIXED_TEAMS/FLEXIBLE_ROTATION e definir os rotativos;
- iniciar/refazer sorteios;
- acompanhar votações;
- registrar partidas;
- corrigir eventos;
- criar contas e redefinir senhas;
- confirmar, corrigir e estornar pagamentos;
- registrar o pagamento do campo, lançar o saldo inicial do caixa e fechar ciclos financeiros;
- alterar valor da diária, custo do campo e dia de vencimento;
- definir/remover isenção financeira de mensalistas;
- acessar logs administrativos.

Pode haver múltiplos administradores.

### PLAYER

Pode:

- confirmar ou recusar presença;
- entrar na lista de espera quando aplicável;
- visualizar participantes;
- visualizar times;
- votar nas opções de sorteio quando elegível;
- montar/aprovar a Panela de Aniversário quando for aniversariante;
- visualizar partidas;
- visualizar estatísticas e rankings;
- visualizar o caixa e a previsão da próxima mensalidade.

---

# 3. Modalidade do jogador

A modalidade é independente da permissão.

Um ADMIN também pode ser mensalista, por exemplo.

Modalidades:

- MONTHLY — mensalista;
- DAILY — diarista.

Mensalistas possuem prioridade sobre diaristas conforme as regras de presença.

Cada jogador possui uma nota base entre 1 e 5 utilizada inicialmente para balanceamento dos times.

A nota base (baseRating) é visível e editável somente por ADMIN.

Jogadores não visualizam notas, nem as próprias nem as dos outros, inclusive de forma indireta (por exemplo, força somada dos times em um sorteio).

O modelo deve permitir que futuramente a força utilizada pelo algoritmo considere também desempenho e outras métricas.

### Isenção financeira

Alguns mensalistas podem ser isentos da mensalidade.

A isenção é um atributo financeiro explícito do jogador (por exemplo, feeExempt), definido/removido somente por ADMIN e auditável.

Permissão administrativa e obrigação financeira são conceitos independentes: NÃO existe a regra "ADMIN não paga". Um ADMIN só é isento se tiver a isenção definida explicitamente.

---

# 4. Configuração da pelada

Configuração atual:

- Dia: quinta-feira;
- Início: 21:00;
- Término padrão: 22:30;
- Pode eventualmente durar mais 30 minutos;
- Máximo padrão: 20 jogadores;
- Times normalmente possuem 5 jogadores;
- Duração padrão de cada partida: 7 minutos;
- Diferença mínima entre opções de sorteio: 3 jogadores;
- Valor da diária (exemplo atual): R$ 15;
- Custo mensal do campo (exemplo atual): R$ 900 por mês;
- Vencimento do pagamento do campo: dia 10 de cada mês.

Essas informações NÃO devem ser hardcoded.

Devem ser configurações alteráveis por administradores, permitindo mudança futura de campo, horário, quantidade etc.

---

# 5. Temporadas

As estatísticas são organizadas por temporada.

Inicialmente, cada temporada corresponde a um ano.

Exemplo:

- 2026;
- 2027;
- 2028.

Dados de temporadas anteriores devem permanecer disponíveis para consulta histórica.

---

# 6. Sessão semanal

Cada ocorrência da pelada é uma sessão independente.

Exemplo:

Pelada — Quinta-feira — 08/10/2026 — 21:00.

A sessão contém:

- participantes;
- lista de espera;
- configuração;
- sorteios;
- votação;
- times;
- partidas;
- eventos;
- estatísticas relacionadas àquela noite;
- cobranças das diárias geradas por ela.

### Criação automática

As sessões semanais normais são criadas automaticamente pelo sistema (ação do SYSTEM), 7 dias antes da abertura programada da lista (antecedência configurável).

A sessão usa a configuração do Group para determinar dia, horário, abertura da lista, deadline dos mensalistas e demais valores copiados como snapshot (limite de participantes, tamanho dos times, duração da partida, valor da diária etc.).

Normalmente a lista abre automaticamente na segunda-feira às 08:00 para a sessão de quinta-feira.

### Sessão extraordinária

ADMIN pode criar manualmente uma sessão extraordinária, fora da recorrência semanal.

A criação gera AuditLog.

### Cancelamento

ADMIN pode cancelar uma sessão.

O cancelamento:

- exige reason;
- gera AuditLog;
- notifica todos os membros ativos (SESSION_CANCELLED);
- impede ou encerra o fluxo normal daquela sessão (abertura da lista, deadline, promoções, sorteio, votação, partidas e cobranças).

O histórico da sessão cancelada (inscrições, eventuais sorteios) é preservado.

---

# 7. Abertura da lista

Normalmente a lista abre:

Segunda-feira às 08:00.

A abertura deve ocorrer automaticamente.

Quando aberta, mensalistas recebem uma notificação push informando que precisam responder.

---

# 8. Confirmação dos mensalistas

Após abertura da lista, cada mensalista pode:

- confirmar presença;
- recusar;
- permanecer sem responder.

O prazo prioritário dos mensalistas termina:

Quinta-feira às 14:00.

Antes desse horário, mensalistas possuem prioridade sobre qualquer diarista.

A ordem de confirmação deve ser registrada por timestamp.

A quantidade de mensalistas não é fixa (atualmente pode haver 20 ou 21) e NÃO deve ser hardcoded.

O limite padrão de participantes de uma sessão continua sendo 20 (configurável).

Exemplo: com 21 mensalistas, caso todos confirmem antes do prazo, os primeiros 20 pela ordem de confirmação ocupam as vagas.

O 21º entra na lista de espera.

---

# 9. Diaristas

Diaristas são usuários previamente cadastrados.

Eles podem demonstrar interesse em participar da sessão.

Enquanto houver prioridade dos mensalistas, ficam na lista de espera.

A fila respeita a ordem de confirmação/interesse.

Convidados também devem ser previamente cadastrados por administradores como diaristas.

Não existe convidado anônimo.

---

# 10. Deadline dos mensalistas

Às 14:00 da quinta-feira termina a prioridade dos mensalistas.

Mensalistas que não confirmaram até esse horário perdem a prioridade.

Vagas disponíveis passam a ser preenchidas pelos diaristas interessados, respeitando a ordem da fila.

Caso um mensalista tente entrar depois das 14:00, ele entra no final da lista de espera e não recupera prioridade sobre diaristas.

---

# 11. Liberação de vaga e promoção automática

Sempre que uma vaga for liberada, o próximo jogador elegível da lista de espera é promovido AUTOMATICAMENTE, respeitando as regras de prioridade vigentes (seções 8 a 10).

O jogador já manifestou interesse ao entrar na fila, portanto NÃO precisa aceitar novamente.

Ao ser promovido:

- passa para PARTICIPANT;
- promotedAt é registrado;
- é gerado AuditLog (ação do SYSTEM);
- recebe a notificação push WAITLIST_PROMOTED.

### Cancelamento depois das 14:00

Se um participante confirmado cancelar depois das 14:00:

1. sua vaga é liberada;
2. o primeiro jogador elegível da lista de espera é promovido;
3. o sistema registra a promoção;
4. o jogador promovido recebe push notification.

Exemplo:

"Você entrou na pelada! Uma vaga foi liberada para hoje."

### Intervenção administrativa na fila

ADMIN pode, excepcionalmente, incluir, remover ou reposicionar um participante contrariando a ordem normal da fila.

É uma intervenção manual excepcional e exige:

- reason obrigatório;
- AuditLog com actor, timestamp, before e after.

O timestamp original de confirmação do jogador é preservado; a intervenção altera apenas a posição efetiva.

Uma intervenção administrativa nunca pode fazer a sessão ultrapassar sua capacidade. Se a sessão estiver cheia, o ADMIN deve remover ou reposicionar outro participante como parte da mesma intervenção.

---

# 12. Quantidade de jogadores

O formato ideal é:

20 jogadores → 4 times de 5.

Também é possível:

15 jogadores → 3 times de 5.

Quando houver entre 16 e 19 participantes, após o deadline das 14:00, o ADMIN escolhe entre:

### FIXED_TEAMS

- limitar a sessão a 15 participantes;
- formar 3 times de 5;
- respeitar as regras de prioridade: mensalistas mantêm prioridade e os excedentes saem na ordem inversa de prioridade/fila (diaristas primeiro).

### FLEXIBLE_ROTATION

- manter os 16 a 19 participantes;
- formar 3 times de 5;
- os excedentes ficam como rotativos, completando lacunas conforme decisão feita durante a pelada;
- ADMIN decide e pode ajustar quem são os rotativos;
- o algoritmo NÃO escolhe automaticamente os rotativos.

O rodízio não precisa ser automatizado no MVP.

A escolha entre FIXED_TEAMS e FLEXIBLE_ROTATION pode ser alterada até o sorteio.

### Menos de 15 participantes

Não existe comportamento automático no MVP. ADMIN decide como proceder.

---

# 13. Goleiros

Goleiro não é posição fixa de um jogador.

Os 20 participantes são considerados jogadores para formação dos times.

Durante uma partida, jogadores que não estão jogando podem ser escolhidos manualmente para atuar como goleiros.

Goleiros:

- não influenciam o sorteio;
- são escolhidos na hora;
- podem ser registrados em cada partida.

---

# 14. Formação normal dos times

O sistema utiliza a nota de 1 a 5 dos jogadores para gerar times equilibrados.

Atualmente:

playerStrength = baseRating

A arquitetura deve permitir futuramente:

playerStrength = baseRating + performanceModifiers + outros fatores.

O algoritmo não deve depender diretamente da implementação atual da nota.

---

# 15. Opções de sorteio

Em uma sessão normal, o sistema gera DUAS opções independentes de times equilibrados.

Exemplo:

Opção A

- Time A;
- Time B;
- Time C;
- Time D.

Opção B

- Time A;
- Time B;
- Time C;
- Time D.

As opções devem permanecer congeladas durante a votação.

### Diversidade entre as opções

As opções A e B precisam possuir diversidade real.

Deve existir uma diferença mínima de 3 jogadores (valor configurável) alocados em times diferentes entre uma opção e outra.

A comparação desconsidera os identificadores arbitrários dos times: renomear Time A para Time B, trocar cores ou trocar a ordem dos times NÃO constitui uma opção diferente.

Definição: a diferença entre duas opções é o menor número de jogadores que precisam mudar de time para transformar uma opção na outra, considerando o melhor pareamento possível entre os times das duas opções.

Jogadores fixos (por exemplo, a Panela de Aniversário, idêntica nas duas opções) não contam para a diferença.

---

# 16. Votação

Somente mensalistas confirmados como participantes daquela sessão podem votar.

Diaristas não votam.

Mensalistas ausentes não votam.

Cada jogador elegível possui um voto:

- Opção A;
- Opção B.

A opção com mais votos vence.

Em caso de empate:

- o sistema permanece com status de empate;
- NÃO realiza desempate automático;
- administradores resolvem a situação externamente.

---

# 17. Refazer sorteio

Administradores podem invalidar um sorteio e gerar outro.

O sorteio anterior NÃO deve ser apagado.

Deve permanecer no histórico.

Devem ser registrados:

- administrador responsável;
- data/hora;
- sorteio substituído;
- novo sorteio;
- reason opcional.

Os votos do sorteio invalidado não são transferidos.

Uma nova votação começa do zero.

---

# 18. Panela de Aniversário

Algumas sessões possuem o evento especial:

BIRTHDAY_DRAFT — "Panela de Aniversário".

O aniversariante participa obrigatoriamente da panela.

### Um aniversariante

O aniversariante escolhe mais 4 jogadores.

Total:

5 jogadores.

### Dois aniversariantes

Os dois aniversariantes ficam obrigatoriamente na mesma panela.

Eles escolhem conjuntamente mais 3 jogadores.

Total:

5 jogadores.

Os dois precisam entrar em consenso sobre a composição.

O sistema deve permitir aprovação da panela pelos dois aniversariantes.

Se a composição for alterada depois da aprovação de um deles, aprovações anteriores devem ser invalidadas.

A panela somente é considerada finalizada quando todos os aniversariantes envolvidos aprovarem a composição atual.

---

# 19. Sorteio após Panela de Aniversário

Nenhum sorteio pode ocorrer antes da finalização da panela.

Após a panela ser finalizada:

- seus 5 jogadores ficam fixos;
- os demais jogadores são utilizados para formar os times restantes;
- o algoritmo deve buscar equilíbrio considerando também a força da panela já formada.

Com 20 participantes:

1 panela + 3 times sorteados.

O sistema deve continuar permitindo as opções/votação conforme a configuração da sessão.

---

# 20. Histórico e auditoria

Alterações administrativas relevantes devem gerar AuditLog.

O sistema também deve registrar ações automáticas relevantes.

Exemplos:

- alteração da nota;
- inclusão/remoção de participante;
- promoção da lista de espera;
- mudança de configuração;
- criação de sessão;
- alteração da Panela de Aniversário;
- aprovação da panela;
- sorteio;
- invalidação/refação de sorteio;
- correção de partida;
- correção de gol;
- correção de assistência;
- alterações relevantes de estatísticas;
- criação de sessão extraordinária e cancelamento de sessão;
- intervenção administrativa na fila (inclusão, remoção, reposicionamento);
- escolha de FIXED_TEAMS/FLEXIBLE_ROTATION e definição de rotativos;
- registro e correção de presença real;
- criação de conta e redefinição de senha;
- geração e cancelamento de cobrança;
- confirmação, correção e estorno de pagamento;
- abertura e fechamento de ciclo financeiro;
- registro, correção e estorno do pagamento do campo;
- lançamento do saldo inicial do caixa;
- alteração do valor da diária, do custo do campo e do dia de vencimento;
- definição/remoção de isenção financeira;
- conflitos de concorrência relevantes no Modo Pelada.

Quando aplicável, armazenar:

- actor;
- action;
- entity;
- entityId;
- before;
- after;
- reason;
- timestamp.

Ações automáticas devem ser identificáveis como ações do SYSTEM.

---

# 21. Formato das partidas — Rei da Mesa

Cada partida possui duração padrão de:

7 minutos.

A duração é configurável e NÃO deve ser hardcoded.

O vencedor permanece em campo.

---

# 22. Rei da Mesa com quatro times

Em caso de vitória:

- vencedor permanece;
- perdedor sai;
- próximo time entra.

Em caso de empate:

- os dois times saem;
- os dois times que estavam esperando entram.

---

# 23. Rei da Mesa com três times

Em caso de vitória:

- vencedor permanece;
- perdedor sai;
- time que estava esperando entra.

Em caso de empate:

- ocorre disputa de pênaltis;
- o sistema registra quem venceu nos pênaltis;
- vencedor permanece;
- perdedor sai;
- time que estava esperando entra.

---

# 24. Modo Pelada

A área administrativa deve possuir uma interface mobile simplificada para operar a sessão em tempo real.

Deve permitir:

- registrar a presença real dos participantes (PRESENT ou ABSENT);
- visualizar partida atual;
- visualizar cronômetro;
- registrar gols;
- registrar gols contra;
- registrar assistência;
- registrar pixotadas;
- selecionar goleiros;
- finalizar partida;
- registrar vencedor nos pênaltis;
- iniciar próxima partida.

O sistema deve aplicar automaticamente as regras de Rei da Mesa para sugerir os próximos times.

### Múltiplos administradores simultâneos

Vários administradores podem operar o Modo Pelada ao mesmo tempo. A sessão NÃO é limitada a um único operador.

As mutações devem ser protegidas contra:

- duplo clique;
- retry de rede;
- reenvio da mesma operação;
- concorrência entre administradores.

Regras:

1. Idempotência: cada comando relevante carrega um operationId (UUID gerado pelo cliente). O backend garante que a mesma operationId produza efeito no máximo uma vez; reenvios recebem o mesmo resultado da primeira execução.
2. Concorrência: cada partida possui uma versão (version). Comandos que alteram a partida informam a versão que o operador estava vendo (expectedVersion). Se a partida tiver mudado desde então, o comando é rejeitado como conflito, nada é gravado e o operador recebe o estado atual para reconciliar (descartar ou reenviar conscientemente).
3. NÃO usar heurística baseada apenas em tempo para detectar duplicidade, pois dois gols legítimos podem ocorrer em sequência.
4. Comandos aceitos e conflitos relevantes geram AuditLog.

---

# 25. Eventos individuais

No MVP serão registrados:

### GOAL

Gol marcado pelo jogador.

Todo GOAL possui obrigatoriamente um autor identificado.

Pode possuir uma assistência vinculada.

### OWN_GOAL

Gol contra.

Todo OWN_GOAL possui obrigatoriamente um autor identificado.

Aumenta o placar do adversário e registra gol contra para o jogador responsável.

Não existe gol (GOAL ou OWN_GOAL) sem autor.

### ASSIST

Não deve existir isoladamente.

Uma assistência pertence a um evento GOAL.

Um gol pode possuir zero ou uma assistência: o autor é obrigatório e o assistente é opcional.

### BIG_MISS

Nome apresentado na interface:

"Pixotada".

Representa uma oportunidade clara/absurda de gol desperdiçada.

---

# 26. Estatísticas

A partir das partidas e eventos, o sistema poderá calcular:

- partidas jogadas;
- vitórias;
- empates;
- derrotas;
- gols;
- gols contra;
- assistências;
- pixotadas;
- gols por partida;
- assistências por partida;
- aproveitamento.

Os totais derivados NÃO devem ser a fonte primária dos dados.

A fonte da verdade são partidas, participações e eventos.

Alterações históricas devem refletir automaticamente nos rankings derivados.

---

# 27. Ranking

O sistema possui rankings por temporada.

Devem existir pelo menos:

- classificação geral;
- artilharia;
- assistências;
- pixotadas;
- gols contra.

Temporadas antigas permanecem consultáveis.

Rankings e estatísticas são visíveis para todos os usuários autenticados da pelada.

---

# 28. PWA

A aplicação deve ser mobile-first e instalável como PWA.

A experiência principal será em smartphones.

Também deve funcionar normalmente pelo navegador em desktop.

---

# 29. Push notifications

Push notifications fazem parte do MVP.

Eventos inicialmente previstos:

### LIST_OPENED

Lista da próxima pelada aberta.

### MONTHLY_DECLINED

Mensalista informou que não participará.

Pode ser utilizado para alertar sobre possível disponibilidade.

### WAITLIST_PROMOTED

Jogador da lista de espera ganhou vaga.

### DAILY_PLAYERS_NEEDED

Ainda faltam jogadores para completar a pelada.

### SESSION_CANCELLED

Sessão cancelada por um ADMIN.

Enviada a todos os membros ativos.

### PAYMENT_AVAILABLE

Previsto para o futuro. Não faz parte do MVP, mesmo com o caixa básico (seção 31).

Novos tipos de notificação devem poder ser adicionados futuramente.

---

# 30. Segurança e privacidade

Dados da pelada não são públicos.

Usuários precisam estar autenticados para acessar informações internas.

Permissões administrativas devem ser verificadas no backend e nunca apenas ocultadas na interface.

Visibilidade para usuários autenticados:

- rankings e estatísticas: todos;
- caixa e previsão da mensalidade: todos (detalhes na seção 31);
- nota base (baseRating) e qualquer dado que a revele (força de jogadores ou times): somente ADMIN.

Dados restritos a ADMIN não devem ser enviados ao cliente de um PLAYER, nem mesmo ocultos na interface.

---

# 31. Caixa da pelada

O MVP possui um módulo básico de caixa.

O caixa representa:

ENTRADAS:

- pagamentos confirmados de diaristas;
- pagamentos confirmados de mensalidades dos mensalistas.

SAÍDAS:

- pagamento mensal do campo.

## 31.1 Conceitos separados

O financeiro separa quatro conceitos:

- ciclo financeiro (BillingCycle): o mês financeiro ao qual cobranças e movimentações são atribuídas;
- cobrança (obrigação): o que um jogador deve (diária ou mensalidade);
- pagamento: o registro de que uma cobrança foi paga, confirmado por ADMIN;
- movimentação do caixa: a entrada ou saída de dinheiro efetivamente registrada no caixa.

"Diarista participou" NÃO é receita. Participação gera uma cobrança; somente o pagamento confirmado gera entrada no caixa.

Presença e financeiro são domínios separados.

A rastreabilidade deve permitir seguir:

- GameSession → participação do diarista → cobrança → pagamento → movimentação do caixa;
- BillingCycle → cobranças dos diaristas atribuídas ao ciclo → pagamentos recebidos → movimentações de entrada;
- BillingCycle → cobranças dos mensalistas → pagamentos recebidos → movimentações de entrada;
- BillingCycle → pagamento do campo → movimentação de saída.

## 31.2 Ciclo financeiro (BillingCycle)

O ciclo financeiro é mensal e é representado por uma entidade explícita.

O ciclo NÃO é derivado simplesmente do mês da data de pagamento (MONTH(paymentDate)), porque pagamentos podem ocorrer com atraso e é preciso preservar explicitamente a qual ciclo cada receita foi atribuída.

Cada ciclo possui pelo menos:

- período/referência (mês de referência);
- openedAt;
- closedAt;
- dueDate (data concreta de vencimento do pagamento do campo);
- fieldCostSnapshot (custo mensal do campo aplicável ao ciclo);
- status: OPEN ou CLOSED.

Toda cobrança e toda movimentação do caixa são vinculadas explicitamente a um ciclo. A atribuição fica gravada e não é recalculada a partir de datas.

As receitas de diaristas que reduzem a mensalidade são as vinculadas explicitamente ao ciclo.

Ao fechar um ciclo, seus valores históricos (custo do campo, receitas elegíveis, mensalistas pagantes e valor por mensalista) ficam congelados e NÃO mudam silenciosamente por causa de alterações posteriores em configurações ou cadastros.

Ciclos fechados nunca são recalculados retroativamente.

Os ciclos são fechados em ordem cronológica: apenas o ciclo aberto mais antigo pode ser fechado.

## 31.3 Custo do campo e vencimento

O campo custa atualmente R$ 900 POR MÊS (não por sessão).

O pagamento do campo deve ser realizado até o dia 10 de cada mês.

O vencimento é no dia configurado DO PRÓPRIO MÊS do ciclo. Exemplo: ciclo de outubro/2026 → vencimento em 10/10/2026.

O custo mensal e o dia de vencimento são configuráveis por ADMIN e NÃO devem ser hardcoded.

Cada BillingCycle guarda:

- o snapshot do custo mensal aplicável (exemplo: fieldCostSnapshot = 90000 centavos);
- a dueDate concreta (exemplo: 10/10/2026 para o ciclo de outubro/2026).

Se futuramente o campo passar para R$ 1.000, os ciclos históricos continuam com o custo original.

## 31.4 Valor da diária

O valor da diária é configurável por ADMIN (exemplo atual: R$ 15).

## 31.5 Cobrança do diarista

Estar confirmado na lista NÃO significa que o diarista efetivamente participou.

A presença real é registrada no Modo Pelada (PRESENT ou ABSENT).

Somente o diarista marcado como PRESENT naquela sessão gera cobrança de diária.

A criação da cobrança é idempotente: nunca pode existir mais de uma cobrança de diária para o mesmo jogador na mesma sessão.

O valor da diária é salvo como snapshot na cobrança.

Exemplo: se a diária era R$ 15 naquela sessão e depois passar para R$ 20, a cobrança antiga continua sendo R$ 15.

A cobrança nasce PENDENTE e é vinculada ao ciclo financeiro da sessão.

### Correção de presença

A cobrança de diária representa a obrigação financeira única daquele diarista naquela sessão. Correções de presença nunca criam uma segunda cobrança.

PRESENT → ABSENT:

- a cobrança PENDENTE existente passa para CANCELADA;
- reason é obrigatório;
- gera AuditLog.

ABSENT → PRESENT (depois de uma correção anterior):

- NÃO cria nova cobrança;
- reativa a mesma cobrança CANCELADA para PENDENTE, preservando sua identidade e rastreabilidade;
- gera AuditLog.

Se a cobrança já tiver pagamento confirmado, não é permitido cancelamento nem reativação simples: primeiro deve ser feito o estorno do pagamento (seção 31.7).

## 31.6 Pagamento

Somente quando o pagamento for CONFIRMADO o dinheiro entra no caixa. Vale para diárias e mensalidades.

No MVP, o pagamento é confirmado manualmente por ADMIN.

No MVP NÃO existe pagamento parcial: cada cobrança possui no máximo um pagamento confirmado válido, sempre pelo valor integral da cobrança. Correções são feitas por estorno + novo registro, preservando o pagamento estornado no histórico.

Exemplo, com 3 diaristas em uma sessão:

- João: R$ 15, PAGO;
- Pedro: R$ 15, PAGO;
- Carlos: R$ 15, PENDENTE.

Resultado:

- receita prevista: R$ 45;
- receita recebida: R$ 30;
- receita pendente: R$ 15;
- saldo disponível proveniente dessas cobranças: R$ 30.

Cobranças pendentes NÃO entram no saldo do caixa.

Ao confirmar um pagamento, registrar:

- cobrança;
- jogador;
- sessão;
- valor;
- administrador que confirmou;
- data/hora do pagamento;
- data/hora da confirmação;
- forma de pagamento (opcional);
- observação (opcional).

### Pagamento atrasado de diária

Se uma diária de um ciclo já fechado for paga posteriormente:

- a cobrança permanece vinculada à sessão e ao ciclo originais;
- o pagamento permanece vinculado à cobrança;
- a movimentação de entrada no caixa é atribuída ao ciclo financeiro atualmente aberto;
- o valor reduz a próxima mensalidade;
- o ciclo fechado não é recalculado.

## 31.7 Correção e estorno

Confirmação, correção e estorno de pagamento devem ser auditáveis.

O histórico financeiro NUNCA é apagado silenciosamente: correções e estornos preservam o registro original e geram novos registros que o compensam.

Correções nunca alteram os valores congelados de um ciclo já fechado.

## 31.8 Mensalistas pagantes

Mensalistas pagantes = mensalistas ativos não isentos no momento do fechamento do ciclo (ver isenção financeira na seção 3).

O mensalista paga a mensalidade independentemente da presença. Somente o diarista PRESENT gera cobrança de diária (seção 31.5).

Enquanto o ciclo está aberto, a previsão usa os mensalistas ativos não isentos do momento da consulta.

## 31.9 Cálculo da mensalidade

Durante o ciclo são acumulados os pagamentos CONFIRMADOS de diaristas atribuídos àquele ciclo.

Fórmula:

- valorParaMensalistas = custoDoCampoDoCiclo − receitasElegiveisRecebidasDeDiaristas − créditoDeArredondamentoDoCicloAnterior;
- mensalistasPagantes = mensalistas ativos não isentos no momento do fechamento;
- valorPorMensalista = valorParaMensalistas / mensalistasPagantes, arredondado PARA CIMA ao próximo centavo.

Exemplo:

- campo: R$ 900;
- diaristas efetivamente pagos: R$ 75;
- mensalistas pagantes: 19;
- R$ 900 − R$ 75 = R$ 825;
- R$ 825 / 19 = R$ 43,421...;
- mensalidade individual = R$ 43,43;
- total cobrado = 19 × R$ 43,43 = R$ 825,17;
- diferença de arredondamento = R$ 0,17.

Cobranças PENDENTES não reduzem a mensalidade.

Enquanto o ciclo está aberto, o sistema apresenta o valor como PREVISÃO dinâmica, visível para todos os usuários autenticados.

No fechamento do ciclo, o valor é congelado como o valor daquele ciclo.

Divisão monetária:

- todos os cálculos são feitos em centavos inteiros;
- todos os mensalistas pagantes pagam EXATAMENTE O MESMO VALOR; não se distribuem centavos diferentes entre jogadores;
- quando houver fração de centavo, o valor individual é arredondado PARA CIMA;
- a diferença de arredondamento NÃO é descartada: permanece como saldo positivo do caixa e beneficia o ciclo seguinte, entrando como crédito no cálculo da próxima mensalidade;
- nenhum centavo pode ser criado ou perdido sem registro.

O BillingCycle registra no fechamento:

- valor exato a ser dividido;
- quantidade de pagantes;
- valor individual arredondado;
- total efetivamente cobrado;
- diferença de arredondamento.

NÃO devem ser hardcoded: custo do campo, dia de vencimento, valor da diária, quantidade de mensalistas pagantes e quantidade de mensalistas.

## 31.10 Fechamento do ciclo e cobrança das mensalidades

No MVP, o fechamento do BillingCycle é MANUAL, realizado por ADMIN.

Enquanto o ciclo está OPEN, o sistema mostra a previsão dinâmica.

Ao fechar, em uma única operação transacional e idempotente (repetir o comando não fecha duas vezes nem duplica cobranças):

1. congelar os valores do ciclo;
2. determinar os mensalistas ativos não isentos;
3. calcular a mensalidade individual;
4. arredondar para cima conforme a regra da seção 31.9;
5. criar uma cobrança de mensalidade para cada mensalista pagante, todas com o mesmo valor individual congelado;
6. registrar closedAt;
7. mudar o status para CLOSED;
8. gerar AuditLog.

As cobranças de mensalidade nascem PENDENTES.

O pagamento é confirmado manualmente por ADMIN, com os mesmos registros exigidos na seção 31.6, e só então entra no caixa.

## 31.11 Pagamento do campo

O pagamento mensal do campo faz parte do caixa.

Ele é registrado por ADMIN como movimentação de saída vinculada ao ciclo, com data do pagamento, valor, administrador responsável, forma de pagamento (opcional) e observação (opcional).

O registro é auditável e segue as mesmas regras de correção e estorno.

Exemplo de ciclo:

- diaristas: + R$ 75;
- mensalidades: + R$ 825,17 (19 × R$ 43,43);
- pagamento do campo: − R$ 900;
- saldo do ciclo: + R$ 0,17 (diferença de arredondamento, que beneficia o ciclo seguinte).

## 31.12 Saldo inicial do caixa

É permitido lançar o saldo inicial do caixa (por exemplo, o dinheiro já existente ao começar a usar o sistema) como uma movimentação do tipo INITIAL_BALANCE.

O saldo do caixa NÃO é armazenado diretamente: é sempre calculado a partir das movimentações.

Somente ADMIN pode realizar o lançamento, com motivo (reason) obrigatório e AuditLog.

Existe no máximo um INITIAL_BALANCE válido por grupo. Correções são feitas por estorno + novo lançamento, preservando o histórico.

## 31.13 Visibilidade

Todos os usuários autenticados podem visualizar:

- saldo do caixa;
- receitas previstas;
- receitas recebidas;
- receitas pendentes;
- histórico por sessão;
- quantidade de diaristas;
- custo do campo;
- ciclos financeiros, com valor congelado da mensalidade e pagamento do campo;
- previsão da próxima mensalidade;
- fórmula utilizada no cálculo.

Somente ADMIN pode:

- confirmar pagamento (diária ou mensalidade);
- corrigir/estornar pagamento;
- registrar, corrigir ou estornar o pagamento do campo;
- fechar ciclo financeiro;
- lançar o saldo inicial do caixa;
- alterar valor da diária;
- alterar custo do campo e dia de vencimento;
- definir/remover isenção;
- realizar qualquer alteração financeira.

## 31.14 Fora do MVP

- PIX integrado;
- gateway de pagamento;
- cobrança automática;
- integração bancária.

A arquitetura deve permitir evoluir para essas funcionalidades sem reescrever o caixa.

---

# 32. Evolução futura para SaaS

Embora inicialmente exista apenas uma pelada, evitar modelagem que torne impossível suportar múltiplos grupos futuramente.

A arquitetura deve permitir futura introdução de uma entidade equivalente a:

Group / League

que possua:

- membros;
- administradores;
- configurações;
- sessões;
- temporadas;
- rankings.

Não é necessário implementar toda a infraestrutura multi-tenant no MVP.

---

# 33. Princípios técnicos

1. Regras de negócio não devem ficar espalhadas em componentes de interface.

2. Algoritmos de formação de times devem ser desacoplados da UI.

3. A força de um jogador deve ser obtida por uma abstração, permitindo evolução futura.

4. Eventos e partidas são a fonte da verdade para estatísticas.

5. Operações administrativas importantes devem ser auditáveis.

6. Timestamps determinam prioridade quando aplicável.

7. Valores configuráveis da pelada não devem ser hardcoded.

8. O backend deve validar todas as regras importantes independentemente das validações do frontend.

9. Sorteios anteriores nunca devem ser destruídos ao serem refeitos.

10. O sistema deve priorizar experiência mobile.

11. Comandos críticos devem ser idempotentes (operationId) e protegidos contra concorrência (versionamento otimista), sem heurísticas baseadas apenas em tempo.

12. Histórico financeiro nunca é apagado: correções e estornos geram novos registros.

13. Participação, cobrança, pagamento e movimentação de caixa são conceitos distintos.

14. Dados restritos a ADMIN (como notas) nunca são enviados ao cliente de um PLAYER.

---

# 34. Fora do MVP

Não implementar inicialmente:

- PIX integrado;
- gateway de pagamento;
- cobrança automática;
- integração bancária;
- recuperação de senha por email;
- login Google;
- integração WhatsApp;
- SaaS multi-tenant completo;
- balanceamento baseado em desempenho;
- automação do rodízio de jogadores excedentes;
- estatísticas avançadas de goleiro.

A arquitetura pode prever essas funcionalidades sem implementá-las antecipadamente.

---

# 35. Regra fundamental para desenvolvimento

Este documento é a fonte principal das regras de negócio do projeto.

Antes de implementar ou alterar funcionalidades que envolvam regras da pelada:

1. consultar este documento;
2. não inventar regras não especificadas;
3. apontar ambiguidades antes de implementar;
4. manter regras de domínio separadas da apresentação;
5. atualizar esta documentação quando uma regra de negócio for oficialmente alterada.

---

# 36. Histórico de revisões

### Revisão 1 — 03/10/2026

- Promoção automática da lista de espera em qualquer liberação de vaga, sem necessidade de aceite (seção 11).
- Diversidade mínima entre opções de sorteio: 3 jogadores, desconsiderando permutações dos times (seção 15).
- GOAL e OWN_GOAL com autor obrigatório; assistência opcional (seção 25).
- Rankings e estatísticas visíveis para todos; nota base visível/editável só por ADMIN (seções 3, 27, 30).
- Múltiplos admins simultâneos no Modo Pelada, com idempotência e versionamento otimista (seção 24).
- Contas criadas só por ADMIN; recuperação de senha por redefinição administrativa (seção 2).
- Correção: duração padrão da partida é 7 minutos, não 8 (seções 4 e 21).
- Quantidade de mensalistas não é fixa (seção 8).
- Caixa da pelada, cobrança de diaristas, pagamentos, isenção e previsão da mensalidade passam a fazer parte do MVP (seções 3 e 31).

### Revisão 2 — 03/10/2026

- Ciclo financeiro mensal explícito (BillingCycle) com referência, openedAt, closedAt, dueDate, fieldCostSnapshot e status; cobranças e movimentações vinculadas explicitamente ao ciclo (seção 31.2).
- Custo do campo é mensal (R$ 900 por mês), com vencimento padrão no dia 10, ambos configuráveis (seções 4 e 31.3).
- Mensalidade calculada por ciclo, exibida como previsão enquanto aberto e congelada no fechamento; diferença de arredondamento sempre explícita (seção 31.9).
- Cobrança e pagamento de mensalidades e pagamento do campo passam a fazer parte do caixa (seções 31.10 e 31.11).

### Revisão 3 — 03/10/2026

- Mensalidade igual para todos os pagantes, arredondada para cima ao centavo; a diferença permanece no caixa e entra como crédito no ciclo seguinte (seção 31.9).
- Pagamento atrasado de diária de ciclo fechado entra no ciclo aberto atual, sem recalcular o ciclo fechado (seção 31.6).
- Vencimento no dia configurado do próprio mês do ciclo (seção 31.3).
- Fechamento do ciclo manual por ADMIN, transacional e idempotente (seção 31.10).
- Saldo inicial do caixa via movimentação INITIAL_BALANCE, com reason e AuditLog (seção 31.12).

### Revisão 4 — 03/10/2026

- Confirmado: o crédito de arredondamento reduz o valor a dividir do ciclo seguinte (seção 31.9); ciclos fechados em ordem cronológica (seção 31.2); no máximo um INITIAL_BALANCE válido por grupo (seção 31.12).
- Presença real registrada no Modo Pelada; somente diarista PRESENT gera cobrança, de forma idempotente (seções 24 e 31.5).
- Intervenção administrativa excepcional na fila, com reason e AuditLog (seção 11).
- Regras de FIXED_TEAMS/FLEXIBLE_ROTATION após o deadline, rotativos definidos pelo ADMIN, decisão alterável até o sorteio; menos de 15 sem comportamento automático (seção 12).
- Sessões semanais criadas automaticamente; sessão extraordinária manual; cancelamento com reason, AuditLog e notificação SESSION_CANCELLED (seções 6 e 29).

### Revisão 5 — 03/10/2026

- Mensalista paga a mensalidade independentemente da presença; somente diarista PRESENT gera cobrança de diária (seção 31.8).
- Intervenção administrativa nunca ultrapassa a capacidade da sessão; com a sessão cheia, o ADMIN remove ou reposiciona outro participante na mesma intervenção (seção 11).
- SESSION_CANCELLED é enviada a todos os membros ativos (seções 6 e 29).
- Sessões automáticas são criadas 7 dias antes da abertura programada da lista (seção 6).

### Revisão 6 — 03/10/2026

- Correção de presença de diarista: PRESENT → ABSENT cancela a cobrança PENDENTE (reason obrigatório, AuditLog); ABSENT → PRESENT reativa a mesma cobrança para PENDENTE, sem criar outra (AuditLog). Cobrança com pagamento confirmado exige estorno antes (seção 31.5).

### Revisão 7 — 03/10/2026

- Autenticação própria por username e senha, com sessões próprias em cookie seguro; sem email, OAuth ou login social no MVP (seção 2).
- Senha temporária individual e aleatória na criação e na redefinição; username nunca é senha padrão; somente o hash é armazenado (seção 2).
- Troca obrigatória de senha no primeiro login; a redefinição pelo ADMIN revoga as sessões ativas do usuário (seção 2).
- Sem pagamento parcial: cada cobrança tem no máximo um pagamento confirmado válido, pelo valor integral (seção 31.6).
