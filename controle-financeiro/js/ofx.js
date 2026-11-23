'use strict';
/* Importação de extrato bancário no formato OFX (Itaú e outros bancos).
   O arquivo é lido só neste aparelho; nada é enviado para a internet. */

const OFX_SUGESTOES = [
  [/SUPERM|MERCEARIA|MERCADO|ATACAD|ASSAI|CARREFOUR|PAO DE ACUCAR|HORTIFRUTI|PADARIA|ACOUGUE|SACOLAO|ATACADAO/, 'mercado'],
  [/UBER|99 ?APP|99POP|POSTO|COMBUST|SHELL|IPIRANGA|PETROBRAS|ESTACIONA|METRO|ONIBUS|BILHETE|SEM PARAR|VELOE|PEDAGIO/, 'transporte'],
  [/FARMA|DROGA|RAIA|PAGUE MENOS|HOSPITAL|CLINICA|LABORAT|UNIMED|ODONTO|AMIL|HAPVIDA/, 'saude'],
  [/ALUGUEL|CONDOMINIO|IMOBILIARIA/, 'moradia'],
  [/ENEL|LIGHT|CEMIG|COPEL|CPFL|SABESP|SANEPAR|COMGAS|CLARO|VIVO|\bTIM\b|\bOI\b|INTERNET|ENERGIA|\bAGUA\b/, 'contas'],
  [/IFOOD|IFD\*|RAPPI|NETFLIX|SPOTIFY|DISNEY|PRIME VIDEO|MAX\.COM|CINEMA|INGRESSO|\bBAR\b|RESTAUR|LANCHON|BURGER|PIZZA|STEAM|PLAYSTATION|XBOX/, 'lazer'],
];
const OFX_PALAVRAS_GENERICAS = new Set(['PIX', 'TRANSF', 'TRANSFERENCIA', 'ENVIADO', 'ENVIADA', 'RECEBIDO', 'RECEBIDA', 'PAG',
  'PAGTO', 'PAGAMENTO', 'COMPRA', 'COMPRAS', 'CARTAO', 'DEB', 'DEBITO', 'CRED', 'CREDITO', 'ELO', 'VISA', 'MASTER',
  'MASTERCARD', 'BOLETO', 'TED', 'DOC', 'TEV', 'INT', 'SISPAG', 'QRS', 'QR', 'DE', 'DA', 'DO', 'EM', 'NO', 'NA', 'S', 'A', 'E', 'COM']);

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** Chave usada para lembrar a categoria de uma descrição (ex.: "IFOOD" -> Lazer). */
function ofxLearnKey(desc) {
  const words = semAcento(desc).replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !OFX_PALAVRAS_GENERICAS.has(w));
  const key = words.slice(0, 2).join(' ');
  return key || semAcento(desc).replace(/[^A-Z]/g, '').slice(0, 20);
}

function ofxSuggestCategory(desc, rules) {
  const key = ofxLearnKey(desc);
  const learned = key && rules.get(key);
  if (learned && catById(learned)) return learned;
  const txt = semAcento(desc);
  for (const [re, id] of OFX_SUGESTOES) if (re.test(txt) && catById(id)) return id;
  return catById(CAT_OUTROS) ? CAT_OUTROS : state.categories[0]?.id;
}

function ofxPayment(desc, type) {
  const t = semAcento(`${desc} ${type || ''}`);
  if (/PIX/.test(t)) return 'Pix';
  if (/BOLETO|SISPAG|PAGTO|PAG /.test(t)) return 'Boleto';
  if (/SAQUE/.test(t)) return 'Dinheiro';
  if (/CREDITO|FATURA/.test(t)) return 'Crédito';
  if (/^(ATM|CASH)$/.test(String(type).toUpperCase())) return 'Dinheiro';
  return 'Débito';
}

function ofxNiceText(s) {
  const clean = String(s || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Movimentação do extrato';
  // Extratos costumam vir em MAIÚSCULAS: deixa mais fácil de ler.
  const pretty = clean === clean.toUpperCase()
    ? clean.toLowerCase().replace(/(^|[\s/(-])([a-zà-ú])/g, (m, a, b) => a + b.toUpperCase())
    : clean;
  return pretty.slice(0, 80);
}

function ofxDecode(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch (e) {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function ofxTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : '';
}

function ofxDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(s || '');
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return U.isValidDate(iso) ? iso : null;
}

function ofxAmount(raw) {
  let s = String(raw || '').trim().replace(/\s/g, '');
  const neg = s.startsWith('-');
  s = s.replace(/^[-+]/, '');
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [i, f = ''] = s.split('.');
  const cents = parseInt(i, 10) * 100 + parseInt((f + '00').slice(0, 2), 10);
  if (!Number.isSafeInteger(cents)) return null;
  return neg ? -cents : cents;
}

/** Lê o texto do OFX e devolve conta, período e movimentações. */
function parseOfx(text) {
  if (!/<OFX>/i.test(text) || !/<STMTTRN>/i.test(text)) {
    throw new Error('Este arquivo não parece um extrato OFX com movimentações. No Itaú, use "Salvar em outros formatos" → OFX.');
  }
  const bank = ofxTag(text, 'BANKID') || ofxTag(text, 'ORG');
  const acct = ofxTag(text, 'ACCTID');
  const blocks = text.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]);
  const txs = [];
  let skipped = 0;
  const seen = new Map();
  for (const b of blocks) {
    const date = ofxDate(ofxTag(b, 'DTPOSTED'));
    const amount = ofxAmount(ofxTag(b, 'TRNAMT'));
    if (!date || amount == null || amount === 0) { skipped++; continue; }
    const memo = ofxTag(b, 'MEMO') || ofxTag(b, 'NAME');
    const fitid = ofxTag(b, 'FITID');
    let key = `${bank}|${acct}|${fitid}|${date}|${amount}`;
    // Mesmo código repetido no arquivo: mantém as duas, com chaves diferentes.
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    if (n > 1) key += `|${n}`;
    txs.push({ key, date, amount, memo, desc: ofxNiceText(memo), type: ofxTag(b, 'TRNTYPE') });
  }
  if (!txs.length) throw new Error('Não encontrei movimentações válidas neste extrato.');
  txs.sort((a, b) => a.date.localeCompare(b.date));
  return {
    bank, acct, skipped, txs, source: 'Extrato OFX',
    start: ofxDate(ofxTag(text, 'DTSTART')) || txs[0].date,
    end: ofxDate(ofxTag(text, 'DTEND')) || txs[txs.length - 1].date,
  };
}

/* ---------- Telas ---------- */

function ofxStartForm() {
  const form = openForm(`<h2>Importar extrato</h2>
    <p>Transforme as saídas do extrato em gastos, sem digitar um por um. Você revisa tudo antes.</p>
    <p class="muted small">Aceita o <b>PDF do extrato de conta corrente do Itaú</b> (app ou site) e arquivos <b>OFX</b> de qualquer banco.</p>
    <details class="help"><summary>Como baixar o extrato em PDF no app do Itaú</summary>
      <ol>
        <li>No app do Itaú, abra <b>Extrato</b> da conta corrente.</li>
        <li>Escolha o período (por exemplo, o mês passado).</li>
        <li>Toque em <b>Compartilhar</b> ou <b>Salvar PDF</b> e guarde o arquivo no celular.</li>
      </ol>
    </details>
    <details class="help"><summary>Como baixar o extrato OFX no Itaú</summary>
      <ol>
        <li>Entre no <b>internet banking do Itaú</b> pelo computador.</li>
        <li>Abra <b>Extrato</b> e escolha o período (por exemplo, o mês passado).</li>
        <li>Clique em <b>Salvar em outros formatos</b> e escolha <b>OFX</b> (também chamado de "Money").</li>
        <li>O arquivo termina em <b>.ofx</b> e vai para a pasta Downloads.</li>
      </ol>
      <p class="muted small">Outros bancos também exportam OFX, geralmente na tela de extrato.</p>
    </details>
    <label class="field"><span>Arquivo do extrato (.pdf ou .ofx)</span>
      <input type="file" name="file" accept=".pdf,application/pdf,.ofx,.OFX,application/x-ofx,application/ofx"></label>
    <p class="muted small" id="ofxReading" hidden>Lendo o extrato…</p>
    <p class="muted small">🔒 O arquivo é lido só aqui no aparelho.</p>
    <div class="actions"><span class="grow"></span>
      <button type="button" class="btn secondary" data-x="cancel">Cancelar</button></div>`, {
    onSubmit: async () => false,
  });
  $('input[type=file]', form).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const err = $('.form-error', dlg);
    err.textContent = '';
    try {
      if (f.size > 15 * 1024 * 1024) throw new Error('Arquivo grande demais para um extrato (máximo 15 MB).');
      $('#ofxReading', form).hidden = false;
      const buf = await f.arrayBuffer();
      const head = new TextDecoder('latin1').decode(buf.slice(0, 5));
      const parsed = head === '%PDF-' ? await parseItauPdf(buf) : parseOfx(ofxDecode(buf));
      const rules = new Map((await DB.getAll('rules')).map((r) => [r.key, r.categoryId]));
      const done = new Set((await DB.getAll('bankIds')).map((r) => r.id));
      dlg.close();
      ofxReviewForm(parsed, rules, done);
    } catch (ex) {
      $('#ofxReading', form).hidden = true;
      err.textContent = ex.message || String(ex);
    }
  });
}

function ofxReviewForm(parsed, rules, done) {
  const items = parsed.txs.map((t, i) => {
    const out = t.amount < 0;
    const cents = Math.abs(t.amount);
    const imported = done.has(t.key);
    const sameDay = !imported && out && state.expenses.find((e) => e.date === t.date && e.amountCents === cents);
    const invest = /APLIC|RESGATE|POUPANCA|INVEST|CDB/.test(semAcento(t.memo));
    let hint = '';
    if (imported) hint = 'já importado antes';
    else if (sameDay) hint = `já existe um gasto de ${U.money(cents)} nesse dia ("${sameDay.description}")`;
    else if (invest) hint = 'parece aplicação/resgate (não é gasto)';
    return { ...t, i, out, cents, imported, checked: out && !imported && !sameDay && !invest, hint,
      categoryId: out ? ofxSuggestCategory(t.memo, rules) : null };
  });
  // Estorno: a compra devolvida e o estorno se anulam, então os dois ficam desmarcados.
  for (const est of items.filter((x) => !x.out && /ESTORNO|DEVOLU/.test(semAcento(`${x.type} ${x.memo}`)))) {
    const buy = items.find((x) => x.out && !x.paired && x.cents === est.cents
      && Math.abs(new Date(x.date) - new Date(est.date)) <= 7 * 864e5);
    est.hint = 'estorno (dinheiro devolvido)';
    if (buy) {
      buy.paired = true;
      buy.checked = false;
      if (!buy.imported) buy.hint = 'compra estornada: o valor foi devolvido';
    }
  }
  const outs = items.filter((x) => x.out);
  const ins = items.filter((x) => !x.out);
  const acct = parsed.acct ? `Conta final ${esc(parsed.acct.replace(/\D/g, '').slice(-4) || parsed.acct.slice(-4))} · ` : '';
  const row = (x) => `<li class="ofx-row ${x.imported ? 'done' : ''}">
    <input type="checkbox" data-i="${x.i}" ${x.checked ? 'checked' : ''} ${x.imported ? 'disabled' : ''}
      aria-label="Importar ${esc(x.desc)} de ${U.money(x.cents)}">
    <span class="row-main"><span class="row-title">${esc(x.desc)}</span>
      <span class="muted small">${U.dateBR(x.date)}${x.hint ? ` · <span class="text-warn">${esc(x.hint)}</span>` : ''}</span></span>
    <span class="amount ${x.out ? '' : 'pos'}">${x.out ? '−' : '+'} ${U.money(x.cents)}</span>
    ${x.out ? `<select class="mini" data-cat="${x.i}" aria-label="Categoria de ${esc(x.desc)}" ${x.imported ? 'disabled' : ''}>${catOptions(x.categoryId)}</select>` : ''}
  </li>`;

  const form = openForm(`<h2>Revisar extrato</h2>
    <p class="muted small">${parsed.source ? `${esc(parsed.source)} · ` : ''}${acct}${U.dateBR(parsed.start)} a ${U.dateBR(parsed.end)}</p>
    ${parsed.reconciled === true ? '<p class="ok-note">✓ Conferido: os lançamentos batem com o saldo do extrato.</p>' : ''}
    ${parsed.reconciled === false ? '<p class="text-warn small">Atenção: os lançamentos lidos não batem com o saldo do extrato. Confira a lista antes de importar.</p>' : ''}
    <div class="ofx-stats">
      <span><b>${outs.length}</b> saídas</span><span><b>${ins.length}</b> entradas</span>
      <span><b>${items.filter((x) => x.imported).length}</b> já importadas</span>
    </div>
    <p class="small">Marque o que deve entrar no app e confira a categoria. O app lembra suas escolhas nas próximas importações.</p>
    ${outs.length ? `<div class="card-head"><h3 class="sub">Saídas → viram gastos</h3>
      <label class="check small"><input type="checkbox" id="ofxAll"> Marcar todas</label></div>
      <ul class="list ofx-list">${outs.map(row).join('')}</ul>` : ''}
    ${ins.length ? `<details class="ins"><summary><b>Entradas (${ins.length})</b> · ${U.money(ins.reduce((t, x) => t + x.cents, 0))} · opcional</summary>
      <p class="muted small">O salário você já informa no Início. Marque só entradas que quiser somar como receita extra do mês (ex.: Pix recebido).</p>
      <ul class="list ofx-list">${ins.map(row).join('')}</ul></details>` : ''}
    <div class="actions sticky-actions"><span class="grow"></span>
      <button type="button" class="btn secondary" data-x="cancel">Cancelar</button>
      <button type="submit" class="btn primary" id="ofxGo">Importar</button></div>`, {
    onSubmit: async (fd, f) => {
      const chosen = $$('input[data-i]:checked', f).map((c) => items[Number(c.dataset.i)]);
      if (!chosen.length) throw new Error('Nenhuma movimentação marcada.');
      const batch = [];
      const newRules = new Map();
      const importId = U.uid();
      const importedAt = Date.now();
      const importLabel = `${parsed.source || 'Extrato OFX'} · ${U.dateBR(parsed.start)} a ${U.dateBR(parsed.end)}`;
      const tag = { importId, importLabel, importedAt };
      for (const x of chosen) {
        if (x.out) {
          const categoryId = $(`select[data-cat="${x.i}"]`, f).value;
          if (!catById(categoryId)) throw new Error(`Escolha a categoria de "${x.desc}".`);
          batch.push({ kind: 'expense', bankKey: x.key, record: {
            id: U.uid(), month: x.date.slice(0, 7), date: x.date, description: x.desc, amountCents: x.cents,
            categoryId, payment: ofxPayment(x.memo, x.type), source: 'ofx', createdAt: Date.now(), ...tag } });
          const k = ofxLearnKey(x.memo);
          if (k) newRules.set(k, { key: k, categoryId, updatedAt: Date.now() });
        } else {
          batch.push({ kind: 'income', bankKey: x.key, record: {
            id: U.uid(), month: x.date.slice(0, 7), kind: 'extra', description: x.desc, amountCents: x.cents,
            source: 'ofx', createdAt: Date.now(), ...tag } });
        }
      }
      const r = await DB.importBank(batch, [...newRules.values()]);
      askPersistentStorage();
      const months = [...new Set(chosen.map((x) => x.date.slice(0, 7)))].sort();
      if (months.length) state.month = months[months.length - 1];
      return `Importado: ${r.exp} gasto(s)${r.inc ? ` e ${r.inc} receita(s)` : ''}${r.skipped ? `. ${r.skipped} já existia(m) e foi(ram) pulada(s)` : ''}.`;
    },
  });
  dlg.classList.add('wide');
  dlg.addEventListener('close', () => dlg.classList.remove('wide'), { once: true });

  const go = $('#ofxGo', form);
  const count = () => {
    const n = $$('input[data-i]:checked', form).length;
    go.textContent = n ? `Importar (${n})` : 'Importar';
    const all = $('#ofxAll', form);
    if (all) {
      const boxes = $$('.ofx-list input[data-i]:not(:disabled)', form).filter((c) => items[Number(c.dataset.i)].out);
      all.checked = boxes.length > 0 && boxes.every((c) => c.checked);
    }
  };
  form.addEventListener('change', (e) => {
    if (e.target.id === 'ofxAll') {
      $$('input[data-i]:not(:disabled)', form).forEach((c) => {
        if (items[Number(c.dataset.i)].out) c.checked = e.target.checked;
      });
    }
    if (e.target.matches('select[data-cat]')) {
      const box = $(`input[data-i="${e.target.dataset.cat}"]`, form);
      if (box && !box.disabled) box.checked = true;
    }
    count();
  });
  count();
}

const OfxActions = {
  'ofx-import': () => ofxStartForm(),
};
