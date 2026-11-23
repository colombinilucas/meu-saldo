'use strict';
/* Backup: um arquivo .zip com todos os dados (backup.json) e os documentos (pasta documentos/).
   Serve para guardar uma cópia e para levar tudo para outro aparelho. */

const BACKUP_APP = 'meu-salario-controle-financeiro';
const BACKUP_FORMAT = 1;
const BACKUP_STORES = ['categories', 'incomes', 'expenses', 'recurring', 'goals', 'goalMoves', 'rules', 'bankIds', 'docs'];

async function exportBackup() {
  const data = {};
  for (const s of BACKUP_STORES) data[s] = await DB.getAll(s);
  const files = [];
  const docs = [];
  for (const d of data.docs) {
    const content = await DB.getDocData(d.id);
    if (!content) continue; // ficha sem arquivo: não entra no backup
    files.push({ name: `documentos/${d.id}`, data: new Uint8Array(content) });
    docs.push(d);
  }
  data.docs = docs;
  const manifest = {
    app: BACKUP_APP, format: BACKUP_FORMAT, createdAt: new Date().toISOString(),
    counts: Object.fromEntries(BACKUP_STORES.map((s) => [s, data[s].length])),
    data,
  };
  files.unshift({ name: 'backup.json', data: new TextEncoder().encode(JSON.stringify(manifest)) });
  const blob = Zip.create(files);
  const url = URL.createObjectURL(blob);
  docDownload(url, `meu-saldo-backup-${U.today()}.zip`);
  setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
  await DB.put('settings', { key: 'lastBackup', value: Date.now() });
  return { size: blob.size, docs: docs.length };
}

/* ---------- Validação ---------- */

function validateBackup(m, zipNames) {
  const problems = [];
  const fail = (msg) => { if (problems.length < 4) problems.push(msg); };
  if (!m || typeof m !== 'object' || m.app !== BACKUP_APP) {
    throw new Error('Este arquivo não é um backup deste app.');
  }
  if (!Number.isInteger(m.format) || m.format > BACKUP_FORMAT) {
    throw new Error('Este backup foi feito por uma versão mais nova do app. Atualize o app e tente de novo.');
  }
  const d = m.data || {};
  const out = {};
  for (const s of BACKUP_STORES) {
    const v = d[s] ?? ((s === 'rules' || s === 'bankIds') ? [] : null);
    if (!Array.isArray(v)) throw new Error('O backup está incompleto ou foi alterado. Nada foi importado.');
    out[s] = v;
  }
  const isId = (x) => typeof x === 'string' && x.length > 0 && x.length < 200;
  const isStr = (x, max = 200) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
  const isCents = (x, min = 1) => Number.isSafeInteger(x) && x >= min;
  const uniq = (list, name) => {
    const seen = new Set();
    for (const o of list) {
      if (!o || typeof o !== 'object' || !isId(o.id ?? o.key)) { fail(`${name}: item sem identificação.`); continue; }
      const k = o.id ?? o.key;
      if (seen.has(k)) fail(`${name}: item repetido.`);
      seen.add(k);
    }
    return seen;
  };

  const cats = uniq(out.categories, 'Categorias');
  out.categories.forEach((c, i) => {
    if (!isStr(c.name, 40)) fail(`Categoria nº ${i + 1}: nome inválido.`);
    if (!isCents(c.limitCents ?? 0, 0)) fail(`Categoria "${c.name}": limite inválido.`);
  });
  uniq(out.incomes, 'Receitas');
  out.incomes.forEach((o, i) => {
    if (!U.isValidMonth(o.month)) fail(`Receita nº ${i + 1}: mês inválido.`);
    if (!['salario', 'extra'].includes(o.kind)) fail(`Receita nº ${i + 1}: tipo inválido.`);
    if (!isCents(o.amountCents, 0)) fail(`Receita nº ${i + 1}: valor inválido.`);
  });
  uniq(out.expenses, 'Gastos');
  out.expenses.forEach((o, i) => {
    const label = `Gasto nº ${i + 1}${typeof o.description === 'string' ? ` ("${o.description.slice(0, 30)}")` : ''}`;
    if (!isStr(o.description, 200)) fail(`${label}: descrição inválida.`);
    if (!isCents(o.amountCents)) fail(`${label}: valor inválido.`);
    if (!U.isValidDate(o.date) || o.month !== o.date.slice(0, 7)) fail(`${label}: data inválida.`);
    if (!cats.has(o.categoryId)) fail(`${label}: categoria inexistente.`);
  });
  const recs = uniq(out.recurring, 'Contas fixas');
  out.recurring.forEach((o, i) => {
    if (!isStr(o.description, 200) || !isCents(o.amountCents)) fail(`Conta fixa nº ${i + 1}: dados inválidos.`);
    if (!Number.isInteger(o.day) || o.day < 1 || o.day > 31) fail(`Conta fixa nº ${i + 1}: dia inválido.`);
    if (!U.isValidMonth(o.startMonth)) fail(`Conta fixa nº ${i + 1}: mês inicial inválido.`);
    if (!cats.has(o.categoryId)) fail(`Conta fixa nº ${i + 1}: categoria inexistente.`);
  });
  out.expenses.forEach((o) => { if (o.recurringId && !isId(o.recurringId)) fail('Gasto com conta fixa inválida.'); });
  const goals = uniq(out.goals, 'Objetivos');
  out.goals.forEach((o, i) => {
    if (!isStr(o.name, 50) || !isCents(o.targetCents)) fail(`Objetivo nº ${i + 1}: dados inválidos.`);
    if (o.targetMonth && !U.isValidMonth(o.targetMonth)) fail(`Objetivo nº ${i + 1}: prazo inválido.`);
  });
  uniq(out.goalMoves, 'Cofre');
  out.goalMoves.forEach((o, i) => {
    if (!goals.has(o.goalId)) fail(`Movimentação do cofre nº ${i + 1}: objetivo inexistente.`);
    if (!Number.isSafeInteger(o.amountCents) || o.amountCents === 0) fail(`Movimentação do cofre nº ${i + 1}: valor inválido.`);
    if (!U.isValidDate(o.date) || o.month !== o.date.slice(0, 7)) fail(`Movimentação do cofre nº ${i + 1}: data inválida.`);
  });
  uniq(out.rules, 'Regras');
  uniq(out.bankIds, 'Extratos');
  uniq(out.docs, 'Documentos');
  const names = new Set(zipNames);
  out.docs.forEach((o, i) => {
    if (!U.isValidMonth(o.month) || !isStr(o.name, 200) || !DOC_FORMATOS[o.mime] || !isCents(o.size)) {
      fail(`Documento nº ${i + 1}: dados inválidos.`);
    } else if (!names.has(`documentos/${o.id}`)) fail(`Documento "${o.name}": arquivo não está no backup.`);
  });
  void recs;
  if (problems.length) {
    throw new Error(`O backup tem problemas e não foi importado. Nada foi alterado.\n• ${problems.join('\n• ')}`);
  }
  return out;
}

/** Lê e confere o arquivo inteiro antes de qualquer alteração. */
async function readBackupFile(file) {
  if (!file) throw new Error('Escolha o arquivo de backup (.zip).');
  let zip;
  try { zip = await Zip.read(await file.arrayBuffer()); } catch (e) { throw new Error(e.message || 'Não foi possível ler o arquivo.'); }
  const json = await zip.get('backup.json');
  if (!json) throw new Error('Este arquivo não é um backup deste app (falta o backup.json).');
  let manifest;
  try { manifest = JSON.parse(new TextDecoder().decode(json)); } catch (e) {
    throw new Error('O backup está danificado (não foi possível ler os dados). Nada foi alterado.');
  }
  const data = validateBackup(manifest, zip.names);
  const files = new Map();
  for (const d of data.docs) {
    const bytes = await zip.get(`documentos/${d.id}`);
    if (bytes.length !== d.size) throw new Error(`O documento "${d.name}" está incompleto no backup. Nada foi alterado.`);
    files.set(d.id, bytes.slice().buffer); // cópia só do documento
  }
  return { manifest, data, files };
}

function backupSummary(manifest, data) {
  const months = [...data.expenses, ...data.incomes, ...data.goalMoves].map((o) => o.month).sort();
  const docBytes = data.docs.reduce((s, d) => s + d.size, 0);
  const when = new Date(manifest.createdAt);
  return `<ul class="summary">
    <li>Feito em <b>${isNaN(when) ? '—' : when.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</b></li>
    ${months.length ? `<li>Meses: <b>${U.monthLabel(months[0])}</b> a <b>${U.monthLabel(months[months.length - 1])}</b></li>` : ''}
    <li>${data.expenses.length} gasto(s), ${data.incomes.length} receita(s), ${data.recurring.length} conta(s) fixa(s)</li>
    <li>${data.categories.length} categoria(s), ${data.goals.length} objetivo(s) no cofre</li>
    <li>${data.docs.length} documento(s)${data.docs.length ? ` (${fileSize(docBytes)})` : ''}</li>
  </ul>`;
}

function importBackupForm() {
  const hasData = state.expenses.length || state.incomes.length || state.goals.length || state.docs.length;
  let loaded = null;
  const form = openForm(`<h2>Importar backup</h2>
    <label class="field"><span>Arquivo de backup (.zip)</span>
      <input type="file" name="file" accept=".zip,application/zip"></label>
    <div id="bkInfo"><p class="muted small">Escolha o arquivo. Ele será conferido antes de qualquer mudança.</p></div>
    <div id="bkMode" hidden>
      <label class="radio"><input type="radio" name="mode" value="merge" checked>
        <span><b>Juntar com os dados deste aparelho</b><br><span class="muted small">Mantém o que já está aqui e acrescenta o do backup. Se o mesmo lançamento existir nos dois, fica a versão do backup.</span></span></label>
      <label class="radio"><input type="radio" name="mode" value="replace">
        <span><b>Substituir tudo</b><br><span class="muted small">Apaga os dados e documentos deste aparelho e coloca os do backup no lugar.</span></span></label>
      ${hasData ? '<button type="button" class="btn small secondary" id="bkBefore">Baixar backup deste aparelho antes</button>' : ''}
    </div>
    <div class="actions"><span class="grow"></span>
      <button type="button" class="btn secondary" data-x="cancel">Cancelar</button>
      <button type="submit" class="btn primary" id="bkGo" disabled>Importar</button></div>`, {
    onSubmit: async (fd) => {
      if (!loaded) throw new Error('Escolha um arquivo de backup válido.');
      const mode = fd.get('mode') === 'replace' ? 'replace' : 'merge';
      if (mode === 'replace' && hasData) {
        const ok = await confirmBox(`Substituir tudo?<br>Os <b>${state.expenses.length} gasto(s)</b>, receitas, cofre e <b>${state.docs.length} documento(s)</b> deste aparelho serão apagados e trocados pelos do backup.`, 'Substituir');
        if (!ok) return false;
      }
      await DB.importAll(mode, loaded.data, loaded.files);
      askPersistentStorage();
      return mode === 'replace' ? 'Backup importado. Os dados foram substituídos.' : 'Backup importado e juntado aos dados deste aparelho.';
    },
  });
  const info = $('#bkInfo', form);
  const go = $('#bkGo', form);
  $('input[type=file]', form).addEventListener('change', async (e) => {
    loaded = null;
    go.disabled = true;
    $('#bkMode', form).hidden = true;
    $('.form-error', dlg).textContent = '';
    const f = e.target.files[0];
    if (!f) return;
    info.innerHTML = '<p class="muted small">Conferindo o backup…</p>';
    try {
      loaded = await readBackupFile(f);
      info.innerHTML = `<p><b>Backup válido.</b> Conteúdo:</p>${backupSummary(loaded.manifest, loaded.data)}`;
      $('#bkMode', form).hidden = false;
      go.disabled = false;
    } catch (ex) {
      info.innerHTML = '';
      $('.form-error', dlg).textContent = ex.message;
    }
  });
  $('#bkBefore', form)?.addEventListener('click', async () => {
    try { await exportBackup(); toast('Backup deste aparelho baixado.'); } catch (ex) { showError(ex); }
  });
}

const BackupActions = {
  'backup-export': async () => {
    toast('Preparando o backup…');
    const r = await exportBackup();
    await refresh();
    toast(`Backup baixado (${fileSize(r.size)}${r.docs ? `, ${r.docs} documento(s)` : ''}). Guarde-o em local seguro.`);
  },
  'backup-import': () => importBackupForm(),
};
