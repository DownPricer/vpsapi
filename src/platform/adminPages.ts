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
  <title>Cockpit plateforme — Super-admin</title>
  <style>
    :root{
      color-scheme: light;
      --bg:#0b1220;
      --bg2:#070b14;
      --panel:#0f1b33;
      --panel2:#101e3b;
      --text:#e8eefc;
      --muted:#a8b3d1;
      --muted2:#7f8bb0;
      --accent:#6ea8fe;
      --ok:#2ecc71;
      --warn:#f1c40f;
      --danger:#ff6b6b;
      --border: rgba(255,255,255,.10);
      --shadow: 0 20px 70px rgba(0,0,0,.35);
      --radius: 14px;
    }
    *{ box-sizing:border-box; }
    body{
      margin:0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      background: radial-gradient(1200px 700px at 20% 0%, #1b2a55, var(--bg)), linear-gradient(180deg, var(--bg), var(--bg2));
      color: var(--text);
    }
    a{ color: inherit; text-decoration:none; }
    .layout{ display:grid; grid-template-columns: 280px 1fr; min-height:100vh; }
    .sidebar{
      position: sticky; top:0; height:100vh;
      padding: 16px;
      border-right: 1px solid var(--border);
      background: rgba(11,18,32,.65);
      backdrop-filter: blur(10px);
    }
    .logo{ font-weight: 900; letter-spacing:.3px; font-size: 14px; color: var(--text); margin-bottom: 10px; }
    .sub{ color: var(--muted); font-size: 12px; margin-bottom: 16px; }
    .nav a{
      display:flex; align-items:center; gap:10px;
      padding: 10px 10px;
      border-radius: 12px;
      color: var(--muted);
      border: 1px solid transparent;
      margin-bottom: 6px;
    }
    .nav a.active{
      color: var(--text);
      background: rgba(255,255,255,.05);
      border-color: rgba(255,255,255,.10);
    }
    .chip{ display:inline-flex; align-items:center; gap:6px; padding: 4px 8px; border-radius: 999px; font-size: 12px; border:1px solid var(--border); color: var(--muted); }
    .chip.ok{ color: rgba(46,204,113,.95); border-color: rgba(46,204,113,.35); }
    .chip.warn{ color: rgba(241,196,15,.95); border-color: rgba(241,196,15,.35); }
    .chip.bad{ color: rgba(255,107,107,.95); border-color: rgba(255,107,107,.35); }
    .content{ padding: 18px 18px 40px; }
    .header{
      position: sticky; top:0;
      background: rgba(11,18,32,.65);
      backdrop-filter: blur(10px);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px;
      box-shadow: var(--shadow);
      z-index: 5;
      margin-bottom: 14px;
    }
    .hrow{ display:flex; gap: 10px; align-items:center; flex-wrap: wrap; }
    .title{ font-size: 16px; font-weight: 900; margin:0; }
    .spacer{ flex: 1; }
    .input, select{
      padding: 10px 10px; border-radius: 12px; border: 1px solid var(--border);
      background: rgba(255,255,255,.05); color: var(--text); outline:none;
    }
    .btn{
      padding: 10px 12px; border-radius: 12px; border:1px solid rgba(110,168,254,.35);
      background: rgba(110,168,254,.14); color: var(--text); cursor:pointer;
    }
    .btn.primary{ background: rgba(110,168,254,.22); border-color: rgba(110,168,254,.55); }
    .btn.ghost{ background: rgba(255,255,255,.03); border-color: rgba(255,255,255,.10); }
    .btn.danger{ background: rgba(255,107,107,.12); border-color: rgba(255,107,107,.35); }
    .grid{ display:grid; grid-template-columns: repeat(12, 1fr); gap: 12px; }
    .card{
      background: rgba(15,27,51,.92);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 14px;
    }
    .kpi{ grid-column: span 3; }
    .kpi .label{ color: var(--muted); font-size: 12px; font-weight: 700; }
    .kpi .value{ font-size: 22px; font-weight: 950; margin-top: 6px; }
    .kpi .hint{ color: var(--muted2); font-size: 12px; margin-top: 6px; }
    .sectionTitle{ margin: 12px 0 10px; font-size: 14px; color: var(--muted); font-weight: 800; letter-spacing:.2px; }
    .chartCard{ grid-column: span 6; }
    .chartCard.w4{ grid-column: span 4; }
    .chartCard.w8{ grid-column: span 8; }
    canvas{ width: 100% !important; height: 260px !important; }
    .table{ width:100%; border-collapse: collapse; overflow:hidden; border-radius: var(--radius); border:1px solid var(--border); }
    th, td{ padding: 10px 10px; border-bottom: 1px solid rgba(255,255,255,.08); font-size: 13px; }
    th{ text-align:left; color: var(--muted); font-weight: 800; background: rgba(255,255,255,.03); }
    tr:hover td{ background: rgba(255,255,255,.03); }
    .mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .muted{ color: var(--muted); }
    .right{ text-align:right; }
    .badge{ display:inline-flex; align-items:center; gap:6px; padding: 4px 8px; border-radius: 999px; font-size: 12px; border:1px solid var(--border); color: var(--muted); }
    .badge.ok{ color: rgba(46,204,113,.95); border-color: rgba(46,204,113,.35); }
    .badge.warn{ color: rgba(241,196,15,.95); border-color: rgba(241,196,15,.35); }
    .badge.bad{ color: rgba(255,107,107,.95); border-color: rgba(255,107,107,.35); }
    .twoCol{ display:grid; grid-template-columns: 1fr 420px; gap: 12px; align-items:start; }
    @media (max-width: 1180px){ .layout{ grid-template-columns: 1fr; } .sidebar{ position: relative; height:auto; } .twoCol{ grid-template-columns: 1fr; } .kpi{ grid-column: span 6; } .chartCard{ grid-column: span 12; } }
    @media (max-width: 720px){ .kpi{ grid-column: span 12; } }
    .timeline{ display:flex; flex-direction: column; gap: 10px; }
    .event{
      display:grid; grid-template-columns: 140px 1fr; gap: 12px;
      padding: 12px; border-radius: 12px; border:1px solid rgba(255,255,255,.10);
      background: rgba(255,255,255,.03);
    }
    .event .when{ color: var(--muted); font-size: 12px; }
    .event .headline{ font-weight: 900; margin-bottom: 4px; }
    details{ margin-top: 6px; }
    summary{ cursor:pointer; color: var(--muted); font-size: 12px; }
    pre{ margin: 8px 0 0; white-space: pre-wrap; word-break: break-word; background: rgba(0,0,0,.25); border: 1px solid rgba(255,255,255,.10); padding: 10px; border-radius: 12px; }
    .empty{ padding: 18px; color: var(--muted); text-align:center; border:1px dashed rgba(255,255,255,.18); border-radius: 12px; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="logo">Cockpit Plateforme</div>
      <div id="me" class="sub">…</div>
      <nav class="nav">
        <a id="nav-overview" href="#/overview">Vue globale</a>
        <a id="nav-sites" href="#/sites">Sites</a>
        <a id="nav-events" href="#/events">Activité</a>
        <a id="nav-health" href="#/health">Santé & alertes</a>
      </nav>
      <div style="margin-top:12px">
        <div class="chip" id="chipRange">Période: —</div>
      </div>
    </aside>
    <main class="content">
      <div class="header">
        <div class="hrow">
          <div>
            <div class="title" id="pageTitle">—</div>
            <div class="sub" id="pageSubtitle"></div>
          </div>
          <div class="spacer"></div>
          <select id="range">
            <option value="7d">7 jours</option>
            <option value="30d" selected>30 jours</option>
            <option value="90d">90 jours</option>
            <option value="all">Total</option>
          </select>
          <input id="q" class="input" placeholder="Recherche (site, domaine, email, tenantId…)" style="min-width: 320px" />
          <button id="reload" class="btn primary">Rafraîchir</button>
          <button id="logout" class="btn danger">Se déconnecter</button>
        </div>
      </div>

      <section id="view-overview" style="display:none">
        <div class="grid" id="kpis"></div>
        <div class="sectionTitle">Activité & performance</div>
        <div class="grid">
          <div class="card chartCard w8">
            <div class="sectionTitle" style="margin:0 0 8px">Activité (calculs, réservations, paiements)</div>
            <canvas id="chActivity"></canvas>
          </div>
          <div class="card chartCard w4">
            <div class="sectionTitle" style="margin:0 0 8px">Types de service</div>
            <canvas id="chServiceTypes"></canvas>
          </div>
          <div class="card chartCard w6">
            <div class="sectionTitle" style="margin:0 0 8px">Chiffre d’affaires payé</div>
            <canvas id="chRevenue"></canvas>
          </div>
          <div class="card chartCard w6">
            <div class="sectionTitle" style="margin:0 0 8px">Top sites (CA payé)</div>
            <canvas id="chTopSites"></canvas>
          </div>
        </div>

        <div class="sectionTitle">Sites à surveiller</div>
        <div class="card" id="watchTable"></div>

        <div class="sectionTitle">Actions prioritaires</div>
        <div class="card" id="priorityActions"></div>

        <div class="sectionTitle">Dernières activités importantes</div>
        <div class="card" id="recentEvents"></div>
      </section>

      <section id="view-sites" style="display:none">
        <div class="hrow" style="margin-bottom: 10px;">
          <div class="chip" id="sitesCount">—</div>
          <div class="spacer"></div>
          <button class="btn ghost" data-status="">Tous</button>
          <button class="btn ghost" data-status="ok">OK</button>
          <button class="btn ghost" data-status="a_configurer">À configurer</button>
          <button class="btn ghost" data-status="incomplet">Incomplet</button>
          <button class="btn ghost" data-status="risque">Risque</button>
          <button class="btn ghost" data-status="erreur">Erreur</button>
          <button class="btn ghost" data-status="stripe">Stripe manquant</button>
          <button class="btn ghost" data-status="contenu">Contenu incomplet</button>
        </div>
        <div class="card" id="sitesTable"></div>
      </section>

      <section id="view-site" style="display:none">
        <div class="twoCol">
          <div>
            <div class="card" id="siteHeader"></div>
            <div class="sectionTitle">KPIs (période)</div>
            <div class="grid" id="siteKpis"></div>
            <div class="sectionTitle">Activité du site</div>
            <div class="grid">
              <div class="card chartCard w8"><canvas id="chSiteActivity"></canvas></div>
              <div class="card chartCard w4"><canvas id="chSiteService"></canvas></div>
            </div>
            <div class="sectionTitle">Journal récent</div>
            <div class="card" id="siteEvents"></div>
          </div>
          <div>
            <div class="sectionTitle">Plan d’action</div>
            <div class="card" id="sitePlan"></div>
            <div class="card" id="siteAudit"></div>
            <div class="sectionTitle">Funnel (période)</div>
            <div class="card" id="siteFunnel"></div>
          </div>
        </div>
      </section>

      <section id="view-events" style="display:none">
        <div class="hrow" style="margin-bottom: 10px;">
          <input id="evTenant" class="input" placeholder="Filtrer par tenantId (optionnel)" style="min-width:240px" />
          <input id="evType" class="input" placeholder="Filtrer par type (optionnel)" style="min-width:240px" />
          <button id="evReload" class="btn primary">Appliquer</button>
          <div class="spacer"></div>
          <div class="chip">Astuce: cliquez “Détails techniques” pour voir la metadata</div>
        </div>
        <div class="card" id="eventsTimeline"></div>
      </section>

      <section id="view-health" style="display:none">
        <div class="grid" id="healthKpis"></div>
        <div class="sectionTitle">Alertes prioritaires</div>
        <div class="card" id="alertsList"></div>
      </section>
    </main>
  </div>

  <script>
    const $ = (id) => document.getElementById(id);
    const safe = (s) => (s==null?'':String(s)).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    const fmtCents = (n) => (Number(n||0)/100).toLocaleString('fr-FR', { style:'currency', currency:'EUR' });
    const fmtInt = (n) => Number(n||0).toLocaleString('fr-FR');
    const fmtDateTime = (iso) => {
      try { return new Date(iso).toLocaleString('fr-FR'); } catch { return String(iso||''); }
    };
    const badge = (label, kind) => '<span class="badge '+kind+'">'+safe(label)+'</span>';

    const afterPaint = () => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });

    const api = async (url, opts={}) => {
      const r = await fetch(url, { credentials:'include', ...opts });
      if (r.status === 401) { window.location.href='/admin/login'; return null; }
      let j = null;
      try { j = await r.json(); } catch {}
      if (!r.ok || !j || j.success !== true) throw new Error((j&&j.error&&j.error.message) ? j.error.message : ('Erreur '+r.status));
      return j.data;
    };

    const state = {
      range: '30d',
      q: '',
      sitesStatus: '',
      charts: {},
      chartsSite: {},
      currentSite: null,
    };

    function setNavActive(key){
      ['overview','sites','events','health'].forEach(k => {
        const el = $('nav-'+k);
        if (el) el.classList.toggle('active', k===key);
      });
    }

    function setPage(title, subtitle){
      $('pageTitle').textContent = title;
      $('pageSubtitle').textContent = subtitle || '';
      $('chipRange').textContent = 'Période: ' + (state.range === '7d' ? '7 jours' : state.range === '30d' ? '30 jours' : state.range === '90d' ? '90 jours' : 'Total');
    }

    function destroyChart(key, chart){
      if (state.charts[key]) { try { state.charts[key].destroy(); } catch {} }
      state.charts[key] = chart;
    }
    function destroySiteChart(key, chart){
      if (state.chartsSite[key]) { try { state.chartsSite[key].destroy(); } catch {} }
      state.chartsSite[key] = chart;
    }

    function humanEvent(ev){
      const t = ev.type || '';
      const md = ev.metadata || {};
      const tid = ev.tenantId || '—';
      const when = fmtDateTime(ev.createdAt);

      const get = (k) => (md && typeof md === 'object') ? md[k] : undefined;
      if (t === 'calculator_quote_success') {
        const price = get('estimatedPrice');
        const st = get('serviceType') || 'calcul';
        return { when, tenantId: tid, badge: 'Calculateur', kind:'ok', title: 'Calcul tarif réussi', message: st + (price!=null ? (' — ' + price + ' €') : '') };
      }
      if (t === 'calculator_quote_failed') return { when, tenantId: tid, badge:'Calculateur', kind:'warn', title:'Calcul tarif échoué', message: (get('reason')||'Erreur de validation') };
      if (t === 'payment_succeeded') return { when, tenantId: tid, badge:'Paiement', kind:'ok', title:'Paiement confirmé', message: (get('amountCents')!=null ? fmtCents(get('amountCents')) : '') };
      if (t === 'payment_failed') return { when, tenantId: tid, badge:'Paiement', kind:'bad', title:'Paiement échoué', message: 'Vérifier Stripe / intent' };
      if (t === 'email_failed') return { when, tenantId: tid, badge:'Email', kind:'warn', title:'Email non envoyé', message: (get('error')||'Erreur SMTP') };
      if (t === 'email_sent') return { when, tenantId: tid, badge:'Email', kind:'ok', title:'Email envoyé', message: 'Notification envoyée' };
      if (t === 'api_error') return { when, tenantId: tid, badge:'Erreur', kind:'bad', title:'Erreur API', message: (get('message')||'500') + ' — ' + (ev.path||'') };
      if (t === 'admin_error') return { when, tenantId: tid, badge:'Admin', kind:'bad', title:'Erreur Admin', message: (get('message')||'500') };
      if (t === 'stripe_webhook_received') return { when, tenantId: tid, badge:'Stripe', kind:'ok', title:'Webhook Stripe reçu', message: (get('stripeEventType')||'') };
      if (t === 'quote_request_created') return { when, tenantId: tid, badge:'Demande', kind:'ok', title:'Demande reçue', message: (get('kind')||'') };
      if (t === 'booking_created') return { when, tenantId: tid, badge:'Réservation', kind:'ok', title:'Réservation créée', message: '' };
      return { when, tenantId: tid, badge:'Activité', kind:'ok', title: t, message: ev.path || '' };
    }

    function renderTimeline(container, events){
      if (!events || events.length === 0) {
        container.innerHTML = '<div class="empty">Aucune activité sur la période sélectionnée.</div>';
        return;
      }
      container.innerHTML = '<div class="timeline">' + events.map(ev => {
        const h = humanEvent(ev);
        return '<div class="event">' +
          '<div><div class="when">'+safe(h.when)+'</div><div class="muted mono" style="margin-top:6px">'+safe(h.tenantId||'')+'</div></div>' +
          '<div>' +
            '<div class="headline">'+badge(h.badge, h.kind)+' <span style="margin-left:8px">'+safe(h.title)+'</span></div>' +
            '<div class="muted">'+safe(h.message||'')+'</div>' +
            '<details><summary>Détails techniques</summary><pre class="mono">'+safe(JSON.stringify({type: ev.type, tenantId: ev.tenantId, path: ev.path, category: ev.category, metadata: ev.metadata}, null, 2))+'</pre></details>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>';
    }

    async function loadMe(){
      const me = await api('/api/platform/me');
      if (!me) return;
      $('me').innerHTML = '<div><div class="logo">Cockpit Plateforme</div><div class="sub">'+safe(me.email)+' · '+safe(me.role)+'</div></div>';
    }

    function kpiCard(label, value, hint){
      return '<div class="card kpi"><div class="label">'+safe(label)+'</div><div class="value">'+safe(value)+'</div>' + (hint?('<div class="hint">'+safe(hint)+'</div>'):'') + '</div>';
    }

    async function viewOverview(){
      setNavActive('overview');
      setPage('Vue globale', 'Synthèse business & supervision en un coup d’œil.');
      const [ov, charts, alerts, recent] = await Promise.all([
        api('/api/platform/overview?range='+encodeURIComponent(state.range)),
        api('/api/platform/overview/charts?range='+encodeURIComponent(state.range)),
        api('/api/platform/alerts?range='+encodeURIComponent(state.range)),
        api('/api/platform/events?range='+encodeURIComponent(state.range)+'&take=30'),
      ]);
      if (!ov || !charts || !alerts) return;
      await afterPaint();

      const kpis = [
        ['Sites actifs', fmtInt(ov.tenants.active), fmtInt(ov.tenants.total)+' total'],
        ['Sites avec alertes', fmtInt(alerts.sitesToWatch.length), 'Critique: '+fmtInt(alerts.summary.critique)+' · Warning: '+fmtInt(alerts.summary.warning)],
        ['Réservations (période)', fmtInt(ov.leads.inRange), 'LeadRequest (tous types)'],
        ['CA payé (période)', fmtCents(ov.payments.amountPaidInRangeCents), 'Frais plateforme: '+fmtCents(ov.payments.platformFeesInRangeCents)],
        ['Paiements réussis', fmtInt(ov.payments.paidInRange), 'Échecs: '+fmtInt(ov.payments.failedInRange)],
        ['Événements', fmtInt(ov.telemetry.eventsInRange), 'Telemetry (si activée)'],
        ['CA payé (total)', fmtCents(ov.payments.amountPaidTotalCents), ''],
        ['Paiements réussis (total)', fmtInt(ov.payments.paidTotal), ''],
      ];
      $('kpis').innerHTML = kpis.map(([a,b,c]) => kpiCard(a,b,c)).join('');

      // Charts
      const labels = charts.series.map(s => s.day.slice(5));
      const act = charts.series;
      destroyChart('activity', new Chart($('chActivity'), {
        type:'line',
        data:{ labels, datasets:[
          { label:'Calculs', data: act.map(x=>x.calculatorQuotes), borderColor:'#6ea8fe', tension:.3, fill:false },
          { label:'Réservations', data: act.map(x=>x.reservations), borderColor:'#2ecc71', tension:.3, fill:false },
          { label:'Paiements', data: act.map(x=>x.payments), borderColor:'#f1c40f', tension:.3, fill:false },
        ]},
        options:{ responsive:true, plugins:{ legend:{ labels:{ color:'#a8b3d1' } } }, scales:{ x:{ ticks:{ color:'#7f8bb0' } }, y:{ ticks:{ color:'#7f8bb0' } } } }
      }));
      setTimeout(() => { try { state.charts.activity && state.charts.activity.resize(); } catch {} }, 0);

      destroyChart('revenue', new Chart($('chRevenue'), {
        type:'line',
        data:{ labels, datasets:[
          { label:'CA payé', data: act.map(x=>x.revenuePaidCents/100), borderColor:'#6ea8fe', tension:.3 },
          { label:'Frais plateforme', data: act.map(x=>x.platformFeesCents/100), borderColor:'#ff6b6b', tension:.3 },
        ]},
        options:{ plugins:{ legend:{ labels:{ color:'#a8b3d1' } } }, scales:{ x:{ ticks:{ color:'#7f8bb0' } }, y:{ ticks:{ color:'#7f8bb0' } } } }
      }));
      setTimeout(() => { try { state.charts.revenue && state.charts.revenue.resize(); } catch {} }, 0);

      const st = charts.serviceTypes || [];
      destroyChart('service', new Chart($('chServiceTypes'), {
        type:'doughnut',
        data:{ labels: st.map(x=>x.key), datasets:[{ data: st.map(x=>x.cnt), backgroundColor:['#6ea8fe','#2ecc71','#f1c40f','#ff6b6b','#a8b3d1'] }] },
        options:{ plugins:{ legend:{ labels:{ color:'#a8b3d1' } } } }
      }));
      setTimeout(() => { try { state.charts.service && state.charts.service.resize(); } catch {} }, 0);

      const top = charts.topSites || [];
      destroyChart('topSites', new Chart($('chTopSites'), {
        type:'bar',
        data:{ labels: top.map(x=>x.name), datasets:[{ label:'CA payé', data: top.map(x=>x.revenuePaidCents/100), backgroundColor:'rgba(110,168,254,.45)', borderColor:'#6ea8fe', borderWidth:1 }] },
        options:{ plugins:{ legend:{ labels:{ color:'#a8b3d1' } } }, scales:{ x:{ ticks:{ color:'#7f8bb0' } }, y:{ ticks:{ color:'#7f8bb0' } } } }
      }));
      setTimeout(() => { try { state.charts.topSites && state.charts.topSites.resize(); } catch {} }, 0);

      // Sites à surveiller
      const rows = alerts.sitesToWatch || [];
      $('watchTable').innerHTML = rows.length === 0 ? '<div class="empty">Aucun site à surveiller sur la période.</div>' :
        '<table class="table"><thead><tr><th>Site</th><th>Statut</th><th>Score</th><th>Problèmes</th><th>Dernière activité</th><th class="right">Actions</th></tr></thead><tbody>' +
        rows.slice(0,12).map(s => {
          const st =
            s.status === 'erreur' ? badge('Erreur','bad') :
            s.status === 'risque' ? badge('Risque','warn') :
            s.status === 'incomplet' ? badge('Incomplet','warn') :
            s.status === 'a_configurer' ? badge('À configurer','warn') :
            badge('OK','ok');
          return '<tr>' +
            '<td><div style="font-weight:900">'+safe(s.name)+'</div><div class="muted mono">'+safe(s.tenantId)+'</div></td>' +
            '<td>'+st+'</td>' +
            '<td>'+safe(String(s.readinessScore))+'%</td>' +
            '<td class="muted">'+safe((s.problems||[]).slice(0,3).join(' · '))+'</td>' +
            '<td class="muted">'+(s.lastActivityAt? safe(fmtDateTime(s.lastActivityAt)) : '—')+'</td>' +
            '<td class="right"><button class="btn ghost" data-open="'+safe(s.tenantId)+'">Ouvrir fiche</button></td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';
      $('watchTable').querySelectorAll('button[data-open]').forEach(b => b.addEventListener('click', () => {
        window.location.hash = '#/site/'+b.getAttribute('data-open');
      }));

      // Actions prioritaires
      const pa = alerts.priorityActions || [];
      $('priorityActions').innerHTML = pa.length === 0 ? '<div class="empty">Aucune action prioritaire sur la période.</div>' :
        '<table class="table"><thead><tr><th>Priorité</th><th>Site</th><th>Problème</th><th>Action recommandée</th><th class="right">Ouvrir</th></tr></thead><tbody>' +
        pa.slice(0,12).map(a => {
          const p = a.priority === 'critique' ? badge('Critique','bad') : a.priority === 'important' ? badge('Important','warn') : a.priority === 'moyen' ? badge('Moyen','warn') : badge('Faible','ok');
          return '<tr>' +
            '<td>'+p+'</td>' +
            '<td><div style="font-weight:900">'+safe(a.siteName)+'</div><div class="muted mono">'+safe(a.tenantId)+'</div></td>' +
            '<td class="muted">'+safe(a.problem||'')+'</td>' +
            '<td><div style="font-weight:900">'+safe(a.action)+'</div><div class="muted" style="margin-top:4px">'+safe(a.why||'')+'</div></td>' +
            '<td class="right"><button class="btn ghost" data-open="'+safe(a.tenantId)+'">Fiche</button></td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';
      $('priorityActions').querySelectorAll('button[data-open]').forEach(b => b.addEventListener('click', () => {
        window.location.hash = '#/site/'+b.getAttribute('data-open');
      }));

      // Activités importantes
      $('recentEvents').innerHTML = '';
      renderTimeline($('recentEvents'), (recent && recent.events) ? recent.events : []);
    }

    async function viewSites(){
      setNavActive('sites');
      setPage('Sites', 'Gestion multi-tenant: statut, contenu, Stripe, performance.');
      const qs = new URLSearchParams();
      qs.set('range', state.range);
      if (state.q) qs.set('q', state.q);
      if (state.sitesStatus) qs.set('status', state.sitesStatus);
      const data = await api('/api/platform/sites?'+qs.toString());
      if (!data) return;
      $('sitesCount').textContent = fmtInt(data.count) + ' site(s)';
      const rows = data.sites || [];
      $('sitesTable').innerHTML = rows.length === 0 ? '<div class="empty">Aucun site ne correspond aux filtres.</div>' :
        '<table class="table"><thead><tr>' +
          '<th>Site</th><th>Domaine</th><th>Statut</th><th>Priorité</th><th>Prochaine action</th><th class="right">CA '+safe(data.range)+'</th><th class="right">Paiements</th><th class="right">Actions</th>' +
        '</tr></thead><tbody>' +
        rows.map(s => {
          const stFine = s.status.globalFine;
          const st = stFine === 'ok' ? badge('OK','ok') :
            stFine === 'a_configurer' ? badge('À configurer','warn') :
            stFine === 'incomplet' ? badge('Incomplet','warn') :
            stFine === 'risque' ? badge('Risque','warn') :
            badge('Erreur','bad');
          const pr = s.status.priority === 'critique' ? badge('Critique','bad') :
            s.status.priority === 'important' ? badge('Important','warn') :
            s.status.priority === 'moyen' ? badge('Moyen','warn') :
            badge('Faible','ok');
          const dom = s.siteUrl ? '<a class="mono" href="'+safe(s.siteUrl)+'" target="_blank" rel="noreferrer">'+safe(s.siteUrl)+'</a>' : '<span class="muted">—</span>';
          const acts =
            (s.siteUrl ? '<a class="btn ghost" href="'+safe(s.siteUrl)+'" target="_blank" rel="noreferrer">Site</a> ' : '') +
            '<button class="btn ghost" data-open="'+safe(s.tenantId)+'">Fiche</button> ' +
            (s.adminUrl ? '<a class="btn ghost" href="'+safe(s.adminUrl)+'" target="_blank" rel="noreferrer">Admin</a>' : '');
          return '<tr>' +
            '<td><div style="font-weight:900">'+safe(s.name)+'</div><div class="muted mono">'+safe(s.tenantId)+'</div></td>' +
            '<td>'+dom+'<div class="muted">'+safe(s.email||'')+'</div></td>' +
            '<td>'+st+' ' + (s.status.stripeConnected ? badge('Stripe','ok') : badge('Stripe','bad')) + ' ' + (s.status.accentsOk ? badge('Accents','ok') : badge('Accents','warn')) + ' ' + badge('Prêt '+safe(String(s.status.readinessScore))+'%',''+(s.status.readinessScore>=85?'ok':s.status.readinessScore>=70?'warn':'bad')) + '</td>' +
            '<td>'+pr+'</td>' +
            '<td class="muted">'+safe(s.status.nextAction || '—')+'</td>' +
            '<td class="right">'+fmtCents(s.metrics.amountPaidInRangeCents)+'</td>' +
            '<td class="right">'+fmtInt(s.metrics.paymentsPaidInRange)+' <span class="muted">(échecs '+fmtInt(s.metrics.paymentsFailedInRange)+')</span></td>' +
            '<td class="right">'+acts+'</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';

      $('sitesTable').querySelectorAll('button[data-open]').forEach(b => b.addEventListener('click', () => {
        window.location.hash = '#/site/'+b.getAttribute('data-open');
      }));
    }

    async function viewSite(tenantId){
      setPage('Fiche site', 'KPI, activité, audit contenu, Stripe.');
      const [site, metrics, charts, audit, planResp, events] = await Promise.all([
        api('/api/platform/sites/'+encodeURIComponent(tenantId)),
        api('/api/platform/sites/'+encodeURIComponent(tenantId)+'/metrics?range='+encodeURIComponent(state.range)),
        api('/api/platform/sites/'+encodeURIComponent(tenantId)+'/charts?range='+encodeURIComponent(state.range)),
        api('/api/platform/sites/'+encodeURIComponent(tenantId)+'/audit'),
        api('/api/platform/sites/'+encodeURIComponent(tenantId)+'/plan?range='+encodeURIComponent(state.range)),
        api('/api/platform/sites/'+encodeURIComponent(tenantId)+'/events?range='+encodeURIComponent(state.range)+'&take=80'),
      ]);
      if (!site || !metrics || !charts || !audit) return;
      await afterPaint();

      const a = audit.audit;
      const plan = planResp ? planResp.plan : null;
      const stFine = plan ? plan.fineStatus : null;
      const st = stFine === 'ok' ? badge('OK','ok') :
        stFine === 'a_configurer' ? badge('À configurer','warn') :
        stFine === 'incomplet' ? badge('Incomplet','warn') :
        stFine === 'risque' ? badge('Risque','warn') :
        badge('Erreur','bad');
      const pr = plan ? (plan.priority === 'critique' ? badge('Critique','bad') : plan.priority === 'important' ? badge('Important','warn') : plan.priority === 'moyen' ? badge('Moyen','warn') : badge('Faible','ok')) : '';
      $('siteHeader').innerHTML =
        '<div class="hrow">' +
          '<div>' +
            '<div style="font-weight:950; font-size:18px">'+safe(site.name)+'</div>' +
            '<div class="muted mono">'+safe(site.tenantId)+' · '+(site.siteUrl?('<a href="'+safe(site.siteUrl)+'" target="_blank" rel="noreferrer">'+safe(site.siteUrl)+'</a>'):'—')+'</div>' +
          '</div>' +
          '<div class="spacer"></div>' +
          st + ' ' + pr +
          '<span class="badge '+(site.stripe.accountIdPresent && site.stripe.chargesEnabled ? 'ok' : 'warn')+'">Stripe</span>' +
          (site.siteUrl ? '<a class="btn ghost" href="'+safe(site.siteUrl)+'" target="_blank" rel="noreferrer">Ouvrir site</a>' : '') +
          (site.adminUrl ? '<a class="btn ghost" href="'+safe(site.adminUrl)+'" target="_blank" rel="noreferrer">Ouvrir admin</a>' : '') +
          '<button class="btn primary" id="btnRefreshSite">Rafraîchir</button>' +
        '</div>';
      $('btnRefreshSite').addEventListener('click', () => viewSite(tenantId).catch(()=>{}));

      const sk = [
        ['Réservations', fmtInt(metrics.leads.count), 'période '+state.range],
        ['CA payé', fmtCents(metrics.payments.amountPaidCents), 'frais: '+fmtCents(metrics.payments.platformFeesCents)],
        ['Paiements OK', fmtInt(metrics.payments.paidCount), 'échecs: '+fmtInt(metrics.payments.failedCount)],
        ['Événements', fmtInt(metrics.telemetry.eventsCount), 'telemetry'],
      ];
      $('siteKpis').innerHTML = sk.map(([a,b,c]) => kpiCard(a,b,c)).join('');

      // Plan d’action
      if (plan) {
        const items = (plan.actions || []).slice(0, 10).map(x => {
          const kind = x.gravite === 'critique' ? 'bad' : x.gravite === 'warning' ? 'warn' : 'ok';
          const st = x.statut === 'ok' ? badge('OK','ok') : badge('À faire', kind);
          return '<div style="padding:10px 0; border-bottom:1px solid rgba(255,255,255,.06)">' +
            '<div class="hrow"><div style="font-weight:900">'+safe(x.action)+'</div><div class="spacer"></div>'+st+'</div>' +
            '<div class="muted" style="margin-top:6px">'+safe(x.pourquoi)+'</div>' +
          '</div>';
        }).join('');
        $('sitePlan').innerHTML =
          '<div class="hrow"><div class="title">Plan d’action</div><div class="spacer"></div>' +
          (plan.nextAction ? badge('Prochaine: '+safe(plan.nextAction), 'warn') : badge('Aucune action', 'ok')) +
          '</div>' +
          '<div class="muted" style="margin-top:6px">Checklist priorisée (1–3 actions clés visibles dans les listes).</div>' +
          '<div style="margin-top:10px">' + (items || '<div class="empty">Aucune action recommandée.</div>') + '</div>';
      } else {
        $('sitePlan').innerHTML = '<div class="empty">Plan d’action indisponible.</div>';
      }

      // Audit visuel
      const checks = (a.checks||[]).map(c => {
        const kind = c.status === 'ok' ? 'ok' : c.status === 'ko' ? 'bad' : 'warn';
        return '<div style="display:flex; justify-content:space-between; gap:10px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,.06)">' +
          '<div><div style="font-weight:900">'+safe(c.label)+'</div>' +
          (c.message ? '<div class="muted" style="font-size:12px">'+safe(c.message)+'</div>' : '') +
          '</div>' +
          '<div>'+badge(c.status === 'ok' ? 'OK' : c.status === 'ko' ? 'KO' : 'Warning', kind)+'</div>' +
        '</div>';
      }).join('');
      const issues = (a.issues||[]).slice(0,6).map(i => {
        const kind = i.severity === 'critique' ? 'bad' : i.severity === 'warning' ? 'warn' : 'ok';
        return '<div style="margin-top:10px">'+badge(i.severity, kind)+' <strong style="margin-left:6px">'+safe(i.title)+'</strong><div class="muted" style="margin-top:4px">'+safe(i.message)+'</div></div>';
      }).join('');
      $('siteAudit').innerHTML =
        '<div class="hrow"><div class="title">Contenu</div><div class="spacer"></div>'+badge('Score '+a.readinessScore+'%',''+(a.readinessScore>=85?'ok':a.readinessScore>=70?'warn':'bad'))+'</div>' +
        '<div class="muted" style="margin-top:6px">'+safe((a.warnings||[]).join(' · ')||'')+'</div>' +
        '<div style="margin-top:10px">'+checks+'</div>' +
        (issues ? '<div class="sectionTitle">Problèmes détectés</div>'+issues : '') +
        '<details style="margin-top:12px"><summary>Export technique (JSON)</summary><pre class="mono">'+safe(JSON.stringify(a, null, 2))+'</pre></details>';

      // Funnel
      const f = charts.funnel;
      $('siteFunnel').innerHTML =
        '<table class="table"><thead><tr><th>Étape</th><th class="right">Volume</th></tr></thead><tbody>' +
        '<tr><td>Pages vues</td><td class="right">'+fmtInt(f.pageViews)+'</td></tr>' +
        '<tr><td>Ouverture calculateur</td><td class="right">'+fmtInt(f.calculatorOpened)+'</td></tr>' +
        '<tr><td>Début de saisie</td><td class="right">'+fmtInt(f.calculatorStarted)+'</td></tr>' +
        '<tr><td>Prix affiché</td><td class="right">'+fmtInt(f.quoteDisplayed)+'</td></tr>' +
        '<tr><td>Calculs API</td><td class="right">'+fmtInt(f.quotesApi)+'</td></tr>' +
        '<tr><td>Demandes</td><td class="right">'+fmtInt(f.demands)+'</td></tr>' +
        '<tr><td>Réservations</td><td class="right">'+fmtInt(f.reservations)+'</td></tr>' +
        '<tr><td>Paiements</td><td class="right">'+fmtInt(f.payments)+'</td></tr>' +
        '</tbody></table>';

      // Charts site
      const labels = charts.series.map(s => s.day.slice(5));
      destroySiteChart('siteActivity', new Chart($('chSiteActivity'), {
        type:'line',
        data:{ labels, datasets:[
          { label:'Calculs', data: charts.series.map(x=>x.calculatorQuotes), borderColor:'#6ea8fe', tension:.3 },
          { label:'Demandes', data: charts.series.map(x=>x.demands), borderColor:'#f1c40f', tension:.3 },
          { label:'Paiements', data: charts.series.map(x=>x.payments), borderColor:'#2ecc71', tension:.3 },
        ]},
        options:{ plugins:{ legend:{ labels:{ color:'#a8b3d1' } } }, scales:{ x:{ ticks:{ color:'#7f8bb0' } }, y:{ ticks:{ color:'#7f8bb0' } } } }
      }));
      setTimeout(() => { try { state.chartsSite.siteActivity && state.chartsSite.siteActivity.resize(); } catch {} }, 0);
      destroySiteChart('siteService', new Chart($('chSiteService'), {
        type:'doughnut',
        data:{ labels: (charts.serviceTypes||[]).map(x=>x.key), datasets:[{ data: (charts.serviceTypes||[]).map(x=>x.cnt), backgroundColor:['#6ea8fe','#2ecc71','#f1c40f','#ff6b6b','#a8b3d1'] }] },
        options:{ plugins:{ legend:{ labels:{ color:'#a8b3d1' } } } }
      }));
      setTimeout(() => { try { state.chartsSite.siteService && state.chartsSite.siteService.resize(); } catch {} }, 0);

      // Events site (timeline)
      $('siteEvents').innerHTML = '';
      renderTimeline($('siteEvents'), events?.events ?? events ?? []);
    }

    async function viewEvents(){
      setNavActive('events');
      setPage('Activité', 'Journal filtrable: calculateur, réservations, paiements, emails, erreurs.');
      const tenantId = ($('evTenant').value||'').trim();
      const type = ($('evType').value||'').trim();
      if (!tenantId && !type) {
        const grouped = await api('/api/platform/events/grouped?range='+encodeURIComponent(state.range)+'&by=day&take=120');
        if (!grouped) return;
        const groups = grouped.groups || [];
        $('eventsTimeline').innerHTML = groups.length === 0 ? '<div class="empty">Aucune activité sur la période.</div>' :
          '<table class="table"><thead><tr><th>Période</th><th>Site</th><th>Type</th><th class="right">Occurrences</th><th>Dernier</th><th class="right">Action</th></tr></thead><tbody>' +
          groups.map(g => (
            '<tr>' +
              '<td class="mono">'+safe(g.bucket)+'</td>' +
              '<td class="mono">'+safe(g.tenantId||'—')+'</td>' +
              '<td>'+safe(g.type)+'</td>' +
              '<td class="right">'+fmtInt(g.count)+'</td>' +
              '<td class="muted">'+safe(fmtDateTime(g.lastAt))+'</td>' +
              '<td class="right">'+(g.tenantId?('<button class="btn ghost" data-open="'+safe(g.tenantId)+'">Fiche</button>'):'')+'</td>' +
            '</tr>'
          )).join('') +
          '</tbody></table>';
        $('eventsTimeline').querySelectorAll('button[data-open]').forEach(b => b.addEventListener('click', () => {
          window.location.hash = '#/site/'+b.getAttribute('data-open');
        }));
        return;
      }
      const qs = new URLSearchParams();
      qs.set('range', state.range);
      qs.set('take', '200');
      if (tenantId) qs.set('tenantId', tenantId);
      if (type) qs.set('type', type);
      const data = await api('/api/platform/events?'+qs.toString());
      if (!data) return;
      renderTimeline($('eventsTimeline'), data.events || []);
    }

    async function viewHealth(){
      setNavActive('health');
      setPage('Santé & alertes', 'Supervision de la plateforme: priorités, risques, inactivité.');
      const [health, alerts] = await Promise.all([
        api('/api/platform/health'),
        api('/api/platform/alerts?range='+encodeURIComponent(state.range)),
      ]);
      if (!health || !alerts) return;

      const hk = [
        ['API', health.ok ? 'OK' : 'KO', health.ok ? 'service opérationnel' : 'problème'],
        ['Telemetry', health.features.telemetryEnabled ? 'Activée' : 'Désactivée', ''],
        ['Alertes critiques', fmtInt(alerts.summary.critique), 'à traiter en priorité'],
        ['Warnings', fmtInt(alerts.summary.warning), ''],
      ];
      $('healthKpis').innerHTML = hk.map(([a,b,c]) => '<div class="card kpi"><div class="label">'+safe(a)+'</div><div class="value">'+safe(b)+'</div><div class="hint">'+safe(c)+'</div></div>').join('');

      const list = alerts.alerts || [];
      $('alertsList').innerHTML = list.length === 0 ? '<div class="empty">Aucune alerte sur la période.</div>' :
        '<table class="table"><thead><tr><th>Priorité</th><th>Site</th><th>Raison</th><th>Détail</th><th>Action suggérée</th><th>Dernière activité</th><th class="right">Action</th></tr></thead><tbody>' +
        list.slice(0,60).map(a => {
          const kind = a.severity === 'critique' ? 'bad' : a.severity === 'warning' ? 'warn' : 'ok';
          return '<tr>' +
            '<td>'+badge(a.severity, kind)+'</td>' +
            '<td><div style="font-weight:900">'+safe(a.siteName)+'</div><div class="muted mono">'+safe(a.tenantId)+'</div></td>' +
            '<td>'+safe(a.reason)+'</td>' +
            '<td class="muted">'+safe(a.detail||'')+'</td>' +
            '<td class="muted">'+safe(a.actionSuggested||'')+'</td>' +
            '<td class="muted">'+(a.lastActivityAt? safe(fmtDateTime(a.lastActivityAt)) : '—')+'</td>' +
            '<td class="right"><button class="btn ghost" data-open="'+safe(a.tenantId)+'">Fiche</button></td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';
      $('alertsList').querySelectorAll('button[data-open]').forEach(b => b.addEventListener('click', () => {
        window.location.hash = '#/site/'+b.getAttribute('data-open');
      }));
    }

    function show(view){
      ['view-overview','view-sites','view-events','view-health','view-site'].forEach(id => { const el=$(id); if(el) el.style.display='none'; });
      const el = $(view);
      if (el) el.style.display = '';
    }

    async function router(){
      const h = window.location.hash || '#/overview';
      const parts = h.replace('#/','').split('/');
      const page = parts[0] || 'overview';

      $('chipRange').textContent = 'Période: ' + (state.range === '7d' ? '7 jours' : state.range === '30d' ? '30 jours' : state.range === '90d' ? '90 jours' : 'Total');

      if (page === 'overview'){ show('view-overview'); await viewOverview(); return; }
      if (page === 'sites'){ show('view-sites'); await viewSites(); return; }
      if (page === 'site'){ show('view-site'); const tid = parts[1] || ''; await viewSite(tid); return; }
      if (page === 'events'){ show('view-events'); await viewEvents(); return; }
      if (page === 'health'){ show('view-health'); await viewHealth(); return; }
      window.location.hash = '#/overview';
    }

    // events UI
    document.querySelectorAll('button[data-status]').forEach(btn => btn.addEventListener('click', () => {
      state.sitesStatus = btn.getAttribute('data-status') || '';
      window.location.hash = '#/sites';
      router().catch(()=>{});
    }));

    $('range').addEventListener('change', () => { state.range = $('range').value; router().catch(()=>{}); });
    $('q').addEventListener('input', () => { state.q = $('q').value; if ((window.location.hash||'').startsWith('#/sites')) { router().catch(()=>{}); } });
    $('reload').addEventListener('click', () => router().catch(()=>{}));
    $('logout').addEventListener('click', async () => { try { await fetch('/api/platform/auth/logout', { method:'POST', credentials:'include' }); } catch {} window.location.href='/admin/login'; });
    $('evReload').addEventListener('click', () => viewEvents().catch(()=>{}));
    window.addEventListener('hashchange', () => router().catch(()=>{}));

    (async function init(){
      state.range = $('range').value;
      await loadMe();
      await router();
    })();
  </script>
</body>
</html>`;
}

