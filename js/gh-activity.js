// <gh-pulse> — merged commits in the last twelve months, read in the
// visitor's browser from api.github.com. Falls back to a committed snapshot.
// Tells the scene how many lights to put on the trail.

const USER = 'raginpirate';
const TRACKED = ['Universal-Commerce-Protocol/ucp'];
const CACHE_KEY = 'gh-pulse-v2';
const CACHE_TTL = 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function getJSON(url) {
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

function fromEvents(events) {
  const out = [];
  for (const e of events) {
    const repo = e.repo?.name, at = e.created_at, p = e.payload || {};
    if (!repo || TRACKED.includes(repo)) continue; // tracked repos come from the commits call
    if (e.type === 'PushEvent') {
      for (const c of p.commits || []) out.push({ at, repo, sha: c.sha, detail: c.message?.split('\n')[0], url: `https://github.com/${repo}/commit/${c.sha}` });
    }
  }
  return out;
}

function fromCommits(repo, commits) {
  return commits.map((c) => ({ at: c.commit?.author?.date || c.commit?.committer?.date, repo, sha: c.sha, detail: c.commit?.message?.split('\n')[0], url: c.html_url })).filter((c) => c.at);
}

async function live() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.at < CACHE_TTL) return { ...cached.data, source: 'cache' };
  } catch { /* no storage */ }
  const results = await Promise.allSettled([
    getJSON(`https://api.github.com/users/${USER}/events/public?per_page=100`),
    ...TRACKED.map((r) => getJSON(`https://api.github.com/repos/${r}/commits?author=${USER}&per_page=100`)),
  ]);
  const commits = [];
  if (results[0].status === 'fulfilled') commits.push(...fromEvents(results[0].value));
  TRACKED.forEach((r, i) => { if (results[i + 1].status === 'fulfilled') commits.push(...fromCommits(r, results[i + 1].value)); });
  if (!commits.length) throw new Error('nothing from GitHub');
  const data = { commits, fetched: new Date().toISOString() };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* ignore */ }
  return { ...data, source: 'live' };
}

async function snapshot(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('no snapshot');
  return { ...(await r.json()), source: 'snapshot' };
}

export class GhPulse extends HTMLElement {
  async connectedCallback() {
    if (this._started) return;
    this._started = true;
    const snapUrl = this.getAttribute('snapshot');
    this.innerHTML = `<p class="gh-status">Reading GitHub…</p>`;
    let data = null;
    try { data = await live(); } catch { /* fall through */ }
    let snap = null;
    if (snapUrl) { try { snap = await snapshot(snapUrl); } catch { /* fine */ } }
    if (!data && !snap) { this.innerHTML = `<p class="gh-status">GitHub didn't answer. <a href="https://github.com/${USER}">github.com/${USER}</a></p>`; return; }
    const seen = new Set(), commits = [];
    for (const c of [...(data?.commits || []), ...(snap?.commits || [])]) { if (c.sha && !seen.has(c.sha)) { seen.add(c.sha); commits.push(c); } }
    commits.sort((a, b) => new Date(b.at) - new Date(a.at));

    const now = new Date(), months = [];
    for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: MONTHS[d.getMonth()], n: 0 }); }
    const idx = Object.fromEntries(months.map((m, i) => [m.key, i]));
    let total = 0;
    for (const c of commits) { const d = new Date(c.at); const k = `${d.getFullYear()}-${d.getMonth()}`; if (k in idx) { months[idx[k]].n++; total++; } }
    const max = Math.max(1, ...months.map((m) => m.n));
    const repos = new Set(commits.map((c) => c.repo)).size;
    const latest = commits.slice(0, 3);
    const note = data ? 'Live from GitHub.' : `Snapshot, ${new Date(snap.fetched).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}.`;

    this.innerHTML = `
      <p class="gh-sum"><strong>${total}</strong> merged commits in twelve months, ${repos} ${repos === 1 ? 'repo' : 'repos'}.</p>
      <div class="gh-pulse" role="img" aria-label="${total} commits by month">
        ${months.map((m) => `<span style="--v:${(m.n / max).toFixed(3)}" title="${m.label}: ${m.n}"><i>${m.label[0]}</i></span>`).join('')}
      </div>
      <ul class="gh-latest">
        ${latest.map((c) => `<li><a href="${esc(c.url)}" rel="noopener">${esc(c.detail || c.sha.slice(0, 7))}</a></li>`).join('')}
      </ul>
      <p class="gh-status">${note} <a href="https://github.com/${USER}" rel="noopener">All of it.</a></p>`;

    document.querySelector('ascent-scene')?.setTrailLights?.(total);
  }
}

customElements.define('gh-pulse', GhPulse);
