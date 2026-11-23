'use strict';
/* Documentos: contracheques, extratos e comprovantes guardados só neste aparelho. */

const DOC_TIPOS = ['Contracheque', 'Extrato', 'Comprovante', 'Outro'];
const DOC_MAX_BYTES = 25 * 1024 * 1024;
const DOC_FORMATOS = { 'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG' };

function docMime(file) {
  if (DOC_FORMATOS[file.type]) return file.type;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }[ext] || null;
}

function fileSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
}

function guessDocKind(name) {
  if (/contra.?cheque|holerite|pagamento|salario|salário/i.test(name)) return 'Contracheque';
  if (/extrato/i.test(name)) return 'Extrato';
  if (/comprovante|recibo|nota/i.test(name)) return 'Comprovante';
  return 'Outro';
}

function monthOptions(selected) {
  const list = new Set([selected]);
  for (let i = -36; i <= 2; i++) list.add(U.addMonths(U.thisMonth(), i));
  return [...list].sort().reverse()
    .map((m) => `<option value="${m}" ${m === selected ? 'selected' : ''}>${U.monthLabel(m)}</option>`).join('');
}

function renderDocs() {
  const scope = state.docScope;
  let list = state.docs.slice();
  if (scope === 'mes') list = list.filter((d) => d.month === state.month);
  if (state.docKind) list = list.filter((d) => d.kind === state.docKind);
  list.sort((a, b) => b.month.localeCompare(a.month) || b.addedAt - a.addedAt);

  return `<section class="card">
    <div class="card-head"><h2>Documentos</h2>
      <button type="button" class="btn small primary" data-act="doc-new">+ Anexar</button></div>
    <p class="muted small">Contracheques, extratos e comprovantes (PDF, JPG ou PNG). Ficam só neste aparelho e não são enviados para a internet.</p>
    <div class="filters">
      <div class="seg" role="group" aria-label="Período">
        <button type="button" data-act="doc-scope" data-scope="mes" aria-pressed="${scope === 'mes'}">${U.monthLabel(state.month)}</button>
        <button type="button" data-act="doc-scope" data-scope="todos" aria-pressed="${scope === 'todos'}">Todos os meses</button>
      </div>
      <label class="field inline"><span>Tipo</span>
        <select id="docKind"><option value="">Todos</option>
          ${DOC_TIPOS.map((t) => `<option ${t === state.docKind ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    </div>
    ${list.length ? `<ul class="list">${list.map((d) => `<li class="doc">
      <span class="doc-ico ${DOC_FORMATOS[d.mime] === 'PDF' ? 'pdf' : 'img'}" aria-hidden="true">${DOC_FORMATOS[d.mime] || '?'}</span>
      <span class="row-main">
        <span class="row-title">${esc(d.name)}</span>
        <span class="muted small">${esc(d.kind)} · ${U.monthLabel(d.month)} · ${fileSize(d.size)}</span>
        <span class="muted small">Incluído em ${new Date(d.addedAt).toLocaleDateString('pt-BR')}</span>
        ${d.note ? `<span class="small doc-note">${esc(d.note)}</span>` : ''}
      </span>
      <span class="doc-actions">
        <button type="button" class="btn small" data-act="doc-open" data-id="${esc(d.id)}">Abrir</button>
        <button type="button" class="btn small secondary" data-act="doc-download" data-id="${esc(d.id)}">Baixar</button>
        <button type="button" class="btn small secondary" data-act="doc-edit" data-id="${esc(d.id)}">Editar</button>
        <button type="button" class="btn small danger-link" data-act="doc-delete" data-id="${esc(d.id)}">Excluir</button>
      </span>
    </li>`).join('')}</ul>`
      : `<p class="empty">Nenhum documento ${scope === 'mes' ? 'neste mês' : 'guardado'}${state.docKind ? ' deste tipo' : ''}.<br>Toque em <b>+ Anexar</b> para guardar um contracheque ou extrato.</p>`}
  </section>`;
}

function docNewForm() {
  const form = openForm(`<h2>Anexar documento</h2>
    <label class="field"><span>Arquivo (PDF, JPG ou PNG, até 25 MB)</span>
      <input type="file" name="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"></label>
    <div class="two">
      <label class="field"><span>Tipo</span><select name="kind">${DOC_TIPOS.map((t) => `<option>${t}</option>`).join('')}</select></label>
      <label class="field"><span>Mês</span><select name="month">${monthOptions(state.month)}</select></label>
    </div>
    <label class="field"><span>Observação (opcional)</span>
      <input name="note" maxlength="120" autocomplete="off" placeholder="Ex.: Extrato Itaú conta corrente"></label>
    ${actionsHtml(false)}`, {
    onSubmit: async (fd) => {
      const file = fd.get('file');
      if (!file || !file.name || !file.size) throw new Error('Escolha um arquivo.');
      const mime = docMime(file);
      if (!mime) throw new Error('Formato não aceito. Use PDF, JPG ou PNG.');
      if (file.size > DOC_MAX_BYTES) throw new Error(`Arquivo grande demais (${fileSize(file.size)}). O limite é 25 MB.`);
      const month = fd.get('month');
      if (!U.isValidMonth(month)) throw new Error('Escolha o mês do documento.');
      const kind = DOC_TIPOS.includes(fd.get('kind')) ? fd.get('kind') : 'Outro';
      let data;
      try { data = await file.arrayBuffer(); } catch (e) { throw new Error('Não foi possível ler o arquivo. Tente escolher de novo.'); }
      await DB.saveDoc({ id: U.uid(), month, kind, name: file.name.slice(0, 150), mime, size: file.size,
        addedAt: Date.now(), note: String(fd.get('note') || '').trim().slice(0, 120) }, data);
      askPersistentStorage();
      return month === state.month ? 'Documento guardado.' : `Documento guardado em ${U.monthLabel(month)}.`;
    },
  });
  $('input[type=file]', form).addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) form.elements.kind.value = guessDocKind(f.name);
  });
}

function docEditForm(doc) {
  openForm(`<h2>Editar documento</h2>
    <p class="row-title">${esc(doc.name)}</p>
    <div class="two">
      <label class="field"><span>Tipo</span><select name="kind">${DOC_TIPOS.map((t) => `<option ${t === doc.kind ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field"><span>Mês</span><select name="month">${monthOptions(doc.month)}</select></label>
    </div>
    <label class="field"><span>Observação</span>
      <input name="note" maxlength="120" autocomplete="off" value="${esc(doc.note || '')}"></label>
    ${actionsHtml(true)}`, {
    onSubmit: async (fd) => {
      const month = fd.get('month');
      if (!U.isValidMonth(month)) throw new Error('Escolha o mês do documento.');
      const kind = DOC_TIPOS.includes(fd.get('kind')) ? fd.get('kind') : 'Outro';
      await DB.put('docs', { ...doc, month, kind, note: String(fd.get('note') || '').trim().slice(0, 120) });
      return 'Documento atualizado.';
    },
    onAction: async (act) => {
      if (act !== 'delete') return false;
      if (!await confirmBox(`Excluir o documento <b>${esc(doc.name)}</b>?<br>Ele será apagado deste aparelho e não poderá ser recuperado.`)) return false;
      await DB.deleteDoc(doc.id);
      return 'Documento excluído.';
    },
  });
}

async function docBlobUrl(doc) {
  const data = await DB.getDocData(doc.id);
  if (!data) throw new Error('O conteúdo deste documento não foi encontrado neste aparelho.');
  const url = URL.createObjectURL(new Blob([data], { type: doc.mime }));
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  return url;
}

function docDownload(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const DocsActions = {
  'doc-delete': async (ds) => {
    const d = state.docs.find((x) => x.id === ds.id);
    if (!d) return;
    if (!await confirmBox(`Excluir o documento <b>${esc(d.name)}</b>?<br>Ele será apagado deste aparelho e não poderá ser recuperado.`)) return;
    await DB.deleteDoc(d.id);
    await refresh();
    toast('Documento excluído.');
  },
  'doc-new': () => docNewForm(),
  'doc-edit': (ds) => { const d = state.docs.find((x) => x.id === ds.id); if (d) docEditForm(d); },
  'doc-scope': (ds) => { state.docScope = ds.scope; render(); },
  'doc-open': async (ds) => {
    const d = state.docs.find((x) => x.id === ds.id);
    if (!d) return;
    const url = await docBlobUrl(d);
    if (d.mime.startsWith('image/')) {
      dlg.innerHTML = `<div class="dlg-body"><h2>${esc(d.name)}</h2>
        <img class="doc-preview" src="${url}" alt="${esc(d.kind)} de ${U.monthLabel(d.month)}">
        <div class="actions"><span class="grow"></span><button type="button" class="btn primary" id="closeView">Fechar</button></div></div>`;
      $('#closeView', dlg).addEventListener('click', () => dlg.close());
      dlg.showModal();
      return;
    }
    const w = window.open(url, '_blank');
    if (!w) {
      docDownload(url, d.name);
      toast('O navegador bloqueou a nova aba. O arquivo foi baixado.');
    }
  },
  'doc-download': async (ds) => {
    const d = state.docs.find((x) => x.id === ds.id);
    if (d) docDownload(await docBlobUrl(d), d.name);
  },
};
