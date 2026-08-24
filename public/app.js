const colsEl = document.getElementById('cols');
const agentsEl = document.getElementById('agents');
const tokenInput = document.getElementById('board-token');
const STATUSES = ['todo', 'doing', 'blocked', 'done'];

if (tokenInput) {
  tokenInput.value = localStorage.getItem('boardToken') || '';
  tokenInput.addEventListener('change', () => {
    localStorage.setItem('boardToken', tokenInput.value.trim());
  });
}

function apiHeaders(extra) {
  const h = { 'Content-Type': 'application/json', ...extra };
  const t = (tokenInput?.value || localStorage.getItem('boardToken') || '').trim();
  if (t) h['X-Board-Token'] = t;
  return h;
}

async function api(path, opts) {
  const r = await fetch(path, {
    headers: apiHeaders(opts?.headers),
    ...opts,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.err || r.statusText);
  return j;
}

function renderMandate(m) {
  document.getElementById('goal').textContent = m.goal || '—';
  document.getElementById('focus').textContent = m.focus || '—';
  document.getElementById('done-when').textContent = m.done || '—';
  const ul = document.getElementById('rules');
  ul.innerHTML = (m.rules || []).map((r) => `<li>${escapeHtml(r)}</li>`).join('');
}

function renderProgress(p) {
  document.getElementById('pct').textContent = `${p.pct}%`;
  const fill = document.getElementById('bar-fill');
  fill.style.width = `${p.pct}%`;
  document.getElementById('bar').setAttribute('aria-valuenow', String(p.pct));
  const c = p.counts || {};
  document.getElementById('counts').innerHTML = STATUSES.map(
    (s) => `<span>${s}: <b>${c[s] || 0}</b></span>`,
  ).join('');
}

function ticketCard(t) {
  const deps = t.d?.length ? `<span class="chip">deps ${t.d.join(',')}</span>` : '';
  const agent = t.a ? `<span class="chip">${escapeHtml(t.a)}</span>` : '<span class="chip">ledig</span>';
  const actions =
    t.s === 'done'
      ? ''
      : `<div class="ticket-actions">
          ${t.s === 'todo' ? `<button type="button" data-act="claim" data-id="${t.id}">Claim</button>` : ''}
          ${t.s !== 'blocked' ? `<button type="button" data-act="block" data-id="${t.id}">Block</button>` : `<button type="button" data-act="todo" data-id="${t.id}">Unblock</button>`}
          <button type="button" class="primary" data-act="done" data-id="${t.id}">Done</button>
        </div>`;
  return `<article class="ticket s-${t.s}" data-id="${t.id}">
    <div class="id">${t.id} · P${t.p}</div>
    <p class="title">${escapeHtml(t.t)}</p>
    <div class="foot">${agent}${deps}<span class="chip p${t.p}">${t.s}</span></div>
    ${t.n ? `<p class="note">${escapeHtml(t.n)}</p>` : ''}
    ${actions}
  </article>`;
}

function renderTickets(tickets) {
  colsEl.innerHTML = STATUSES.map((s) => {
    const list = tickets
      .filter((t) => t.s === s)
      .sort((a, b) => a.p - b.p || a.id.localeCompare(b.id));
    return `<div class="col" data-s="${s}">
      <h3>${s} (${list.length})</h3>
      ${list.map(ticketCard).join('') || '<p class="note">Tom</p>'}
    </div>`;
  }).join('');
}

function renderAgents(agents) {
  agentsEl.innerHTML = Object.entries(agents || {})
    .map(
      ([id, a]) => `<div class="agent"><strong>${escapeHtml(id)}</strong>
        <span>${escapeHtml(a.role || '')}</span>
        <span>${a.ticket ? `→ ${a.ticket}` : 'idle'}</span></div>`,
    )
    .join('');
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function refresh() {
  const board = await api('/v1/board');
  renderMandate(board.mandate);
  renderProgress({
    pct: board.tickets.length
      ? Math.round((board.tickets.filter((t) => t.s === 'done').length / board.tickets.length) * 100)
      : 0,
    counts: board.tickets.reduce((acc, t) => {
      acc[t.s] = (acc[t.s] || 0) + 1;
      return acc;
    }, {}),
  });
  renderTickets(board.tickets);
  renderAgents(board.agents);
}

colsEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  try {
    if (act === 'claim') {
      const a = prompt('Agent-id', 'builder') || 'builder';
      await api(`/v1/tickets/${id}/claim`, { method: 'POST', body: JSON.stringify({ a }) });
    } else if (act === 'done') {
      const n = prompt('Note (≤140)', '') ?? '';
      await api(`/v1/tickets/${id}/done`, { method: 'POST', body: JSON.stringify({ n }) });
    } else if (act === 'block') {
      const n = prompt('Blocker note', 'blocked') ?? 'blocked';
      await api(`/v1/tickets/${id}`, { method: 'PATCH', body: JSON.stringify({ s: 'blocked', n }) });
    } else if (act === 'todo') {
      await api(`/v1/tickets/${id}`, { method: 'PATCH', body: JSON.stringify({ s: 'todo' }) });
    }
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('new-ticket').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('/v1/tickets', {
      method: 'POST',
      body: JSON.stringify({ t: fd.get('t'), p: Number(fd.get('p')) }),
    });
    e.target.reset();
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

const dlg = document.getElementById('mandate-dialog');
const form = document.getElementById('mandate-form');
document.getElementById('edit-mandate').addEventListener('click', async () => {
  const board = await api('/v1/board');
  form.goal.value = board.mandate.goal || '';
  form.focus.value = board.mandate.focus || '';
  form.done.value = board.mandate.done || '';
  form.rules.value = (board.mandate.rules || []).join('\n');
  dlg.showModal();
});

form.addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault();
  await api('/v1/mandate', {
    method: 'PATCH',
    body: JSON.stringify({
      g: form.goal.value,
      f: form.focus.value,
      d: form.done.value,
      r: form.rules.value.split('\n').map((x) => x.trim()).filter(Boolean),
    }),
  });
  dlg.close();
  await refresh();
});

refresh();
setInterval(refresh, 8000);
