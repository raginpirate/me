// <gh-activity> — recent public GitHub activity, fetched in the visitor's
// browser straight from api.github.com. Falls back to a committed snapshot
// when the API is unreachable or rate-limited.

const USER = 'raginpirate';
const TRACKED = ['Universal-Commerce-Protocol/ucp'];
const CACHE_KEY = 'gh-activity-v1';
const CACHE_TTL = 60 * 60 * 1000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function relTime(iso) {
  const d = (Date.now() - new Date(iso)) / 1000;
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  if (d < 86400 * 30) return `${Math.round(d / 86400)} d ago`;
  const dt = new Date(iso);
  return `${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function getJSON(url) {
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// turn GitHub's event stream into plain items
function fromEvents(events) {
  const items = [];
  for (const e of events) {
    const repo = e.repo?.name, at = e.created_at, p = e.payload || {};
    if (!repo) continue;
    if (e.type === 'PushEvent') {
      const n = p.size ?? (p.commits?.length || 0);
      const msg = p.commits?.[p.commits.length - 1]?.message?.split('\n')[0];
      items.push({ at, repo, kind: 'push', text: `Pushed ${n} commit${n === 1 ? '' : 's'}`, detail: msg, url: `https://github.com/${repo}` });
    } else if (e.type === 'PullRequestEvent') {
      const pr = p.pull_request || {};
      const verb = p.action === 'closed' && pr.merged ? 'Merged' : p.action === 'opened' ? 'Opened' : p.action === 'closed' ? 'Closed' : null;
      if (!verb) continue;
      items.push({ at, repo, kind: 'pr', text: `${verb} #${pr.number}`, detail: pr.title, url: pr.html_url });
    } else if (e.type === 'PullRequestReviewEvent') {
      const pr = p.pull_request || {};
      items.push({ at, repo, kind: 'review', text: `Reviewed #${pr.number}`, detail: pr.title, url: pr.html_url });
    } else if (e.type === 'IssuesEvent' && p.action === 'opened') {
      items.push({ at, repo, kind: 'issue', text: `Opened issue #${p.issue?.number}`, detail: p.issue?.title, url: p.issue?.html_url });
    } else if (e.type === 'IssueCommentEvent' || e.type === 'PullRequestReviewCommentEvent') {
      const i = p.issue || p.pull_request || {};
      items.push({ at, repo, kind: 'comment', text: `Commented on #${i.number}`, detail: i.title, url: p.comment?.html_url || i.html_url });
    } else if (e.type === 'CreateEvent' && p.ref_type === 'repository') {
      items.push({ at, repo, kind: 'create', text: 'Created repository', url: `https://github.com/${repo}` });
    }
  }
  return items;
}

function fromCommits(repo, commits) {
  return commits.map((c) => ({
    at: c.commit?.author?.date || c.commit?.committer?.date,
    repo,
    kind: 'commit',
    text: 'Merged',
    detail: c.commit?.message?.split('\n')[0],
    url: c.html_url,
    sha: c.sha,
  })).filter((c) => c.at);
}

async function load() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.at < CACHE_TTL) return { ...cached.data, source: 'cache' };
  } catch { /* storage unavailable */ }

  const [events, ...tracked] = await Promise.allSettled([
    getJSON(`https://api.github.com/users/${USER}/events/public?per_page=100`),
    ...TRACKED.map((r) => getJSON(`https://api.github.com/repos/${r}/commits?author=${USER}&per_page=100`)),
  ]);

  const items = events.status === 'fulfilled' ? fromEvents(events.value) : [];
  const commits = [];
  tracked.forEach((t, i) => { if (t.status === 'fulfilled') commits.push(...fromCommits(TRACKED[i], t.value)); });
  if (!items.length && !commits.length) throw new Error('nothing from GitHub');

  const data = { items, commits, fetched: new Date().toISOString() };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* ignore */ }
  return { ...data, source: 'live' };
}

async function loadSnapshot(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('no snapshot');
  const data = await r.json();
  return { ...data, source: 'snapshot' };
}

// a 12-month strip of commit counts
function pulse(commits, items) {
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: MONTHS[d.getMonth()], year: d.getFullYear(), n: 0 });
  }
  const idx = Object.fromEntries(months.map((m, i) => [m.key, i]));
  const bump = (iso, w) => { const d = new Date(iso); const k = `${d.getFullYear()}-${d.getMonth()}`; if (k in idx) months[idx[k]].n += w; };
  const seen = new Set(commits.map((c) => c.sha));
  commits.forEach((c) => bump(c.at, 1));
  // pushes elsewhere count too, but don't double-count tracked repos
  items.forEach((i) => { if (i.kind === 'push' && !TRACKED.includes(i.repo)) bump(i.at, 1); });
  return { months, seen };
}

export class GhActivity extends HTMLElement {
  async connectedCallback() {
    if (this._started) return;
    this._started = true;
    this.snapshot = this.getAttribute('snapshot');
    this.render({ loading: true });
    let data;
    try { data = await load(); }
    catch { try { data = await loadSnapshot(this.snapshot); } catch { data = null; } }
    if (!data) { this.render({ failed: true }); return; }
    // merge: the snapshot holds commits the live feed may have aged out of
    if (data.source !== 'snapshot' && this.snapshot) {
      try {
        const snap = await loadSnapshot(this.snapshot);
        const have = new Set(data.commits.map((c) => c.sha));
        snap.commits.forEach((c) => { if (!have.has(c.sha)) data.commits.push(c); });
      } catch { /* fine without it */ }
    }
    this.render(data);
  }

  render(state) {
    if (state.loading) { this.innerHTML = `<p class="gh-status">Reading GitHub…</p>`; return; }
    if (state.failed) { this.innerHTML = `<p class="gh-status">GitHub didn't answer. The work is still there: <a href="https://github.com/${USER}">github.com/${USER}</a>.</p>`; return; }

    const commits = [...(state.commits || [])].sort((a, b) => new Date(b.at) - new Date(a.at));
    const items = [...(state.items || [])].sort((a, b) => new Date(b.at) - new Date(a.at));
    const { months } = pulse(commits, items);
    const max = Math.max(1, ...months.map((m) => m.n));
    const total = months.reduce((s, m) => s + m.n, 0);

    // the feed: recent events first, then merged commits to fill in
    const feed = [];
    const seenKey = new Set();
    for (const i of items) {
      const k = `${i.kind}:${i.repo}:${i.text}:${i.detail}`;
      if (seenKey.has(k)) continue; seenKey.add(k); feed.push(i);
      if (feed.length >= 8) break;
    }
    const feedShas = new Set();
    for (const c of commits) {
      if (feed.length >= 12) break;
      if (feed.some((f) => f.detail && c.detail && f.detail === c.detail)) continue;
      if (feedShas.has(c.sha)) continue; feedShas.add(c.sha); feed.push(c);
    }
    feed.sort((a, b) => new Date(b.at) - new Date(a.at));

    const repos = [...new Set([...items, ...commits].map((i) => i.repo))];
    const sourceNote = state.source === 'snapshot'
      ? `Snapshot from ${new Date(state.fetched).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}; GitHub's API was unreachable.`
      : `Live from GitHub${state.source === 'cache' ? ', cached this hour' : ''}.`;

    this.innerHTML = `
      <div class="gh-pulse" role="img" aria-label="${total} commits in the last twelve months">
        ${months.map((m) => `<div class="gh-bar" style="--v:${(m.n / max).toFixed(3)}" title="${m.label} ${m.year}: ${m.n}"><span>${m.label[0]}</span></div>`).join('')}
      </div>
      <p class="gh-sum"><strong>${total}</strong> merged commits in the last twelve months across ${repos.length} ${repos.length === 1 ? 'repository' : 'repositories'}.</p>
      <ol class="gh-feed">
        ${feed.map((f) => `
          <li>
            <a href="${esc(f.url)}" rel="noopener">
              <span class="gh-when">${relTime(f.at)}</span>
              <span class="gh-what">${esc(f.text)}${f.detail ? ` <em>${esc(f.detail)}</em>` : ''}</span>
              <span class="gh-repo">${esc(f.repo.replace('Universal-Commerce-Protocol', 'UCP'))}</span>
            </a>
          </li>`).join('')}
      </ol>
      <p class="gh-status">${sourceNote} <a href="https://github.com/${USER}" rel="noopener">All of it on GitHub.</a></p>`;
  }
}

customElements.define('gh-activity', GhActivity);
