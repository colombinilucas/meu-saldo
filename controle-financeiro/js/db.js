'use strict';
/* Banco de dados local (IndexedDB). Tudo fica só neste aparelho/navegador.
   Valores em dinheiro são guardados em centavos inteiros (ex.: R$ 12,34 = 1234). */
const DB = (() => {
  const NAME = 'controle-financeiro';
  const VERSION = 2;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('Este navegador não permite guardar dados. Tente o Chrome, Edge, Firefox ou Safari atualizados.'));
        return;
      }
      let req;
      try { req = indexedDB.open(NAME, VERSION); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        // Criar somente o que ainda não existe: nunca apagar dados em atualizações.
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('incomes')) {
          db.createObjectStore('incomes', { keyPath: 'id' }).createIndex('month', 'month');
        }
        if (!db.objectStoreNames.contains('expenses')) {
          const s = db.createObjectStore('expenses', { keyPath: 'id' });
          s.createIndex('month', 'month');
          s.createIndex('recurringMonth', ['recurringId', 'month']);
        }
        if (!db.objectStoreNames.contains('recurring')) db.createObjectStore('recurring', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('docs')) {
          db.createObjectStore('docs', { keyPath: 'id' }).createIndex('month', 'month');
        }
        // Versão 2: conteúdo dos documentos (separado da lista), cofre e regras de categorias.
        if (!db.objectStoreNames.contains('docFiles')) db.createObjectStore('docFiles', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('goals')) db.createObjectStore('goals', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('goalMoves')) {
          const s = db.createObjectStore('goalMoves', { keyPath: 'id' });
          s.createIndex('goalId', 'goalId');
          s.createIndex('month', 'month');
        }
        if (!db.objectStoreNames.contains('rules')) db.createObjectStore('rules', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('bankIds')) db.createObjectStore('bankIds', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          alert('O app foi atualizado em outra aba. Esta página será recarregada.');
          location.reload();
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error('Não foi possível abrir o banco de dados.'));
      req.onblocked = () => reject(new Error('Feche as outras abas deste app e tente de novo.'));
    });
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
  }

  const reqP = (r) => new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

  /** Executa uma transação. A função recebe a transação e só deve usar requisições do IndexedDB. */
  async function tx(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let result;
      let t;
      try { t = db.transaction(stores, mode); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(friendly(t.error));
      t.onabort = () => reject(friendly(t.error) || new Error('A operação foi cancelada. Nada foi alterado.'));
      Promise.resolve()
        .then(() => fn(t))
        .then((v) => { result = v; })
        .catch((e) => { try { t.abort(); } catch (x) { /* já encerrada */ } reject(e); });
    });
  }

  function friendly(err) {
    if (!err) return err;
    if (err.name === 'QuotaExceededError') {
      const e = new Error('Não há espaço suficiente no aparelho para salvar. Libere espaço ou remova documentos grandes.');
      e.name = err.name;
      return e;
    }
    return err;
  }

  const api = {
    open,
    tx,
    get: (s, key) => tx([s], 'readonly', (t) => reqP(t.objectStore(s).get(key))),
    getAll: (s) => tx([s], 'readonly', (t) => reqP(t.objectStore(s).getAll())),
    put: (s, obj) => tx([s], 'readwrite', (t) => reqP(t.objectStore(s).put(obj))),
    del: (s, key) => tx([s], 'readwrite', (t) => reqP(t.objectStore(s).delete(key))),
    delMany: (s, keys) => tx([s], 'readwrite', async (t) => {
      const st = t.objectStore(s);
      for (const k of keys) await reqP(st.delete(k));
    }),
    putMany: (s, list) => tx([s], 'readwrite', async (t) => {
      const st = t.objectStore(s);
      for (const o of list) await reqP(st.put(o));
    }),

    /** Salva salário e outras receitas do mês de uma vez (substitui as do mês). */
    saveIncomes: (month, list) => tx(['incomes'], 'readwrite', async (t) => {
      const st = t.objectStore('incomes');
      const old = await reqP(st.index('month').getAll(month));
      const keep = new Set(list.map((i) => i.id));
      for (const o of old) if (!keep.has(o.id)) await reqP(st.delete(o.id));
      for (const o of list) await reqP(st.put(o));
    }),

    /** Lança uma conta fixa no mês. Retorna false se já existir lançamento dela no mês. */
    launchRecurring: (expense) => tx(['expenses'], 'readwrite', async (t) => {
      const st = t.objectStore('expenses');
      const found = await reqP(st.index('recurringMonth').getKey([expense.recurringId, expense.month]));
      if (found !== undefined) return false;
      await reqP(st.add(expense));
      return true;
    }),

    /** Exclui uma categoria e move gastos e contas fixas dela para outra. */
    deleteCategory: (id, moveTo) => tx(['categories', 'expenses', 'recurring'], 'readwrite', async (t) => {
      for (const name of ['expenses', 'recurring']) {
        const st = t.objectStore(name);
        const all = await reqP(st.getAll());
        for (const o of all) {
          if (o.categoryId === id) { o.categoryId = moveTo; await reqP(st.put(o)); }
        }
      }
      await reqP(t.objectStore('categories').delete(id));
    }),

    /** Salva um documento: a ficha (nome, mês, tipo…) e o conteúdo do arquivo juntos. */
    saveDoc: (meta, data) => tx(['docs', 'docFiles'], 'readwrite', async (t) => {
      await reqP(t.objectStore('docFiles').put({ id: meta.id, data }));
      await reqP(t.objectStore('docs').put(meta));
    }),
    getDocData: (id) => tx(['docFiles'], 'readonly', (t) => reqP(t.objectStore('docFiles').get(id)))
      .then((r) => (r ? r.data : null)),
    deleteDoc: (id) => tx(['docs', 'docFiles'], 'readwrite', async (t) => {
      await reqP(t.objectStore('docs').delete(id));
      await reqP(t.objectStore('docFiles').delete(id));
    }),

    /** Exclui um objetivo do cofre e todas as movimentações dele. */
    deleteGoal: (id) => tx(['goals', 'goalMoves'], 'readwrite', async (t) => {
      const st = t.objectStore('goalMoves');
      const keys = await reqP(st.index('goalId').getAllKeys(id));
      for (const k of keys) await reqP(st.delete(k));
      await reqP(t.objectStore('goals').delete(id));
    }),

    /** Grava um backup já validado, tudo numa única transação: ou entra tudo, ou nada muda.
     *  mode 'replace' apaga os dados deste aparelho antes; 'merge' junta. */
    importAll: (mode, data, files) => tx(
      ['categories', 'incomes', 'expenses', 'recurring', 'goals', 'goalMoves', 'rules', 'bankIds', 'docs', 'docFiles', 'settings'],
      'readwrite', async (t) => {
        const st = (n) => t.objectStore(n);
        const stores = ['categories', 'incomes', 'expenses', 'recurring', 'goals', 'goalMoves', 'rules', 'bankIds', 'docs', 'docFiles'];
        if (mode === 'replace') for (const n of stores) await reqP(st(n).clear());
        const catMap = new Map();
        if (mode === 'merge') {
          // Categoria com o mesmo nome aqui e no backup vira uma só.
          const existing = await reqP(st('categories').getAll());
          const byName = new Map(existing.map((c) => [c.name.toLocaleLowerCase('pt-BR'), c.id]));
          for (const c of data.categories) {
            const same = byName.get(c.name.toLocaleLowerCase('pt-BR'));
            if (same && same !== c.id) catMap.set(c.id, same);
          }
        }
        const cat = (id) => catMap.get(id) || id;
        for (const c of data.categories) if (!catMap.has(c.id)) await reqP(st('categories').put(c));
        for (const o of data.incomes) await reqP(st('incomes').put(o));
        for (const o of data.recurring) await reqP(st('recurring').put({ ...o, categoryId: cat(o.categoryId) }));
        for (const o of data.expenses) {
          if (mode === 'merge' && o.recurringId) {
            const k = await reqP(st('expenses').index('recurringMonth').getKey([o.recurringId, o.month]));
            if (k !== undefined && k !== o.id) continue; // conta fixa já lançada neste mês aqui
          }
          await reqP(st('expenses').put({ ...o, categoryId: cat(o.categoryId) }));
        }
        for (const o of data.goals) await reqP(st('goals').put(o));
        for (const o of data.goalMoves) await reqP(st('goalMoves').put(o));
        for (const o of data.rules) await reqP(st('rules').put({ ...o, categoryId: o.categoryId ? cat(o.categoryId) : o.categoryId }));
        for (const o of data.bankIds) await reqP(st('bankIds').put(o));
        for (const o of data.docs) {
          await reqP(st('docFiles').put({ id: o.id, data: files.get(o.id) }));
          await reqP(st('docs').put(o));
        }
        await reqP(st('settings').put({ key: 'categoriesSeeded', value: true }));
      },
    ),

    /** Grava o que foi escolhido do extrato OFX numa única transação.
     *  Movimentações já importadas antes (mesmo código) são puladas. */
    importBank: (items, rules) => tx(['expenses', 'incomes', 'bankIds', 'rules'], 'readwrite', async (t) => {
      const ids = t.objectStore('bankIds');
      let exp = 0; let inc = 0; let skipped = 0;
      for (const it of items) {
        if (await reqP(ids.getKey(it.bankKey)) !== undefined) { skipped++; continue; }
        await reqP(t.objectStore(it.kind === 'expense' ? 'expenses' : 'incomes').add(it.record));
        await reqP(ids.put({ id: it.bankKey, importedAt: Date.now(), recordId: it.record.id }));
        if (it.kind === 'expense') exp++; else inc++;
      }
      for (const r of rules) await reqP(t.objectStore('rules').put(r));
      return { exp, inc, skipped };
    }),

    /** Desfaz uma importação de extrato: apaga os lançamentos dela e libera para importar de novo. */
    undoImport: (importId) => tx(['expenses', 'incomes', 'bankIds'], 'readwrite', async (t) => {
      const ids = new Set();
      for (const n of ['expenses', 'incomes']) {
        const st = t.objectStore(n);
        const all = await reqP(st.getAll());
        for (const o of all) if (o.importId === importId) { ids.add(o.id); await reqP(st.delete(o.id)); }
      }
      const b = t.objectStore('bankIds');
      const all = await reqP(b.getAll());
      for (const o of all) if (ids.has(o.recordId)) await reqP(b.delete(o.id));
      return ids.size;
    }),

    /** Remove tudo que foi criado como dado de exemplo. */
    removeDemo: () => tx(['expenses', 'incomes', 'recurring', 'goals', 'goalMoves'], 'readwrite', async (t) => {
      let n = 0;
      for (const name of ['expenses', 'incomes', 'recurring', 'goals', 'goalMoves']) {
        const st = t.objectStore(name);
        const all = await reqP(st.getAll());
        for (const o of all) if (o.demo) { await reqP(st.delete(o.id)); n++; }
      }
      return n;
    }),
  };
  return api;
})();
