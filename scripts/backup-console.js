// CineList — Backup de tabelas do Supabase via console do navegador.
//
// COMO USAR:
// 1. Abra https://lbatinga.github.io/cinelist/ e faça login normalmente.
// 2. Abra o DevTools (F12) e vá na aba "Console".
// 3. Cole este script inteiro e aperte Enter.
// 4. O navegador vai baixar 4 arquivos CSV (avaliacoes, filmes, usuarios, perfis).
//    Se ele perguntar se pode baixar múltiplos arquivos, clique em "Permitir".
//
// Usa o cliente Supabase já autenticado da própria página (`supa`), por isso
// lê tabelas com RLS restrita a usuário logado (ex: usuarios) sem precisar
// de service_role. Roda 100% no navegador, sem Node.

(async function backupCineList() {
  if (typeof supa === 'undefined') {
    console.error('❌ Variável "supa" não encontrada. Rode este script na aba do CineList, com o app carregado.');
    return;
  }

  const TABLES = ['avaliacoes', 'filmes', 'usuarios', 'perfis'];
  const PAGE_SIZE = 1000; // limite máximo de linhas por requisição da API

  async function fetchAllRows(table) {
    const rows = [];
    let from = 0;
    while (true) {
      const { data, error } = await supa.from(table).select('*').range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < PAGE_SIZE) break; // última página
      from += PAGE_SIZE;
    }
    return rows;
  }

  function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function rowsToCSV(rows) {
    if (rows.length === 0) return '';
    // União das chaves de todas as linhas, na ordem em que aparecem
    const headers = [];
    const seen = new Set();
    rows.forEach(r => Object.keys(r).forEach(k => {
      if (!seen.has(k)) { seen.add(k); headers.push(k); }
    }));
    const lines = [headers.join(',')];
    rows.forEach(r => lines.push(headers.map(h => csvEscape(r[h])).join(',')));
    return lines.join('\n');
  }

  function downloadCSV(filename, csv) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const today = new Date().toISOString().split('T')[0];
  const counts = {};

  for (const table of TABLES) {
    console.log(`Baixando ${table}...`);
    try {
      const rows = await fetchAllRows(table);
      const csv = rowsToCSV(rows);
      downloadCSV(`${table}_${today}.csv`, csv);
      counts[table] = rows.length;
      console.log(`✅ ${table}: ${rows.length} linhas`);
    } catch (e) {
      console.error(`❌ Erro em ${table}:`, e.message);
      counts[table] = 'erro — veja o console';
    }
    await new Promise(r => setTimeout(r, 400)); // evita disparo simultâneo de downloads
  }

  console.log('Resumo:', counts);
})();
