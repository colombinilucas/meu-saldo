'use strict';
/* Cofre: objetivos de economia (ex.: comprar um computador).
   Valor guardado num mês sai da "sobra" daquele mês; valor retirado volta para ela. */

function goalSaved(goalId) {
  return state.goalMoves.filter((m) => m.goalId === goalId).reduce((s, m) => s + m.amountCents, 0);
}

function monthsBetween(fromMonth, toMonth) {
  const [y1, m1] = fromMonth.split('-').map(Number);
  const [y2, m2] = toMonth.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

function goalPlan(goal, saved) {
  const left = goal.targetCents - saved;
  if (left <= 0) return '<p class="goal-done">🎉 Objetivo alcançado!</p>';
  let txt = `Faltam <b>${U.money(left)}</b>.`;
  if (goal.targetMonth) {
    const n = monthsBetween(U.thisMonth(), goal.targetMonth) + 1;
    txt += n >= 1
      ? ` Para chegar até ${U.monthLabel(goal.targetMonth).toLowerCase()}, guarde cerca de <b>${U.money(Math.ceil(left / n))}</b> por mês.`
      : ' O prazo escolhido já passou; edite o objetivo para definir outro.';
  }
  return `<p class="muted small">${txt}</p>`;
}

function renderCofre() {
  const total = state.goalMoves.reduce((s, m) => s + m.amountCents, 0);
  const thisMonthSaved = monthData(state.month).saved;
  const goals = state.goals.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  let h = `<section class="card hero">
    <p class="hero-label">Total no cofre</p>
    <p class="hero-value">${U.money(total)}</p>
    <p class="muted small">Em ${U.monthLabel(state.month).toLowerCase()}: ${thisMonthSaved >= 0 ? 'guardou' : 'retirou'} ${U.money(Math.abs(thisMonthSaved))}</p>
  </section>
  <section class="card">
    <div class="card-head"><h2>Objetivos</h2>
      <button type="button" class="btn small primary" data-act="goal-new">+ Novo objetivo</button></div>`;
  if (!goals.length) {
    h += `<p class="empty">Crie um objetivo, como <b>Comprar computador</b>, e vá guardando um pouco por mês.<br>
      O valor guardado sai da sobra do mês, para você não gastar sem perceber.</p>`;
  } else {
    h += `<div class="goals">${goals.map((g) => {
      const saved = goalSaved(g.id);
      const pct = g.targetCents ? Math.min(100, Math.round((saved / g.targetCents) * 100)) : 0;
      return `<article class="goal">
        <div class="card-head"><h3>${esc(g.name)}${demoTag(g)}</h3>
          <button type="button" class="btn small secondary" data-act="goal-edit" data-id="${esc(g.id)}">Editar</button></div>
        <p class="goal-amount"><strong>${U.money(saved)}</strong> <span class="muted">de ${U.money(g.targetCents)}</span> <span class="goal-pct">${pct}%</span></p>
        <div class="meter big" aria-hidden="true"><span style="width:${pct}%"></span></div>
        ${goalPlan(g, saved)}
        <div class="btn-row">
          <button type="button" class="btn small primary" data-act="goal-move" data-kind="in" data-id="${esc(g.id)}">+ Guardar</button>
          <button type="button" class="btn small secondary" data-act="goal-move" data-kind="out" data-id="${esc(g.id)}" ${saved > 0 ? '' : 'disabled'}>Retirar</button>
        </div>
      </article>`;
    }).join('')}</div>`;
  }
  return `${h}</section>
  <p class="note">Dica: o cofre é um controle seu. O dinheiro continua na sua conta ou onde você realmente guardar.</p>`;
}

function targetMonthOptions(selected) {
  const opts = ['<option value="">Sem prazo</option>'];
  for (let i = 0; i <= 72; i++) {
    const m = U.addMonths(U.thisMonth(), i);
    opts.push(`<option value="${m}" ${m === selected ? 'selected' : ''}>${U.monthLabel(m)}</option>`);
  }
  if (selected && !opts.some((o) => o.includes(`"${selected}"`))) {
    opts.splice(1, 0, `<option value="${selected}" selected>${U.monthLabel(selected)}</option>`);
  }
  return opts.join('');
}

function goalForm(goal) {
  const moves = goal ? state.goalMoves.filter((m) => m.goalId === goal.id)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0)) : [];
  const form = openForm(`<h2>${goal ? 'Editar objetivo' : 'Novo objetivo'}</h2>
    <label class="field"><span>Nome</span>
      <input name="name" maxlength="50" autocomplete="off" placeholder="Ex.: Comprar computador" value="${esc(goal?.name || '')}"></label>
    <div class="two">
      <label class="field"><span>Quanto precisa (R$)</span>
        <input name="target" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${U.moneyInput(goal?.targetCents ?? null)}"></label>
      <label class="field"><span>Até quando (opcional)</span><select name="targetMonth">${targetMonthOptions(goal?.targetMonth || '')}</select></label>
    </div>
    ${goal ? `<h3 class="sub">Movimentações</h3>
      ${moves.length ? `<ul class="list" id="moves">${moves.map((m) => `<li class="row">
        <span class="row-main"><span class="row-title">${m.amountCents >= 0 ? 'Guardou' : 'Retirou'}${m.note ? ` · ${esc(m.note)}` : ''}</span>
          <span class="muted small">${U.dateBR(m.date)}</span></span>
        <span class="amount ${m.amountCents < 0 ? 'neg' : ''}">${m.amountCents >= 0 ? '+' : '−'} ${U.money(Math.abs(m.amountCents))}</span>
        <button type="button" class="btn small danger-link" data-mv="${esc(m.id)}" aria-label="Excluir movimentação de ${U.dateBR(m.date)}">Excluir</button>
      </li>`).join('')}</ul>` : '<p class="muted small">Nenhuma movimentação ainda.</p>'}` : ''}
    ${actionsHtml(!!goal)}`, {
    onSubmit: async (fd) => {
      const name = needText(fd.get('name'), 'Nome').slice(0, 50);
      const targetCents = needMoney(fd.get('target'), 'Quanto precisa');
      const targetMonth = fd.get('targetMonth') || '';
      if (targetMonth && !U.isValidMonth(targetMonth)) throw new Error('Escolha um prazo válido.');
      await DB.put('goals', { ...(goal || { id: U.uid(), createdAt: Date.now() }), name, targetCents, targetMonth });
      askPersistentStorage();
      return 'Objetivo salvo.';
    },
    onAction: async (act) => {
      if (act !== 'delete') return false;
      const saved = goalSaved(goal.id);
      if (!await confirmBox(`Excluir o objetivo <b>${esc(goal.name)}</b>?${moves.length
        ? `<br>As ${moves.length} movimentação(ões) dele também serão apagadas, e as sobras dos meses voltam a incluir esses ${U.money(saved)}.
           <br>Se você já usou o dinheiro, prefira <b>Retirar</b> antes de excluir.` : ''}`)) return false;
      await DB.deleteGoal(goal.id);
      return 'Objetivo excluído.';
    },
  });
  const movesEl = $('#moves', form);
  if (movesEl) {
    movesEl.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-mv]');
      if (!b) return;
      if (!await confirmBox('Excluir esta movimentação do cofre?')) return;
      try {
        await DB.del('goalMoves', b.dataset.mv);
        dlg.close();
        await refresh();
        goalForm(state.goals.find((x) => x.id === goal.id));
        toast('Movimentação excluída.');
      } catch (ex) { showError(ex); }
    });
  }
}

function goalMoveForm(goal, kind) {
  const saved = goalSaved(goal.id);
  const isIn = kind === 'in';
  openForm(`<h2>${isIn ? 'Guardar no cofre' : 'Retirar do cofre'}</h2>
    <p class="muted">${esc(goal.name)} · tem ${U.money(saved)}</p>
    <div class="two">
      <label class="field"><span>Valor (R$)</span>
        <input name="amount" inputmode="decimal" autocomplete="off" placeholder="0,00"></label>
      <label class="field"><span>Data</span><input type="date" name="date" value="${defaultDate(state.month)}"></label>
    </div>
    <label class="field"><span>Observação (opcional)</span>
      <input name="note" maxlength="60" autocomplete="off" placeholder="${isIn ? 'Ex.: Sobra de novembro' : 'Ex.: Compra do computador'}"></label>
    <p class="muted small">${isIn ? 'Esse valor sai da sobra do mês da data escolhida.' : 'Esse valor volta para a sobra do mês da data escolhida.'}</p>
    ${actionsHtml(false)}`, {
    onSubmit: async (fd) => {
      const cents = needMoney(fd.get('amount'), 'Valor');
      const date = fd.get('date');
      if (!U.isValidDate(date)) throw new Error('Escolha uma data válida.');
      if (!isIn && cents > saved) throw new Error(`Você só tem ${U.money(saved)} neste objetivo.`);
      await DB.put('goalMoves', { id: U.uid(), goalId: goal.id, month: date.slice(0, 7), date,
        amountCents: isIn ? cents : -cents, note: String(fd.get('note') || '').trim().slice(0, 60),
        createdAt: Date.now() });
      askPersistentStorage();
      return isIn ? `${U.money(cents)} guardados em ${goal.name}.` : `${U.money(cents)} retirados de ${goal.name}.`;
    },
  });
}

const CofreActions = {
  'goal-new': () => goalForm(null),
  'goal-edit': (ds) => { const g = state.goals.find((x) => x.id === ds.id); if (g) goalForm(g); },
  'goal-move': (ds) => { const g = state.goals.find((x) => x.id === ds.id); if (g) goalMoveForm(g, ds.kind); },
};
