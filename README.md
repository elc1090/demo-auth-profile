# Demo: conta com senha ou login com Google

Demo minimalista: **criar conta ou continuar com Google → completar perfil → salvar → sair → entrar novamente**.

Frontend HTML/CSS/JavaScript, backend Express, SQLite integrado ao Node.js 24 e sessões com cookie. Sem Docker, build de frontend ou serviço externo de banco de dados. Google é opcional para iniciar: o cadastro e login com senha funcionam imediatamente.

## 1. Colocar no GitHub

No GitHub, selecione **Code → Codespaces → Create codespace on main**. 

## 2. Iniciar no Codespaces

No terminal:

```bash
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copie o valor gerado para `SESSION_SECRET` no arquivo `.env`. Esse arquivo já está no `.gitignore`.

```bash
npm start
```

Na aba **Ports**, abra a porta **3000** em uma **nova aba do navegador**. Evite o preview embutido para o fluxo Google. Altere **Port Visibility → Public**; isso torna a aplicação acessível a quem tiver a URL enquanto o Codespace estiver ativo. Organizações podem restringir essa opção. Para teste individual, a porta privada pode funcionar no mesmo navegador autenticado no GitHub.

O terminal mostra a URL da aplicação e o **Callback Google**. No Codespaces, o endereço é detectado pelas variáveis do ambiente. Exemplo:

```text
Aplicação: https://SEU-CODESPACE-3000.app.github.dev
Callback Google: https://SEU-CODESPACE-3000.app.github.dev/auth/google/callback
```

Teste primeiro **Criar conta**, preencha o perfil, salve, saia e use **Entrar**. Em seguida configure o Google.

## 3. Configurar o Google — passo a passo

Não é necessário ativar uma assinatura paga, fornecer cartão ou habilitar faturamento para este login. O projeto Google armazena a configuração de identidade; o servidor continua rodando no Codespaces.

1. Acesse [Google Cloud Console](https://console.cloud.google.com/) com uma conta Google normal (é possível que a conta @acad.ufsm.br não funcione para este demo). Não é preciso ativar o teste gratuito de serviços pagos.
2. Use a busca da Console para localizar **Google Auth Platform**. Crie um projeto. Em **Get started / Vamos começar**, informe o nome da aplicação, e-mail de suporte e e-mail de contato.
3. Em **Audience / Público-alvo**, escolha **External / Externo** para permitir contas fora da sua instituição. Uma conta institucional pode ter políticas que impedem criação de projetos ou login em aplicativos externos; nesse caso, teste com uma conta pessoal permitida. Pode manter a aplicação em **Testing / Teste**. 
Se a Console solicitar usuários de teste, adicione alguma outra conta pessoal. Os escopos básicos deste demo (`openid`, `email`, `profile`) têm exceção à exigência da lista de teste, segundo a documentação Google.
4. Em **Clients / Clientes → Create client / Criar cliente**, escolha **Web application / Aplicativo da Web** e dê um nome ao cliente.
5. Em **Authorized redirect URIs / URIs de redirecionamento autorizados**, cole **exatamente o Callback Google mostrado no terminal**, incluindo `https://`, o domínio e `/auth/google/callback`. Não adicione barra ao final. Para também testar localmente, acrescente outra entrada: `http://localhost:3000/auth/google/callback`.
6. Salve e copie o **Client ID** e o **Client secret** para `.env`:

   ```dotenv
   PORT=3000
   SESSION_SECRET=seu-valor-aleatorio-gerado-anteriormente
   GOOGLE_CLIENT_ID=seu-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=seu-secret
   ```

7. Pare o servidor com **Ctrl+C**, execute `npm start` novamente e recarregue a aplicação. O botão **Continuar com Google** estará habilitado.

**Não é preciso preencher Authorized JavaScript origins neste exemplo:** o login usa redirecionamento para o backend, que recebe o código e verifica a identidade. Não usamos o SDK Google no navegador. Não é necessário habilitar Gmail, Drive ou Google+ APIs. Os nomes e a disposição dos menus podem variar; procure Branding, Audience e Clients na Google Auth Platform.

O `GOOGLE_CLIENT_SECRET` fica no backend. Nunca o coloque em `public/`, no README ou em commits. Como alternativa ao `.env`, é possível usar secrets do Codespaces disponibilizados ao repositório.

## 4. Testar o fluxo completo

1. Clique em **Continuar com Google**, escolha sua conta e conclua o login.
2. O Google devolve o navegador ao callback. O backend valida a identidade, cria ou encontra o usuário e inicia uma sessão.
3. Complete nome, curso/área e cidade; interesses e apresentação são opcionais. Salve.
4. Saia e entre novamente com a mesma conta Google: os atributos adicionais devem continuar salvos.
5. Teste outra conta em janela privada (a porta precisa estar pública se essa janela não estiver autenticada no GitHub). Ela terá outro perfil.
6. Sem login, acessar `/api/profile` deve retornar **401**. A página do formulário redireciona para a entrada.

As contas locais e Google são **separadas, mesmo que tenham o mesmo e-mail**. Isso permite comparar os dois caminhos e evita vincular automaticamente identidades por e-mail. Entre sempre pelo método usado na criação.

## Executar localmente

Instale **Node.js 24**. Na pasta do projeto:

```bash
npm ci
cp .env.example .env
npm start
```

Abra `http://localhost:3000`. Configure um `SESSION_SECRET` aleatório como explicado acima. Para Google, use as credenciais e o callback local da seção 3.

Se precisar definir a URL manualmente (por exemplo, outro proxy), use:

```dotenv
APP_URL=https://endereco-publico-da-aplicacao
```

`APP_URL` é apenas a origem, sem `/auth/google/callback`. Ela prevalece sobre a detecção automática. URL HTTPS faz o cookie usar `Secure`; localhost HTTP permite teste local. O Express confia em um proxy, adequado ao encaminhamento usado aqui.

## O que observar em aula

| Etapa | E-mail e senha | Google |
| --- | --- | --- |
| Verificação de identidade | Backend verifica senha com scrypt | Google autentica; backend valida ID token |
| Dados locais | E-mail, salt e hash da senha | E-mail e identificador Google `sub`; nenhuma senha Google |
| Sessão da aplicação | Cookie com identificador de sessão | O mesmo mecanismo |
| Perfil adicional | Salvo no SQLite | Salvo no mesmo SQLite |

No DevTools, observe `/api/register` ou `/api/login`, os redirecionamentos Google e `/api/profile`. O callback troca um código por tokens **entre servidores**: essa requisição não aparece como fetch do navegador. O navegador recebe um cookie `HttpOnly`; o frontend não lê o identificador da sessão.

`state` relaciona o retorno Google à sessão que iniciou o login; `nonce` relaciona o ID token à tentativa. A biblioteca Google verifica assinatura, emissor, público e validade do ID token. O servidor também verifica o nonce e e-mail verificado. Depois do login, regenera a sessão. Operações que alteram dados exigem token CSRF.

## Arquivos e rotas

- `server.js`: banco, hashes, sessões, rotas locais, Google e autorização do perfil.
- `public/`: páginas e JavaScript do navegador; `api.js` centraliza fetch e token CSRF.
- `.devcontainer/devcontainer.json`: ambiente Node.js 24 e encaminhamento da porta.
- `test/auth.test.js`: testes HTTP, incluindo isolamento entre usuários.
- `data/demo.sqlite`: gerado automaticamente, fora do Git.

| Método | Rota | Objetivo |
| --- | --- | --- |
| GET | `/api/session` | Estado da sessão, token CSRF e disponibilidade Google |
| POST | `/api/register` | Criar conta local e iniciar sessão |
| POST | `/api/login` | Verificar senha e iniciar sessão |
| GET | `/auth/google` | Iniciar login Google |
| GET | `/auth/google/callback` | Validar retorno e iniciar sessão |
| GET / PUT | `/api/profile` | Ler / salvar perfil do usuário da sessão |
| POST | `/api/logout` | Destruir sessão |

## Persistência e limites do demo

Os perfis persistem no SQLite entre reinicializações do servidor, enquanto o disco do Codespace existir. Excluir o Codespace exclui esses dados. As sessões ficam **em memória**: reiniciar o servidor encerra os logins, mas não apaga as contas. A sessão dura uma hora; sair da aplicação não encerra a sessão da Conta Google.

O demo não inclui recuperação de senha, verificação do e-mail de contas locais, vinculação de contas nem recursos de administração. O limite de tentativas é por sessão e serve apenas à aula. Para produção, seriam necessários armazenamento persistente de sessões, proteção contra abuso por IP/conta, verificação de e-mail e recuperação de acesso. Use dados fictícios nos testes.

Para apagar as contas de teste, pare o servidor e remova a pasta `data/`. O próximo início recria o banco vazio.

## Problemas comuns

| Sintoma | Verificação |
| --- | --- |
| `redirect_uri_mismatch` | Compare o callback do terminal com a Console, caractere por caractere. Um novo Codespace tem outra URL; parar/iniciar o mesmo normalmente preserva o endereço. |
| Botão Google desativado | Preencha as duas variáveis Google e reinicie o Node. |
| Retorno Google expira ou volta para entrada | Use nova aba, mesmo navegador, cookies habilitados e a URL pública correta; tente porta pública para eliminar a autenticação intermediária GitHub. |
| `invalid_client` ou falha Google | Confira ID/secret do mesmo cliente Web; atualize `.env` e reinicie. Alterações da Console podem levar alguns minutos. |
| Acesso bloqueado pela instituição | Confira público-alvo e políticas da conta Google Workspace. |
| Erro de sessão/CSRF após reiniciar | Recarregue a página antes de tentar novamente. |
| `node:sqlite` indisponível | Confira `node --version`: use Node.js 24 e reconstrua o ambiente se necessário. O Node pode exibir aviso de API experimental de SQLite; isso não impede o demo. |
| Google funciona, senha não encontra conta | Os provedores têm contas separadas, mesmo com e-mail igual. |

## Testes

```bash
npm test
```

Os testes usam banco temporário e não precisam de credenciais Google. Cobrem cadastro, senha incorreta, login, logout, CSRF, persistência de perfil, isolamento de contas, validação de atributos e rejeição de callback sem estado válido. O consentimento/login Google real deve ser testado manualmente depois da configuração; não é simulado como se fosse uma verificação real do provedor.

## Referências

- [Google: Sign in with Google — tutorial e projeto gratuito](https://codelabs.developers.google.com/codelabs/sign-in-with-google-button)
- [Google: OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Google: configuração e estado de aplicações OAuth](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)
- [GitHub: encaminhamento de portas no Codespaces](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace)
- [Node.js 24: SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)
- [Express: sessões](https://expressjs.com/en/resources/middleware/session.html)
