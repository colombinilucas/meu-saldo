'use strict';
/* Funções de apoio: dinheiro (em centavos), datas no padrão brasileiro e textos. */
const U = (() => {
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const pad = (n) => String(n).padStart(2, '0');

  /** Centavos (inteiro) -> "R$ 1.234,56" */
  function money(cents) {
    return brl.format((cents || 0) / 100);
  }

  const num = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  /** Centavos -> "1.234,56" (sem o R$, para tabelas) */
  function moneyPlain(cents) {
    return num.format((cents || 0) / 100);
  }

  /** Texto digitado -> centavos (inteiro) ou null se inválido.
   *  Aceita "1234,56", "1.234,56", "1234.56", "1.500", "R$ 50". */
  function parseMoney(input) {
    if (input == null) return null;
    let s = String(input).trim().replace(/R\$/i, '').replace(/\s/g, '');
    if (!s) return null;
    if (s.includes(',')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, '');
    }
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    const [int, frac = ''] = s.split('.');
    const cents = parseInt(int, 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
    return Number.isSafeInteger(cents) ? cents : null;
  }

  /** Centavos -> "1234,56" para preencher campos */
  function moneyInput(cents) {
    if (cents == null) return '';
    return `${Math.floor(cents / 100)},${pad(cents % 100)}`;
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const thisMonth = () => today().slice(0, 7);

  function addMonths(month, n) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }

  function monthLabel(month) {
    const [y, m] = month.split('-').map(Number);
    const s = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
    'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  /** "2026-11-23" -> "23/11/2026" */
  function dateBR(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  /** "2026-11-23" -> "Segunda, 23/11" */
  function dayTitle(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const w = new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long' });
    const name = w.split('-')[0];
    return `${name.charAt(0).toUpperCase() + name.slice(1)}, ${pad(d)}/${pad(m)}`;
  }

  function daysInMonth(month) {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }

  function isValidDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return false;
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d && y > 1900 && y < 2200;
  }

  const isValidMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || '');

  function uid() {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* segue */ }
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  return { money, moneyPlain, parseMoney, moneyInput, today, thisMonth, addMonths, monthLabel, MESES,
    dateBR, dayTitle, daysInMonth, isValidDate, isValidMonth, uid, esc, pad };
})();
