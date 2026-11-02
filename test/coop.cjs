// Кооператив: два браузера, комната, готовность, бой, метки, переподключение.
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:8080/';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctxA = await b.newContext({ viewport: { width: 1280, height: 650 } });
  const ctxB = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const A = await ctxA.newPage(), B = await ctxB.newPage();
  const errs = [];
  for (const [n, p] of [['A', A], ['B', B]]) { p.on('console', m => { if (m.type() === 'error') errs.push(n + ': ' + m.text()); }); p.on('pageerror', e => errs.push(n + ' PAGEERR ' + e.message)); }
  await A.goto(URL + '?speed=2', { waitUntil: 'domcontentloaded' }); await B.goto(URL + '?speed=2', { waitUntil: 'domcontentloaded' });
  await A.waitForTimeout(2000); await B.waitForTimeout(500);
  await A.fill('#in-name', 'Джамшид'); await B.fill('#in-name', 'Тимур');
  await A.click('#btn-create');
  await A.waitForFunction(() => /^[A-Z0-9]{4}$/.test(document.getElementById('lobby-code').textContent));
  const code = await A.textContent('#lobby-code');
  console.log('комната', code);
  await A.screenshot({ path: '/tmp/c_lobbyA_1.png' });
  await B.fill('#in-code', code.toLowerCase());
  await B.click('#btn-join');
  await B.waitForTimeout(800);
  const startDisabled = await A.$eval('#btn-start', e => e.disabled);
  console.log('кнопка «Начать» до готовности выключена:', startDisabled);
  await B.click('#btn-ready');
  await A.waitForTimeout(500);
  await A.screenshot({ path: '/tmp/c_lobbyA_2.png' });
  await B.screenshot({ path: '/tmp/c_lobbyB.png' });
  await A.click('#btn-start');
  await A.waitForTimeout(1200);
  await A.click('#btn-brief'); await B.click('#btn-brief');
  const COST = { shkval: 300, razryadnik: 700, nebosvod: 500, plant: 400 };
  const place = async (p, kind, tx, ty) => {
    for (let i = 0; i < 300; i++) {
      const c = await p.evaluate(() => { const s = window.__rubezh.snap; const me = s.pl.find(q => q[0] === window.__rubezh.session.you); return me[4] ? -1 : me[3]; });
      if (c >= COST[kind]) break; await p.waitForTimeout(100);
    }
    await p.evaluate(k => window.__rubezh.cameoClick(k), kind);
    for (let i = 0; i < 200; i++) {
      const r = await p.evaluate(() => { const s = window.__rubezh.snap; const me = s.pl.find(q => q[0] === window.__rubezh.session.you); return me[6]; });
      if (r) break; await p.waitForTimeout(100);
    }
    const [x, y] = await p.evaluate(([tx, ty]) => window.__rubezh.R.worldToScreen(tx + 0.5, 0, ty + 0.5), [tx, ty]);
    await p.mouse.move(x, y); await p.waitForTimeout(50); await p.mouse.click(x, y);
  };
  await Promise.all([place(A, 'shkval', 6, 5), place(B, 'shkval', 12, 6)]);
  await Promise.all([place(A, 'shkval', 6, 9), place(B, 'nebosvod', 13, 8)]);
  await Promise.all([place(A, 'razryadnik', 10, 9), place(B, 'shkval', 15, 8)]);
  // метка от B
  await B.click('#btn-ping');
  const [px, py] = await B.evaluate(() => window.__rubezh.R.worldToScreen(9.5, 0, 4.5));
  await B.mouse.click(px, py);
  await A.waitForTimeout(400);
  await A.screenshot({ path: '/tmp/c_gameA.png' });
  await B.screenshot({ path: '/tmp/c_gameB.png' });
  const sa = await A.evaluate(() => { const s = window.__rubezh.snap; return { pl: s.pl.map(p => [p[1], p[2], p[3]]), st: s.st.length, ph: s.ph, t: s.t }; });
  const sb = await B.evaluate(() => { const s = window.__rubezh.snap; return { pl: s.pl.map(p => [p[1], p[2], p[3]]), st: s.st.length, ph: s.ph, t: s.t }; });
  console.log('A видит', JSON.stringify(sa));
  console.log('B видит', JSON.stringify(sb));
  // переподключение B: перезагрузка страницы
  await B.reload({ waitUntil: 'domcontentloaded' });
  await B.waitForTimeout(3000);
  let resumed = await B.evaluate(() => ({ hud: !document.getElementById('hud').classList.contains('hidden'), st: window.__rubezh.snap ? window.__rubezh.snap.st.length : 0 }));
  console.log('B сразу после перезагрузки:', JSON.stringify(resumed));
  await B.screenshot({ path: '/tmp/c_gameB_reload.png' });
  // доиграть: оба вызывают волны, смотрим конец
  for (let i = 0; i < 500; i++) {
    const s = await A.evaluate(() => window.__rubezh.snap.ph);
    if (s === 'won' || s === 'lost') break;
    if (s === 'countdown') await A.click('#btn-wave').catch(() => {});
    await A.waitForTimeout(500);
  }
  await A.waitForTimeout(3500);
  await A.screenshot({ path: '/tmp/c_endA.png' });
  const endA = await A.evaluate(() => [window.__rubezh.snap.ph, window.__rubezh.snap.wv]);
  console.log('конец', JSON.stringify(endA));
  await A.click('#btn-again');
  await A.waitForTimeout(1000);
  const lobbyBackA = await A.evaluate(() => !document.getElementById('lobby').classList.contains('hidden'));
  console.log('после «В лобби» A видит лобби:', lobbyBackA);
  console.log('ошибки:', errs.length ? errs.join('\n') : 'нет');
  await b.close();
})();
