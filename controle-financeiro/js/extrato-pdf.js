'use strict';
/* Leitura do extrato de conta corrente do Itaú em PDF.
   O PDF é lido só neste aparelho, com a biblioteca PDF.js guardada junto do app (pasta vendor/). */

const PDF_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const PDF_NUM = /^-?\d{1,3}(\.\d{3})*,\d{2}$|^-?\d+,\d{2}$/;

let pdfLibPromise = null;
function loadPdfLib() {
  if (location.protocol === 'file:') {
    return Promise.reject(new Error('A leitura de PDF funciona no app publicado (endereço https). Aberto direto do arquivo, o navegador bloqueia.'));
  }
  if (!pdfLibPromise) {
    pdfLibPromise = import(new URL('vendor/pdfjs/pdf.min.mjs', document.baseURI).href).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', location.href).href;
      return lib;
    }).catch((e) => {
      pdfLibPromise = null;
      console.error(e);
      throw new Error('Não foi possível carregar o leitor de PDF. Abra o app com internet uma vez e tente de novo.');
    });
  }
  return pdfLibPromise;
}

/** Lê o PDF e devolve as páginas como listas de textos com posição. */
async function pdfTextPages(buffer) {
  const lib = await loadPdfLib();
  let doc;
  const task = lib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true });
  try {
    doc = await task.promise;
  } catch (e) {
    if (e?.name === 'PasswordException') throw new Error('Este PDF tem senha. Baixe o extrato sem senha e tente de novo.');
    throw new Error('Não foi possível abrir este PDF.');
  }
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    pages.push(tc.items.filter((i) => i.str && i.str.trim()).map((i) => ({
      s: i.str.replace(/\s+/g, ' ').trim(), x: i.transform[4], y: i.transform[5], r: i.transform[4] + i.width,
    })));
  }
  try { await task.destroy(); } catch (e) { /* ignora */ }
  return pages;
}

/** Interpreta as páginas do extrato do Itaú. Função pura: não depende do navegador. */
function parseItauPages(pages) {
  const all = pages.flat().map((i) => i.s).join(' ');
  const per = /Per[ií]odo de visualiza[çc][ãa]o:\s*(\d{2}\/\d{2}\/\d{4})\s*at[ée]\s*(\d{2}\/\d{2}\/\d{4})/i.exec(all);
  const ag = /ag[êe]ncia:\s*([\d-]+)/i.exec(all);
  const cc = /conta:\s*([\d.-]+)/i.exec(all);
  const acct = `${ag ? ag[1] : ''}/${cc ? cc[1] : ''}`;
  const iso = (br) => { const m = PDF_DATE.exec(br); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

  let cols = null;
  const records = [];
  let stop = false;
  for (const items of pages) {
    if (stop) break;
    // Cabeçalho da tabela (aparece em cada página): Data | Lançamentos | Descrição | Valor (R$) | Saldo (R$)
    const valor = items.find((i) => /^Valor \(R\$\)$/i.test(i.s));
    const saldo = items.find((i) => /^Saldo \(R\$\)$/i.test(i.s));
    let headerY = Infinity;
    if (valor && saldo && Math.abs(valor.y - saldo.y) < 3) {
      const same = items.filter((i) => Math.abs(i.y - valor.y) < 3);
      const lanc = same.find((i) => /^Lan[çc]amentos$/i.test(i.s));
      const desc = same.find((i) => /^Descri[çc][ãa]o$/i.test(i.s));
      if (lanc && desc) {
        cols = { type: lanc.x, desc: desc.x, valorR: valor.r, saldoR: saldo.r, valorL: valor.x };
        headerY = valor.y;
      }
    }
    if (!cols) continue;
    const endItem = items.find((i) => /^Posi[çc][ãa]o consolidada/i.test(i.s));
    const endY = endItem ? endItem.y : -Infinity;
    if (endItem) stop = true;
    const body = items.filter((i) => i.y < headerY - 2 && i.y > endY + 2)
      .sort((a, b) => b.y - a.y || a.x - b.x);
    let cur = null;
    for (const it of body) {
      if (PDF_DATE.test(it.s) && it.x < cols.type - 5) {
        cur = { date: iso(it.s), y: it.y, type: [], desc: [], amount: null, balance: null };
        records.push(cur);
        continue;
      }
      if (!cur) continue;
      if (PDF_NUM.test(it.s)) {
        const toValor = Math.abs(it.r - cols.valorR);
        const toSaldo = Math.abs(it.r - cols.saldoR);
        if (toValor < toSaldo) { if (cur.amount == null) cur.amount = it.s; } else cur.balance = it.s;
        continue;
      }
      if (it.x >= cols.desc - 3 && it.x < cols.valorL - 3) cur.desc.push(it.s);
      else if (it.x >= cols.type - 3 && it.x < cols.desc - 3) cur.type.push(it.s);
    }
  }
  if (!cols) {
    throw new Error('Não reconheci este PDF como extrato de conta corrente do Itaú. Use o extrato baixado pelo app ou site do Itaú, ou o arquivo OFX.');
  }

  // Conferência: saldo mais antigo + movimentações = saldo mais novo.
  const withBal = records.filter((r) => r.balance != null && r.date);
  let reconciled = null;
  if (withBal.length >= 2) {
    const newest = withBal.reduce((a, r) => (r.date > a.date ? r : a));
    const oldest = withBal.reduce((a, r) => (r.date < a.date ? r : a));
    const sum = records.filter((r) => r.amount != null && r.date > oldest.date && r.date <= newest.date)
      .reduce((t, r) => t + (ofxAmount(r.amount) || 0), 0);
    const ob = ofxAmount(oldest.balance); const nb = ofxAmount(newest.balance);
    if (ob != null && nb != null) reconciled = ob + sum === nb;
  }

  const txs = [];
  const seen = new Map();
  let skipped = 0;
  for (const r of records) {
    if (!r.type.length && r.amount == null) continue; // linha só com saldo do dia
    const amount = ofxAmount(r.amount);
    if (!r.date || amount == null || amount === 0) { skipped++; continue; }
    const type = r.type.join(' ');
    const desc = r.desc.join(' ') || type;
    let key = `itau-pdf|${acct}|${r.date}|${amount}|${semAcento(`${type} ${desc}`)}`;
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    if (n > 1) key += `|${n}`;
    txs.push({ key, date: r.date, amount, memo: desc, type, desc: ofxNiceText(desc) });
  }
  if (!txs.length) throw new Error('Não encontrei lançamentos neste extrato.');
  txs.sort((a, b) => a.date.localeCompare(b.date));
  return {
    bank: 'itau', acct, skipped, txs, source: 'PDF do Itaú', reconciled,
    start: per ? iso(per[1]) : txs[0].date,
    end: per ? iso(per[2]) : txs[txs.length - 1].date,
  };
}

async function parseItauPdf(buffer) {
  return parseItauPages(await pdfTextPages(buffer));
}
