// Сцены для проверки визуала: захват башни, нехватка энергии, режим стройки, пауза, итоги.
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:8080/';
const W = +(process.env.W || 1440), H = +(process.env.H || 900), TAG = process.env.TAG || 's';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: W, height: H } });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => !!window.__rubezh, null, { timeout: 60000 });
  await p.screenshot({ path: `/tmp/${TAG}_menu.png` });
  await p.click('#btn-solo'); await p.waitForTimeout(2500);
  await p.screenshot({ path: `/tmp/${TAG}_brief.png` });
  await p.click('#btn-brief');
  // расставить оборону прямо в симуляции
  await p.evaluate(() => {
    const g = window.__rubezh.session.game;
    const put = (k, x, y) => { const s = g.addStruct(k, 'me', x, y, true); g.emit({ e: 'build', id: s.id, kind: k, owner: 'me', x: x + .5, y: y + .5 }); return s; };
    put('shkval', 6, 5); put('shkval', 4, 8); put('razryadnik', 6, 9); put('nebosvod', 9, 6); put('razryadnik', 10, 9); put('shkval', 12, 6);
    put('nebosvod', 13, 8); put('razryadnik', 15, 8); put('plant', 18, 12); put('shkval', 17, 6);
    g.players[0].credits = 2500;
    g.wave = 4; g.countdown = 0.1;
  });
  // стройка: выбор места
  await p.evaluate(() => window.__rubezh.cameoClick('shkval'));
  await p.waitForTimeout(4800);
  const [x, y] = await p.evaluate(() => window.__rubezh.R.worldToScreen(8.5, 0, 9.5));
  await p.mouse.move(x, y); await p.waitForTimeout(300);
  await p.screenshot({ path: `/tmp/${TAG}_placing.png` });
  await p.mouse.click(x, y);
  // ждём захват
  for (let i = 0; i < 120; i++) {
    const c = await p.evaluate(() => window.__rubezh.snap.st.some(s => s[7]));
    if (c) { await p.waitForTimeout(400); await p.screenshot({ path: `/tmp/${TAG}_capture.png` }); break; }
    await p.waitForTimeout(250);
  }
  // приблизить к бою
  await p.evaluate(() => { const R = window.__rubezh.R; R.zoom = 1.9; R.centerOn(7, 7); });
  await p.waitForTimeout(600);
  await p.screenshot({ path: `/tmp/${TAG}_zoom.png` });
  await p.evaluate(() => { const R = window.__rubezh.R; R.zoom = 1; R.fit(); });
  // нехватка энергии
  await p.evaluate(() => { const g = window.__rubezh.session.game; for (const s of [...g.structs]) if (s.kind === 'plant') g.removeStruct(s, 'destroyed'); });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `/tmp/${TAG}_lowpower.png` });
  // пауза
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.screenshot({ path: `/tmp/${TAG}_pause.png` });
  await p.click('#btn-resume');
  // итоги
  await p.evaluate(() => { const g = window.__rubezh.session.game; g.damageStruct(g.hq, 5000); });
  await p.waitForTimeout(4000);
  await p.screenshot({ path: `/tmp/${TAG}_end.png` });
  await p.click('#btn-again'); await p.waitForTimeout(1500);
  const again = await p.evaluate(() => ({ st: window.__rubezh.snap.st.length, ph: window.__rubezh.snap.ph, cr: window.__rubezh.snap.pl[0][3] }));
  console.log('новая партия:', JSON.stringify(again));
  console.log('ошибки:', errs.length ? errs.join('\n') : 'нет');
  await b.close();
})();
