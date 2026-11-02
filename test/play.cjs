// Партия через интерфейс: стройка через иконки, установка кликом по карте, снимки по ходу боя.
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:8080/';
const W = +(process.env.W || 1440), H = +(process.env.H || 900), TAG = process.env.TAG || 'a', SPEED = process.env.SPEED || 3;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: W, height: H } });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await p.goto(URL + (URL.includes('?') ? '&' : '?') + 'speed=' + SPEED);
  await p.waitForTimeout(2500);
  await p.click('#btn-solo');
  await p.waitForTimeout(600);
  await p.click('#btn-brief');
  const KINDS = ['shkval', 'razryadnik', 'nebosvod', 'plant'];
  const COST = { shkval: 300, razryadnik: 700, nebosvod: 500, plant: 400 };
  const order = [[1, 6, 5], [1, 12, 6], [2, 10, 9], [1, 6, 9], [3, 9, 6], [2, 15, 8], [4, 18, 12], [3, 13, 8], [2, 4, 8], [1, 17, 6], [2, 12, 3], [4, 19, 12], [2, 7, 2], [1, 2, 4]];
  let oi = 0, shots = 1, k = 0, last = '';
  const want = { sel: false };
  while (k++ < 4000) {
    const s = await p.evaluate(() => { const s = window.__rubezh.snap; const me = s.pl[0]; return { ph: s.ph, wv: s.wv, en: s.en.length, b: me[4], r: me[6], c: me[3], cap: s.st.some(x => x[7]), dr: s.en.some(e => e[5] & 2), boss: s.en.some(e => e[1] === 1), low: s.pw[1] > s.pw[0] }; });
    if (s.ph === 'won' || s.ph === 'lost') break;
    if (oi < order.length) {
      const [i, tx, ty] = order[oi];
      if (!s.b && s.c >= COST[KINDS[i - 1]]) await p.evaluate(kind => window.__rubezh.cameoClick(kind), KINDS[i - 1]);
      else if (s.b && s.r) {
        const [x, y] = await p.evaluate(([tx, ty]) => { const R = window.__rubezh.R; const [x, y] = R.worldToScreen(tx + 0.5, 0, ty + 0.5); return [x, y]; }, [tx, ty]);
        await p.mouse.move(x, y); await p.waitForTimeout(60);
        if (oi === 3 && shots < 9) await p.screenshot({ path: `/tmp/p_${TAG}_${shots++}_placing.png` });
        await p.mouse.click(x, y); oi++;
      }
    }
    const tag = s.cap ? 'capture' : s.dr ? 'drain' : s.boss ? 'brute' : s.en > 8 ? 'wave' + s.wv : '';
    if (tag && tag !== last && shots < 9) { last = tag; await p.screenshot({ path: `/tmp/p_${TAG}_${shots++}_${tag}.png` }); }
    if (!want.sel && oi > 3) {
      want.sel = true;
      const [x, y] = await p.evaluate(() => { const R = window.__rubezh.R; return R.worldToScreen(10.5, 0, 9.5); });
      await p.mouse.click(x, y);
      await p.waitForTimeout(200);
      await p.screenshot({ path: `/tmp/p_${TAG}_${shots++}_select.png` });
      await p.mouse.click(x, y, { button: 'right' });
    }
    await p.waitForTimeout(120);
  }
  await p.waitForTimeout(3500);
  await p.screenshot({ path: `/tmp/p_${TAG}_end.png` });
  const fin = await p.evaluate(() => { const s = window.__rubezh.snap; return { ph: s.ph, wv: s.wv, hq: s.hq, st: s.st.length }; });
  console.log('итог', JSON.stringify(fin), 'поставлено', oi);
  console.log('ошибки:', errs.length ? errs.join('\n') : 'нет');
  await b.close();
})();
