const { chromium } = require('playwright-core');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath() });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const root = __dirname;
    const origin = 'http://forum.test';
    const mock = `
      const post = { id: 'p1', authorId: 'u2', authorNick: 'Автор', title: 'Тестовая тема', body: '<p>Тестовый текст</p>'.repeat(40), category: 'vs', createdAt: new Date(), commentCount: 0, reactions: {}, views: 0 };
      export const forum = {
        name: 'Test', capabilities: { isShared: true }, isReady: async () => true,
        currentUser: async () => ({ id: 'u1', nick: 'Модератор', role: 'moderator' }),
        listNotifications: async () => [], registerView: async () => {}, listComments: async () => [],
        getPost: async () => post, listPosts: async () => ({ posts: [post], total: 1 }),
        deletePost: async (id, reason) => { if (window.failDelete) throw new Error('Тестовый отказ'); window.deleted = { id, reason }; },
        report: async data => { window.reported = data; }
      };`;
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/src/forum/index.js') return route.fulfill({ contentType: 'text/javascript', body: mock });
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1">${['styles-v8','forum','mobile','controls','refine'].map(n => `<link rel="stylesheet" href="/src/${n}.css">`).join('')}</head><body><header style="height:100px">Test</header><main id="app" class="wrap"></main><script type="module">import { mountForum, unmountForum } from '/src/forum/mount.js'; window.unmountForum = unmountForum; await mountForum(document.querySelector('#app'), {events: [], alliances: [], texts: []}, 'p1'); window.ready = true;</script></body></html>` });
      try {
        const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        if (!filename.startsWith(root + path.sep)) return route.abort();
        const body = await readFile(filename);
        return route.fulfill({ body, contentType: filename.endsWith('.css') ? 'text/css' : 'text/javascript' });
      } catch { return route.fulfill({ status: 404, body: '' }); }
    });
    for (const width of [1440, 1024, 390]) {
      for (const theme of ['dark', 'light']) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(origin);
        await page.waitForFunction(() => window.ready);
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        await page.waitForTimeout(900);
        const modal = page.locator('[data-forum-delete-modal]');
        const open = async () => {
          await page.locator('.forum-act-menu > summary').click();
          await page.locator('[data-forum-del-post]').click();
          const bounds = await modal.boundingBox();
          assert(bounds && Math.abs(bounds.x) < 1 && Math.abs(bounds.y) < 1);
          const box = await modal.locator('.forum-modal__box').boundingBox();
          assert(box && box.y >= 0 && box.y + box.height <= 901);
          assert(await modal.locator('[data-forum-delete-rules]').isVisible());
        };
        const unlocked = async () => {
          assert(await modal.isHidden());
          assert.equal(await page.evaluate(() => document.documentElement.classList.contains('is-modal-open')), false);
          await page.waitForTimeout(400);
          await page.evaluate(() => window.scrollTo(0, 500));
          await page.waitForTimeout(200);
          const before = await page.evaluate(() => window.scrollY);
          assert(before > 0);
          await page.mouse.move(width - 15, 300);
          await page.mouse.wheel(0, -180);
          await page.waitForFunction(y => window.scrollY < y, before);
          const above = await page.evaluate(() => window.scrollY);
          await page.mouse.wheel(0, 180);
          await page.waitForFunction(y => window.scrollY > y, above);
        };
        await open();
        await modal.locator('[data-forum-delete-cancel]').click();
        await unlocked();
        await open();
        await page.keyboard.press('Escape');
        await unlocked();
        await open();
        await modal.click({ position: { x: 4, y: 4 } });
        await unlocked();
        await open();
        await modal.locator('button[type="submit"]').click();
        assert(await modal.locator('[data-forum-delete-error]').isVisible());
        await modal.locator('input[name="ruleId"]').first().check();
        await modal.locator('input[name="note"]').fill('Тестовая причина');
        await page.evaluate(() => window.failDelete = true);
        await modal.locator('button[type="submit"]').click();
        await page.waitForFunction(() => document.querySelector('[data-forum-delete-error]').textContent === 'Тестовый отказ');
        await page.evaluate(() => window.failDelete = false);
        await modal.locator('button[type="submit"]').click();
        await page.waitForFunction(() => window.deleted);
        assert((await page.evaluate(() => window.deleted.reason)).includes('Тестовая причина'));
        await unlocked();
        await open();
        await page.evaluate(() => window.unmountForum());
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('is-modal-open')), false);
        assert.deepEqual(errors, []);
        console.log(`PASS ${width}px ${theme}: menu, modal bounds, cancel, Escape, backdrop, validation, failure, submit, unmount, wheel up/down, no JS errors`);
      }
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
