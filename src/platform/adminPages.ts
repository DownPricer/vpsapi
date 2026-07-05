import type { AppEnv } from "../config/env";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderAdminLoginPage(env: AppEnv): string {
  const enabled = env.platformAdminEnabled;
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Platform Admin — Login</title>
  <style>
    :root { color-scheme: light; --bg:#0b1220; --card:#0f1b33; --text:#e8eefc; --muted:#a8b3d1; --accent:#6ea8fe; --danger:#ff6b6b; --ok:#2ecc71; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background: radial-gradient(1200px 600px at 10% 10%, #1b2a55, var(--bg)); color: var(--text); }
    .wrap { max-width: 460px; margin: 10vh auto; padding: 0 16px; }
    .card { background: rgba(15,27,51,.92); border: 1px solid rgba(255,255,255,.08); border-radius: 14px; padding: 20px; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
    h1 { margin: 0 0 6px; font-size: 20px; }
    p { margin: 0 0 16px; color: var(--muted); font-size: 14px; line-height: 1.4; }
    label { display:block; margin: 10px 0 6px; font-size: 13px; color: var(--muted); }
    input { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06); color: var(--text); outline: none; }
    input:focus { border-color: rgba(110,168,254,.6); box-shadow: 0 0 0 3px rgba(110,168,254,.18); }
    button { width: 100%; margin-top: 14px; padding: 10px 12px; border-radius: 10px; border: 0; background: var(--accent); color: #081122; font-weight: 700; cursor: pointer; }
    button[disabled] { opacity: .6; cursor: not-allowed; }
    .row { display:flex; gap: 10px; margin-top: 10px; }
    .pill { display:inline-block; padding: 3px 8px; border-radius: 999px; font-size: 12px; border: 1px solid rgba(255,255,255,.12); color: var(--muted); }
    .err { margin-top: 12px; color: var(--danger); font-size: 13px; min-height: 18px; }
    .hint { margin-top: 14px; font-size: 12px; color: rgba(255,255,255,.55); }
    a { color: var(--accent); text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="row" style="align-items:center; justify-content:space-between;">
        <h1>Platform Admin</h1>
        <span class="pill">${enabled ? "activé" : "désactivé"}</span>
      </div>
      <p>Connexion super-admin (isolée de l’auth pro). Les identifiants sont seedés via variables d’environnement.</p>
      <form id="f">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" required />
        <label for="password">Mot de passe</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required />
        <button id="btn" type="submit">Se connecter</button>
        <div id="err" class="err"></div>
      </form>
      <div class="hint">
        API: <code>${escapeHtml(env.nodeEnv)}</code> — URL: <code>/api/platform/auth/login</code>
      </div>
    </div>
  </div>
  <script>
    (function(){
      const f = document.getElementById('f');
      const btn = document.getElementById('btn');
      const err = document.getElementById('err');
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.textContent = '';
        btn.disabled = true;
        try {
          const email = document.getElementById('email').value || '';
          const password = document.getElementById('password').value || '';
          const r = await fetch('/api/platform/auth/login', {
            method:'POST',
            headers:{'Content-Type':'application/json; charset=utf-8'},
            credentials:'include',
            body: JSON.stringify({ email, password })
          });
          const data = await (async()=>{ try { return await r.json(); } catch { return null; } })();
          if (!r.ok || !data || data.success !== true) {
            err.textContent = (data && data.error && data.error.message) ? data.error.message : ('Erreur ('+r.status+')');
            return;
          }
          window.location.href = '/admin';
        } catch (e) {
          err.textContent = 'Erreur réseau.';
        } finally {
          btn.disabled = false;
        }
      });
    })();
  </script>
</body>
</html>`;
}

export function renderAdminAppPage(): string {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Platform Admin — Dashboard</title>
  <style>
    :root { color-scheme: light; --bg:#0b1220; --panel:#0f1b33; --text:#e8eefc; --muted:#a8b3d1; --accent:#6ea8fe; --warn:#f1c40f; --danger:#ff6b6b; --ok:#2ecc71; --border: rgba(255,255,255,.10); }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background: linear-gradient(180deg, #0b1220, #070b14); color: var(--text); }
    header { position: sticky; top:0; background: rgba(11,18,32,.88); backdrop-filter: blur(10px); border-bottom: 1px solid var(--border); }
    .bar { max-width: 1180px; margin: 0 auto; padding: 12px 16px; display:flex; align-items:center; gap: 12px; }
    .brand { font-weight: 800; letter-spacing: .2px; }
    .spacer { flex: 1; }
    .btn { background: rgba(110,168,254,.14); border: 1px solid rgba(110,168,254,.35); color: var(--text); padding: 8px 10px; border-radius: 10px; cursor:pointer; }
    .btn.danger { background: rgba(255,107,107,.12); border-color: rgba(255,107,107,.35); }
    .btn.primary { background: rgba(110,168,254,.22); border-color: rgba(110,168,254,.55); }
    main { max-width: 1180px; margin: 0 auto; padding: 16px; }
    .grid { display:grid; grid-template-columns: repeat(12, 1fr); gap: 12px; }
    .card { grid-column: span 3; background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 12px; }
    .card h3 { margin: 0 0 6px; font-size: 13px; color: var(--muted); font-weight: 700; }
    .big { font-size: 22px; font-weight: 900; }
    .row { display:flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .pill { padding: 3px 8px; border-radius: 999px; font-size: 12px; border: 1px solid var(--border); color: var(--muted); }
    .input { padding: 8px 10px; border-radius: 10px; border: 1px solid var(--border); background: rgba(255,255,255,.05); color: var(--text); outline:none; }
    table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 14px; border:1px solid var(--border); background: var(--panel); }
    th, td { padding: 10px 10px; border-bottom: 1px solid rgba(255,255,255,.08); font-size: 13px; vertical-align: top; }
    th { text-align:left; color: var(--muted); font-weight: 700; background: rgba(255,255,255,.03); }
    tr:hover td { background: rgba(255,255,255,.03); }
    .muted { color: var(--muted); }
    .tag { display:inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; border: 1px solid var(--border); }
    .tag.ok { border-color: rgba(46,204,113,.4); color: rgba(46,204,113,.95); }
    .tag.warn { border-color: rgba(241,196,15,.45); color: rgba(241,196,15,.95); }
    .tag.bad { border-color: rgba(255,107,107,.45); color: rgba(255,107,107,.95); }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .split { display:grid; grid-template-columns: 1fr 420px; gap: 12px; align-items:start; }
    @media (max-width: 1100px) { .card{grid-column: span 6;} .split{grid-template-columns: 1fr;} }
    @media (max-width: 720px) { .card{grid-column: span 12;} th:nth-child(6), td:nth-child(6), th:nth-child(7), td:nth-child(7) { display:none; } }
    pre { white-space: pre-wrap; word-break: break-word; margin:0; color: var(--text); }
    .nav { display:flex; gap: 8px; align-items:center; }
    .nav a { color: var(--muted); text-decoration:none; padding: 6px 8px; border-radius: 10px; border: 1px solid transparent; }
    .nav a.active { color: var(--text); background: rgba(255,255,255,.05); border-color: rgba(255,255,255,.10); }
  </style>
</head>
<body>
  <header>
    <div class="bar">
      <div class="brand">Platform Admin</div>
      <span id="me" class="pill">…</span>
      <div class="nav">
        <a id="nav-overview" href="/admin#overview">Overview</a>
        <a id="nav-sites" href="/admin#sites">Sites</a>
        <a id="nav-events" href="/admin#events">Events</a>
        <a id="nav-health" href="/admin#health">Health</a>
      </div>
      <div class="spacer"></div>
      <select id="range" class="input">
        <option value="24h">24h</option>
        <option value="7d">7j</option>
        <option value="30d" selected>30j</option>
        <option value="90d">90j</option>
        <option value="all">total</option>
      </select>
      <input id="q" class="input" placeholder="Rechercher (nom, domaine, email…)" style="min-width:260px" />
      <button id="reload" class="btn">Rafraîchir</button>
      <button id="logout" class="btn danger">Logout</button>
    </div>
  </header>
  <main>
    <section id="view-overview">
      <div class="grid" id="cards"></div>
    </section>

    <section id="view-sites" style="display:none">
      <div class="split" style="margin-top:12px;">
        <div>
          <h2 style="margin: 6px 0 10px; font-size:16px;">Sites</h2>
          <div id="sites"></div>
        </div>
        <div>
          <h2 style="margin: 6px 0 10px; font-size:16px;">Fiche site</h2>
          <div id="siteDetail" class="card" style="grid-column: span 12; padding: 12px;"></div>
          <h2 style="margin: 12px 0 10px; font-size:16px;">Événements (tenant)</h2>
          <div id="events" class="card" style="grid-column: span 12; padding: 12px;"></div>
        </div>
      </div>
    </section>

    <section id="view-events" style="display:none">
      <h2 style="margin: 6px 0 10px; font-size:16px;">Events / logs</h2>
      <div class="row" style="margin-bottom: 10px;">
        <input id="evTenant" class="input" placeholder="tenantId (optionnel)" style="min-width:220px" />
        <input id="evType" class="input" placeholder="type (optionnel)" style="min-width:220px" />
        <button id="evReload" class="btn primary">Charger</button>
      </div>
      <div id="eventsGlobal" class="card" style="padding: 12px;"></div>
    </section>

    <section id="view-health" style="display:none">
      <h2 style="margin: 6px 0 10px; font-size:16px;">Health</h2>
      <div id="healthBox" class="card" style="padding: 12px;"></div>
    </section>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    const fmtCents = (n) => {
      const v = Number(n||0);
      return (v/100).toLocaleString('fr-FR', { style:'currency', currency:'EUR' });
    };
    const tag = (label, cls) => '<span class="tag '+cls+'">'+label+'</span>';
    const safe = (s) => (s==null?'':String(s)).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    const api = async (url, opts={}) => {
      const r = await fetch(url, { credentials:'include', ...opts });
      if (r.status === 401) { window.location.href='/admin/login'; return null; }
      let j = null;
      try { j = await r.json(); } catch {}
      if (!r.ok || !j || j.success !== true) throw new Error((j&&j.error&&j.error.message) ? j.error.message : ('Erreur '+r.status));
      return j.data;
    };

    let currentTenantId = null;

    async function loadMe() {
      try {
        const me = await api('/api/platform/me');
        if (me) $('me').textContent = me.email + ' · ' + me.role;
      } catch { $('me').textContent = 'non connecté'; }
    }

    function renderCards(ov) {
      const items = [
        ['Tenants (total)', ov.tenants.total],
        ['Tenants actifs', ov.tenants.active],
        ['Leads (total)', ov.leads.total],
        ['Leads ('+ov.range+')', ov.leads.inRange],
        ['Paiements réussis (total)', ov.payments.paidTotal],
        ['Paiements réussis ('+ov.range+')', ov.payments.paidInRange],
        ['CA payé (total)', fmtCents(ov.payments.amountPaidTotalCents)],
        ['CA payé ('+ov.range+')', fmtCents(ov.payments.amountPaidInRangeCents)],
      ];
      $('cards').innerHTML = items.map(([k,v]) => (
        '<div class="card"><h3>'+safe(k)+'</h3><div class="big">'+safe(v)+'</div></div>'
      )).join('');
    }

    function stripeStatus(s) {
      if (!s.accountIdPresent) return tag('Stripe: non connecté', 'bad');
      if (s.chargesEnabled && s.detailsSubmitted) return tag('Stripe: OK', 'ok');
      return tag('Stripe: onboarding', 'warn');
    }

    function renderSites(list) {
      const rows = list.sites.map((s) => {
        const url = s.siteUrl ? '<a class="mono" href="'+safe(s.siteUrl)+'" target="_blank" rel="noreferrer">'+safe(s.siteUrl)+'</a>' : '<span class="muted">—</span>';
        const admin = s.adminUrl ? '<a class="mono" href="'+safe(s.adminUrl)+'" target="_blank" rel="noreferrer">admin</a>' : '<span class="muted">—</span>';
        const active = s.active ? tag('actif','ok') : tag('inactif','warn');
        const pay = s.payment.onlineEnabled ? tag('paiement: ON','ok') : tag('paiement: OFF','warn');
        return '<tr data-tenant="'+safe(s.tenantId)+'">'+
          '<td class="mono">'+safe(s.tenantId)+'</td>'+
          '<td><div style="font-weight:800">'+safe(s.name||'')+'</div><div class="muted">'+safe(s.companyName||'')+'</div></td>'+
          '<td>'+url+'<div class="muted">'+safe(s.email||'')+' · '+safe(s.phone||'')+'</div></td>'+
          '<td>'+active+' '+stripeStatus(s.stripe)+' '+pay+'</td>'+
          '<td>'+safe(s.metrics.leadsTotal)+' <span class="muted">(+'+safe(s.metrics.leadsInRange)+')</span></td>'+
          '<td>'+fmtCents(s.metrics.amountPaidTotalCents)+'</td>'+
          '<td>'+fmtCents(s.metrics.amountPaidInRangeCents)+'</td>'+
          '<td>'+admin+'</td>'+
        '</tr>';
      }).join('');

      $('sites').innerHTML = '<table><thead><tr>'+
        '<th>tenantId</th><th>Nom</th><th>Domaine / contact</th><th>Statuts</th><th>Leads</th><th>CA total</th><th>CA '+safe(list.range)+'</th><th>Admin pro</th>'+
      '</tr></thead><tbody>'+rows+'</tbody></table>';

      $('sites').querySelectorAll('tr[data-tenant]').forEach((tr) => {
        tr.addEventListener('click', () => loadTenant(tr.getAttribute('data-tenant')));
      });
    }

    function renderDetail(site, audit, events) {
      const a = audit ? audit.audit : null;
      currentTenantId = site ? site.tenantId : null;
      $('siteDetail').innerHTML = site ? (
        '<div class="row"><span class="pill mono">'+safe(site.tenantId)+'</span>' +
        (site.active ? tag('actif','ok') : tag('inactif','warn')) +
        '</div>' +
        '<div style="margin-top:8px; font-weight:900; font-size:16px;">'+safe(site.name||'')+'</div>' +
        '<div class="muted">'+safe(site.companyName||'')+'</div>' +
        '<div style="margin-top:10px" class="row">' +
          '<span class="pill">Email: '+safe(site.contact.email||'—')+'</span>' +
          '<span class="pill">Tel: '+safe(site.contact.phone||'—')+'</span>' +
          '<span class="pill">Ville: '+safe(site.city||'—')+'</span>' +
        '</div>' +
        '<div style="margin-top:10px" class="row">' +
          '<span class="pill">URL: '+(site.siteUrl ? '<a href="'+safe(site.siteUrl)+'" target="_blank" rel="noreferrer">'+safe(site.siteUrl)+'</a>' : '—')+'</span>' +
          '<span class="pill">Admin: '+(site.adminUrl ? '<a href="'+safe(site.adminUrl)+'" target="_blank" rel="noreferrer">'+safe(site.adminUrl)+'</a>' : '—')+'</span>' +
        '</div>' +
        '<div class="row" style="margin-top:10px">' +
          (site.siteUrl ? '<a class="btn" href="'+safe(site.siteUrl)+'" target="_blank" rel="noreferrer">Ouvrir site</a>' : '') +
          (site.adminUrl ? '<a class="btn" href="'+safe(site.adminUrl)+'" target="_blank" rel="noreferrer">Ouvrir admin pro</a>' : '') +
          '<button id="btnAuditDl" class="btn">Télécharger audit JSON</button>' +
        '</div>' +
        (a ? (
          '<div style="margin-top:12px; border-top:1px solid rgba(255,255,255,.10); padding-top:10px;">' +
            '<div class="row"><strong>Audit contenu</strong> ' +
            (a.readinessScore >= 85 ? tag('prêt '+a.readinessScore+'%','ok') : a.readinessScore >= 60 ? tag('à revoir '+a.readinessScore+'%','warn') : tag('risque '+a.readinessScore+'%','bad')) +
            '</div>' +
            '<div class="muted" style="margin-top:6px">'+safe((a.warnings||[]).join(' · ')||'—')+'</div>' +
          '</div>'
        ) : '<div class="muted" style="margin-top:12px">Audit: non disponible</div>')
      ) : '<div class="muted">Cliquez un site dans la table.</div>';

      $('events').innerHTML = events ? (
        '<div class="muted" style="margin-bottom:8px">'+safe(events.count)+' événement(s)</div>' +
        '<pre class="mono" style="font-size:12px; max-height: 420px; overflow:auto;">'+safe(JSON.stringify(events.events.slice(0,50), null, 2))+'</pre>'
      ) : '<div class="muted">—</div>';

      const btn = document.getElementById('btnAuditDl');
      if (btn) {
        btn.addEventListener('click', async () => {
          if (!currentTenantId) return;
          try {
            const data = await api('/api/platform/sites/'+encodeURIComponent(currentTenantId)+'/audit');
            if (!data) return;
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'audit_'+currentTenantId+'.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
          } catch (e) {}
        });
      }
    }

    async function loadTenant(tenantId) {
      try {
        const [site, audit, events] = await Promise.all([
          api('/api/platform/sites/'+encodeURIComponent(tenantId)),
          api('/api/platform/sites/'+encodeURIComponent(tenantId)+'/audit'),
          api('/api/platform/sites/'+encodeURIComponent(tenantId)+'/events?take=200'),
        ]);
        renderDetail(site, audit, events);
      } catch (e) {
        $('siteDetail').innerHTML = '<div class="tag bad">Erreur</div><div class="muted" style="margin-top:8px">'+safe(e.message||String(e))+'</div>';
      }
    }

    async function loadAll() {
      const range = $('range').value;
      const q = $('q').value || '';
      const [ov, sites] = await Promise.all([
        api('/api/platform/overview?range='+encodeURIComponent(range)),
        api('/api/platform/sites?range='+encodeURIComponent(range)+'&q='+encodeURIComponent(q)),
      ]);
      if (ov) renderCards(ov);
      if (sites) renderSites(sites);
    }

    function setActiveNav(view) {
      const map = { overview: 'nav-overview', sites: 'nav-sites', events: 'nav-events', health: 'nav-health' };
      for (const [k, id] of Object.entries(map)) {
        const el = $(id);
        if (el) el.classList.toggle('active', k === view);
      }
    }

    async function loadGlobalEvents() {
      const tenantId = ($('evTenant').value || '').trim();
      const type = ($('evType').value || '').trim();
      const qs = new URLSearchParams();
      if (tenantId) qs.set('tenantId', tenantId);
      if (type) qs.set('type', type);
      qs.set('take', '200');
      const data = await api('/api/platform/events?'+qs.toString());
      if (!data) return;
      $('eventsGlobal').innerHTML =
        '<div class="muted" style="margin-bottom:8px">'+safe(data.count)+' événement(s)</div>' +
        '<pre class="mono" style="font-size:12px; max-height: 520px; overflow:auto;">'+safe(JSON.stringify(data.events, null, 2))+'</pre>';
    }

    async function loadHealth() {
      const data = await api('/api/platform/health');
      if (!data) return;
      $('healthBox').innerHTML =
        '<div class="muted" style="margin-bottom:8px">/api/platform/health</div>' +
        '<pre class="mono" style="font-size:12px; max-height: 520px; overflow:auto;">'+safe(JSON.stringify(data, null, 2))+'</pre>';
    }

    function showView() {
      const hash = (window.location.hash || '#overview').replace('#','') || 'overview';
      const view = (hash === 'sites' || hash === 'events' || hash === 'health') ? hash : 'overview';
      $('view-overview').style.display = (view === 'overview') ? '' : 'none';
      $('view-sites').style.display = (view === 'sites') ? '' : 'none';
      $('view-events').style.display = (view === 'events') ? '' : 'none';
      $('view-health').style.display = (view === 'health') ? '' : 'none';
      setActiveNav(view);
      if (view === 'overview') { loadAll().catch(()=>{}); }
      if (view === 'sites') { loadAll().catch(()=>{}); }
      if (view === 'events') { loadGlobalEvents().catch(()=>{}); }
      if (view === 'health') { loadHealth().catch(()=>{}); }
    }

    $('reload').addEventListener('click', () => loadAll());
    $('range').addEventListener('change', () => loadAll());
    $('q').addEventListener('input', () => { window.clearTimeout(window.__qT); window.__qT=setTimeout(loadAll, 250); });
    $('logout').addEventListener('click', async () => {
      try { await fetch('/api/platform/auth/logout', { method:'POST', credentials:'include' }); } catch {}
      window.location.href='/admin/login';
    });

    $('evReload').addEventListener('click', () => loadGlobalEvents().catch(()=>{}));
    window.addEventListener('hashchange', () => showView());

    loadMe().then(() => showView()).catch(()=>{});
  </script>
</body>
</html>`;
}

