// CineList — Auditoria do catálogo contra o TMDB, via console do navegador.
//
// COMO USAR:
// 1. Não precisa do app aberto nem de login — abra QUALQUER aba (ex. about:blank).
//    `filmes` tem SELECT público e a chave do TMDB já é pública em index.html; este
//    script usa as duas direto, sem depender de sessão nem de cliente Supabase.
// 2. Abra o DevTools (F12) e vá na aba "Console".
// 3. Cole este script inteiro e aperte Enter.
// 4. Acompanha o progresso no console (a cada ~150 filmes, em cada uma das três fases —
//    ver abaixo). Ao final:
//    - imprime até 7 tabelas (uma por categoria de achado — ver TIPOS abaixo);
//    - baixa um CSV com TODAS as linhas, inclusive as que não aparecem nas tabelas do
//      console (duração <5min, sinopse), pra revisão fora do console;
//    - devolve o array completo (`achados`) pra quem quiser inspecionar no console.
//
// SÓ RELATÓRIO — este script NUNCA escreve em lugar nenhum (nem `filmes`, nem qualquer
// outra tabela, nem o index.html). Toda decisão sobre o que corrigir é manual, depois de
// ler o relatório.
//
// TRÊS FASES, cada uma só nos filmes que a fase anterior já isolou (nunca 1.000+ chamadas
// em cada uma):
//   FASE 1 — todo filme com tmdb_id (1 chamada cada, /movie/{id}?language=pt-BR&
//     append_to_response=release_dates, mesma chamada que enrichTMDBResult() já faz ao
//     adicionar um filme): compara pôster (só caminho do arquivo), ano, duração, gêneros,
//     classificação BR (mesma função getCert() do app — BR primeiro, US convertido como
//     reserva) e sinopse pt-BR. Sinaliza também "suspeita de tmdb_id errado".
//   FASE 2 — só nos filmes com pôster divergente na Fase 1 (1 chamada extra cada,
//     /movie/{id}/images): confere se o caminho gravado no banco está no HISTÓRICO de
//     pôsteres já oficiais desse tmdb_id no TMDB. Se está, é só o TMDB tendo trocado o
//     pôster principal (inofensivo). Se não está em lugar nenhum, é suspeito — pode ser o
//     viés da rotina antiga da era AppSheet (mesma classe de bug do Onde Assistir antigo,
//     mas aplicado ao pôster: buscar por nome/ano podia pegar a imagem de outro filme).
//   FASE 3 — só nos filmes sinalizados como "suspeita de tmdb_id errado" (2 chamadas extra
//     cada: /search/movie por nome/ano, mesma lógica que o Onde Assistir usava antes do
//     fix fb6af09, + /movie/{id} do candidato achado): sugere um id alternativo e mostra
//     runtime/ano/votos dos dois lados, pra facilitar decidir qual é o certo sem precisar
//     investigar na mão (foi assim que o caso do Guerra Civil, tmdb_id 1310753→929590, foi
//     achado e confirmado em 2026-09-24).
//
// TIPOS DE ACHADO (uma linha nunca é dois tipos ao mesmo tempo):
//   'id_suspeito'    — duração diverge >20min OU ano diverge ≥2 do PRÓPRIO tmdb_id gravado.
//                       Bug de dado na origem, não de exibição — ver a "LIÇÃO" no cabeçalho
//                       do CLAUDE.md sobre o caso Guerra Civil. Primeira tabela impressa,
//                       de propósito: é a mais importante.
//   'diferenca'      — banco e TMDB têm valor, diferentes, sem ser um dos casos acima.
//   'poster_churn'    — pôster diverge, mas o caminho do banco está no histórico de
//                       pôsteres do TMDB pra esse id — o TMDB só trocou o principal.
//   'poster_suspeito' — pôster diverge e o caminho do banco NÃO está no histórico do TMDB
//                       pra esse id — vale checar visualmente.
//   'poster_externo'  — pôster não é uma URL do TMDB (ex. imagem hospedada em i.redd.it,
//                       caso do "Harry Potter Saga Completa" seria este tipo se tivesse
//                       tmdb_id — hoje ele nem entra na auditoria por não ter).
//   'categoria_menos' — o banco tem gênero que o TMDB não tem mais (removido/trocado) —
//                       o único dos dois casos de categoria que pode ser erro nosso.
//   'categoria_mais'  — TMDB só ACRESCENTOU gênero — não contradiz o banco, cosmético.
//   'ausencia'        — só um lado tem valor (TMDB sem BR/US pra classificação, TMDB sem
//                       sinopse pt-BR, banco sem pôster que o TMDB tem).
//   'esperado'        — campo listado em ESPERADOS: diferença conhecida e intencional.
//   'alerta'          — nome em alfabeto não-latino.
//   'erro'            — chamada ao TMDB falhou, ou o tmdb_id gravado não existe mais lá.
//
// NO CONSOLE (console.table), só o que compensa ler linha por linha: id_suspeito,
// diferenca, poster_suspeito, categoria_menos, alerta, erro, esperado. Ficam SÓ no CSV
// (baixo volume de sinal, muito ruído pra ler na tela): duração <5min, sinopse (sempre
// reescrita cosmética no que foi checado), poster_churn, categoria_mais, ausencia.
//
// Concorrência: 5 chamadas por vez em cada fase (mesmo padrão de runBatched em index.html,
// usado pro Bloco B de recomendações).

(async function auditoriaCatalogo() {
  const SUPA_URL = 'https://iznikddtdwfvkkwqtwxg.supabase.co';
  const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6bmlrZGR0ZHdmdmtrd3F0d3hnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNTI4MDcsImV4cCI6MjA5MDkyODgwN30.VszR38ukPOQFkxVW1UdSLKcz55mZTOsiIQry2KRhfq8'; // anon, pública — igual à embutida em index.html
  const TMDB_KEY = '6bceb2e92a51fd680b2cf8a2a2fbc1ff'; // pública — igual à embutida em index.html
  const CONCORRENCIA = 5;
  const LIMIAR_DURACAO_RELATORIO = 5;   // min — abaixo disso só vai pro CSV (item "ruído de arredondamento")
  const LIMIAR_ID_SUSPEITO_DURACAO = 20; // min
  const LIMIAR_ID_SUSPEITO_ANO = 2;      // anos

  // Diferenças conhecidas e intencionais — ids reais do banco (nunca por nome, que é
  // frágil), com o(s) campo(s) que cada um tem permissão de divergir sem virar achado.
  // Motivo completo de cada grupo no CLAUDE.md (item 24 das Pendências conhecidas; seção
  // "Buscas automáticas de filme por código", caso do filme russo).
  const ESPERADOS = {
    'FILME-0238': ['duracao_min'],
    'FILME-0533': ['duracao_min'],
    'FILME-0444': ['duracao_min'],
    'FILME-0097': ['duracao_min'],
    'FILME-0149': ['duracao_min'],
    'a586bee6-e581-47cf-8b05-db700fb2f7f5': ['duracao_min'],
    'FILME-0206': ['duracao_min'],
    'FILME-0407': ['duracao_min'],
    '5e6c9133-1270-4211-adb1-8857b75d6189': ['duracao_min'],
    'FILME-0377': ['duracao_min'],
    '753fc052': ['duracao_min'],
    '85784427-6491-41d3-beb2-418245f368da': ['sinopse', 'classificacao'],
    // Item 41 (2026-09-24): duração conferida em fonte independente (Wikipedia/Variety/Box
    // Office Mojo, não copiada do TMDB) e corrigida no banco — o TMDB também estava errado
    // nesses dois, então a diferença contra o TMDB persiste de propósito.
    'b83f514a-4c58-44b9-8394-4052ef46f786': ['duracao_min'], // O Último Refúgio (40 Acres) — banco 113, TMDB ainda mostra 152 (errado)
    'FILME-0524': ['duracao_min'] // Karatê Kid Lendas — banco 94, TMDB ainda mostra 90 (valor pré-lançamento que circulou)
  };

  // Qualquer LETRA fora do script Latin — acento pt-BR passa (é letra latina), cirílico/CJK/
  // árabe/etc. não. Validado no console antes de usar (2026-09-24).
  const naoLatino = s => /(?=\p{L})\P{Script=Latin}/u.test(s || '');

  // Mesma função getCert() de index.html, copiada aqui (não importada — são runtimes
  // diferentes) pra comparar contra o mesmo valor que o app calcularia hoje.
  const CERT_MAP = { 'G':'L', 'PG':'10', 'PG-13':'12', 'R':'16', 'NC-17':'18' };
  function getCert(rd) {
    if (!rd?.results) return null;
    for (const cc of ['BR', 'US']) {
      const r = rd.results.find(x => x.iso_3166_1 === cc);
      if (r) {
        const c = r.release_dates?.find(x => x.certification);
        if (c) return cc === 'US' ? (CERT_MAP[c.certification] || c.certification) : c.certification;
      }
    }
    return null; // nem BR nem US — AUSÊNCIA, não diferença
  }

  const ehUrlTmdb = url => /^https?:\/\/image\.tmdb\.org\//i.test(url || '');
  const posterPath = url => (url || '').match(/\/([^/?#]+\.(?:jpe?g|png|webp))(?:[?#].*)?$/i)?.[1] || null;
  const origemFilme = id => /^FILME-\d+$/.test(id) ? 'AppSheet' : 'atual';
  const trunc = (s, n = 90) => { s = s == null ? '' : String(s); return s.length > n ? s.slice(0, n) + '…' : s; };

  async function fetchAllFilmes() {
    const cols = 'id,nome,ano,duracao_min,poster,categorias,classificacao,sinopse,tmdb_id';
    const out = [];
    let from = 0;
    const PAGE = 1000; // limite máximo de linhas por requisição da API (PostgREST)
    while (true) {
      const r = await fetch(SUPA_URL + '/rest/v1/filmes?select=' + cols, {
        headers: { apikey: SUPA_KEY, Range: `${from}-${from + PAGE - 1}` }
      });
      const page = await r.json();
      if (!Array.isArray(page) || page.length === 0) break;
      out.push(...page);
      if (page.length < PAGE) break;
      from += PAGE;
    }
    return out;
  }

  async function emLotes(itens, fn, label) {
    const out = [];
    let feitos = 0;
    for (let i = 0; i < itens.length; i += CONCORRENCIA) {
      const lote = itens.slice(i, i + CONCORRENCIA);
      const rs = await Promise.all(lote.map(fn));
      rs.forEach(r => { if (r) (Array.isArray(r) ? out.push(...r) : out.push(r)); });
      feitos += lote.length;
      if (label && feitos % 150 < CONCORRENCIA) console.log(`… ${label}: ${feitos}/${itens.length}`);
    }
    return out;
  }

  // ── FASE 1 ──
  async function auditarFilme(f) {
    const achados = [];
    const esperado = ESPERADOS[f.id] || [];
    const push = (campo, banco, tmdb, tipo = 'diferenca') => {
      achados.push({ id: f.id, nome: f.nome, campo, tipo: esperado.includes(campo) ? 'esperado' : tipo, banco, tmdb });
    };

    let d;
    try {
      d = await fetch(`https://api.themoviedb.org/3/movie/${f.tmdb_id}?api_key=${TMDB_KEY}&language=pt-BR&append_to_response=release_dates`).then(r => r.json());
    } catch (e) {
      push('(chamada TMDB)', '', 'erro de rede: ' + String(e).slice(0, 60), 'erro');
      return achados;
    }
    if (d?.success === false) {
      push('(chamada TMDB)', '', d.status_message || `tmdb_id ${f.tmdb_id} inválido/removido no TMDB`, 'erro');
      return achados;
    }

    // suspeita de tmdb_id errado — checa ANTES dos outros campos, e não impede o resto
    // (um id "suspeito" ainda pode ter pôster/categoria pra reportar separadamente)
    const anoTmdbNum = /^\d{4}$/.test(d.release_date?.slice(0,4) || '') ? parseInt(d.release_date.slice(0,4)) : null;
    const anoBancoNum = /^\d{4}$/.test(String(f.ano||'')) ? parseInt(f.ano) : null;
    const anoDiffAbs = (anoTmdbNum !== null && anoBancoNum !== null) ? Math.abs(anoTmdbNum - anoBancoNum) : null;
    const durDiffAbs = (d.runtime && f.duracao_min) ? Math.abs(d.runtime - f.duracao_min) : null;
    // id_suspeito é empurrado direto no array (não passa pelo push() acima, que checa
    // ESPERADOS por campo) — bug achado em 2026-09-24: um filme com duracao_min em ESPERADOS
    // (duração conferida e corrigida à mão, TMDB só desatualizado) continuava virando
    // id_suspeito todo run, porque o limiar de duração não sabia da exceção. Checado aqui
    // direto: se a duração já está marcada como esperada pra este filme, ela não conta mais
    // pro limiar — o de ano continua valendo (nenhuma exceção de ano registrada até hoje).
    const duracaoEhEsperada = esperado.includes('duracao_min');
    if ((!duracaoEhEsperada && durDiffAbs !== null && durDiffAbs > LIMIAR_ID_SUSPEITO_DURACAO) || (anoDiffAbs !== null && anoDiffAbs >= LIMIAR_ID_SUSPEITO_ANO)) {
      achados.push({
        id: f.id, nome: f.nome, campo: 'tmdb_id', tipo: 'id_suspeito',
        banco: `ano ${f.ano}, duração ${f.duracao_min}min`,
        tmdb: `tmdb_id ${f.tmdb_id} → "${d.title}" (${anoTmdbNum ?? '?'}, ${d.runtime ?? '?'}min, ${d.vote_count ?? 0} votos)`,
        _tmdbIdAtual: f.tmdb_id
      });
    }

    // pôster — só o nome do arquivo, nunca a URL inteira (tamanho não conta)
    if (f.poster && !ehUrlTmdb(f.poster)) {
      // não é do TMDB (ex. i.redd.it) — categoria própria, não dá pra comparar caminho
      if (d.poster_path) achados.push({ id: f.id, nome: f.nome, campo: 'poster', tipo: 'poster_externo', banco: f.poster, tmdb: 'https://image.tmdb.org/t/p/w500' + d.poster_path });
    } else {
      const bp = posterPath(f.poster), tp = d.poster_path ? d.poster_path.replace(/^\//, '') : null;
      if (f.poster && tp && bp !== tp) push('poster', f.poster, 'https://image.tmdb.org/t/p/w500/' + tp, '__poster_pendente_fase2__');
      else if (f.poster && !tp) push('poster', f.poster, '(TMDB sem pôster)', 'ausencia');
      else if (!f.poster && tp) push('poster', '(sem pôster no banco)', 'https://image.tmdb.org/t/p/w500/' + tp, 'ausencia');
    }

    // ano
    if (anoTmdbNum !== null && anoBancoNum !== null && anoTmdbNum !== anoBancoNum) push('ano', f.ano, String(anoTmdbNum));

    // duração — abaixo do limiar do relatório fica marcado à parte (só CSV)
    if (durDiffAbs !== null && durDiffAbs > 0) {
      push('duracao_min', f.duracao_min, d.runtime, durDiffAbs < LIMIAR_DURACAO_RELATORIO ? 'duracao_pequena' : 'diferenca');
    }

    // gêneros — separa "só acrescentou" de "removeu/trocou"
    const gTmdb = (d.genres || []).map(g => g.name);
    const gBanco = f.categorias || [];
    const faltamNoBanco = gTmdb.filter(g => !gBanco.includes(g));  // TMDB tem, banco não — "mais"
    const sobramNoBanco = gBanco.filter(g => !gTmdb.includes(g));  // banco tem, TMDB não — "menos"
    if (sobramNoBanco.length) push('categorias', sobramNoBanco.join(', '), gTmdb.join(', '), 'categoria_menos');
    if (faltamNoBanco.length) push('categorias', gBanco.join(', '), faltamNoBanco.join(', ') + ' (a mais)', 'categoria_mais');

    // classificação BR (com fallback US, ver getCert acima)
    const cert = getCert(d.release_dates);
    if (cert === null) { if (f.classificacao) push('classificacao', f.classificacao, '(TMDB sem BR nem US)', 'ausencia'); }
    else if (cert !== (f.classificacao || '')) push('classificacao', f.classificacao, cert);

    // sinopse pt-BR — sempre CSV-only quando é diferença de conteúdo presente nos dois lados
    if (!d.overview) { if (f.sinopse) push('sinopse', trunc(f.sinopse), '(TMDB sem sinopse pt-BR)', 'ausencia'); }
    else if (d.overview !== (f.sinopse || '')) push('sinopse', trunc(f.sinopse), trunc(d.overview), 'sinopse_reescrita');

    // título em alfabeto não-latino — não compara contra o TMDB, só sinaliza
    if (naoLatino(f.nome)) push('nome (alfabeto)', f.nome, 'contém letra fora do alfabeto latino', 'alerta');

    return achados;
  }

  // ── FASE 2 — só nos pôsteres pendentes ──
  async function resolverPoster(a) {
    delete a._tmdbId; // lido logo abaixo via tmdbId local — nunca sobra no objeto exportado, nem no caminho de erro
    const tmdbId = comTmdbIdMap[a.id];
    a.origem = origemFilme(a.id);
    let img;
    try { img = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}/images?api_key=${TMDB_KEY}`).then(r => r.json()); }
    catch (e) { a.tipo = 'poster_suspeito'; a.tmdb += ' (falha ao checar histórico)'; return a; }
    const arquivoBanco = posterPath(a.banco);
    const noHistorico = (img.posters || []).some(p => (p.file_path || '').includes((arquivoBanco || '').replace(/\.(jpe?g|png|webp)$/i, '')));
    a.tipo = noHistorico ? 'poster_churn' : 'poster_suspeito';
    return a;
  }

  // ── FASE 3 — só nos "suspeita de tmdb_id errado" ──
  async function sugerirAlternativo(a) {
    const tmdbIdAtual = a._tmdbIdAtual;
    delete a._tmdbIdAtual; // lido acima — nunca sobra no objeto exportado, em nenhum caminho de saída
    try {
      const anoQ = (a.banco.match(/ano (\d{4})/) || [])[1] || '';
      const sr = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&language=pt-BR&query=${encodeURIComponent(a.nome)}&year=${anoQ}`).then(r => r.json());
      const altId = sr.results?.[0]?.id;
      if (!altId || altId === tmdbIdAtual) { a.candidatoAlternativo = '(busca só acha o mesmo id — não parece id errado, ver duração/ano por outro motivo)'; return a; }
      const alt = await fetch(`https://api.themoviedb.org/3/movie/${altId}?api_key=${TMDB_KEY}&language=pt-BR`).then(r => r.json());
      a.candidatoAlternativo = `tmdb_id ${altId} → "${alt.title}" (${(alt.release_date||'').slice(0,4)}, ${alt.runtime ?? '?'}min, ${alt.vote_count ?? 0} votos)`;
    } catch (e) { a.candidatoAlternativo = 'erro ao buscar alternativa'; }
    return a;
  }

  console.log('Carregando catálogo…');
  const todos = await fetchAllFilmes();
  const semTmdbId = todos.filter(f => !f.tmdb_id);
  const comTmdbId = todos.filter(f => f.tmdb_id);
  console.log(`${todos.length} filmes no catálogo — ${comTmdbId.length} com tmdb_id (auditados), ${semTmdbId.length} sem (não auditados).`);

  const comTmdbIdMap = Object.fromEntries(comTmdbId.map(f => [f.id, f.tmdb_id]));

  console.log('Fase 1: comparando cada filme…');
  let achados = await emLotes(comTmdbId, auditarFilme, 'fase 1');

  const pendentesPoster = achados.filter(a => a.tipo === '__poster_pendente_fase2__');
  achados = achados.filter(a => a.tipo !== '__poster_pendente_fase2__');
  if (pendentesPoster.length) {
    console.log(`Fase 2: checando histórico de pôster em ${pendentesPoster.length} filmes…`);
    const resolvidos = await emLotes(pendentesPoster, resolverPoster, 'fase 2');
    achados.push(...resolvidos);
  }

  const suspeitosId = achados.filter(a => a.tipo === 'id_suspeito');
  if (suspeitosId.length) {
    console.log(`Fase 3: buscando candidato alternativo em ${suspeitosId.length} suspeitas de tmdb_id errado…`);
    await emLotes(suspeitosId, sugerirAlternativo, 'fase 3'); // já muta os objetos em achados
  }

  const porTipo = (t, cols) => achados.filter(a => a.tipo === t).map(a => {
    const o = { id: a.id, nome: a.nome };
    (cols || ['campo', 'banco', 'tmdb']).forEach(c => o[c] = typeof a[c] === 'string' ? trunc(a[c], 70) : a[c]);
    return o;
  });

  const idSuspeito = porTipo('id_suspeito', ['banco', 'tmdb', 'candidatoAlternativo']);
  const diferencas = porTipo('diferenca');
  const posterSuspeito = porTipo('poster_suspeito', ['banco', 'tmdb', 'origem']);
  const categoriaMenos = porTipo('categoria_menos');
  const alertas = porTipo('alerta');
  const erros = porTipo('erro');
  const esperados = porTipo('esperado');
  // Só CSV, não impressos:
  const duracaoPequena = achados.filter(a => a.tipo === 'duracao_pequena');
  const sinopseReescrita = achados.filter(a => a.tipo === 'sinopse_reescrita');
  const posterChurn = achados.filter(a => a.tipo === 'poster_churn');
  const categoriaMais = achados.filter(a => a.tipo === 'categoria_mais');
  const ausencias = achados.filter(a => a.tipo === 'ausencia');
  const posterExterno = achados.filter(a => a.tipo === 'poster_externo');

  console.log('\n=== RESUMO ===');
  console.log(`Filmes auditados: ${comTmdbId.length}  |  Sem tmdb_id (não auditados): ${semTmdbId.length}`);
  console.log(`SUSPEITA DE TMDB_ID ERRADO: ${idSuspeito.length}  |  Diferenças reais: ${diferencas.length}  |  Pôster suspeito: ${posterSuspeito.length}  |  Categoria removida/trocada: ${categoriaMenos.length}  |  Alertas de alfabeto: ${alertas.length}  |  Erros: ${erros.length}  |  Esperadas: ${esperados.length}`);
  console.log(`Só no CSV (baixo sinal): duração <${LIMIAR_DURACAO_RELATORIO}min: ${duracaoPequena.length}  |  sinopse reescrita: ${sinopseReescrita.length}  |  pôster só trocou (histórico bate): ${posterChurn.length}  |  categoria só acrescentada: ${categoriaMais.length}  |  ausências: ${ausencias.length}  |  pôster fora do TMDB: ${posterExterno.length}`);
  if (semTmdbId.length) console.log('Sem tmdb_id:', semTmdbId.map(f => `${f.id} (${f.nome})`).join(', '));

  if (idSuspeito.length) { console.log('\n--- SUSPEITA DE TMDB_ID ERRADO (a mais importante) ---'); console.table(idSuspeito); }
  if (diferencas.length) { console.log('\n--- DIFERENÇAS REAIS (banco ≠ TMDB, ≥' + LIMIAR_DURACAO_RELATORIO + 'min quando é duração) ---'); console.table(diferencas); }
  if (posterSuspeito.length) { console.log('\n--- PÔSTER SUSPEITO (caminho não está no histórico do TMDB pra esse id) ---'); console.table(posterSuspeito); }
  if (categoriaMenos.length) { console.log('\n--- CATEGORIA REMOVIDA/TROCADA (banco tem gênero que o TMDB não tem mais) ---'); console.table(categoriaMenos); }
  if (alertas.length) { console.log('\n--- ALERTAS (título em alfabeto não-latino) ---'); console.table(alertas); }
  if (erros.length) { console.log('\n--- ERROS (chamada ao TMDB falhou) ---'); console.table(erros); }
  if (esperados.length) { console.log('\n--- ESPERADAS (diferença conhecida, não é achado) ---'); console.table(esperados); }

  function csvEscape(v) { if (v == null) return ''; const s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function downloadCSV(filename, rows) {
    const headers = ['id', 'nome', 'tipo', 'campo', 'banco', 'tmdb', 'origem', 'candidatoAlternativo'];
    const csv = [headers.join(',')].concat(rows.map(r => headers.map(h => csvEscape(r[h])).join(','))).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  const today = new Date().toISOString().split('T')[0];
  downloadCSV(`auditoria_catalogo_${today}.csv`, achados);
  console.log(`\nCSV baixado com as ${achados.length} linhas (todas as categorias, inclusive as que não aparecem nas tabelas acima). Nada foi escrito no banco.`);

  return achados;
})();
