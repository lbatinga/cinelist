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

## auditoria-catalogo-console.js

Compara cada filme do catálogo que tem `tmdb_id` contra o dado atual do
TMDB — pôster, ano, duração, gêneros, classificação BR e sinopse pt-BR —
e relata as diferenças. **Só relatório: nunca escreve em `filmes` nem em
nenhuma outra tabela.** O que fazer com cada achado é decisão manual,
depois de ler o relatório.

Não precisa do app aberto nem de login — `filmes` tem `SELECT` público e a
chave do TMDB já é pública em `index.html`; o script usa as duas direto.

### Como usar

1. Abra qualquer aba (não precisa ser o CineList) e o DevTools (`F12`) →
   aba **Console**.
2. Copie o conteúdo de
   [`auditoria-catalogo-console.js`](./auditoria-catalogo-console.js), cole
   no console e aperte Enter.
3. Acompanha o progresso no console (a cada ~100 filmes; ~1.040 filmes,
   lotes de 5 chamadas simultâneas ao TMDB).
4. Ao final: imprime até 5 tabelas (diferenças reais, ausências — só um
   lado tem o dado —, alertas de título em alfabeto não-latino, erros e
   diferenças esperadas/conhecidas), baixa um CSV com todas as linhas, e
   devolve o array completo pra inspeção no console.

Diferenças já conhecidas e intencionais (duração corrigida à mão em 11
filmes — item 24 do CLAUDE.md —, sinopse/classificação de um filme sem
tradução pt-BR) ficam marcadas como **"esperado"**, separadas das
diferenças reais — não precisam de ação. A lista de exceções (`ESPERADOS`,
por `id` do filme) fica no topo do script; atualizar ali quando uma nova
correção manual for feita e você não quiser que ela apareça como achado
nas próximas rodadas.
