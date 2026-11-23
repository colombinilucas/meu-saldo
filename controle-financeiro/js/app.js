'use strict';
/* Telas e ações do app. */

const PAGAMENTOS = ['Pix', 'Débito', 'Crédito', 'Dinheiro', 'Boleto', 'Outro'];
const CATS_SUGERIDAS = [
  ['moradia', 'Moradia'], ['mercado', 'Mercado'], ['transporte', 'Transporte'],
  ['saude', 'Saúde'], ['lazer', 'Lazer'], ['contas', 'Contas da casa'], ['outros', 'Outros'],
];
const CAT_OUTROS = 'outros';
const REST_COLOR = '#a3aaa6';

const state = {
  month: U.thisMonth(),
  view: 'inicio',
  filterCat: '',
  categories: [],
  expenses: [],
  incomes: [],
  recurring: [],
  docs: [],
  goals: [],
  goalMoves: [],
  docScope: 'mes',
  docKind: '',
  histYear: null,
  lastBackup: null,
  installPrompt: null,
  histOpen: new Set(),
  carryOver: true,
  lineMode: 'dia',
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = U.esc;
const viewEl = $('#view');
const dlg = $('#dlg');
const confirmDlg = $('#confirm');

/* ---------------- Dados ---------------- */

async function reload() {
  const [cats, exps, incs, recs, docs, goals, moves] = await Promise.all([
    DB.getAll('categories'), DB.getAll('expenses'), DB.getAll('incomes'), DB.getAll('recurring'),
    DB.getAll('docs'), DB.getAll('goals'), DB.getAll('goalMoves'),
  ]);
  state.lastBackup = (await DB.get('settings', 'lastBackup'))?.value || null;
  state.carryOver = (await DB.get('settings', 'carryOver'))?.value !== false;
  state.docs = docs;
  state.goals = goals;
  state.goalMoves = moves;
  state.categories = cats.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'pt-BR'));
  state.expenses = exps;
  state.incomes = incs;
  state.recurring = recs.sort((a, b) => a.day - b.day || a.description.localeCompare(b.description, 'pt-BR'));
}

async function refresh() {
  await reload();
  render();
}

async function seedCategories() {
  const seeded = await DB.get('settings', 'categoriesSeeded');
  if (seeded) return;
  await DB.putMany('categories', CATS_SUGERIDAS.map(([id, name], i) => ({ id, name, limitCents: 0, order: i })));
  await DB.put('settings', { key: 'categoriesSeeded', value: true });
}

let askedPersist = false;
function askPersistentStorage() {
  // Pede ao navegador para não apagar os dados sozinho quando faltar espaço.
  if (askedPersist) return;
  askedPersist = true;
  try { navigator.storage?.persist?.(); } catch (e) { /* opcional */ }
}

const catById = (id) => state.categories.find((c) => c.id === id);
const catName = (id) => catById(id)?.name || 'Sem categoria';
const catColor = (id) => {
  const i = state.categories.findIndex((c) => c.id === id);
  return Charts.PALETTE[(i < 0 ? 0 : i) % Charts.PALETTE.length];
};

function monthData(m) {
  const exps = state.expenses.filter((e) => e.month === m)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  const incs = state.incomes.filter((i) => i.month === m);
  const salary = incs.find((i) => i.kind === 'salario');
  const extras = incs.filter((i) => i.kind !== 'salario');
  const received = incs.reduce((s, i) => s + i.amountCents, 0);
  const spent = exps.reduce((s, e) => s + e.amountCents, 0);
  const saved = state.goalMoves.filter((g) => g.month === m).reduce((s, g) => s + g.amountCents, 0);
  return { exps, salary, extras, received, spent, saved, balance: received - spent - saved };
}

/** Quanto sobrou (ou faltou) somando todos os meses anteriores a m. */
function carryIn(m) {
  if (!state.carryOver) return 0;
  const months = new Set();
  for (const list of [state.expenses, state.incomes, state.goalMoves]) for (const o of list) if (o.month < m) months.add(o.month);
  let c = 0;
  for (const x of months) c += monthData(x).balance;
  return c;
}

function byCategory(exps) {
  const map = new Map();
  for (const e of exps) map.set(e.categoryId, (map.get(e.categoryId) || 0) + e.amountCents);
  return state.categories.map((cat) => {
    const spent = map.get(cat.id) || 0;
    return { cat, spent, st: limitStatus(spent, cat.limitCents) };
  });
}

function limitStatus(spent, limit) {
  if (!limit) return null;
  const pct = spent / limit;
  return { pct, level: pct > 1 ? 'over' : pct >= 0.8 ? 'warn' : 'ok' };
}

function pendingRecurring(m) {
  return state.recurring.filter((r) => r.active && r.startMonth <= m
    && !state.expenses.some((e) => e.recurringId === r.id && e.month === m));
}

function defaultDate(m) {
  const t = U.today();
  return t.slice(0, 7) === m ? t : `${m}-01`;
}

/* ---------------- Telas ---------------- */

function render() {
  $('#monthLabel').textContent = U.monthLabel(state.month);
  $$('.tab, #settingsBtn').forEach((t) => {
    if (t.dataset.view === state.view) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  const screens = { inicio: renderHome, gastos: renderExpenses, resumo: renderSummary,
    cofre: renderCofre, docs: renderDocs, ajustes: renderSettings };
  viewEl.innerHTML = (screens[state.view] || renderHome)();
  $('#fab').hidden = !['inicio', 'gastos', 'resumo'].includes(state.view);
  if (state.view === 'ajustes') showPersistInfo();
}

function avatar(categoryId) {
  const name = catName(categoryId);
  return `<span class="avatar" style="background:${catColor(categoryId)}" aria-hidden="true">${esc(name.charAt(0).toUpperCase())}</span>`;
}

function demoTag(o) {
  return o.demo ? ' <span class="tag">exemplo</span>' : '';
}

function expenseRow(e) {
  return `<li><button type="button" class="row row-btn" data-act="edit-expense" data-id="${esc(e.id)}">
    ${avatar(e.categoryId)}
    <span class="row-main">
      <span class="row-title">${esc(e.description)}${e.recurringId ? ' <span class="tag">fixa</span>' : ''}${e.source === 'ofx' ? ' <span class="tag">extrato</span>' : ''}${e.installmentGroup ? ' <span class="tag">parcela</span>' : ''}${demoTag(e)}</span>
      <span class="muted small">${U.dateBR(e.date)} · ${esc(catName(e.categoryId))} · ${esc(e.payment)}</span>
    </span>
    <span class="amount">${U.money(e.amountCents)}</span>
  </button></li>`;
}

function renderHome() {
  const d = monthData(state.month);
  const pend = pendingRecurring(state.month);
  const limits = byCategory(d.exps).filter((x) => x.st);
  const carry = carryIn(state.month);
  const available = carry + d.balance;
  const used = d.spent + Math.max(0, d.saved);
  const pctUsed = d.received > 0 ? Math.round((used / d.received) * 100) : 0;
  const meterLevel = used > d.received ? 'over' : pctUsed >= 80 ? 'warn' : '';
  let h = '';

  h += `<section class="card hero" aria-labelledby="heroLabel">
    <p class="hero-label" id="heroLabel">${available < 0 ? 'Saldo negativo' : 'Saldo disponível'}</p>
    <p class="hero-value ${available < 0 ? 'neg' : ''}">${U.money(available)}</p>
    ${carry ? `<p class="carry">${carry > 0 ? 'Inclui' : 'Desconta'} <b>${U.money(Math.abs(carry))}</b> que ${carry > 0 ? 'sobrou' : 'faltou'} dos meses anteriores · só este mês: ${U.money(d.balance)}</p>` : ''}
    ${d.received > 0 ? `
      <div class="meter" aria-hidden="true"><span class="${meterLevel}" style="width:${Math.min(100, pctUsed)}%"></span></div>
      <p class="muted small">${pctUsed}% do que entrou já foi gasto ou guardado</p>` : ''}
    <div class="hero-grid three">
      <div><span class="muted small">Recebido</span><strong>${U.money(d.received)}</strong></div>
      <div><span class="muted small">Gasto</span><strong>${U.money(d.spent)}</strong></div>
      <button type="button" class="hero-cell" data-act="goto" data-view="cofre"><span class="muted small">Guardado</span><strong>${U.money(d.saved)}</strong></button>
    </div>
    ${d.salary
      ? `<button type="button" class="btn secondary block" data-act="income">Salário: ${U.money(d.salary.amountCents)} · Editar</button>`
      : `<button type="button" class="btn primary block" data-act="income">Informar salário do mês</button>`}
  </section>`;

  if (pend.length) {
    h += `<section class="card">
      <div class="card-head"><h2>Contas fixas a lançar</h2>
        ${pend.length > 1 ? '<button type="button" class="btn small secondary" data-act="launch-all">Lançar todas</button>' : ''}
      </div>
      <ul class="list">${pend.map((r) => `<li class="row">
        <span class="row-main"><span class="row-title">${esc(r.description)}${demoTag(r)}</span>
          <span class="muted small">Dia ${r.day} · ${esc(catName(r.categoryId))}</span></span>
        <span class="amount">${U.money(r.amountCents)}</span>
        <button type="button" class="btn small" data-act="launch" data-id="${esc(r.id)}">Lançar</button>
      </li>`).join('')}</ul>
    </section>`;
  }

  if (limits.length) h += limitsCard(limits, true);

  if (d.exps.length) {
    const cats = byCategory(d.exps).filter((x) => x.spent > 0).sort((a, b) => b.spent - a.spent);
    const top = cats.slice(0, 4);
    const rest = cats.slice(4).reduce((s, x) => s + x.spent, 0);
    h += `<section class="card">
      <div class="card-head"><h2>Para onde foi o dinheiro</h2>
        <button type="button" class="btn small secondary" data-act="goto" data-view="resumo">Ver resumo</button></div>
      <div class="donut-wrap">
        ${Charts.donut([...top.map((x) => ({ label: x.cat.name, value: x.spent, color: catColor(x.cat.id) })),
          ...(rest ? [{ label: 'Demais', value: rest, color: REST_COLOR }] : [])], U.money(d.spent), 'gasto')}
        <ul class="legend-list">${top.map((x) => `<li><i style="background:${catColor(x.cat.id)}"></i>
          <span>${esc(x.cat.name)}</span><strong>${U.money(x.spent)}</strong></li>`).join('')}
          ${rest ? `<li><i style="background:${REST_COLOR}"></i><span>Demais</span><strong>${U.money(rest)}</strong></li>` : ''}</ul>
      </div>
    </section>`;
  }

  const parc = activeInstallments(state.month);
  if (parc.length) {
    h += `<section class="card">
      <div class="card-head"><h2>Parcelas</h2><span class="muted small">${U.money(parc.reduce((t, g) => t + g.thisMonth, 0))} neste mês</span></div>
      <ul class="list">${parc.map((g) => `<li><button type="button" class="row row-btn" data-act="edit-expense" data-id="${esc(g.current.id)}">
        ${avatar(g.current.categoryId)}
        <span class="row-main"><span class="row-title">${esc(g.name)}</span>
          <span class="muted small">Parcela ${g.current.installmentNo}/${g.total} · ${g.left ? `faltam ${g.left} (${U.money(g.leftCents)}) até ${monthShort(g.lastMonth)}` : 'última parcela'}</span></span>
        <span class="amount">${U.money(g.thisMonth)}</span>
      </button></li>`).join('')}</ul>
    </section>`;
  }

  h += `<section class="card">
    <div class="card-head"><h2>Últimos gastos</h2>
      ${d.exps.length > 5 ? '<button type="button" class="btn small secondary" data-act="goto" data-view="gastos">Ver todos</button>' : ''}
    </div>
    ${d.exps.length
      ? `<ul class="list">${d.exps.slice(0, 5).map(expenseRow).join('')}</ul>`
      : '<p class="empty">Nenhum gasto neste mês. Toque em <b>+ Gasto</b> para lançar o primeiro.</p>'}
  </section>
  ${backupDue() ? `<button type="button" class="reminder" data-act="goto" data-view="ajustes">💾 ${state.lastBackup
    ? `Seu último backup foi em ${new Date(state.lastBackup).toLocaleDateString('pt-BR')}.` : 'Você ainda não fez nenhum backup.'} Toque para fazer agora.</button>` : ''}
  <p class="note">🔒 Seus dados ficam só neste aparelho. Nada é enviado para a internet.</p>`;
  return h;
}

function limitsCard(list, compact) {
  const rows = list.slice().sort((a, b) => b.st.pct - a.st.pct).map((x) => {
    const lim = x.cat.limitCents;
    const left = lim - x.spent;
    const lvl = x.st.level;
    return `<li>
      <div class="cat-top"><span><i class="dot" style="background:${catColor(x.cat.id)}"></i>${esc(x.cat.name)}</span>
        <span><b>${U.money(x.spent)}</b> <span class="muted">de ${U.money(lim)}</span></span></div>
      <div class="meter" aria-hidden="true"><span class="${lvl === 'ok' ? '' : lvl}" style="width:${Math.min(100, x.st.pct * 100)}%"></span></div>
      <span class="small ${lvl === 'over' ? 'text-over' : lvl === 'warn' ? 'text-warn' : 'muted'}">${lvl === 'over'
        ? `Passou ${U.money(-left)} do limite` : `${Math.round(x.st.pct * 100)}% usado · restam ${U.money(left)}`}</span>
    </li>`;
  }).join('');
  return `<section class="card">
    <div class="card-head"><h2>Limites do mês</h2>
      <button type="button" class="btn small secondary" data-act="limits">${compact ? 'Ajustar' : 'Definir limites'}</button></div>
    ${rows ? `<ul class="limits">${rows}</ul>`
      : '<p class="empty">Nenhum limite definido ainda.<br>Escolha quanto quer gastar por mês em cada categoria e acompanhe quanto já usou.</p>'}
  </section>`;
}

function limitsForm() {
  openForm(`<h2>Limites por mês</h2>
    <p class="muted small">Quanto você quer gastar, no máximo, em cada categoria por mês. Deixe vazio para não ter limite. O app avisa ao chegar em 80% e quando passar.</p>
    <div class="limits-form">${state.categories.map((c) => `<label class="field inline lim"><span><i class="dot" style="background:${catColor(c.id)}"></i>${esc(c.name)}</span>
      <input name="lim-${esc(c.id)}" inputmode="decimal" autocomplete="off" placeholder="Sem limite" value="${c.limitCents ? U.moneyInput(c.limitCents) : ''}"></label>`).join('')}</div>
    ${actionsHtml(false)}`, {
    onSubmit: async (fd) => {
      const list = state.categories.map((c) => ({ ...c,
        limitCents: needMoney(fd.get(`lim-${c.id}`), `Limite de ${c.name}`, { allowEmpty: true }) }));
      await DB.putMany('categories', list);
      return 'Limites salvos.';
    },
  });
}

function isoDate(d) {
  return `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())}`;
}

/** Série do gráfico de linha: por dia do mês, por semana (12) ou por mês (12). */
function lineSeries(mode) {
  const m = state.month;
  if (mode === 'semana') {
    const last = `${m}-${U.pad(U.daysInMonth(m))}`;
    const end = U.today().slice(0, 7) === m ? U.today() : last;
    const [y, mo, d] = end.split('-').map(Number);
    const ed = new Date(y, mo - 1, d);
    const monday = new Date(y, mo - 1, d - ((ed.getDay() + 6) % 7));
    const out = [];
    for (let i = 11; i >= 0; i--) {
      const s = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * i);
      const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6);
      const si = isoDate(s); const ei = isoDate(e);
      out.push({ label: `${si.slice(8)}/${si.slice(5, 7)}`, full: `Semana de ${U.dateBR(si)} a ${U.dateBR(ei)}`,
        value: state.expenses.filter((x) => x.date >= si && x.date <= ei).reduce((t, x) => t + x.amountCents, 0) });
    }
    return out;
  }
  if (mode === 'mes') {
    const out = [];
    for (let i = 11; i >= 0; i--) {
      const mm = U.addMonths(m, -i);
      out.push({ label: U.MESES[Number(mm.slice(5)) - 1].slice(0, 3), full: U.monthLabel(mm), value: monthData(mm).spent });
    }
    return out;
  }
  const n = U.daysInMonth(m);
  const vals = Array(n).fill(0);
  for (const e of state.expenses) if (e.month === m) vals[Number(e.date.slice(8)) - 1] += e.amountCents;
  return vals.map((v, i) => ({ label: String(i + 1), full: `${U.pad(i + 1)}/${m.slice(5)}/${m.slice(0, 4)}`, value: v }));
}

function lineCard() {
  const m = state.month;
  const d = monthData(m);
  const days = m === U.thisMonth() ? Number(U.today().slice(8)) : m < U.thisMonth() ? U.daysInMonth(m) : 0;
  const perDay = days ? Math.round(d.spent / days) : 0;
  const daily = lineSeries('dia');
  const top = daily.reduce((a, p) => (p.value > a.value ? p : a), { value: 0 });
  const mode = state.lineMode;
  const series = mode === 'dia' ? daily : lineSeries(mode);
  const modes = [['dia', 'Por dia'], ['semana', 'Por semana'], ['mes', 'Por mês']];
  return `<section class="card">
    <h2>Gastos ao longo do tempo</h2>
    <div class="avg-cards">
      <div><span>Média por dia</span><b>${days ? U.money(perDay) : '—'}</b><small>${days ? `${days} dia(s) de ${U.MESES[Number(m.slice(5)) - 1]}` : 'mês futuro'}</small></div>
      <div><span>Média por semana</span><b>${days ? U.money(perDay * 7) : '—'}</b><small>média diária × 7</small></div>
      <div><span>Dia que mais gastou</span><b>${top.value ? U.money(top.value) : '—'}</b><small>${top.value ? top.full.slice(0, 5) : 'sem gastos'}</small></div>
    </div>
    <div class="seg line-seg" role="group" aria-label="Agrupar gastos">${modes.map(([k, t]) =>
      `<button type="button" data-act="line-mode" data-mode="${k}" aria-pressed="${mode === k}">${t}</button>`).join('')}</div>
    ${Charts.line(series)}
    <details class="vals"><summary>Ver valores</summary>
      <table class="detail-table"><tbody>${series.filter((p) => p.value).map((p) => `<tr><td>${esc(p.full)}</td><td>${U.money(p.value)}</td></tr>`).join('')
        || '<tr><td>Nenhum gasto no período.</td><td></td></tr>'}</tbody></table>
    </details>
  </section>`;
}

function importsList() {
  const map = new Map();
  for (const o of [...state.expenses.map((e) => ({ ...e, _k: 'g' })), ...state.incomes.map((i) => ({ ...i, _k: 'r' }))]) {
    if (!o.importId) continue;
    if (!map.has(o.importId)) map.set(o.importId, { id: o.importId, label: o.importLabel || 'Extrato importado', at: o.importedAt || 0, g: 0, r: 0, total: 0 });
    const it = map.get(o.importId);
    if (o._k === 'g') { it.g++; it.total += o.amountCents; } else it.r++;
  }
  return [...map.values()].sort((a, b) => b.at - a.at);
}

function importsHtml() {
  const list = importsList();
  if (!list.length) return '<p class="empty">Nenhum extrato importado ainda.</p>';
  return `<ul class="list">${list.map((x) => `<li class="row">
    <span class="row-main"><span class="row-title">${esc(x.label)}</span>
      <span class="muted small">${x.g} gasto(s) · ${U.money(x.total)}${x.r ? ` · ${x.r} receita(s)` : ''}${x.at ? ` · importado em ${new Date(x.at).toLocaleDateString('pt-BR')}` : ''}</span></span>
    <button type="button" class="btn small danger-link" data-act="import-undo" data-id="${esc(x.id)}">Desfazer</button>
  </li>`).join('')}</ul>`;
}

function backupDue() {
  const hasData = state.expenses.length + state.incomes.length + state.goals.length + state.docs.length > 0;
  return hasData && (!state.lastBackup || Date.now() - state.lastBackup > 30 * 24 * 3600 * 1000);
}

function isInstalled() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

function renderInstall() {
  if (isInstalled()) return '<p>✅ O app está instalado neste aparelho.</p>';
  if (location.protocol === 'file:') {
    return `<p class="muted small">A instalação fica disponível depois que o app for publicado na internet (endereço com https).
      Hoje ele está aberto direto do arquivo, só para testes.</p>`;
  }
  return `${state.installPrompt ? '<button type="button" class="btn primary" data-act="install">Instalar app</button>' : ''}
    <ul class="howto">
      <li><b>Android (Chrome):</b> menu ⋮ → <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</li>
      <li><b>iPhone (Safari):</b> botão Compartilhar (quadrado com seta) → <b>Adicionar à Tela de Início</b>.</li>
      <li><b>Computador (Chrome ou Edge):</b> ícone de instalar ⊕ no fim da barra de endereço.</li>
    </ul>`;
}

/** Compras parceladas com parcela no mês escolhido. */
function activeInstallments(m) {
  const groups = new Map();
  for (const e of state.expenses) {
    if (!e.installmentGroup) continue;
    if (!groups.has(e.installmentGroup)) groups.set(e.installmentGroup, []);
    groups.get(e.installmentGroup).push(e);
  }
  const out = [];
  for (const list of groups.values()) {
    const current = list.find((e) => e.month === m);
    if (!current) continue;
    const later = list.filter((e) => e.month > m);
    out.push({
      current, name: current.installmentName || current.description, total: current.installmentTotal,
      thisMonth: list.filter((e) => e.month === m).reduce((t, e) => t + e.amountCents, 0),
      left: later.length, leftCents: later.reduce((t, e) => t + e.amountCents, 0),
      lastMonth: list.reduce((a, e) => (e.month > a ? e.month : a), m),
    });
  }
  return out.sort((a, b) => b.thisMonth - a.thisMonth);
}

function renderExpenses() {
  const d = monthData(state.month);
  if (state.filterCat && !catById(state.filterCat)) state.filterCat = '';
  const list = state.filterCat ? d.exps.filter((e) => e.categoryId === state.filterCat) : d.exps;
  const total = list.reduce((s, e) => s + e.amountCents, 0);
  const groups = [];
  for (const e of list) {
    const last = groups[groups.length - 1];
    if (last && last.date === e.date) last.items.push(e); else groups.push({ date: e.date, items: [e] });
  }
  return `<button type="button" class="import-banner" data-act="ofx-import">
    <span class="import-ico" aria-hidden="true">⇩</span>
    <span class="row-main"><b>Importar extrato do banco</b>
      <span class="small">PDF do Itaú ou OFX. Você revisa antes de lançar.</span></span>
    <span aria-hidden="true">›</span>
  </button>
  ${importsList().length ? `<button type="button" class="link-row" data-act="imports">Extratos importados (${importsList().length}) · ver ou desfazer</button>` : ''}
  <section class="card">
    <div class="card-head"><h2>Gastos do mês</h2><strong>${U.money(total)}</strong></div>
    <label class="field inline"><span>Categoria</span>
      <select id="filterCat">
        <option value="">Todas</option>
        ${state.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === state.filterCat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
    </label>
    ${groups.length ? groups.map((g) => `<h3 class="day">${U.dayTitle(g.date)}</h3>
      <ul class="list">${g.items.map(expenseRow).join('')}</ul>`).join('')
      : `<p class="empty">${state.filterCat ? 'Nenhum gasto nesta categoria.' : 'Nenhum gasto neste mês.'}</p>`}
  </section>`;
}

function renderSummary() {
  const d = monthData(state.month);
  const rows = byCategory(d.exps).filter((x) => x.spent > 0 || x.cat.limitCents > 0)
    .sort((a, b) => b.spent - a.spent);
  const spentRows = rows.filter((x) => x.spent > 0);

  const catHtml = rows.map((x) => {
    const lim = x.cat.limitCents;
    const width = lim ? Math.min(100, (x.spent / lim) * 100) : (d.spent ? (x.spent / d.spent) * 100 : 0);
    let info;
    if (x.st?.level === 'over') info = `Passou ${U.money(x.spent - lim)} do limite`;
    else if (lim) info = `${Math.round(x.st.pct * 100)}% do limite · restam ${U.money(lim - x.spent)}`;
    else info = `${d.spent ? Math.round((x.spent / d.spent) * 100) : 0}% dos gastos do mês`;
    return `<li class="cat">
      <div class="cat-top"><span><i class="dot" style="background:${catColor(x.cat.id)}"></i>${esc(x.cat.name)}</span>
        <span><strong>${U.money(x.spent)}</strong>${lim ? ` <span class="muted">de ${U.money(lim)}</span>` : ''}</span></div>
      <div class="meter" aria-hidden="true"><span class="${x.st ? x.st.level : ''}" style="width:${width}%;${x.st && x.st.level !== 'ok' ? '' : `background:${catColor(x.cat.id)}`}"></span></div>
      <span class="muted small ${x.st?.level === 'over' ? 'text-over' : x.st?.level === 'warn' ? 'text-warn' : ''}">${info}</span>
    </li>`;
  }).join('');

  const last6 = [];
  for (let i = 5; i >= 0; i--) {
    const m = U.addMonths(state.month, -i);
    const x = monthData(m);
    last6.push({ month: m, received: x.received, spent: x.spent, saved: Math.max(0, x.saved) });
  }

  // Tabela do ano
  const years = new Set([Number(state.month.slice(0, 4)), new Date().getFullYear()]);
  [...state.expenses, ...state.incomes, ...state.goalMoves].forEach((o) => years.add(Number(o.month.slice(0, 4))));
  const year = state.histYear && years.has(state.histYear) ? state.histYear : Number(state.month.slice(0, 4));
  const tot = { received: 0, spent: 0, saved: 0, balance: 0 };
  const trs = [];
  for (let mo = 1; mo <= 12; mo++) {
    const m = `${year}-${U.pad(mo)}`;
    const x = monthData(m);
    const empty = !x.received && !x.spent && !x.saved;
    if (empty && m !== state.month) continue;
    tot.received += x.received; tot.spent += x.spent; tot.saved += x.saved; tot.balance += x.balance;
    const open = state.histOpen.has(m);
    trs.push(`<tr class="${m === state.month ? 'current' : ''} ${open ? 'open' : ''}">
      <th scope="row"><button type="button" class="expander" data-act="hist-toggle" data-month="${m}" aria-expanded="${open}"
        aria-label="${open ? 'Fechar' : 'Abrir'} detalhes de ${U.monthLabel(m)}"><span class="chev" aria-hidden="true">▸</span>${U.MESES[mo - 1].slice(0, 3)}</button></th>
      <td>${U.moneyPlain(x.received)}</td><td>${U.moneyPlain(x.spent)}</td><td>${U.moneyPlain(x.saved)}</td>
      <td class="${x.balance < 0 ? 'neg' : ''}"><strong>${U.moneyPlain(x.balance)}</strong></td></tr>`);
    if (open) trs.push(`<tr class="detail-row"><td colspan="5">${monthDetail(m)}</td></tr>`);
  }

  return `${limitsCard(byCategory(d.exps).filter((x) => x.st), false)}
  <section class="card">
    <div class="card-head"><h2>Gastos por categoria</h2><strong>${U.money(d.spent)}</strong></div>
    ${spentRows.length ? `<div class="donut-wrap center">${Charts.donut(spentRows.map((x) => ({ label: x.cat.name, value: x.spent, color: catColor(x.cat.id) })), U.money(d.spent), U.monthLabel(state.month).split(' ')[0].toLowerCase())}</div>` : ''}
    ${rows.length ? `<ul class="cats">${catHtml}</ul>` : '<p class="empty">Sem gastos neste mês.</p>'}
  </section>

  ${lineCard()}

  <section class="card">
    <h2>Últimos 6 meses</h2>
    ${Charts.monthBars(last6)}
  </section>

  <section class="card">
    <div class="card-head"><h2>Tabela do ano</h2>
      <label class="field inline compact"><span class="sr-only">Ano</span>
        <select id="histYear">${[...years].sort((a, b) => b - a).map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
    </div>
    <p class="muted small">Valores em R$. Toque num mês para ver o detalhamento com cada gasto.</p>
    <div class="btn-row table-tools">
      <button type="button" class="btn small secondary" data-act="hist-all" data-year="${year}">${trs.some((t) => t.includes('detail-row')) ? 'Fechar todos' : 'Abrir todos'}</button>
      <button type="button" class="btn small secondary" data-act="csv" data-year="${year}">Baixar planilha (CSV)</button>
    </div>
    <div class="table-wrap"><table class="hist">
      <thead><tr><th scope="col">Mês</th><th scope="col">Entrou</th><th scope="col">Gastou</th><th scope="col">Guardou</th><th scope="col">Sobrou</th></tr></thead>
      <tbody>${trs.join('')}</tbody>
      <tfoot><tr><th scope="row">Total</th><td>${U.moneyPlain(tot.received)}</td><td>${U.moneyPlain(tot.spent)}</td><td>${U.moneyPlain(tot.saved)}</td>
        <td class="${tot.balance < 0 ? 'neg' : ''}"><strong>${U.moneyPlain(tot.balance)}</strong></td></tr></tfoot>
    </table></div>
  </section>`;
}

function monthDetail(m) {
  const x = monthData(m);
  const cats = byCategory(x.exps).filter((c) => c.spent > 0).sort((a, b) => b.spent - a.spent);
  const moves = state.goalMoves.filter((g) => g.month === m).sort((a, b) => a.date.localeCompare(b.date));
  const incs = [...(x.salary ? [x.salary] : []), ...x.extras];
  const exps = x.exps.slice().sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
  const biggest = exps.reduce((a, e) => (!a || e.amountCents > a.amountCents ? e : a), null);
  const days = m === U.thisMonth() ? Number(U.today().slice(8)) : m > U.thisMonth() ? 0 : U.daysInMonth(m);
  const count = (id) => exps.filter((e) => e.categoryId === id).length;
  return `<div class="detail">
    <div class="detail-stats">
      <div><span>Gastos</span><b>${exps.length}</b></div>
      <div><span>Média por dia</span><b>${days && x.spent ? U.money(Math.round(x.spent / days)) : '—'}</b></div>
      <div><span>Maior gasto</span><b>${biggest ? U.money(biggest.amountCents) : '—'}</b>${biggest ? `<small>${esc(biggest.description)}</small>` : ''}</div>
    </div>
    ${state.carryOver ? `<p class="small acc">Saldo acumulado no fim do mês: <b class="${carryIn(m) + x.balance < 0 ? 'neg' : ''}">${U.money(carryIn(m) + x.balance)}</b></p>` : ''}
    ${incs.length ? `<h4>Receitas</h4><ul class="mini-list">${incs.map((i) => `<li><span>${esc(i.description)}</span><b class="pos">+ ${U.money(i.amountCents)}</b></li>`).join('')}</ul>` : ''}
    ${cats.length ? `<h4>Por categoria</h4><ul class="mini-list">${cats.map((c) => `<li><span><i class="dot" style="background:${catColor(c.cat.id)}"></i>${esc(c.cat.name)}
      <small class="muted">${count(c.cat.id)} gasto(s) · ${Math.round((c.spent / x.spent) * 100)}%${c.st ? ` · limite ${U.money(c.cat.limitCents)}` : ''}</small></span>
      <b class="${c.st?.level === 'over' ? 'neg' : ''}">${U.money(c.spent)}</b></li>`).join('')}</ul>` : ''}
    ${exps.length ? `<h4>Todos os gastos</h4>
      <table class="detail-table"><thead><tr><th scope="col">Dia</th><th scope="col">Gasto</th><th scope="col">Valor</th></tr></thead>
      <tbody>${exps.map((e) => `<tr>
        <td>${e.date.slice(8)}/${e.date.slice(5, 7)}</td>
        <td><button type="button" class="link plain" data-act="edit-expense" data-id="${esc(e.id)}">${esc(e.description)}</button>
          <small><i class="dot" style="background:${catColor(e.categoryId)}"></i>${esc(catName(e.categoryId))} · ${esc(e.payment)}</small></td>
        <td>${U.money(e.amountCents)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td></td><td>Total</td><td>${U.money(x.spent)}</td></tr></tfoot></table>`
      : '<p class="muted small">Nenhum gasto neste mês.</p>'}
    ${moves.length ? `<h4>Cofre</h4><ul class="mini-list">${moves.map((g) => `<li><span>${U.dateBR(g.date)} · ${esc(state.goals.find((o) => o.id === g.goalId)?.name || 'Objetivo')}</span>
      <b>${g.amountCents >= 0 ? 'guardou' : 'retirou'} ${U.money(Math.abs(g.amountCents))}</b></li>`).join('')}</ul>` : ''}
    <button type="button" class="btn small secondary" data-act="goto-month" data-month="${m}">Abrir ${U.monthLabel(m).toLowerCase()} no Início</button>
  </div>`;
}

function downloadCsv(year) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Tipo', 'Data', 'Descrição', 'Categoria', 'Pagamento', 'Valor (R$)'].map(q).join(';')];
  const inYear = (o) => o.month.startsWith(`${year}-`);
  const rows = [
    ...state.incomes.filter(inYear).map((i) => ['Receita', `${i.month}-01`, i.description, '', '', i.amountCents]),
    ...state.expenses.filter(inYear).map((e) => ['Gasto', e.date, e.description, catName(e.categoryId), e.payment, -e.amountCents]),
    ...state.goalMoves.filter(inYear).map((g) => ['Cofre', g.date, state.goals.find((o) => o.id === g.goalId)?.name || 'Objetivo', '', '', -g.amountCents]),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  for (const r of rows) {
    lines.push([r[0], U.dateBR(r[1]), /^[=+\-@]/.test(r[2]) ? `'${r[2]}` : r[2], r[3], r[4], U.moneyPlain(r[5]).replace(/\./g, '')].map(q).join(';'));
  }
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  docDownload(url, `meu-saldo-${year}.csv`);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return rows.length;
}

function renderSettings() {
  const hasDemo = [...state.expenses, ...state.incomes, ...state.recurring, ...state.goals, ...state.goalMoves].some((o) => o.demo);
  return `<section class="card">
    <h2>Backup</h2>
    <p>Seus dados ficam <b>só neste aparelho e neste navegador</b>. Não vão para a internet e não aparecem sozinhos em outro aparelho.</p>
    <p class="muted small">Para guardar uma cópia ou levar tudo para outro aparelho (celular ↔ computador), baixe o backup aqui e importe-o no outro. O arquivo inclui os documentos.</p>
    <p class="small ${backupDue() ? 'text-warn' : 'muted'}">${state.lastBackup ? `Último backup: ${new Date(state.lastBackup).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : 'Nenhum backup feito ainda neste aparelho.'}</p>
    <div class="btn-row">
      <button type="button" class="btn primary" data-act="backup-export">Baixar backup</button>
      <button type="button" class="btn secondary" data-act="backup-import">Importar backup</button>
    </div>
  </section>

  <section class="card">
    <h2>Saldo entre meses</h2>
    <label class="check"><input type="checkbox" id="carryToggle" ${state.carryOver ? 'checked' : ''}>
      Levar o que sobrou (ou faltou) para o mês seguinte</label>
    <p class="muted small">Ligado: o Início mostra o saldo disponível somando as sobras dos meses anteriores. Desligado: cada mês começa do zero.</p>
  </section>

  <section class="card">
    <h2>Extratos importados</h2>
    <p class="muted small">Desfazer apaga só os lançamentos que vieram daquele extrato. Depois você pode importá-lo de novo.</p>
    ${importsHtml()}
  </section>

  <section class="card">
    <h2>Instalar no aparelho</h2>
    ${renderInstall()}
  </section>

  <section class="card">
    <div class="card-head"><h2>Categorias</h2>
      <button type="button" class="btn small secondary" data-act="new-cat">+ Nova</button></div>
    <p class="muted small">Toque numa categoria para renomear ou definir um limite por mês.</p>
    <ul class="list">${state.categories.map((c) => `<li><button type="button" class="row row-btn" data-act="edit-cat" data-id="${esc(c.id)}">
      <span class="row-main"><span class="row-title">${esc(c.name)}</span></span>
      <span class="muted small">${c.limitCents ? `Limite ${U.money(c.limitCents)}` : 'Sem limite'}</span>
    </button></li>`).join('')}</ul>
  </section>

  <section class="card">
    <div class="card-head"><h2>Contas fixas</h2>
      <button type="button" class="btn small secondary" data-act="new-rec">+ Nova</button></div>
    <p class="muted small">Contas que se repetem todo mês, como aluguel ou internet. Elas aparecem no Início para você lançar com um toque, uma vez por mês.</p>
    ${state.recurring.length ? `<ul class="list">${state.recurring.map((r) => `<li><button type="button" class="row row-btn" data-act="edit-rec" data-id="${esc(r.id)}">
      <span class="row-main"><span class="row-title">${esc(r.description)}${demoTag(r)}${r.active ? '' : ' <span class="tag">pausada</span>'}</span>
        <span class="muted small">Dia ${r.day} · ${esc(catName(r.categoryId))} · ${esc(r.payment)}</span></span>
      <span class="amount">${U.money(r.amountCents)}</span>
    </button></li>`).join('')}</ul>` : '<p class="empty">Nenhuma conta fixa cadastrada.</p>'}
  </section>

  <section class="card">
    <h2>Dados de exemplo</h2>
    <p class="muted small">Lançamentos fictícios para você experimentar o app. Eles aparecem com a marca <span class="tag">exemplo</span> e podem ser removidos quando quiser.</p>
    <div class="btn-row">
      <button type="button" class="btn secondary" data-act="load-demo">Carregar exemplos</button>
      ${hasDemo ? '<button type="button" class="btn danger" data-act="remove-demo">Remover exemplos</button>' : ''}
    </div>
  </section>

  <section class="card">
    <h2>Armazenamento</h2>
    <p class="muted small">Atenção: limpar os dados de navegação deste site apaga tudo, inclusive os documentos. Faça backups com frequência.</p>
    <p class="muted small" id="storageInfo"></p>
    <p class="muted small" id="persistInfo"></p>
  </section>`;
}

async function showPersistInfo() {
  const si = $('#storageInfo');
  if (si && navigator.storage?.estimate) {
    navigator.storage.estimate().then(({ usage, quota }) => {
      if (quota) si.textContent = `Espaço usado pelo app: ${fileSize(usage || 0)} de cerca de ${fileSize(quota)} disponíveis.`;
    }).catch(() => {});
  }
  const el = $('#persistInfo');
  if (!el || !navigator.storage?.persisted) return;
  try {
    const ok = await navigator.storage.persisted();
    el.textContent = ok
      ? 'O navegador marcou estes dados como permanentes.'
      : 'O navegador ainda não marcou estes dados como permanentes. Instalar o app ajuda a protegê-los.';
  } catch (e) { /* ignora */ }
}

/* ---------------- Janelas (formulários) ---------------- */

function catOptions(selected) {
  return state.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}
function payOptions(selected) {
  return PAGAMENTOS.map((p) => `<option ${p === selected ? 'selected' : ''}>${p}</option>`).join('');
}

/** Abre um formulário. onSubmit/onAction podem devolver uma mensagem (string) para mostrar
 *  ou false para manter a janela aberta. Erros aparecem dentro da janela. */
function openForm(html, { onSubmit, onAction } = {}) {
  dlg.innerHTML = `<form class="dlg-body" novalidate>${html}
    <p class="form-error" role="alert"></p></form>`;
  const form = $('form', dlg);
  const err = $('.form-error', dlg);
  const run = async (fn) => {
    err.textContent = '';
    try {
      const r = await fn();
      if (r === false) return;
      dlg.close();
      await refresh();
      if (typeof r === 'string') toast(r);
    } catch (ex) {
      err.textContent = ex?.message || String(ex);
    }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    run(() => onSubmit(new FormData(form), form));
  });
  $$('[data-x]', dlg).forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.x === 'cancel') { dlg.close(); return; }
    run(() => onAction(b.dataset.x, form));
  }));
  dlg.showModal();
  const first = $('input:not([type=hidden]), select', form);
  if (first) first.focus();
  return form;
}

function confirmBox(message, okLabel = 'Excluir', danger = true) {
  return new Promise((resolve) => {
    confirmDlg.innerHTML = `<div class="dlg-body">
      <p class="confirm-text">${message}</p>
      <div class="actions"><span class="grow"></span>
        <button type="button" class="btn secondary" data-c="no">Cancelar</button>
        <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-c="yes">${esc(okLabel)}</button>
      </div></div>`;
    let answer = false;
    $$('[data-c]', confirmDlg).forEach((b) => b.addEventListener('click', () => {
      answer = b.dataset.c === 'yes';
      confirmDlg.close();
    }));
    confirmDlg.addEventListener('close', () => resolve(answer), { once: true });
    confirmDlg.showModal();
    $('[data-c="no"]', confirmDlg).focus();
  });
}

const actionsHtml = (canDelete, deleteLabel = 'Excluir') => `<div class="actions">
  ${canDelete ? `<button type="button" class="btn danger-link" data-x="delete">${deleteLabel}</button>` : ''}
  <span class="grow"></span>
  <button type="button" class="btn secondary" data-x="cancel">Cancelar</button>
  <button type="submit" class="btn primary">Salvar</button>
</div>`;

function needMoney(value, label, { allowEmpty = false } = {}) {
  if (allowEmpty && !String(value || '').trim()) return 0;
  const c = U.parseMoney(value);
  if (c == null) throw new Error(`${label}: digite um valor válido, por exemplo 150,90.`);
  if (c <= 0 && !allowEmpty) throw new Error(`${label}: o valor precisa ser maior que zero.`);
  return c;
}
function needText(value, label) {
  const s = String(value || '').trim();
  if (!s) throw new Error(`Preencha o campo ${label}.`);
  return s.slice(0, 80);
}

/* Gasto (avulso ou parcelado) */
function installmentPlan(totalOrEach, mode, n) {
  if (mode === 'total') {
    const base = Math.floor(totalOrEach / n);
    const rest = totalOrEach - base * n;
    return Array.from({ length: n }, (_, i) => base + (i === 0 ? rest : 0));
  }
  return Array.from({ length: n }, () => totalOrEach);
}

function monthShort(m) {
  const [y, mo] = m.split('-');
  return `${U.MESES[Number(mo) - 1].slice(0, 3)}/${y}`;
}

function expenseForm(exp) {
  const e = exp || { description: '', amountCents: null, date: defaultDate(state.month),
    categoryId: state.categories[0]?.id, payment: 'Pix' };
  const isParc = !!exp?.installmentGroup;
  const groupSize = isParc ? state.expenses.filter((x) => x.installmentGroup === exp.installmentGroup).length : 0;
  const form = openForm(`<h2>${exp ? 'Editar gasto' : 'Novo gasto'}</h2>
    <label class="field"><span id="amountLabel">Valor (R$)</span>
      <input name="amount" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${U.moneyInput(e.amountCents)}"></label>
    <label class="field"><span>Descrição</span>
      <input name="description" maxlength="70" autocomplete="off" placeholder="Ex.: Supermercado" value="${esc(e.description)}"></label>
    <div class="two">
      <label class="field"><span id="dateLabel">Data</span><input type="date" name="date" value="${e.date}"></label>
      <label class="field"><span>Pagamento</span><select name="payment">${payOptions(e.payment)}</select></label>
    </div>
    <label class="field"><span>Categoria</span><select name="categoryId">${catOptions(e.categoryId)}</select></label>
    ${exp ? '' : `<label class="check"><input type="checkbox" name="parcelado" id="parcelado"> Compra parcelada (ex.: celular em 12x)</label>
    <div id="parcBox" class="parc-box" hidden>
      <div class="two">
        <label class="field"><span>Número de parcelas</span>
          <input name="nParc" type="number" min="2" max="72" inputmode="numeric" value="12"></label>
        <label class="field"><span>O valor digitado é</span>
          <select name="valorTipo"><option value="parcela">Cada parcela</option><option value="total">Total da compra</option></select></label>
      </div>
      <label class="field"><span>Esta data é da parcela nº</span>
        <input name="parcAtual" type="number" min="1" max="72" inputmode="numeric" value="1"></label>
      <p class="parc-preview" id="parcPreview" aria-live="polite"></p>
    </div>`}
    ${exp?.recurringId ? '<p class="muted small">Este gasto veio de uma conta fixa. Alterar aqui muda só este mês.</p>' : ''}
    ${isParc ? `<p class="parc-info">Parcela <b>${exp.installmentNo} de ${exp.installmentTotal}</b>. Alterar aqui muda só esta parcela.</p>` : ''}
    <div class="actions">
      ${exp ? '<button type="button" class="btn danger-link" data-x="delete">Excluir</button>' : ''}
      ${isParc && groupSize > 1 ? `<button type="button" class="btn danger-link" data-x="delete-group">Excluir as ${groupSize} parcelas</button>` : ''}
      <span class="grow"></span>
      <button type="button" class="btn secondary" data-x="cancel">Cancelar</button>
      <button type="submit" class="btn primary">Salvar</button>
    </div>`, {
    onSubmit: async (fd) => {
      const amountCents = needMoney(fd.get('amount'), 'Valor');
      const description = needText(fd.get('description'), 'Descrição').slice(0, 70);
      const date = fd.get('date');
      if (!U.isValidDate(date)) throw new Error('Escolha uma data válida.');
      const categoryId = fd.get('categoryId');
      if (!catById(categoryId)) throw new Error('Escolha uma categoria.');
      const payment = PAGAMENTOS.includes(fd.get('payment')) ? fd.get('payment') : 'Outro';

      if (!exp && fd.get('parcelado') === 'on') {
        const n = Number(fd.get('nParc'));
        if (!Number.isInteger(n) || n < 2 || n > 72) throw new Error('O número de parcelas deve ser de 2 a 72.');
        const atual = Number(fd.get('parcAtual'));
        if (!Number.isInteger(atual) || atual < 1 || atual > n) throw new Error(`A parcela da data escolhida deve ser de 1 a ${n}.`);
        const mode = fd.get('valorTipo') === 'total' ? 'total' : 'parcela';
        if (mode === 'total' && amountCents < n) throw new Error('O total é pequeno demais para tantas parcelas.');
        const plan = installmentPlan(amountCents, mode, n);
        const group = U.uid();
        const day = Number(date.slice(8));
        const list = [];
        for (let k = atual; k <= n; k++) {
          const m = U.addMonths(date.slice(0, 7), k - atual);
          const d = `${m}-${U.pad(Math.min(day, U.daysInMonth(m)))}`;
          list.push({ id: U.uid(), createdAt: Date.now() + k, updatedAt: Date.now(), month: m, date: d,
            description: `${description} (${k}/${n})`, amountCents: plan[k - 1], categoryId, payment,
            installmentGroup: group, installmentNo: k, installmentTotal: n, installmentName: description });
        }
        await DB.putMany('expenses', list);
        askPersistentStorage();
        return `${list.length} parcela(s) lançada(s), de ${monthShort(list[0].month)} a ${monthShort(list[list.length - 1].month)}.`;
      }

      const rec = { ...(exp || { id: U.uid(), createdAt: Date.now() }),
        description, amountCents, date, month: date.slice(0, 7), categoryId, payment, updatedAt: Date.now() };
      await DB.put('expenses', rec);
      askPersistentStorage();
      return rec.month === state.month ? 'Gasto salvo.' : `Gasto salvo em ${U.monthLabel(rec.month)}.`;
    },
    onAction: async (act) => {
      if (act === 'delete') {
        if (!await confirmBox(`Excluir o gasto <b>${esc(exp.description)}</b> de ${U.money(exp.amountCents)}?`)) return false;
        await DB.del('expenses', exp.id);
        return 'Gasto excluído.';
      }
      if (act === 'delete-group') {
        const all = state.expenses.filter((x) => x.installmentGroup === exp.installmentGroup);
        const total = all.reduce((t, x) => t + x.amountCents, 0);
        if (!await confirmBox(`Excluir <b>todas as ${all.length} parcelas</b> de <b>${esc(exp.installmentName || exp.description)}</b> (${U.money(total)} no total)?<br>Elas somem de todos os meses.`, 'Excluir todas')) return false;
        await DB.delMany('expenses', all.map((x) => x.id));
        return `${all.length} parcelas excluídas.`;
      }
      return false;
    },
  });

  if (!exp) {
    const box = $('#parcBox', form);
    const preview = $('#parcPreview', form);
    const upd = () => {
      const on = form.elements.parcelado.checked;
      box.hidden = !on;
      $('#dateLabel', form).textContent = on ? 'Data da parcela' : 'Data';
      if (!on) return;
      const n = Number(form.elements.nParc.value);
      const atual = Number(form.elements.parcAtual.value) || 1;
      const cents = U.parseMoney(form.elements.amount.value);
      const date = form.elements.date.value;
      if (!cents || !Number.isInteger(n) || n < 2 || n > 72 || !U.isValidDate(date) || atual < 1 || atual > n) {
        preview.textContent = 'Preencha valor, data e número de parcelas para ver o resumo.';
        return;
      }
      const plan = installmentPlan(cents, form.elements.valorTipo.value, n);
      const total = plan.reduce((t, v) => t + v, 0);
      const first = date.slice(0, 7);
      const last = U.addMonths(first, n - atual);
      preview.innerHTML = `<b>${n}x de ${U.money(plan[n - 1])}</b> · total ${U.money(total)}<br>
        ${atual > 1 ? `Lança da parcela ${atual} até a ${n}: ` : 'Lança '}${n - atual + 1} parcela(s), de ${monthShort(first)} a ${monthShort(last)}.`;
    };
    form.elements.parcelado.addEventListener('change', () => {
      if (form.elements.parcelado.checked) form.elements.payment.value = 'Crédito';
      upd();
    });
    form.addEventListener('input', upd);
    form.addEventListener('change', upd);
  }
}

/* Salário e outras receitas */
function incomeForm() {
  const m = state.month;
  const d = monthData(m);
  const prev = monthData(U.addMonths(m, -1)).salary;
  const salaryValue = d.salary ? d.salary.amountCents : prev ? prev.amountCents : null;
  let extras = d.extras.map((x) => ({ ...x }));

  const form = openForm(`<h2>Receitas de ${U.monthLabel(m)}</h2>
    <label class="field"><span>Salário (R$)</span>
      <input name="salary" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${U.moneyInput(salaryValue)}"></label>
    ${!d.salary && prev ? '<p class="muted small">Preenchido com o salário do mês anterior. Confira e salve.</p>' : ''}
    <fieldset class="extras"><legend>Outras receitas (opcional)</legend>
      <ul class="list" id="extrasList"></ul>
      <div class="two add-extra">
        <label class="field"><span>Descrição</span><input id="exDesc" maxlength="80" placeholder="Ex.: Freela"></label>
        <label class="field"><span>Valor (R$)</span><input id="exVal" inputmode="decimal" placeholder="0,00"></label>
      </div>
      <button type="button" class="btn small secondary" id="exAdd">+ Adicionar receita</button>
    </fieldset>
    ${actionsHtml(false)}`, {
    onSubmit: async (fd) => {
      const raw = String(fd.get('salary') || '').trim();
      const list = [];
      if (raw) {
        const amountCents = needMoney(raw, 'Salário');
        list.push({ ...(d.salary || { createdAt: Date.now() }), id: `sal-${m}`, month: m, kind: 'salario',
          description: 'Salário', amountCents, demo: d.salary?.demo && d.salary.amountCents === amountCents ? true : undefined });
      }
      if ($('#exDesc', form).value.trim() || $('#exVal', form).value.trim()) {
        throw new Error('Você digitou uma receita e não adicionou. Toque em "+ Adicionar receita" ou apague os campos.');
      }
      list.push(...extras);
      await DB.saveIncomes(m, list);
      askPersistentStorage();
      return 'Receitas salvas.';
    },
  });

  const listEl = $('#extrasList', form);
  const draw = () => {
    listEl.innerHTML = extras.length ? extras.map((x, i) => `<li class="row">
      <span class="row-main"><span class="row-title">${esc(x.description)}</span></span>
      <span class="amount">${U.money(x.amountCents)}</span>
      <button type="button" class="btn small danger-link" data-rm="${i}" aria-label="Remover ${esc(x.description)}">Remover</button>
    </li>`).join('') : '<li class="muted small">Nenhuma outra receita.</li>';
  };
  draw();
  listEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    extras.splice(Number(b.dataset.rm), 1);
    draw();
  });
  $('#exAdd', form).addEventListener('click', () => {
    const err = $('.form-error', dlg);
    try {
      const description = needText($('#exDesc', form).value, 'Descrição da receita');
      const amountCents = needMoney($('#exVal', form).value, 'Valor da receita');
      extras.push({ id: U.uid(), month: m, kind: 'extra', description, amountCents, createdAt: Date.now() });
      $('#exDesc', form).value = '';
      $('#exVal', form).value = '';
      err.textContent = '';
      draw();
    } catch (ex) { err.textContent = ex.message; }
  });
}

/* Categoria */
function categoryForm(cat) {
  openForm(`<h2>${cat ? 'Editar categoria' : 'Nova categoria'}</h2>
    <label class="field"><span>Nome</span>
      <input name="name" maxlength="40" autocomplete="off" value="${esc(cat?.name || '')}"></label>
    <label class="field"><span>Limite por mês (R$)</span>
      <input name="limit" inputmode="decimal" autocomplete="off" placeholder="Deixe vazio para não ter limite" value="${cat?.limitCents ? U.moneyInput(cat.limitCents) : ''}"></label>
    <p class="muted small">Você será avisado ao chegar em 80% do limite e quando passar dele.</p>
    ${actionsHtml(cat && cat.id !== CAT_OUTROS)}`, {
    onSubmit: async (fd) => {
      const name = needText(fd.get('name'), 'Nome').slice(0, 40);
      const dup = state.categories.find((c) => c.id !== cat?.id && c.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'));
      if (dup) throw new Error('Já existe uma categoria com esse nome.');
      const limitCents = needMoney(fd.get('limit'), 'Limite', { allowEmpty: true });
      const order = cat ? cat.order : Math.max(0, ...state.categories.map((c) => c.order ?? 0)) + 1;
      await DB.put('categories', { ...(cat || { id: U.uid() }), name, limitCents, order });
      return 'Categoria salva.';
    },
    onAction: async (act) => {
      if (act !== 'delete') return false;
      const n = state.expenses.filter((e) => e.categoryId === cat.id).length
        + state.recurring.filter((r) => r.categoryId === cat.id).length;
      const extra = n ? `<br>${n} lançamento(s) dela vão para <b>${esc(catName(CAT_OUTROS))}</b>. Nenhum gasto será apagado.` : '';
      if (!await confirmBox(`Excluir a categoria <b>${esc(cat.name)}</b>?${extra}`)) return false;
      await DB.deleteCategory(cat.id, CAT_OUTROS);
      return 'Categoria excluída.';
    },
  });
}

/* Conta fixa */
function recurringForm(rec) {
  const r = rec || { description: '', amountCents: null, day: 10, categoryId: state.categories[0]?.id,
    payment: 'Boleto', active: true, startMonth: state.month };
  openForm(`<h2>${rec ? 'Editar conta fixa' : 'Nova conta fixa'}</h2>
    <label class="field"><span>Descrição</span>
      <input name="description" maxlength="80" autocomplete="off" placeholder="Ex.: Aluguel" value="${esc(r.description)}"></label>
    <div class="two">
      <label class="field"><span>Valor (R$)</span>
        <input name="amount" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${U.moneyInput(r.amountCents)}"></label>
      <label class="field"><span>Dia de vencimento</span>
        <input name="day" type="number" min="1" max="31" inputmode="numeric" value="${r.day}"></label>
    </div>
    <div class="two">
      <label class="field"><span>Categoria</span><select name="categoryId">${catOptions(r.categoryId)}</select></label>
      <label class="field"><span>Pagamento</span><select name="payment">${payOptions(r.payment)}</select></label>
    </div>
    <label class="check"><input type="checkbox" name="active" ${r.active ? 'checked' : ''}> Ativa (aparece para lançar todo mês)</label>
    <p class="muted small">${rec ? 'Mudanças valem para os próximos lançamentos. Gastos já lançados não mudam.'
      : `Começa a aparecer em ${U.monthLabel(r.startMonth)}.`}</p>
    ${actionsHtml(!!rec)}`, {
    onSubmit: async (fd) => {
      const description = needText(fd.get('description'), 'Descrição');
      const amountCents = needMoney(fd.get('amount'), 'Valor');
      const day = Number(fd.get('day'));
      if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('O dia de vencimento deve ser de 1 a 31.');
      const categoryId = fd.get('categoryId');
      if (!catById(categoryId)) throw new Error('Escolha uma categoria.');
      const payment = PAGAMENTOS.includes(fd.get('payment')) ? fd.get('payment') : 'Outro';
      await DB.put('recurring', { ...(rec || { id: U.uid(), startMonth: r.startMonth, createdAt: Date.now() }),
        description, amountCents, day, categoryId, payment, active: fd.get('active') === 'on' });
      askPersistentStorage();
      return 'Conta fixa salva.';
    },
    onAction: async (act) => {
      if (act !== 'delete') return false;
      if (!await confirmBox(`Excluir a conta fixa <b>${esc(rec.description)}</b>?<br>Os gastos que já foram lançados continuam no histórico.`)) return false;
      await DB.del('recurring', rec.id);
      return 'Conta fixa excluída.';
    },
  });
}

function monthPicker() {
  const [y, m] = state.month.split('-').map(Number);
  const nowY = new Date().getFullYear();
  const years = [];
  for (let i = Math.min(y, nowY) - 5; i <= Math.max(y, nowY) + 1; i++) years.push(i);
  openForm(`<h2>Escolher mês</h2>
    <div class="two">
      <label class="field"><span>Mês</span><select name="m">${U.MESES.map((n, i) =>
        `<option value="${i + 1}" ${i + 1 === m ? 'selected' : ''}>${n.charAt(0).toUpperCase() + n.slice(1)}</option>`).join('')}</select></label>
      <label class="field"><span>Ano</span><select name="y">${years.map((n) => `<option ${n === y ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    </div>
    <div class="actions">
      <button type="button" class="btn secondary" data-x="today">Mês atual</button>
      <span class="grow"></span>
      <button type="button" class="btn secondary" data-x="cancel">Cancelar</button>
      <button type="submit" class="btn primary">Abrir</button>
    </div>`, {
    onSubmit: async (fd) => { state.month = `${fd.get('y')}-${U.pad(fd.get('m'))}`; },
    onAction: async (act) => { if (act === 'today') state.month = U.thisMonth(); },
  });
}

/* ---------------- Ações ---------------- */

async function launch(rec, month) {
  const day = Math.min(rec.day, U.daysInMonth(month));
  const ok = await DB.launchRecurring({
    id: U.uid(), recurringId: rec.id, month, date: `${month}-${U.pad(day)}`,
    description: rec.description, amountCents: rec.amountCents, categoryId: rec.categoryId,
    payment: rec.payment, createdAt: Date.now(), demo: rec.demo || undefined,
  });
  askPersistentStorage();
  return ok;
}

async function loadDemo() {
  if ([...state.expenses, ...state.incomes, ...state.recurring, ...state.goals].some((o) => o.demo)) {
    toast('Os exemplos já estão carregados.');
    return;
  }
  const m0 = U.thisMonth();
  const months = [U.addMonths(m0, -2), U.addMonths(m0, -1), m0];
  const has = (id) => catById(id) ? id : CAT_OUTROS;
  const rec = { id: U.uid(), description: 'Aluguel', amountCents: 120000, day: 5, categoryId: has('moradia'),
    payment: 'Boleto', active: true, startMonth: months[0], createdAt: Date.now(), demo: true };
  const sample = [
    [3, 'Supermercado', 38750, 'mercado', 'Débito'], [8, 'Ônibus / metrô', 9800, 'transporte', 'Pix'],
    [12, 'Farmácia', 4590, 'saude', 'Crédito'], [15, 'Conta de luz', 18320, 'contas', 'Boleto'],
    [18, 'Cinema', 6000, 'lazer', 'Crédito'], [21, 'Feira', 7450, 'mercado', 'Dinheiro'],
  ];
  const incomes = [];
  const expenses = [];
  months.forEach((m, k) => {
    if (!state.incomes.some((i) => i.month === m && i.kind === 'salario')) {
      incomes.push({ id: `sal-${m}`, month: m, kind: 'salario', description: 'Salário', amountCents: 350000, createdAt: Date.now(), demo: true });
    }
    const lastDay = m === m0 ? Number(U.today().slice(8)) : 31;
    sample.forEach(([day, description, cents, cat, payment], i) => {
      if (day > lastDay) return;
      const dd = Math.min(day, U.daysInMonth(m));
      expenses.push({ id: U.uid(), month: m, date: `${m}-${U.pad(dd)}`, description,
        amountCents: cents + k * 1000 * (i % 3), categoryId: has(cat), payment, createdAt: Date.now() + i, demo: true });
    });
    if (m !== m0) {
      expenses.push({ id: U.uid(), recurringId: rec.id, month: m, date: `${m}-05`, description: rec.description,
        amountCents: rec.amountCents, categoryId: rec.categoryId, payment: rec.payment, createdAt: Date.now(), demo: true });
    }
  });
  const goal = { id: U.uid(), name: 'Computador novo', targetCents: 400000, targetMonth: U.addMonths(m0, 12),
    createdAt: Date.now(), demo: true };
  const moves = months.map((m, k) => ({ id: U.uid(), goalId: goal.id, month: m, date: `${m}-01`,
    amountCents: 20000 + k * 5000, note: '', createdAt: Date.now() + k, demo: true }));
  await DB.put('goals', goal);
  await DB.putMany('goalMoves', moves);
  await DB.put('recurring', rec);
  await DB.putMany('incomes', incomes);
  await DB.putMany('expenses', expenses);
  state.month = m0;
  await refresh();
  toast('Exemplos carregados. Veja o Início e o Resumo.');
}

const actions = {
  income: () => incomeForm(),
  'edit-expense': (ds) => { const e = state.expenses.find((x) => x.id === ds.id); if (e) expenseForm(e); },
  goto: (ds) => { state.view = ds.view; render(); viewEl.focus(); },
  'goto-month': (ds) => { state.month = ds.month; state.view = 'inicio'; render(); viewEl.focus(); },
  launch: async (ds) => {
    const r = state.recurring.find((x) => x.id === ds.id);
    if (!r) return;
    const ok = await launch(r, state.month);
    await refresh();
    toast(ok ? `${r.description} lançada.` : 'Esta conta já foi lançada neste mês.');
  },
  'launch-all': async () => {
    const pend = pendingRecurring(state.month);
    let n = 0;
    for (const r of pend) if (await launch(r, state.month)) n++;
    await refresh();
    toast(`${n} conta(s) lançada(s).`);
  },
  'new-cat': () => categoryForm(null),
  'edit-cat': (ds) => categoryForm(catById(ds.id)),
  'new-rec': () => recurringForm(null),
  'edit-rec': (ds) => recurringForm(state.recurring.find((x) => x.id === ds.id)),
  'load-demo': () => loadDemo(),
  limits: () => limitsForm(),
  'line-mode': (ds) => { state.lineMode = ds.mode; render(); $(`[data-act="line-mode"][data-mode="${ds.mode}"]`)?.focus(); },
  imports: () => {
    dlg.innerHTML = `<div class="dlg-body"><h2>Extratos importados</h2>
      <p class="muted small">Desfazer apaga só os lançamentos que vieram daquele extrato. Depois você pode importá-lo de novo.</p>
      <div id="impList">${importsHtml()}</div>
      <div class="actions"><span class="grow"></span><button type="button" class="btn primary" id="impClose">Fechar</button></div></div>`;
    $('#impClose', dlg).addEventListener('click', () => dlg.close());
    $('#impList', dlg).addEventListener('click', (e) => {
      const b = e.target.closest('[data-act="import-undo"]');
      if (b) { e.stopPropagation(); dlg.close(); actions['import-undo'](b.dataset).catch(showError); }
    });
    dlg.showModal();
  },
  'import-undo': async (ds) => {
    const it = importsList().find((x) => x.id === ds.id);
    if (!it) return;
    if (!await confirmBox(`Desfazer a importação <b>${esc(it.label)}</b>?<br>Os ${it.g} gasto(s)${it.r ? ` e ${it.r} receita(s)` : ''} que vieram deste extrato serão apagados. Lançamentos feitos à mão não mudam.`, 'Desfazer')) return;
    const n = await DB.undoImport(ds.id);
    await refresh();
    toast(`${n} lançamento(s) do extrato apagado(s).`);
  },
  'hist-toggle': (ds) => {
    if (state.histOpen.has(ds.month)) state.histOpen.delete(ds.month); else state.histOpen.add(ds.month);
    render();
    $(`[data-act="hist-toggle"][data-month="${ds.month}"]`)?.focus();
  },
  'hist-all': (ds) => {
    const months = [];
    for (let mo = 1; mo <= 12; mo++) {
      const m = `${ds.year}-${U.pad(mo)}`;
      const x = monthData(m);
      if (x.received || x.spent || x.saved || m === state.month) months.push(m);
    }
    const anyOpen = months.some((m) => state.histOpen.has(m));
    months.forEach((m) => (anyOpen ? state.histOpen.delete(m) : state.histOpen.add(m)));
    render();
  },
  csv: (ds) => {
    const n = downloadCsv(ds.year);
    toast(n ? `Planilha de ${ds.year} baixada (${n} linhas). Abre no Excel.` : `Nada lançado em ${ds.year}.`);
  },
  'remove-demo': async () => {
    if (!await confirmBox('Remover todos os lançamentos de exemplo?<br>Seus próprios lançamentos não serão afetados.', 'Remover')) return;
    const n = await DB.removeDemo();
    await refresh();
    toast(`${n} item(ns) de exemplo removido(s).`);
  },
};

actions.install = async () => {
  const p = state.installPrompt;
  if (!p) return;
  p.prompt();
  await p.userChoice.catch(() => null);
  state.installPrompt = null;
  render();
};
Object.assign(actions, DocsActions, CofreActions, BackupActions, OfxActions);

/* ---------------- Mensagens ---------------- */

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function showError(e) {
  console.error(e);
  toast(`Não foi possível concluir: ${e?.message || e}`);
}

/* ---------------- Início ---------------- */

function bind() {
  $('#prevMonth').addEventListener('click', () => { state.month = U.addMonths(state.month, -1); render(); });
  $('#nextMonth').addEventListener('click', () => { state.month = U.addMonths(state.month, 1); render(); });
  $('#monthLabel').addEventListener('click', monthPicker);
  $('#fab').addEventListener('click', () => expenseForm(null));
  $$('.tab, #settingsBtn').forEach((t) => t.addEventListener('click', () => { state.view = t.dataset.view; render(); }));
  viewEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !actions[b.dataset.act]) return;
    Promise.resolve(actions[b.dataset.act](b.dataset)).catch(showError);
  });
  viewEl.addEventListener('change', (e) => {
    if (e.target.id === 'filterCat') { state.filterCat = e.target.value; render(); $('#filterCat')?.focus(); }
    if (e.target.id === 'docKind') { state.docKind = e.target.value; render(); $('#docKind')?.focus(); }
    if (e.target.id === 'carryToggle') {
      state.carryOver = e.target.checked;
      DB.put('settings', { key: 'carryOver', value: state.carryOver }).catch(showError);
      toast(state.carryOver ? 'A sobra agora passa para o mês seguinte.' : 'Cada mês começa do zero.');
    }
    if (e.target.id === 'histYear') { state.histYear = Number(e.target.value); render(); $('#histYear')?.focus(); }
  });
  // Fecha a janela ao tocar fora dela.
  for (const d of [dlg, confirmDlg]) {
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  }
}

function setupPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installPrompt = e;
    if (state.view === 'ajustes') render();
  });
  window.addEventListener('appinstalled', () => { state.installPrompt = null; toast('App instalado!'); });
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && secure) {
    navigator.serviceWorker.register('./service-worker.js').catch((e) => console.warn('Offline indisponível:', e));
  }
}

async function init() {
  setupPwa();
  try {
    await DB.open();
    await seedCategories();
    await reload();
    bind();
    render();
  } catch (e) {
    console.error(e);
    viewEl.innerHTML = `<section class="card"><h2>Não foi possível abrir seus dados</h2>
      <p>${esc(e?.message || e)}</p>
      <p class="muted small">Se estiver numa janela anônima/privativa, abra o app numa janela normal. Nenhum dado foi apagado.</p></section>`;
  }
}

init();
