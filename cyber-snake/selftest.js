// 最小 DOM/canvas 打桩，把 index.html 的 <script> 整段跑一遍：
//   ① 页面内置自检（撞墙/吃食物/反向/难度/得分公式）通过，且不污染真实存档
//   ② GitHub 登录 + gist 读写（pull / push）跑通
const fs = require('fs'), vm = require('vm');
// 直接从页面里抠出 <script>，不生成中间文件
const src = fs.readFileSync(__dirname + '/index.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];

const ctxStub = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}) });
const nodes = {};
const store = { cyberSnakeTotal: '100', cyberSnakeBest: '50' };   // 预置存档，看自检会不会动它
let fails = 0;
const check = (c, m) => { if (c) console.log('  ✓', m); else { fails++; console.error('  ✗', m); } };

const sandbox = {
  document: {
    getElementById: id => (nodes[id] ||= { textContent: '', value: '', innerHTML: '',
                                           style: {}, blur() {}, addEventListener() {}, getContext: () => ctxStub }),
    createElement: () => ({ getContext: () => ctxStub }),
  },
  localStorage: new Proxy(store, { set: (t, k, v) => (t[k] = String(v), true) }),
  performance: { now: () => Date.now() },
  requestAnimationFrame() {},
  addEventListener() {},
  fetch: () => Promise.reject(new Error('no network')),
  Math, JSON, Date,
  console: { log: () => {}, assert: (c, m) => check(c, '页面自检：' + m) },
};
sandbox.window = sandbox;
vm.createContext(sandbox);

console.log('① 页面内置自检 + 存档不被污染');
vm.runInContext(src, sandbox, { filename: 'snake.js' });
check(+store.cyberSnakeTotal === 100 && +store.cyberSnakeBest === 50, '自检没有污染真实存档');

(async () => {
  console.log('\n② GitHub 登录 + gist 云同步');
  const calls = [];
  const json = (d, status = 200) => ({ ok: status < 300, status, json: async () => d });
  sandbox.fetch = async (url, opts = {}) => {
    calls.push({ m: opts.method || 'GET', p: url.replace('https://api.github.com', ''), body: opts.body });
    if (url.endsWith('/user')) return json({ login: 'octocat' });
    if (url.includes('/gists?per_page=100')) return json([]);           // 还没有存档
    if (url.endsWith('/gists') && opts.method === 'POST') return json({ id: 'G1' });
    if (url.endsWith('/gists/G1') && opts.method === 'PATCH') return json({});
    throw new Error('意外的请求 ' + url);
  };

  await vm.runInContext('token = "ghp_fake"; pull()', sandbox);
  check(vm.runInContext('user', sandbox) === 'octocat', '拉到账号：@octocat');
  check(vm.runInContext('gistId', sandbox) === 'G1', '没有存档时自动新建 gist');
  check(store.cyberSnakeGist === 'G1', 'gist id 记进 localStorage');

  const made = JSON.parse(calls.find(c => c.m === 'POST').body);
  check(made.description === 'cyber-snake-score' && made.public === false, '新建的 gist 私有且带认领用的 description');
  check(JSON.parse(made.files['cyber-snake.json'].content).total === 100, '用本地分数播种，不丢分');

  vm.runInContext('total = 777; best = 88; push()', sandbox);
  await new Promise(r => setTimeout(r, 0));
  const patch = calls.find(c => c.m === 'PATCH');
  check(!!patch, '游戏结束后 PATCH 存档');
  check(JSON.parse(JSON.parse(patch.body).files['cyber-snake.json'].content).total === 777, '总分写进 gist');
  check(store.cyberSnakeTotal === '777', '总分同时留在 localStorage（离线也在）');

  console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 全部通过');
  process.exit(fails ? 1 : 0);
})();
