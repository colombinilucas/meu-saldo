'use strict';
/* Gráficos simples em SVG (sem bibliotecas). Os valores sempre aparecem também em texto. */
const Charts = (() => {
  const PALETTE = ['#3f7a63', '#5a87a0', '#b98a45', '#7f6a9c', '#a86565', '#6e9450', '#4e8a86', '#7a8290', '#9c7a52', '#5b6a96'];
  const SERIES = { received: '#3f7a63', spent: '#b98a45', saved: '#5a87a0' };

  /** Rosca: segments = [{label, value, color}] */
  function donut(segments, centerTop, centerBottom) {
    const total = segments.reduce((s, x) => s + x.value, 0);
    let acc = 0;
    const arcs = total > 0 ? segments.filter((s) => s.value > 0).map((s) => {
      const pct = (s.value / total) * 100;
      const el = `<circle r="15.915" cx="21" cy="21" fill="none" stroke="${s.color}" stroke-width="6"
        stroke-dasharray="${pct.toFixed(3)} ${(100 - pct).toFixed(3)}" stroke-dashoffset="${(25 - acc).toFixed(3)}"/>`;
      acc += pct;
      return el;
    }).join('') : '';
    const label = segments.filter((s) => s.value > 0)
      .map((s) => `${s.label}: ${Math.round((s.value / (total || 1)) * 100)}%`).join(', ');
    return `<svg class="donut" viewBox="0 0 42 42" role="img" aria-label="Gráfico de rosca. ${U.esc(label)}">
      <circle r="15.915" cx="21" cy="21" fill="none" stroke="var(--line)" stroke-width="6"/>
      ${arcs}
      <text x="21" y="20" text-anchor="middle" class="donut-top">${U.esc(centerTop)}</text>
      <text x="21" y="25.5" text-anchor="middle" class="donut-bottom">${U.esc(centerBottom)}</text>
    </svg>`;
  }

  /** Valor curto para caber no gráfico: 350 · 1,2 mil */
  function short(cents) {
    const r = cents / 100;
    if (Math.abs(r) >= 1000) return `${(r / 1000).toFixed(1).replace('.', ',').replace(',0', '')} mil`;
    return String(Math.round(r));
  }

  /** Barras por mês: rows = [{month, received, spent, saved}] (mais antigo primeiro) */
  function monthBars(rows) {
    const W = 340; const H = 190; const top = 8; const bottom = 24; const left = 2;
    const max = Math.max(1, ...rows.flatMap((r) => [r.received, r.spent, r.saved]));
    const gw = (W - left) / rows.length;
    const bw = Math.min(17, (gw - 6) / 3);
    const ph = H - top - bottom;
    const bars = rows.map((r, i) => {
      const x0 = left + i * gw + (gw - bw * 3 - 4) / 2;
      const bar = (v, k, j) => {
        if (v <= 0) return '';
        const h = Math.max(2, (v / max) * ph);
        const x = x0 + j * (bw + 2);
        const y = top + ph - h;
        const cx = (x + bw / 2).toFixed(1);
        const label = short(v);
        // valor no meio da barra (girado); se a barra for baixa, fica logo acima
        const inside = h >= label.length * 5.2 + 8;
        const txt = inside
          ? `<text class="barval" transform="translate(${cx} ${(y + h / 2).toFixed(1)}) rotate(-90)" text-anchor="middle" dominant-baseline="central">${label}</text>`
          : `<text class="barval out" transform="translate(${cx} ${(y - 3).toFixed(1)}) rotate(-90)" text-anchor="start" dominant-baseline="central">${label}</text>`;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${SERIES[k]}"><title>${U.monthLabel(r.month)} · ${NAMES[k]}: ${U.money(v)}</title></rect>${txt}`;
      };
      const [y, m] = r.month.split('-');
      return bar(r.received, 'received', 0) + bar(r.spent, 'spent', 1) + bar(r.saved, 'saved', 2)
        + `<text x="${(left + i * gw + gw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="axis">${U.MESES[Number(m) - 1].slice(0, 3)}/${y.slice(2)}</text>`;
    }).join('');
    return `<svg class="bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de barras dos últimos ${rows.length} meses. Os valores estão na tabela abaixo.">
      <line x1="0" x2="${W}" y1="${top + ph}" y2="${top + ph}" stroke="var(--line)"/>
      ${bars}
    </svg>
    <div class="legend">${Object.keys(SERIES).map((k) => `<span><i style="background:${SERIES[k]}"></i>${NAMES[k]}</span>`).join('')}</div>`;
  }

  function niceMax(v) {
    if (v <= 0) return 100;
    const p = 10 ** Math.floor(Math.log10(v));
    for (const f of [1, 2, 2.5, 5, 10]) if (f * p >= v) return f * p;
    return 10 * p;
  }

  /** Linha: points = [{label, full, value}] */
  function line(points) {
    const W = 340; const H = 180; const L = 40; const R = 10; const T = 14; const B = 22;
    const pw = W - L - R; const ph = H - T - B;
    const max = niceMax(Math.max(...points.map((p) => p.value), 0));
    const n = points.length;
    const x = (i) => L + (n === 1 ? pw / 2 : (i * pw) / (n - 1));
    const y = (v) => T + ph - (v / max) * ph;
    const grid = [0, max / 2, max].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line)"/>
      <text x="${L - 5}" y="${y(v).toFixed(1)}" text-anchor="end" dominant-baseline="central" class="axis">${short(v)}</text>`).join('');
    const pts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
    const area = `M${pts[0]} L${pts.join(' L')} L${x(n - 1).toFixed(1)},${T + ph} L${x(0).toFixed(1)},${T + ph} Z`;
    const step = Math.ceil(n / 7);
    const labels = points.map((p, i) => ((i % step === 0 || i === n - 1) && !(i !== n - 1 && n - 1 - i < step / 2)
      ? `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="axis">${U.esc(p.label)}</text>` : '')).join('');
    let maxI = -1;
    points.forEach((p, i) => { if (p.value > 0 && (maxI < 0 || p.value > points[maxI].value)) maxI = i; });
    const dots = points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="${i === maxI ? 3.6 : n > 20 ? 1.8 : 2.6}"
      class="${i === maxI ? 'dot-max' : 'dot'}"><title>${U.esc(p.full)}: ${U.money(p.value)}</title></circle>`).join('');
    const maxLabel = maxI >= 0 ? `<text x="${Math.min(W - R - 2, Math.max(L + 2, x(maxI))).toFixed(1)}" y="${(y(points[maxI].value) - 7).toFixed(1)}"
      text-anchor="${x(maxI) > W - 40 ? 'end' : x(maxI) < L + 30 ? 'start' : 'middle'}" class="maxval">${U.money(points[maxI].value)}</text>` : '';
    const total = points.reduce((t, p) => t + p.value, 0);
    return `<svg class="linechart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de linha. Total do período ${U.money(total)}. Maior valor ${maxI >= 0 ? `${U.esc(points[maxI].full)}: ${U.money(points[maxI].value)}` : 'nenhum'}. Os valores estão em Ver valores.">
      ${grid}
      <path d="${area}" class="area"/>
      <polyline points="${pts.join(' ')}" class="ln"/>
      ${dots}${maxLabel}${labels}
    </svg>`;
  }

  const NAMES = { received: 'Entrou', spent: 'Gastou', saved: 'Guardou' };

  return { PALETTE, donut, monthBars, line, short };
})();
