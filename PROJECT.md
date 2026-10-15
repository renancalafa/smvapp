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
- registrar o pagamento do campo, realizar a implantação financeira (saldo inicial) e disparar manualmente o congelamento da mensalidade quando o automático não tiver ocorrido;
- alterar valor da diária, custo do campo e dias de vencimento;
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
- Pode eventualmente durar mais 30 minutos (tempo extra máximo configurável entre 0 e 30 minutos; padrão 30);
- Máximo padrão: 20 jogadores;
- Times normalmente possuem 5 jogadores;
- Duração padrão de cada partida: 7 minutos;
- Diferença mínima entre opções de sorteio: 3 jogadores;
- Valor da diária (exemplo atual): R$ 15;
- Custo mensal do campo (exemplo atual): R$ 900 por mês;
- Mensalidade congelada e disponível para pagamento no dia 1 de cada mês (fixo);
- Prazo de pagamento da mensalidade: dia 7 de cada mês;
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

Quinta-feira às 15:00.

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

Às 15:00 da quinta-feira termina a prioridade dos mensalistas.

Mensalistas que não confirmaram até esse horário perdem a prioridade.

Vagas disponíveis passam a ser preenchidas pelos diaristas interessados, respeitando a ordem da fila.

Caso um mensalista tente entrar depois das 15:00, ele entra no final da lista de espera e não recupera prioridade sobre diaristas.

---

# 11. Liberação de vaga e promoção automática

Enquanto a votação do sorteio não começou, sempre que uma vaga for liberada, o próximo jogador elegível da lista de espera é promovido AUTOMATICAMENTE, respeitando as regras de prioridade vigentes (seções 8 a 10). Depois que a votação começa, a promoção é sempre manual (ver "Desde o início da votação e antes da primeira partida").

O jogador já manifestou interesse ao entrar na fila, portanto NÃO precisa aceitar novamente.

Ao ser promovido:

- passa para PARTICIPANT;
- promotedAt é registrado;
- é gerado AuditLog (ação do SYSTEM);
- recebe a notificação push WAITLIST_PROMOTED.

### Cancelamento depois das 15:00

Se um participante confirmado cancelar depois das 15:00, enquanto a votação do sorteio ainda não começou:

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

### Antes da votação do sorteio

Enquanto a votação não começou, a lista funciona normalmente: jogadores confirmam, recusam, desistem e entram na lista de espera, e a promoção automática continua valendo.

O sorteio é sempre gerado pelo sistema, e gerar o sorteio abre a votação no mesmo passo: não existe uma etapa em que o ADMIN veja opções antes da votação e escolha entre elas (seção 17).

### Desde o início da votação e antes da primeira partida

A votação começa quando o sistema gera o sorteio e continua valendo enquanto esse sorteio estiver ativo: em votação, empatado ou decidido. A partir daí:

- o jogador NÃO altera mais a lista: não confirma, não recusa, não desiste e não entra na lista de espera. O app mostra: "Votação iniciada. Alterações na lista somente com um administrador.";
- o ADMIN continua podendo incluir, remover e promover jogadores, como intervenção manual (reason obrigatório e AuditLog);
- a promoção automática da lista de espera fica desligada: uma vaga liberada continua livre até o ADMIN promover alguém explicitamente;
- nenhuma mudança na lista invalida ou altera o sorteio, suas opções e votos, nem os times da sessão; o ADMIN decide se a situação justifica refazê-lo (seção 17).

O jogador que não puder mais ir avisa um ADMIN, que o remove da sessão.

Se o ADMIN invalidar o sorteio sem gerar outro, a lista volta a funcionar como antes da votação: os jogadores voltam a alterá-la e a fila volta a promover automaticamente, inclusive para as vagas que estavam livres. Se o novo sorteio for gerado na mesma ação, as vagas livres são preenchidas pela fila antes da geração e a nova votação trava a lista de novo.

Uma resposta do jogador e a geração do sorteio nunca se cruzam: ou a resposta é registrada antes de a votação começar, ou é rejeitada.

### Depois do início das partidas

Assim que a primeira partida da sessão é iniciada, o conjunto de participantes fica congelado para todos: não há cancelamento, liberação de vaga, promoção da lista de espera, inclusão nem remoção, nem por intervenção administrativa. Quem não puder mais jogar fica indisponível (seção 24).

---

# 12. Quantidade de jogadores

O formato ideal é:

20 jogadores → 4 times de 5.

Também é possível:

15 jogadores → 3 times de 5.

Quando houver entre 16 e 19 participantes, após o deadline das 15:00, o ADMIN escolhe entre:

### FIXED_TEAMS

- limitar a sessão a 15 participantes;
- formar 3 times de 5;
- respeitar as regras de prioridade: mensalistas mantêm prioridade e os excedentes saem na ordem inversa de prioridade/fila (diaristas primeiro).

### FLEXIBLE_ROTATION

- manter os 16 a 19 participantes;
- formar 3 times de 5;
- os excedentes ficam como rotativos, completando lacunas conforme decisão feita durante a pelada;
- ADMIN decide e pode ajustar quem são os rotativos até o sorteio;
- o algoritmo NÃO escolhe automaticamente os rotativos;
- depois da votação, o sorteio decidido (incluindo quem são os rotativos) é a composição oficial e NÃO é reescrito; desvios práticos durante as partidas ficam registrados em quem efetivamente jogou cada partida;
- antes da primeira partida, se quiser outra composição oficial, o ADMIN usa a refação excepcional do sorteio (seção 17).

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

O sorteio é sempre responsabilidade do sistema: o ADMIN não monta, não pré-visualiza e não escolhe opções. Gerar o sorteio abre a votação imediatamente, e a única forma de obter outro sorteio é invalidar o atual, sempre registrada.

O sorteio anterior NÃO deve ser apagado.

Deve permanecer no histórico.

Devem ser registrados:

- administrador responsável;
- data/hora;
- sorteio substituído;
- novo sorteio;
- reason obrigatório.

Toda invalidação gera AuditLog.

Os votos do sorteio invalidado não são transferidos.

Uma nova votação começa do zero.

### Sorteio decidido é o oficial

Depois que a votação decide um sorteio, ele é o sorteio oficial e normalmente não muda.

Desde o início da votação (e, portanto, também com o sorteio decidido), a lista de participantes só muda por intervenção do ADMIN, e a lista de espera não promove automaticamente (seção 11).

Nenhuma mudança invalida um sorteio automaticamente, inclusive:

- remoção, inclusão ou promoção feita pelo ADMIN;
- indisponibilidade temporária;
- ajuste de rotativos;
- outras circunstâncias antes da partida.

O ADMIN decide se a situação justifica refazer o sorteio. NÃO se troca um jogador dentro do sorteio já votado.

### Antes da primeira partida

Enquanto nenhuma partida da sessão foi iniciada, um ADMIN pode, como ação manual excepcional, invalidar o sorteio vigente, inclusive um sorteio já decidido, e realizar um novo sorteio:

- reason obrigatório, ADMIN responsável e AuditLog;
- o sorteio anterior, suas opções, times e votos são preservados como histórico e marcados como invalidados;
- o novo sorteio referencia o sorteio invalidado, e a votação recomeça do zero;
- a composição atual dos times da sessão pode ser substituída, porque ainda não foi usada por nenhuma partida;
- os novos times da sessão são gerados somente a partir do novo sorteio decidido.

Se o ADMIN não refizer o sorteio, a sessão começa com a composição oficial. Quem deixou de ser participante continua no sorteio oficial como registro histórico, mas não joga; quem está indisponível também não joga. Quem entrou depois do sorteio é participante sem time. As vagas em campo são cobertas por jogadores emprestados ou por participantes sem time, partida a partida (seção 24).

Exemplo: João era do Time 2 no sorteio oficial e avisa que não poderá ir. Com a votação já iniciada, ele não consegue sair da lista pelo app, então fala com um ADMIN, que o remove da sessão com o motivo. A vaga fica livre, e o ADMIN promove Marcos, o primeiro da lista de espera. O ADMIN decide não refazer o sorteio. João continua no Time 2 do sorteio oficial, mas não entra em nenhuma partida seguinte. Marcos é participante sem time e pode jogar por um lado adequado em cada partida.

### Depois da primeira partida

Assim que qualquer partida da sessão é iniciada (inclusive uma partida depois cancelada), a composição dos times da sessão passa a ser dado histórico.

- O sistema NÃO permite invalidar o sorteio, gerar um novo sorteio nem apagar e regenerar os times da sessão.
- Nenhum jogador novo entra na sessão. Lesões, indisponibilidades, empréstimos e outras mudanças práticas são consequência do jogo: ficam registradas na indisponibilidade do jogador, em quem efetivamente jogou cada partida e no estado da partida, sem alterar o sorteio oficial (seção 24).

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
- abertura de ciclo financeiro e congelamento da mensalidade (automático ou manual);
- cobrança de mensalidade de quem entrou depois do congelamento;
- registro, correção e estorno do pagamento do campo;
- implantação financeira e lançamento do saldo inicial do caixa;
- alteração do valor da diária, do custo do campo e dos dias de vencimento;
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

Sempre que uma regra exige reason (motivo ou justificativa), ele deve conter texto: vazio ou só espaços é inválido.

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
- iniciar próxima partida;
- marcar jogador como indisponível (lesão, saída antecipada);
- escolher jogador emprestado para completar um time na partida.

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

### Jogador indisponível e empréstimo por partida

Um jogador pode ficar indisponível durante a sessão, antes ou depois da primeira partida (por exemplo, por lesão ou por ir embora mais cedo). No Rei da Mesa, a vaga dele em campo é preenchida a cada partida por um jogador emprestado de um time que não está jogando aquela partida.

Exemplo:

- João é do Time 2 e Marcos é do Time 3.
- Partida 5: Time 1 × Time 2, com o Time 3 descansando. João se lesiona.
- Marcos joga pelo Time 2 no lugar de João, só nessa partida.
- O Time 2 vence e continua em campo. Partida 6: Time 2 × Time 3.
- Marcos joga normalmente pelo Time 3, o time dele.
- O Time 2 pega emprestado outro jogador de um time que está fora (Time 1 ou Time 4) para a vaga de João.

Time do jogador na noite:

- O sorteio decidido e os times da sessão continuam representando o time de cada jogador na noite.
- João continua sendo do Time 2 e Marcos continua sendo do Time 3. Emprestar um jogador NÃO o transfere de time.
- Nada disso exige novo sorteio.

Indisponibilidade temporária:

- Somente ADMIN marca um jogador como indisponível e, depois, como disponível de novo.
- A indisponibilidade é temporária: o jogador pode voltar a qualquer momento e, a partir daí, joga normalmente pelo próprio time nas partidas seguintes. Pode ficar indisponível e voltar mais de uma vez na mesma sessão.
- Marcar indisponível exige reason e registra data/hora e o administrador responsável. Marcar disponível registra data/hora e o administrador responsável. Ambos geram AuditLog.
- As operações são idempotentes (operationId) e protegidas contra concorrência entre administradores.
- Todo o histórico é preservado: cada período de indisponibilidade fica registrado com início, fim, responsáveis e reason, e é possível saber se o jogador estava disponível quando cada partida começou.
- NÃO altera o time do jogador nem as partidas que ele já jogou, e NÃO altera presença real nem cobranças: as regras de PRESENT continuam determinando a cobrança de diária (seção 31.5).
- O jogador continua participante da sessão; a indisponibilidade não libera vaga na lista nem promove ninguém da lista de espera.

Conjunto de participantes fixo depois do início das partidas:

- Assim que a primeira partida da sessão é iniciada, o conjunto de participantes confirmados fica congelado (em uma sessão normal de 4 times, os 20 confirmados).
- NÃO é permitido incluir um 21º participante, promover alguém da lista de espera por causa de uma lesão, incluir um diarista de emergência nem remover ou cancelar a inscrição do jogador indisponível.
- A vaga em campo de um jogador indisponível é coberta somente por empréstimo, entre esses mesmos participantes.
- A presença real (PRESENT/ABSENT) continua podendo ser registrada e corrigida.

Empréstimo por partida:

- Em cada partida, o ADMIN escolhe quem atua por cada lado. Para a vaga de um jogador indisponível (ou que deixou de ser participante antes da primeira partida sem refação do sorteio), escolhe:
  - um **jogador emprestado**: participante disponível que tem time no sorteio oficial e representa outro time só nessa partida; vem de um time que não está nessa partida; ou
  - um **participante sem time**: participante que entrou depois do sorteio oficial (por exemplo, promovido da lista de espera pelo ADMIN) sem que o ADMIN refizesse o sorteio. O sorteio oficial NÃO é alterado para colocá-lo em um time.
- As estatísticas são sempre do próprio jogador, nos dois casos.
- O emprestado continua no próprio time e só representa o outro time naquela partida.
- Um jogador não pode atuar pelos dois lados da mesma partida.
- Um jogador só entra em uma partida se estiver disponível naquele momento.

Estatísticas:

- O emprestado é um jogador normal na partida: marca gols e gols contra, dá e recebe assistências e comete pixotadas.
- Todas as estatísticas individuais são dele, qualquer que seja o time que representou.
- O resultado da partida (vitória, empate, derrota) conta para ele pelo lado em que atuou.
- Ninguém herda estatísticas de outro jogador.

Nada é apagado. O histórico permite responder: o time original de João; quando e por que João ficou indisponível e quando voltou; se ele estava disponível no início de cada partida; quais partidas João jogou; o time original de Marcos; em quais partidas Marcos jogou emprestado ao Time 2; em quais jogou pelo Time 3; e todos os eventos e estatísticas de Marcos nas duas situações.

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

O app instalado se chama SMV e abre em tela cheia (modo standalone), sem a barra do navegador.

No celular, a navegação fica numa barra inferior com botões grandes para o toque. No desktop, fica numa coluna lateral.

Itens de administração só aparecem para ADMIN. Esconder o item não é a proteção: cada página e ação de ADMIN verifica o papel no servidor.

### Sem conexão

O app precisa de internet para mostrar dados da pelada. Sem conexão, abre uma página "Sem conexão" com um botão para tentar de novo.

O aparelho guarda só arquivos estáticos e públicos: ícones, fontes, estilos, scripts do app e a página "Sem conexão". Nunca guarda:

- páginas de usuário logado;
- respostas de API ou dados de sessão;
- dados pessoais;
- informações financeiras.

Não existe uso offline dos dados nem gravação offline para envio posterior.

### Instalação

- Android (Chrome) e desktop (Chrome e Edge): pelo menu do navegador, "Instalar app".
- iPhone (Safari): Compartilhar, "Adicionar à Tela de Início". No iPhone, as notificações push (seção 29) só funcionam com o app instalado.

A tela Conta mostra essas instruções enquanto o app não está instalado.

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

O conteúdo de uma notificação push aparece na tela bloqueada e passa pelo serviço de push do navegador. Por isso ela leva só um título e um texto curtos e o link da tela. Nunca leva valores financeiros nem dados pessoais além do nome do jogador quando necessário; o detalhe é visto no app, depois do login.

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

- ciclo financeiro (BillingCycle): o mês financeiro (mensalidade e campo de um mês) ao qual mensalidades e movimentações são atribuídas;
- cobrança (obrigação): o que um jogador deve (diária ou mensalidade);
- pagamento: o registro de que uma cobrança foi paga, confirmado por ADMIN;
- movimentação do caixa: a entrada ou saída de dinheiro efetivamente registrada no caixa.

"Diarista participou" NÃO é receita. Participação gera uma cobrança; somente o pagamento confirmado gera entrada no caixa.

Presença e financeiro são domínios separados.

A rastreabilidade deve permitir seguir:

- GameSession → participação do diarista → cobrança → pagamento → movimentação do caixa;
- BillingCycle → movimentações de entrada de diárias atribuídas ao ciclo → pagamentos → cobranças → sessões;
- BillingCycle → cobranças dos mensalistas → pagamentos recebidos → movimentações de entrada;
- BillingCycle → pagamento do campo → movimentação de saída.

A cobrança de diária não pertence a um ciclo: o ciclo cuja mensalidade ela reduz é decidido quando o pagamento é confirmado (seção 31.6).

## 31.2 Ciclo financeiro (BillingCycle)

O ciclo financeiro é mensal e é representado por uma entidade explícita. O ciclo de um mês reúne a mensalidade daquele mês e o pagamento do campo daquele mês.

Linha do tempo (exemplo: ciclo de outubro/2026):

- durante setembro, o ciclo de outubro está ABERTO e acumula as diárias confirmadas; a mensalidade de outubro aparece como previsão;
- em 01/10, às 00:00 no fuso do grupo, a mensalidade de outubro é calculada e CONGELADA, e as cobranças de mensalidade ficam disponíveis para pagamento;
- os mensalistas pagam de 01/10 a 07/10;
- o campo de outubro é pago até 10/10;
- as diárias confirmadas a partir de 01/10 acumulam para a mensalidade de novembro.

Cada ciclo possui pelo menos:

- mês de referência;
- openedAt;
- instante de congelamento programado (00:00 do dia 1 do mês de referência, no fuso do grupo);
- closedAt (instante em que o congelamento foi executado);
- prazo de pagamento da mensalidade (exemplo: 07/10/2026);
- prazo do pagamento do campo (exemplo: 10/10/2026);
- fieldCostSnapshot (custo mensal do campo aplicável ao ciclo);
- status: OPEN ou CLOSED.

Status:

- OPEN: o ciclo acumula receitas de diaristas e a mensalidade é uma previsão;
- CLOSED: a mensalidade está congelada. CLOSED NÃO significa que o ciclo deixa de receber dinheiro: ele continua recebendo os pagamentos das mensalidades e o pagamento do campo. Só as entradas e os resultados do cálculo ficam imutáveis.

Toda mensalidade e toda movimentação do caixa são vinculadas explicitamente a um ciclo. A atribuição fica gravada no momento do lançamento e nunca é recalculada.

As receitas de diaristas que reduzem a mensalidade são as movimentações de diária vinculadas explicitamente ao ciclo (regra de atribuição na seção 31.6).

Ao congelar um ciclo, seus valores históricos (custo do campo, receitas elegíveis, crédito herdado, mensalistas pagantes e valor por mensalista) ficam gravados e NÃO mudam silenciosamente por causa de alterações posteriores em configurações, cadastros, pagamentos ou estornos.

Ciclos congelados nunca são recalculados retroativamente.

Os ciclos são congelados em ordem cronológica: um ciclo só é congelado depois do ciclo do mês anterior.

## 31.3 Custo do campo e vencimento

O campo custa atualmente R$ 900 POR MÊS (não por sessão).

O pagamento do campo deve ser realizado até o dia 10 de cada mês.

O vencimento é no dia configurado DO PRÓPRIO MÊS do ciclo. Exemplo: ciclo de outubro/2026 → vencimento em 10/10/2026.

A mensalidade do mesmo ciclo é congelada em 01/10 e tem prazo de pagamento no dia configurado do próprio mês (padrão: dia 7, ou seja, 07/10/2026). Assim, as mensalidades de outubro são recebidas antes do vencimento do campo de outubro.

O custo mensal e os dias de vencimento (campo e mensalidade) são configuráveis por ADMIN e NÃO devem ser hardcoded. Se o mês não tiver o dia configurado, vale o último dia do mês. O dia do congelamento é sempre o dia 1.

Cada BillingCycle guarda:

- o snapshot do custo mensal aplicável (exemplo: fieldCostSnapshot = 90000 centavos);
- o prazo concreto da mensalidade (exemplo: 07/10/2026 para o ciclo de outubro/2026);
- o prazo concreto do campo (exemplo: 10/10/2026 para o ciclo de outubro/2026).

Os snapshots são gravados quando o ciclo é criado (no início do mês anterior). Enquanto o ciclo está aberto, o ADMIN pode ajustá-los com um comando explícito e auditado; depois do congelamento, nunca.

Se futuramente o campo passar para R$ 1.000, os ciclos históricos continuam com o custo original.

## 31.4 Valor da diária

O valor da diária é configurável por ADMIN (exemplo atual: R$ 15).

O valor da diária é sempre maior que zero. No MVP não existe diarista gratuito: o diarista PRESENT segue a regra normal de cobrança (seção 31.5). Uma eventual participação gratuita será uma regra futura, desenhada separadamente.

## 31.5 Cobrança do diarista

Estar confirmado na lista NÃO significa que o diarista efetivamente participou.

A presença real é registrada no Modo Pelada (PRESENT ou ABSENT).

Somente o diarista marcado como PRESENT naquela sessão gera cobrança de diária.

A criação da cobrança é idempotente: nunca pode existir mais de uma cobrança de diária para o mesmo jogador na mesma sessão.

O valor da diária é salvo como snapshot na cobrança.

Exemplo: se a diária era R$ 15 naquela sessão e depois passar para R$ 20, a cobrança antiga continua sendo R$ 15.

A cobrança nasce PENDENTE e fica vinculada à sessão e à participação. Ela não é vinculada a um ciclo: a mensalidade reduzida pelo pagamento é decidida na confirmação (seção 31.6).

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

São guardadas as duas datas: a data/hora real do pagamento (paidAt, informada pelo ADMIN) e a data/hora da confirmação no sistema (confirmedAt). O pagamento nunca é confirmado antes de ter sido recebido (paidAt ≤ confirmedAt).

### Atribuição da diária ao ciclo

Somente pagamentos de diária CONFIRMADOS reduzem uma mensalidade.

Regra: a entrada de uma diária é atribuída ao primeiro ciclo cujo congelamento programado (00:00 do dia 1, fuso do grupo) é POSTERIOR à confirmação.

Exemplos com o ciclo de outubro (congelamento programado em 01/10 00:00):

- recebida em setembro e confirmada em setembro: reduz a mensalidade de outubro;
- recebida em setembro e confirmada depois do congelamento de outubro (por exemplo, em 01/10 às 09:00 ou em 15/10): NÃO altera a mensalidade congelada de outubro; reduz a de novembro;
- recebida em outubro: nunca reduz a mensalidade de outubro, mesmo que o job de congelamento de outubro atrase; reduz a de novembro;
- diária de uma sessão de setembro paga com atraso em outubro: reduz a de novembro.

Garantias:

- a atribuição depende somente de datas gravadas (confirmedAt e o congelamento programado de cada ciclo), não de qual operação concorrente obteve um lock primeiro;
- o atraso do job de congelamento não muda nenhuma atribuição;
- cada pagamento gera uma única entrada no caixa, atribuída uma única vez e nunca recalculada;
- o congelamento de um ciclo sempre inclui todas as diárias confirmadas antes do seu corte e nenhuma confirmada depois;
- a cobrança permanece vinculada à sessão e o pagamento à cobrança; só a movimentação do caixa aponta para o ciclo;
- o estorno de uma diária segue a mesma regra pela data/hora do estorno: se a mensalidade que ela reduziu já foi congelada, o estorno reduz a receita do próximo ciclo ainda não congelado, e o ciclo congelado não é recalculado.

Pagamentos de mensalidade (e seus estornos) são sempre atribuídos ao ciclo da própria mensalidade, mesmo depois do congelamento.

## 31.7 Correção e estorno

Confirmação, correção e estorno de pagamento devem ser auditáveis.

O histórico financeiro NUNCA é apagado silenciosamente: correções e estornos preservam o registro original e geram novos registros que o compensam.

Correções nunca alteram os valores congelados de um ciclo.

## 31.8 Mensalistas pagantes

Mensalistas pagantes = mensalistas ativos não isentos no momento do congelamento da mensalidade (ver isenção financeira na seção 3). Eles formam o divisor do cálculo.

O mensalista paga a mensalidade independentemente da presença. Somente o diarista PRESENT gera cobrança de diária (seção 31.5).

Enquanto o ciclo está aberto, a previsão usa os mensalistas ativos não isentos do momento da consulta.

### Entrada de novos mensalistas

Novos mensalistas só podem entrar no período de pagamento da mensalidade: do dia 1 ao dia 7 do mês (o prazo configurado da mensalidade), no fuso do grupo. Fora desse período, o cadastro de um novo mensalista (inclusive a mudança de diarista para mensalista) é bloqueado. A mesma janela vale para reativar um mensalista inativo.

A regra vale depois da implantação financeira (seção 31.12). Antes dela, os mensalistas que já fazem parte do grupo são cadastrados livremente; a implantação declara quem ainda deve a mensalidade do mês corrente.

Como a mensalidade é congelada no dia 1, quem entra entre os dias 1 e 7 paga a mensalidade do mês corrente já congelada:

- é criada uma cobrança individual de mensalidade com exatamente o valor congelado;
- divisor, mensalidade congelada, cobranças existentes, diferença de arredondamento e crédito para o ciclo seguinte NÃO são recalculados;
- nunca existe mais de uma cobrança de mensalidade para o mesmo jogador no mesmo ciclo;
- se a mensalidade congelada for zero, nenhuma cobrança é criada;
- o pagamento dessa cobrança aumenta o saldo real do caixa, mas NÃO é receita de diarista e NÃO reduz a mensalidade do mês seguinte (o crédito usa o total cobrado congelado).

No mês seguinte ele já faz parte do divisor normalmente.

## 31.9 Cálculo da mensalidade

Enquanto o ciclo está aberto (na prática, durante o mês anterior), são acumulados os pagamentos CONFIRMADOS de diaristas atribuídos a ele (seção 31.6). Exemplo: as diárias confirmadas em setembro reduzem a mensalidade de outubro.

Fórmula:

- valorParaMensalistas = custoDoCampoDoCiclo − receitasElegiveisRecebidasDeDiaristas − créditoDoCicloAnterior, nunca menor que zero;
- mensalistasPagantes = mensalistas ativos não isentos no momento do congelamento;
- valorPorMensalista = valorParaMensalistas / mensalistasPagantes, arredondado PARA CIMA ao próximo centavo.

O créditoDoCicloAnterior é a sobra positiva do ciclo anterior: a diferença de arredondamento ou, se o custo do campo já estava coberto, o excedente. Crédito nunca é negativo:

- créditoParaOCicloSeguinte = máximo entre zero e (receitas elegíveis de diaristas + crédito herdado + total cobrado de mensalidades − custo do campo);
- o total cobrado é o congelado (19 × R$ 43,43 no exemplo abaixo); cobranças de quem entrou depois do congelamento (seção 31.8) não entram no crédito;
- um déficit NUNCA é levado para o ciclo seguinte.

Custo do campo já coberto: se as receitas elegíveis de diaristas mais o crédito herdado cobrem todo o custo do campo:

- o valor a dividir entre os mensalistas é zero;
- a previsão da mensalidade é R$ 0;
- nenhuma cobrança de mensalidade de valor zero é criada;
- o excedente permanece no caixa e vira crédito do ciclo seguinte.

Nenhum mensalista pagante: o ciclo pode ser congelado com zero mensalistas pagantes. Na prática isso não deve acontecer, porque sem mensalistas suficientes normalmente não há pelada, mas o comportamento é determinístico:

- a mensalidade individual, o total cobrado e a diferença de arredondamento são zero;
- nenhuma cobrança de mensalidade é criada;
- nunca há divisão por zero;
- se o custo do campo não estiver coberto, a parte descoberta NÃO é levada ao ciclo seguinte: o crédito do ciclo seguinte é zero.

A previsão da mensalidade segue as mesmas regras e nunca produz mensalidade negativa.

Exemplo (mensalidade de outubro, congelada em 01/10):

- campo de outubro: R$ 900;
- diárias confirmadas em setembro: R$ 75;
- mensalistas pagantes em 01/10: 19;
- R$ 900 − R$ 75 = R$ 825;
- R$ 825 / 19 = R$ 43,421...;
- mensalidade individual = R$ 43,43;
- total cobrado = 19 × R$ 43,43 = R$ 825,17;
- diferença de arredondamento = R$ 0,17.

Cobranças PENDENTES não reduzem a mensalidade.

Enquanto o ciclo está aberto, o sistema apresenta o valor como PREVISÃO dinâmica, visível para todos os usuários autenticados.

No congelamento (dia 1), o valor passa a ser o valor definitivo daquele ciclo.

A previsão exibida é sempre a da próxima mensalidade ainda não congelada. Exemplo: durante outubro, o caixa mostra a mensalidade de outubro (congelada) e a previsão da de novembro, com as diárias de outubro confirmadas até o momento.

Previsão e valores congelados são coisas diferentes:

- enquanto o ciclo está ABERTO, a previsão está SEMPRE disponível para os usuários. Ela é calculada na hora a partir das receitas elegíveis confirmadas, do crédito herdado, da quantidade atual de mensalistas pagantes e do custo do campo, e muda conforme esses dados mudam. Ela não é gravada como valor do ciclo; os campos congelados permanecem vazios porque o resultado ainda não é final;
- no CONGELAMENTO, os valores definitivos são calculados com a mesma regra, gravados, e nunca mudam retroativamente.

Divisão monetária:

- todos os cálculos são feitos em centavos inteiros;
- todos os mensalistas pagantes pagam EXATAMENTE O MESMO VALOR; não se distribuem centavos diferentes entre jogadores;
- quando houver fração de centavo, o valor individual é arredondado PARA CIMA;
- a diferença de arredondamento NÃO é descartada: permanece como saldo positivo do caixa e beneficia o ciclo seguinte, entrando como crédito no cálculo da próxima mensalidade;
- nenhum centavo pode ser criado ou perdido sem registro.

O BillingCycle registra no congelamento:

- valor exato a ser dividido;
- quantidade de pagantes;
- valor individual arredondado;
- total efetivamente cobrado;
- diferença de arredondamento.

NÃO devem ser hardcoded: custo do campo, dias de vencimento (campo e mensalidade), valor da diária, quantidade de mensalistas pagantes e quantidade de mensalistas.

## 31.10 Congelamento da mensalidade e cobrança das mensalidades

A mensalidade de cada mês é congelada AUTOMATICAMENTE pelo sistema no dia 1, às 00:00 no fuso configurado do grupo.

Se a tarefa automática atrasar, o congelamento é executado na primeira operação ou consulta financeira seguinte, e o ADMIN também pode dispará-lo manualmente como fallback. As três formas usam a mesma operação idempotente: repetir não congela duas vezes nem duplica cobranças. O atraso nunca muda quais diárias entram no cálculo (seção 31.6).

Enquanto o ciclo está OPEN, o sistema mostra a previsão dinâmica.

O congelamento só acontece a partir do dia 1 do mês de referência e depois do congelamento do mês anterior. Em uma única operação transacional:

1. determinar as receitas de diárias atribuídas ao ciclo e o crédito herdado do ciclo anterior;
2. determinar os mensalistas ativos não isentos naquele momento;
3. calcular a mensalidade individual;
4. arredondar para cima conforme a regra da seção 31.9;
5. gravar os valores congelados, closedAt e o status CLOSED;
6. se a mensalidade individual for maior que zero, criar uma cobrança de mensalidade para cada mensalista pagante, todas com o mesmo valor individual congelado;
7. gerar AuditLog (ator SYSTEM, ou o ADMIN no fallback).

As cobranças de mensalidade nascem PENDENTES e podem ser pagas desde o dia 1, com prazo até o dia 7.

O pagamento é confirmado manualmente por ADMIN, com os mesmos registros exigidos na seção 31.6, e só então entra no caixa. Pagamentos de mensalidade, pagamento do campo e estornos continuam sendo registrados no ciclo congelado sem alterar os valores congelados.

## 31.11 Pagamento do campo

O pagamento mensal do campo faz parte do caixa.

Ele é registrado por ADMIN como movimentação de saída vinculada ao ciclo, com data do pagamento, valor, administrador responsável, forma de pagamento (opcional) e observação (opcional).

O registro é auditável e segue as mesmas regras de correção e estorno.

O pagamento do campo só pode ser registrado se o saldo disponível do caixa cobrir o valor inteiro. Caso contrário, a operação é rejeitada até que exista dinheiro confirmado suficiente. O valor NUNCA é reduzido ao saldo disponível: registrar R$ 400 de um pagamento de R$ 900 mostraria o campo como pago quando não foi.

Exemplo do ciclo de outubro:

- diárias confirmadas em setembro: + R$ 75;
- mensalidades de outubro, pagas de 01/10 a 07/10: + R$ 825,17 (19 × R$ 43,43);
- pagamento do campo de outubro, até 10/10: − R$ 900;
- saldo do ciclo: + R$ 0,17 (diferença de arredondamento, que vira crédito da mensalidade de novembro).

## 31.12 Implantação e saldo inicial do caixa

O saldo do caixa NÃO é armazenado diretamente: é sempre calculado a partir das movimentações.

### Implantação em um grupo que já está funcionando

A implantação é uma operação única do ADMIN, transacional, idempotente e auditada. Ela não pula o mês corrente e não inventa histórico. O ADMIN informa explicitamente:

- o saldo inicial do caixa: o dinheiro realmente existente no momento da implantação, que já inclui o que foi recebido e pago antes (diárias, mensalidades e campo);
- a mensalidade do mês corrente já definida pelo grupo fora do sistema (pode ser zero);
- quais mensalistas ainda devem essa mensalidade;
- quanto do campo do mês corrente ainda falta pagar (zero se já foi pago).

Resultado:

- o ciclo do mês corrente é criado como ciclo de implantação, já congelado, com a mensalidade declarada. Ele não registra receitas de diárias, crédito herdado nem divisor, porque esse histórico não existe no sistema;
- uma cobrança de mensalidade com o valor declarado é criada para cada mensalista que ainda deve (nenhuma se o valor for zero). Quem já pagou não recebe cobrança nem pagamento fictício: o dinheiro já está no saldo inicial;
- o saldo inicial vira uma movimentação INITIAL_BALANCE (se for maior que zero);
- o ciclo do mês seguinte é criado aberto e começa a acumular as diárias confirmadas no sistema a partir da implantação;
- a primeira mensalidade calculada pelo sistema é a do mês seguinte, sem crédito herdado. Diárias recebidas antes da implantação não são reconstruídas: estão no saldo inicial;
- depois da implantação, novos mensalistas só entram do dia 1 ao dia 7 de um mês (seção 31.8); se entrarem no próprio mês da implantação, pagam a mensalidade declarada;
- nenhum pagamento, saldo ou receita histórica é gerado silenciosamente; os valores declarados e as listas de quem deve e de quem já pagou ficam no AuditLog.

### Saldo inicial

O saldo inicial do caixa é lançado como uma movimentação do tipo INITIAL_BALANCE, vinculada ao ciclo de implantação. Ele não entra no cálculo da mensalidade.

O saldo do caixa nunca fica negativo (piso de R$ 0). Toda saída (pagamento do campo ou estorno de uma entrada) é rejeitada se exceder o saldo disponível naquele momento. Um custo do campo não coberto nunca é representado como saldo negativo nem como crédito negativo.

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
- ciclos financeiros, com valor congelado da mensalidade, prazos e pagamento do campo;
- receitas de diárias confirmadas que estão acumulando para a próxima mensalidade;
- previsão da próxima mensalidade ainda não congelada;
- fórmula utilizada no cálculo.

Somente ADMIN pode:

- confirmar pagamento (diária ou mensalidade);
- corrigir/estornar pagamento;
- registrar, corrigir ou estornar o pagamento do campo;
- disparar manualmente o congelamento da mensalidade (fallback do automático);
- realizar a implantação e lançar o saldo inicial do caixa;
- alterar valor da diária;
- alterar custo do campo e dias de vencimento;
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

9. Sorteios anteriores nunca devem ser destruídos ao serem refeitos. Depois da primeira partida da sessão, os times não são mais regenerados por sorteio.

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

### Revisão 8 — 03/10/2026

- Refazer sorteio exige reason e gera AuditLog; o sorteio invalidado, com opções, times e votos, permanece no histórico (seção 17).
- Antes da primeira partida da sessão, o ADMIN pode invalidar inclusive um sorteio decidido; os times da sessão são substituídos pelos do novo sorteio decidido (seção 17).
- Depois que qualquer partida da sessão é iniciada, os times passam a ser histórico: não há novo sorteio nem regeneração; mudanças de elenco são ajustes administrativos explícitos com AuditLog (seção 17).

### Revisão 9 — 05/10/2026

- Jogador indisponível durante a sessão (lesão, saída antecipada), marcado por ADMIN com reason, AuditLog, idempotência e controle de concorrência; não altera o time dele, partidas anteriores, presença real nem cobranças (seção 24).
- A vaga em campo é preenchida a cada partida por um jogador emprestado de um time que não está jogando; o emprestado continua no próprio time e suas estatísticas são dele (seção 24).

### Revisão 10 — 05/10/2026

- Indisponibilidade temporária: o jogador pode voltar a ficar disponível a qualquer momento, mais de uma vez na mesma sessão; cada período fica no histórico com início, fim, responsáveis e reason (seção 24).
- Depois que a primeira partida é iniciada, o conjunto de participantes fica congelado: sem 21º participante, sem promoção da lista de espera, sem diarista de emergência e sem remover o indisponível; a vaga em campo é coberta só por empréstimo entre os participantes (seções 11 e 24).

### Revisão 11 — 05/10/2026

- O sorteio decidido pela votação é o oficial. Nenhuma mudança antes da partida (cancelamento, remoção, promoção, indisponibilidade, ajuste de rotativos) o invalida automaticamente (seções 11, 12 e 17).
- Antes da primeira partida, só o ADMIN, como ação manual excepcional, pode invalidar e refazer o sorteio, inclusive um já decidido, com reason e AuditLog; o sorteio anterior fica no histórico, o novo o referencia e a votação recomeça (seção 17).
- Em FLEXIBLE_ROTATION, o sorteio votado é a composição oficial; desvios práticos nas partidas ficam em quem efetivamente jogou cada partida (seção 12).

### Revisão 12 — 05/10/2026

- O ciclo pode ser fechado com zero mensalistas pagantes: mensalidade, total cobrado e diferença de arredondamento zero, sem cobranças de mensalidade e sem divisão por zero (seção 31.9).
- Custo do campo já coberto por diárias e crédito herdado: valor a dividir zero, previsão R$ 0, nenhuma cobrança de valor zero; o excedente vira crédito do ciclo seguinte (seção 31.9).
- A previsão da mensalidade é sempre visível enquanto o ciclo está aberto e é calculada na hora; os valores de fechamento só são gravados e congelados no fechamento (seção 31.9).
- O valor da diária é sempre maior que zero; não há diarista gratuito no MVP (seção 31.4).
- Tempo extra máximo configurável entre 0 e 30 minutos, padrão 30 (seção 4).
- Todo reason obrigatório precisa conter texto; vazio ou só espaços é inválido (seção 20).

### Revisão 13 — 05/10/2026

- Ciclo fechado com zero mensalistas pagantes e custo do campo não coberto: sem cobranças, e a parte descoberta não é levada adiante; o crédito do ciclo seguinte é zero (seção 31.9).
- O ciclo seguinte herda só sobra positiva; um déficit nunca é levado adiante, e o crédito nunca é negativo (seção 31.9).
- O saldo do caixa nunca fica negativo; uma saída que exceda o saldo disponível é rejeitada, nunca reduzida (seções 31.11 e 31.12).

### Revisão 14 — 10/10/2026

Correção do calendário financeiro. Substitui o fechamento manual da Revisão 3 e a regra de pagamento atrasado da Revisão 3.

- A mensalidade de cada mês é congelada automaticamente no dia 1, às 00:00 no fuso do grupo, e fica disponível para pagamento desde o dia 1; o ADMIN pode disparar o mesmo congelamento idempotente como fallback (seção 31.10).
- Prazos: mensalidade até o dia 7 e campo até o dia 10 do próprio mês, ambos configuráveis (seções 4 e 31.3).
- As diárias confirmadas em um mês reduzem a mensalidade do mês seguinte (setembro → outubro). A atribuição é pelo instante da confirmação em relação ao congelamento programado de cada ciclo, independente de atraso do job ou de ordem de locks. Uma diária confirmada depois do congelamento, ou recebida no próprio mês, vai para a próxima mensalidade ainda não congelada (seção 31.6).
- São guardados paidAt (pagamento real) e confirmedAt (confirmação no sistema), com paidAt ≤ confirmedAt (seção 31.6).
- A cobrança de diária deixa de ser vinculada a um ciclo; o ciclo da receita é o da movimentação do caixa (seções 31.1 e 31.5).
- CLOSED significa mensalidade congelada; o ciclo continua recebendo pagamentos de mensalidade e do campo sem alterar os valores congelados (seção 31.2).
- Mensalista que entra depois do congelamento paga a mensalidade congelada do mês, em cobrança individual, sem recalcular divisor, cobranças, arredondamento ou crédito; esse dinheiro não reduz a mensalidade seguinte; sem cobrança de valor zero (seção 31.8).
- Implantação em grupo já em funcionamento: saldo inicial real, ciclo do mês corrente com a mensalidade declarada pelo grupo e cobranças só de quem ainda deve, sem histórico inventado; a primeira mensalidade calculada é a do mês seguinte (seção 31.12).

### Revisão 15 — 10/10/2026

- Novos mensalistas (cadastro novo ou mudança de diarista para mensalista) só entram do dia 1 ao dia 7 do mês, no fuso do grupo; fora desse período o cadastro é bloqueado. Quem entra nesse período paga a mensalidade já congelada do mês, em cobrança individual. A regra vale depois da implantação financeira (seção 31.8).

### Revisão 16 — 10/10/2026

- PWA instalável com o nome SMV, navegação mobile-first (barra inferior no celular, coluna lateral no desktop) e página "Sem conexão". O aparelho guarda só arquivos estáticos públicos, nunca páginas logadas, dados pessoais ou financeiros (seção 28).
- Notificações push levam só título, texto curto e link, sem valores financeiros (seção 29).

### Revisão 17 — 10/10/2026

- O prazo de prioridade dos mensalistas passa a ser quinta-feira às 15:00 (antes 14:00), em GroupSettings (`priorityDeadlineMinute` = 900) e na sessão já criada da semana (seções 8, 10 e 11).

### Revisão 18 — 14/10/2026

- Correção da regra de presença depois do sorteio (seções 11 e 17). Enquanto não há sorteio decidido, inclusive durante a votação, a lista funciona normalmente. Com o sorteio decidido (status DECIDED), só o ADMIN altera a lista (incluir, remover, promover, com reason e AuditLog); os jogadores veem "Times definidos. Alterações na lista somente com um administrador."; a promoção automática da lista de espera fica desligada e toda promoção é explícita do ADMIN. Mudanças na lista continuam sem invalidar o sorteio oficial. Se o sorteio decidido for invalidado, a lista volta ao funcionamento normal. A partir da primeira partida, a lista fica congelada para todos (sem mudança).

### Revisão 19 — 14/10/2026

- O travamento da lista de presença passa a valer desde o INÍCIO DA VOTAÇÃO, e não mais só com o sorteio decidido (substitui o marco da Revisão 18; seções 11 e 17). Com um sorteio ativo em votação, empatado ou decidido, os jogadores não alteram a lista e veem "Votação iniciada. Alterações na lista somente com um administrador."; a promoção automática fica desligada e o ADMIN continua incluindo, removendo e promovendo explicitamente até a primeira partida. O sorteio é sempre do sistema: gerar abre a votação no mesmo passo, sem pré-visualização nem escolha de opções pelo ADMIN; cada refação é uma invalidação registrada com ADMIN e reason. Invalidar sem gerar outro sorteio devolve a lista ao funcionamento normal; gerar na mesma ação trava de novo.