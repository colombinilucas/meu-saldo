'use strict';
/* Criação e leitura de arquivos .zip simples (sem compactação), feitos no próprio navegador.
   Usado pelo backup: nada é enviado para a internet. */
const Zip = (() => {
  const TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    TABLE[n] = c >>> 0;
  }
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function dos(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

  /** files: [{ name, data: Uint8Array }] -> Blob (.zip) */
  function create(files) {
    if (files.length > 65000) throw new Error('Arquivos demais para um único backup.');
    const parts = [];
    const central = [];
    let offset = 0;
    const { time, date } = dos(new Date());
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint16(8, 0, true); h.setUint16(10, time, true); h.setUint16(12, date, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, name, data);

      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, time, true); c.setUint16(14, date, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(c.buffer, name);
      offset += 30 + name.length + data.length;
      if (offset > 0xFFFFFFF0) throw new Error('O backup ficou maior que 4 GB. Remova documentos grandes e tente de novo.');
    }
    const cdSize = central.reduce((s, b) => s + b.byteLength, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
  }

  /** Lê um .zip. Devolve { names, get(name) -> Uint8Array | null } */
  async function read(buffer) {
    const bad = () => new Error('Este arquivo não é um backup válido do app.');
    const u8 = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw bad();
    const files = new Map();
    try {
      const count = dv.getUint16(eocd + 10, true);
      let p = dv.getUint32(eocd + 16, true);
      for (let i = 0; i < count; i++) {
        if (dv.getUint32(p, true) !== 0x02014b50) throw bad();
        const method = dv.getUint16(p + 10, true);
        const crc = dv.getUint32(p + 16, true);
        const csize = dv.getUint32(p + 20, true);
        const usize = dv.getUint32(p + 24, true);
        const nlen = dv.getUint16(p + 28, true);
        const elen = dv.getUint16(p + 30, true);
        const clen = dv.getUint16(p + 32, true);
        const lho = dv.getUint32(p + 42, true);
        const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
        p += 46 + nlen + elen + clen;
        if (dv.getUint32(lho, true) !== 0x04034b50) throw bad();
        const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
        if (start + csize > u8.length) throw bad();
        if (!name.endsWith('/')) files.set(name, { method, crc, usize, raw: u8.subarray(start, start + csize) });
      }
    } catch (e) {
      throw bad();
    }
    return {
      names: [...files.keys()],
      async get(name) {
        const f = files.get(name);
        if (!f) return null;
        let data;
        if (f.method === 0) data = f.raw;
        else if (f.method === 8 && typeof DecompressionStream !== 'undefined') {
          const stream = new Blob([f.raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          data = new Uint8Array(await new Response(stream).arrayBuffer());
        } else throw new Error('O backup usa uma compactação que este navegador não lê.');
        if (data.length !== f.usize || crc32(data) !== f.crc) {
          throw new Error(`Uma parte do backup está corrompida (${name}). Nada foi alterado.`);
        }
        return data;
      },
    };
  }

  return { create, read, crc32 };
})();
