# Scripts

## backup-console.js

Baixa todas as linhas das tabelas `avaliacoes`, `filmes`, `usuarios` e `perfis`
do Supabase, uma CSV por tabela, com a data no nome do arquivo.

Roda inteiro no navegador, usando o cliente Supabase já autenticado da
própria página — por isso lê tabelas com RLS restrita a usuário logado
(como `usuarios`) sem precisar de Node nem de chave `service_role`.

### Como usar

1. Abra `https://lbatinga.github.io/cinelist/` e faça login normalmente.
2. Abra o DevTools (`F12`) → aba **Console**.
3. Copie o conteúdo de [`backup-console.js`](./backup-console.js), cole no
   console e aperte Enter.
4. O navegador vai baixar 4 arquivos CSV. Se ele perguntar se pode baixar
   múltiplos arquivos de uma vez, clique em **Permitir**.

Ao final, o console mostra um resumo com a quantidade de linhas baixadas
de cada tabela (ou o erro, se alguma falhar).
