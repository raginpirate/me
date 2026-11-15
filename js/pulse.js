// <gh-pulse>: merged commits in the last twelve months, read in the visitor's browser, with a committed snapshot behind it.

const USER = 'raginpirate', REPOS = ['Universal-Commerce-Protocol/ucp'], CACHE = 'gh-pulse-v3', HOUR = 3600e3;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const safe = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function live() {
  try { const c = JSON.parse(localStorage[CACHE] || 'null'); if (c && Date.now() - c.at < HOUR) return c.data; } catch { /* no storage */ }
  const lists = await Promise.all(REPOS.map(async (repo) => {
    const r = await fetch(`https://api.github.com/repos/${repo}/commits?author=${USER}&per_page=100`, { headers: { Accept: 'application/vnd.github+json' } }); if (!r.ok) return [];
    return (await r.json()).map((c) => ({ at: c.commit.author?.date || c.commit.committer?.date, repo, sha: c.sha, detail: c.commit.message.split('\n')[0], url: c.html_url }));
  }));
  const data = lists.flat(); if (!data.length) throw new Error('nothing');
  try { localStorage[CACHE] = JSON.stringify({ at: Date.now(), data }); } catch { /* no storage */ }
  return data;
}

customElements.define('gh-pulse', class extends HTMLElement {
  async connectedCallback() {
    this.innerHTML = '<p class="gh-status">Reading GitHub…</p>';
    const [fresh, snap] = await Promise.all([live().catch(() => null), fetch(this.getAttribute('snapshot')).then((r) => r.json()).catch(() => null)]);
    if (!fresh && !snap) { this.innerHTML = `<p class="gh-status">GitHub didn't answer. <a href="https://github.com/${USER}" rel="noopener">github.com/${USER}</a></p>`; return; }
    const seen = new Set(), commits = [...(fresh || []), ...(snap?.commits || [])].filter((c) => c.sha && !seen.has(c.sha) && seen.add(c.sha)).sort((a, b) => new Date(b.at) - new Date(a.at));
    const now = new Date(), months = Array.from({ length: 12 }, (_, i) => { const m = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1); return { name: MONTHS[m.getMonth()], y: m.getFullYear(), m: m.getMonth(), n: 0 }; });
    for (const c of commits) { const at = new Date(c.at), slot = months.find((s) => s.y === at.getFullYear() && s.m === at.getMonth()); if (slot) slot.n++; }
    const total = months.reduce((n, s) => n + s.n, 0), most = Math.max(1, ...months.map((s) => s.n)), tall = (s) => Math.ceil(s.n / most * 4);
    const bars = [4, 3, 2, 1].map((row) => months.map((s) => tall(s) >= row ? '#' : row === 1 ? '.' : ' ').join(' ')).join('\n');
    const source = fresh ? 'Live from GitHub.' : `Snapshot, ${MONTHS[new Date(snap.fetched).getMonth()]} ${new Date(snap.fetched).getFullYear()}.`;
    this.innerHTML = `<p class="gh-sum"><strong>${total}</strong> merged commits in twelve months.</p>`
      + `<pre class="gh-bars" role="img" aria-label="${months.map((s) => `${s.name} ${s.n}`).join(', ')}">${bars}\n<span>${months.map((s) => s.name[0]).join(' ')}</span></pre>`
      + `<ul class="gh-latest">${commits.slice(0, 3).map((c) => `<li><a href="${safe(c.url)}" rel="noopener">${safe(c.detail || c.sha.slice(0, 7))}</a></li>`).join('')}</ul>`
      + `<p class="gh-status">${source} <a href="https://github.com/${USER}" rel="noopener">All of it.</a></p>`;
    this.total = total; this.dispatchEvent(new CustomEvent('gh-pulse', { bubbles: true, detail: total }));
  }
});
