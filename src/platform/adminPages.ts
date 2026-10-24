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
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root { color-scheme: dark; --bg:#08090d; --panel:#11141c; --text:#eceef4; --muted:#a4abc0; --faint:#6b7390; --accent:#7c8cff; --accent2:#a78bfa; --danger:#f87171; --ok:#34d399; --line:rgba(255,255,255,.08); }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; font-family: "Inter", ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size:14px; color: var(--text);
      background: radial-gradient(800px 460px at 15% -10%, rgba(124,140,255,.20), transparent 60%), radial-gradient(700px 420px at 100% 100%, rgba(167,139,250,.14), transparent 60%), var(--bg); -webkit-font-smoothing: antialiased; }
    .wrap { width:100%; max-width:420px; padding: 24px 16px; }
    .brand { display:flex; align-items:center; gap:12px; margin-bottom:22px; justify-content:center; }
    .mark { width:38px; height:38px; border-radius:11px; background: linear-gradient(135deg, var(--accent), var(--accent2)); display:grid; place-items:center; box-shadow: 0 10px 30px -8px rgba(124,140,255,.7); }
    .mark svg { width:20px; height:20px; color:#0b0c12; }
    .brand b { font-size:18px; letter-spacing:-.01em; }
    .card { background: linear-gradient(180deg, rgba(255,255,255,.03), transparent 40%), var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 28px; box-shadow: 0 30px 80px -20px rgba(0,0,0,.7); }
    h1 { margin: 0 0 6px; font-size: 22px; letter-spacing:-.02em; }
    p { margin: 0 0 20px; color: var(--muted); line-height: 1.5; }
    label { display:block; margin: 14px 0 6px; font-size: 12.5px; font-weight:600; color: var(--muted); }
    input { width: 100%; padding: 11px 13px; border-radius: 10px; border: 1px solid var(--line); background: rgba(255,255,255,.04); color: var(--text); outline: none; font: inherit; transition: .15s; }
    input:focus { border-color: rgba(124,140,255,.6); box-shadow: 0 0 0 3px rgba(124,140,255,.16); }
    button { width: 100%; margin-top: 20px; padding: 12px; border-radius: 10px; border: 0; background: linear-gradient(135deg, var(--accent), #6674f0); color: #0a0b12; font: inherit; font-weight: 700; cursor: pointer; transition: .15s; }
    button:hover { filter: brightness(1.1); }
    button[disabled] { opacity: .6; cursor: not-allowed; }
    .top { display:flex; align-items:center; justify-content:space-between; margin-bottom: 4px; }
    .pill { display:inline-flex; align-items:center; gap:6px; padding: 3px 10px; border-radius: 999px; font-size: 11.5px; font-weight:600; background: rgba(255,255,255,.06); color: var(--muted); }
    .pill::before { content:""; width:6px; height:6px; border-radius:50%; background: currentColor; }
    .pill.on { background: rgba(52,211,153,.12); color: var(--ok); }
    .err { margin-top: 14px; color: var(--danger); font-size: 13px; min-height: 18px; }
    .hint { margin-top: 18px; font-size: 12px; color: var(--faint); text-align:center; }
    code { font-family: ui-monospace, Menlo, Consolas, monospace; color: var(--muted); }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="brand"><div class="mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14l5-9 4 7 3-4 4 6"/></svg></div><b>Cockpit plateforme</b></div>
    <div class="card">
      <div class="top">
        <h1>Connexion</h1>
        <span class="pill ${enabled ? "on" : ""}">${enabled ? "activé" : "désactivé"}</span>
      </div>
      <p>Espace super-admin, isolé de l’authentification pro.</p>
      <form id="f">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" required />
        <label for="password">Mot de passe</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required />
        <button id="btn" type="submit">Se connecter</button>
        <div id="err" class="err"></div>
      </form>
      <div class="hint">Environnement <code>${escapeHtml(env.nodeEnv)}</code></div>
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
  <title>Cockpit plateforme</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root{
      color-scheme: dark;
      --bg:#08090d; --bg-elev:#0d0f15; --panel:#11141c; --panel-2:#161a24; --panel-3:#1b2030;
      --line:rgba(255,255,255,.07); --line-strong:rgba(255,255,255,.13);
      --text:#eceef4; --text-2:#a4abc0; --text-3:#6b7390;
      --accent:#7c8cff; --accent-2:#a78bfa; --accent-soft:rgba(124,140,255,.14);
      --ok:#34d399; --ok-soft:rgba(52,211,153,.12);
      --warn:#fbbf24; --warn-soft:rgba(251,191,36,.12);
      --bad:#f87171; --bad-soft:rgba(248,113,113,.12);
      --info:#38bdf8;
      --radius:14px; --radius-sm:10px;
      --shadow:0 1px 0 rgba(255,255,255,.04) inset, 0 10px 30px -12px rgba(0,0,0,.6);
      --font:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
      --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    }
    *{box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{margin:0;font-family:var(--font);font-size:14px;line-height:1.45;color:var(--text);
      background:radial-gradient(900px 500px at 12% -10%,rgba(124,140,255,.10),transparent 60%),radial-gradient(700px 400px at 100% 0%,rgba(167,139,250,.07),transparent 60%),var(--bg);
      background-attachment:fixed;-webkit-font-smoothing:antialiased}
    a{color:inherit;text-decoration:none}
    button{font-family:inherit}
    ::selection{background:rgba(124,140,255,.35)}
    ::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-thumb{background:var(--panel-3);border-radius:10px}::-webkit-scrollbar-track{background:transparent}

    .layout{display:grid;grid-template-columns:248px 1fr;min-height:100vh}
    .sidebar{position:sticky;top:0;height:100vh;padding:18px 14px;border-right:1px solid var(--line);background:rgba(10,11,16,.7);backdrop-filter:blur(14px);display:flex;flex-direction:column;gap:18px}
    .brand{display:flex;align-items:center;gap:10px;padding:4px 8px}
    .brand-mark{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,var(--accent),var(--accent-2));display:grid;place-items:center;box-shadow:0 6px 20px -6px rgba(124,140,255,.7)}
    .brand-mark svg{width:16px;height:16px;color:#0b0c12}
    .brand-name{font-weight:700;letter-spacing:-.01em}.brand-sub{font-size:11px;color:var(--text-3)}
    .nav-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3);padding:0 10px;margin-bottom:6px}
    .nav{display:flex;flex-direction:column;gap:2px}
    .nav a{display:flex;align-items:center;gap:11px;padding:9px 10px;border-radius:9px;color:var(--text-2);font-weight:500;transition:.15s}
    .nav a svg{width:17px;height:17px;flex:none;opacity:.85}
    .nav a:hover{background:rgba(255,255,255,.04);color:var(--text)}
    .nav a.active{background:var(--accent-soft);color:#fff;box-shadow:0 0 0 1px rgba(124,140,255,.25) inset}
    .nav a.active svg{color:var(--accent);opacity:1}
    .nav .count{margin-left:auto;font-size:11px;padding:1px 7px;border-radius:99px;background:var(--bad-soft);color:var(--bad);font-weight:600}
    .side-foot{margin-top:auto;display:flex;flex-direction:column;gap:10px}
    .me{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}
    .avatar{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#334,#556);display:grid;place-items:center;font-weight:700;font-size:12px;color:#fff}
    .me-mail{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px}.me-role{font-size:11px;color:var(--text-3)}

    .main{min-width:0}
    .topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:12px;padding:14px 28px;border-bottom:1px solid var(--line);background:rgba(8,9,13,.78);backdrop-filter:blur(14px)}
    .page-title{font-size:18px;font-weight:700;letter-spacing:-.015em;margin:0}.page-sub{font-size:12.5px;color:var(--text-3);margin-top:1px}
    .spacer{flex:1}
    .seg{display:inline-flex;padding:3px;border-radius:10px;background:var(--panel);border:1px solid var(--line)}
    .seg button{white-space:nowrap;border:0;background:transparent;color:var(--text-2);padding:6px 11px;border-radius:7px;font-size:12.5px;font-weight:600;cursor:pointer;transition:.15s}
    .seg button:hover{color:var(--text)}.seg button.on{background:var(--panel-3);color:#fff;box-shadow:0 1px 0 rgba(255,255,255,.06) inset}
    .search{position:relative}.search svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);width:15px;height:15px;color:var(--text-3)}
    .input{padding:9px 12px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--text);outline:none;font:inherit;transition:.15s}
    .search .input{padding-left:33px;width:260px}
    .input:focus{border-color:rgba(124,140,255,.55);box-shadow:0 0 0 3px rgba(124,140,255,.14)}
    .input::placeholder{color:var(--text-3)}
    .btn{display:inline-flex;align-items:center;gap:7px;padding:8px 13px;border-radius:9px;border:1px solid var(--line-strong);background:var(--panel-2);color:var(--text);font-weight:600;font-size:13px;cursor:pointer;transition:.15s;white-space:nowrap}
    .btn:hover{background:var(--panel-3);border-color:rgba(255,255,255,.2)}
    .btn svg{width:15px;height:15px}
    .btn.primary{background:linear-gradient(135deg,var(--accent),#6674f0);border-color:transparent;color:#0a0b12}
    .btn.primary:hover{filter:brightness(1.1)}
    .btn.danger{background:var(--bad-soft);border-color:rgba(248,113,113,.3);color:var(--bad)}
    .btn.sm{padding:5px 10px;font-size:12px;border-radius:8px}
    .btn.icon{padding:8px}

    .content{padding:24px 28px 60px;max-width:1500px}
    .fade{animation:fade .35s ease both}@keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
    .section-head{display:flex;align-items:center;gap:10px;margin:30px 0 12px}
    .section-head:first-child{margin-top:0}
    .section-head h2{font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-2);margin:0}
    .section-head .line{flex:1;height:1px;background:var(--line)}
    .section-head .hint{font-size:12px;color:var(--text-3)}

    .grid{display:grid;grid-template-columns:repeat(12,1fr);gap:14px}
    .col-3{grid-column:span 3}.col-4{grid-column:span 4}.col-5{grid-column:span 5}.col-6{grid-column:span 6}.col-7{grid-column:span 7}.col-8{grid-column:span 8}.col-12{grid-column:span 12}
    .card{background:linear-gradient(180deg,rgba(255,255,255,.025),transparent 40%),var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:18px;min-width:0}
    .card-title{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--text-2);margin-bottom:12px}
    .card-title .grow{flex:1}

    .kpi{position:relative;overflow:hidden}
    .kpi .label{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:var(--text-2)}
    .kpi .ico{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent)}
    .kpi .ico svg{width:14px;height:14px}
    .kpi .ico.ok{background:var(--ok-soft);color:var(--ok)}.kpi .ico.warn{background:var(--warn-soft);color:var(--warn)}.kpi .ico.bad{background:var(--bad-soft);color:var(--bad)}.kpi .ico.info{background:rgba(56,189,248,.12);color:var(--info)}
    .kpi .value{font-size:28px;font-weight:750;letter-spacing:-.025em;margin:12px 0 6px;font-variant-numeric:tabular-nums}
    .kpi .meta{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-3);flex-wrap:wrap}
    .kpi .spark{position:absolute;right:0;bottom:0;width:38%;height:56px;opacity:.9;pointer-events:none}
    .delta{display:inline-flex;align-items:center;gap:3px;padding:1px 7px;border-radius:99px;font-weight:600;font-size:11.5px}
    .delta.up{background:var(--ok-soft);color:var(--ok)}.delta.down{background:var(--bad-soft);color:var(--bad)}.delta.flat{background:rgba(255,255,255,.06);color:var(--text-2)}

    .stat-list{display:flex;flex-direction:column}
    .stat{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
    .stat:last-child{border-bottom:0;padding-bottom:0}.stat:first-child{padding-top:0}
    .stat .k{color:var(--text-2);font-size:13px}.stat .v{font-weight:650;font-variant-numeric:tabular-nums;text-align:right}
    .stat .sub{display:block;font-size:11.5px;color:var(--text-3);font-weight:400}
    .bar{height:6px;border-radius:99px;background:rgba(255,255,255,.07);overflow:hidden;margin-top:6px}
    .bar>i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2))}
    .bar>i.ok{background:var(--ok)}.bar>i.warn{background:var(--warn)}.bar>i.bad{background:var(--bad)}

    .badge{display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border-radius:99px;font-size:11.5px;font-weight:600;background:rgba(255,255,255,.06);color:var(--text-2);white-space:nowrap}
    .badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.9}
    .badge.ok{background:var(--ok-soft);color:var(--ok)}.badge.warn{background:var(--warn-soft);color:var(--warn)}.badge.bad{background:var(--bad-soft);color:var(--bad)}.badge.info{background:rgba(56,189,248,.12);color:var(--info)}
    .badge.plain::before{display:none}
    .pill-row{display:flex;gap:8px;flex-wrap:wrap}
    .status-tile{display:flex;align-items:center;gap:12px;padding:13px 14px;border:1px solid var(--line);border-radius:12px;background:var(--panel-2)}
    .status-tile .dot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--text-3)}
    .status-tile .dot.ok{background:var(--ok);box-shadow:0 0 0 4px var(--ok-soft)}.status-tile .dot.warn{background:var(--warn);box-shadow:0 0 0 4px var(--warn-soft)}.status-tile .dot.bad{background:var(--bad);box-shadow:0 0 0 4px var(--bad-soft)}
    .status-tile .n{font-weight:600}.status-tile .d{font-size:11.5px;color:var(--text-3)}

    .table-wrap{overflow:auto;border:1px solid var(--line);border-radius:12px}
    table.table{width:100%;border-collapse:collapse;min-width:640px}
    table.table.compact{min-width:0}.table.compact th,.table.compact td{padding:10px 10px}
    .grid.top{align-items:start}
    .table th{position:sticky;top:0;text-align:left;font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-3);font-weight:600;padding:11px 14px;background:var(--panel-2);border-bottom:1px solid var(--line)}
    .table td{padding:12px 14px;border-bottom:1px solid var(--line);vertical-align:middle}
    .table tr:last-child td{border-bottom:0}.table tbody tr{transition:background .12s}.table tbody tr:hover td{background:rgba(255,255,255,.025)}
    .right{text-align:right}.mono{font-family:var(--mono);font-size:12px}.muted{color:var(--text-3)}.strong{font-weight:650}
    .site-cell{display:flex;align-items:center;gap:11px}
    .site-av{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;font-weight:700;font-size:12px;color:#fff;flex:none}
    .empty{padding:34px 16px;text-align:center;color:var(--text-3);border:1px dashed var(--line-strong);border-radius:12px}
    .empty b{display:block;color:var(--text-2);margin-bottom:4px}

    .chart-box{position:relative;height:260px}.chart-box.sm{height:220px}
    .legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--text-2);margin-bottom:8px}
    .legend i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px}

    .timeline{display:flex;flex-direction:column}
    .ev{display:grid;grid-template-columns:34px 1fr auto;gap:12px;padding:12px 0;border-bottom:1px solid var(--line);align-items:flex-start}
    .ev:last-child{border-bottom:0}
    .ev .ei{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--panel-3);color:var(--text-2)}
    .ev .ei svg{width:16px;height:16px}.ev .ei.ok{background:var(--ok-soft);color:var(--ok)}.ev .ei.warn{background:var(--warn-soft);color:var(--warn)}.ev .ei.bad{background:var(--bad-soft);color:var(--bad)}
    .ev .et{font-weight:600}.ev .em{color:var(--text-3);font-size:12.5px;margin-top:2px}.ev .ew{font-size:12px;color:var(--text-3);text-align:right;white-space:nowrap}
    details{margin-top:6px}summary{cursor:pointer;color:var(--text-3);font-size:12px}summary:hover{color:var(--text-2)}
    pre{margin:8px 0 0;white-space:pre-wrap;word-break:break-word;background:#07080c;border:1px solid var(--line);padding:12px;border-radius:10px;font-size:12px;color:var(--text-2);font-family:var(--mono)}

    .alert{display:flex;gap:12px;padding:13px 14px;border:1px solid var(--line);border-radius:12px;background:var(--panel-2);align-items:flex-start}
    .alert+.alert{margin-top:10px}
    .alert .bar-l{width:3px;align-self:stretch;border-radius:3px;background:var(--text-3)}
    .alert.bad .bar-l{background:var(--bad)}.alert.warn .bar-l{background:var(--warn)}.alert.ok .bar-l{background:var(--ok)}
    .alert .at{font-weight:600}.alert .ad{font-size:12.5px;color:var(--text-3);margin-top:2px}
    .alert .aa{font-size:12.5px;color:var(--text-2);margin-top:6px}

    .site-hero{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
    .site-hero .site-av{width:52px;height:52px;border-radius:14px;font-size:18px}
    .two-col{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:14px;align-items:start}
    .stack{display:flex;flex-direction:column;gap:14px}
    .check{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}.check:last-child{border-bottom:0}
    .funnel-row{margin-bottom:12px}.funnel-row .fr{display:flex;justify-content:space-between;font-size:13px}.funnel-row .fr span:last-child{font-weight:650;font-variant-numeric:tabular-nums}
    .pill-btn{border:1px solid var(--line);background:var(--panel);color:var(--text-2);padding:6px 12px;border-radius:99px;font-size:12.5px;font-weight:600;cursor:pointer;transition:.15s}
    .pill-btn:hover{color:var(--text);border-color:var(--line-strong)}.pill-btn.on{background:var(--accent-soft);color:#fff;border-color:rgba(124,140,255,.4)}
    .toast{position:fixed;right:20px;bottom:20px;background:var(--panel-3);border:1px solid var(--line-strong);padding:11px 16px;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.5);z-index:100}
    .skeleton{border-radius:10px;background:linear-gradient(90deg,var(--panel) 25%,var(--panel-2) 50%,var(--panel) 75%);background-size:200% 100%;animation:sk 1.2s infinite;height:110px}@keyframes sk{to{background-position:-200% 0}}
    .mobile-menu{display:none}

    @media (max-width:1180px){.col-3{grid-column:span 6}.col-4,.col-5,.col-6,.col-7,.col-8{grid-column:span 12}.two-col{grid-template-columns:1fr}}
    @media (max-width:960px){
      .layout{grid-template-columns:1fr}
      .sidebar{position:relative;height:auto;flex-direction:row;align-items:center;flex-wrap:wrap;padding:12px 14px;gap:10px}
      .nav{flex-direction:row;flex-wrap:wrap}.nav-label,.side-foot,.brand-sub{display:none}
      .topbar{flex-wrap:wrap;padding:12px 16px}.content{padding:16px 16px 50px}
      .search .input{width:100%}
    }
    @media (max-width:620px){.col-3{grid-column:span 12}}
  </style>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14l5-9 4 7 3-4 4 6"/></svg></div>
        <div><div class="brand-name">Cockpit</div><div class="brand-sub">Plateforme VTC</div></div>
      </div>
      <div>
        <div class="nav-label">Pilotage</div>
        <nav class="nav">
          <a id="nav-overview" href="#/overview"><span data-i="grid"></span>Vue globale</a>
          <a id="nav-sites" href="#/sites"><span data-i="globe"></span>Sites</a>
          <a id="nav-domains" href="#/domains"><span data-i="radar"></span>Sites détectés</a>
          <a id="nav-events" href="#/events"><span data-i="pulse"></span>Activité</a>
          <a id="nav-health" href="#/health"><span data-i="shield"></span>Santé &amp; alertes<span class="count" id="navAlertCount" style="display:none"></span></a>
        </nav>
      </div>
      <div class="side-foot">
        <div class="me"><div class="avatar" id="meAv">·</div><div><div class="me-mail" id="meMail">…</div><div class="me-role" id="meRole"></div></div></div>
        <button class="btn danger" id="logout"><span data-i="logout"></span>Déconnexion</button>
      </div>
    </aside>

    <main class="main">
      <div class="topbar">
        <div><h1 class="page-title" id="pageTitle">—</h1><div class="page-sub" id="pageSubtitle"></div></div>
        <div class="spacer"></div>
        <div class="search"><span data-i="search"></span><input id="q" class="input" placeholder="Rechercher un site, domaine, email…" /></div>
        <div class="seg" id="rangeSeg">
          <button data-r="24h">24h</button><button data-r="7d">7 j</button><button data-r="30d" class="on">30 j</button><button data-r="90d">90 j</button><button data-r="all">Total</button>
        </div>
        <button id="reload" class="btn icon" title="Rafraîchir"><span data-i="refresh"></span></button>
      </div>

      <div class="content">
        <section id="view-overview" style="display:none"></section>

        <section id="view-sites" style="display:none">
          <div class="pill-row" id="siteFilters" style="margin-bottom:14px">
            <button class="pill-btn on" data-status="">Tous</button>
            <button class="pill-btn" data-status="ok">OK</button>
            <button class="pill-btn" data-status="a_configurer">À configurer</button>
            <button class="pill-btn" data-status="incomplet">Incomplet</button>
            <button class="pill-btn" data-status="risque">Risque</button>
            <button class="pill-btn" data-status="erreur">Erreur</button>
            <button class="pill-btn" data-status="stripe">Stripe manquant</button>
            <button class="pill-btn" data-status="contenu">Contenu incomplet</button>
            <span class="spacer"></span><span class="badge plain" id="sitesCount">—</span>
          </div>
          <div id="sitesTable"></div>
        </section>

        <section id="view-site" style="display:none">
          <div class="stack">
            <div class="card" id="siteHeader"></div>
            <div class="two-col">
              <div class="stack">
                <div class="grid" id="siteKpis"></div>
                <div class="grid">
                  <div class="card col-8"><div class="card-title">Activité du site</div><div class="chart-box sm"><canvas id="chSiteActivity"></canvas></div></div>
                  <div class="card col-4"><div class="card-title">Types de service</div><div class="chart-box sm"><canvas id="chSiteService"></canvas></div></div>
                </div>
                <div class="card"><div class="card-title">Utilisation &amp; coûts API</div><div id="siteUsage"></div></div>
                <div class="card"><div class="card-title">Journal récent</div><div id="siteEvents"></div></div>
              </div>
              <div class="stack">
                <div class="card" id="sitePlan"></div>
                <div class="card"><div class="card-title">Funnel de conversion</div><div id="siteFunnel"></div></div>
                <div class="card" id="siteAudit"></div>
              </div>
            </div>
          </div>
        </section>

        <section id="view-events" style="display:none">
          <div class="pill-row" style="margin-bottom:14px">
            <input id="evTenant" class="input" placeholder="Filtrer par site (tenantId)" style="min-width:230px" />
            <input id="evType" class="input" placeholder="Filtrer par type d'événement" style="min-width:230px" />
            <button id="evReload" class="btn primary">Appliquer</button>
          </div>
          <div class="card" id="eventsTimeline"></div>
        </section>

        <section id="view-domains" style="display:none">
          <div id="domainsTable"></div>
        </section>

        <section id="view-health" style="display:none"></section>
      </div>
    </main>
  </div>

  <script>
    const $ = (id) => document.getElementById(id);
    const safe = (s) => (s == null ? '' : String(s)).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
    const fmtCents = (n) => (Number(n||0)/100).toLocaleString('fr-FR', { style:'currency', currency:'EUR', maximumFractionDigits: (Math.abs(Number(n||0))>=100000?0:2) });
    const fmtInt = (n) => Number(n||0).toLocaleString('fr-FR');
    const fmtPct = (n) => (Number(n||0)).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %';
    const fmtDateTime = (iso) => { try { return new Date(iso).toLocaleString('fr-FR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }); } catch { return String(iso||''); } };
    const fmtAgo = (iso) => {
      if (!iso) return '—';
      const s = Math.max(0, (Date.now() - new Date(iso).getTime())/1000);
      if (s < 60) return 'à l’instant';
      if (s < 3600) return Math.floor(s/60) + ' min';
      if (s < 86400) return Math.floor(s/3600) + ' h';
      return Math.floor(s/86400) + ' j';
    };
    const fmtUptime = (sec) => { const d=Math.floor(sec/86400), h=Math.floor(sec%86400/3600), m=Math.floor(sec%3600/60); return (d?d+' j ':'')+(h?h+' h ':'')+m+' min'; };
    const fmtUsageCost = (u) => (u && u.estimatedCostCents != null) ? fmtCents(u.estimatedCostCents) : 'Non configuré';
    const RANGE_LABEL = { '24h':'24 heures', '7d':'7 jours', '30d':'30 jours', '90d':'90 jours', 'all':'Total' };
    const badge = (label, kind) => '<span class="badge '+(kind||'')+'">'+safe(label)+'</span>';
    const afterPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const ICONS = {
      grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
      globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
      radar:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-6"/>',
      pulse:'<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
      shield:'<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
      logout:'<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>',
      search:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
      refresh:'<path d="M20 11a8 8 0 10-2.3 5.7M20 5v6h-6"/>',
      euro:'<path d="M18 6.5A7 7 0 106 12m0 0a7 7 0 0012 5.5M4 10h9M4 14h9"/>',
      cart:'<path d="M3 4h2l2.4 11h10.2L20 8H6"/><circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/>',
      card:'<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18"/>',
      users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M17 4.5a3.5 3.5 0 010 7M21.5 20c-.3-2.4-1.6-4-3.5-4.8"/>',
      calc:'<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 7.5h7M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01"/>',
      mail:'<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>',
      trend:'<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
      alert:'<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
      server:'<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
      db:'<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
      bolt:'<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
      map:'<path d="M9 4L3 6.5v13L9 17l6 3 6-2.5v-13L15 7z"/><path d="M9 4v13M15 7v13"/>',
      check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
      external:'<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
      clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      key:'<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
    };
    const icon = (n) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+(ICONS[n]||'')+'</svg>';
    function hydrateIcons(root){ (root||document).querySelectorAll('[data-i]').forEach(el => { el.innerHTML = icon(el.getAttribute('data-i')); el.style.display='inline-flex'; }); }

    const PALETTE = ['#7c8cff','#34d399','#fbbf24','#f87171','#38bdf8','#a78bfa','#fb923c'];
    const avatarColor = (s) => { let h=0; for (const c of String(s||'')) h=(h*31+c.charCodeAt(0))%360; return 'linear-gradient(135deg,hsl('+h+',60%,48%),hsl('+((h+40)%360)+',65%,38%))'; };
    const initials = (s) => String(s||'?').trim().split(/[\\s-_]+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase() || '?';
    const siteAv = (s) => '<div class="site-av" style="background:'+avatarColor(s)+'">'+safe(initials(s))+'</div>';

    const api = async (url, opts={}) => {
      const r = await fetch(url, { credentials:'include', ...opts });
      if (r.status === 401) { window.location.href='/admin/login'; return null; }
      let j = null; try { j = await r.json(); } catch {}
      if (!r.ok || !j || j.success !== true) throw new Error((j&&j.error&&j.error.message) ? j.error.message : ('Erreur '+r.status));
      return j.data;
    };
    function toast(msg){ const t=document.createElement('div'); t.className='toast'; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),3600); }

    const state = { range:'30d', q:'', sitesStatus:'', charts:{} };

    Chart.defaults.color = '#8a92ab';
    Chart.defaults.font.family = '"Inter",system-ui,sans-serif';
    Chart.defaults.font.size = 11.5;
    Chart.defaults.borderColor = 'rgba(255,255,255,.06)';
    const chartScales = (money) => ({
      x:{ grid:{ display:false }, ticks:{ maxTicksLimit:8 }, border:{ display:false } },
      y:{ beginAtZero:true, border:{ display:false }, ticks:{ maxTicksLimit:5, callback:(v)=> money ? (Number(v).toLocaleString('fr-FR')+' €') : v } }
    });
    const tooltipOpts = { backgroundColor:'#1b2030', borderColor:'rgba(255,255,255,.12)', borderWidth:1, padding:10, titleColor:'#eceef4', bodyColor:'#a4abc0', cornerRadius:10, displayColors:true, boxPadding:4 };
    function mkChart(key, canvasId, cfg){
      if (state.charts[key]) { try { state.charts[key].destroy(); } catch {} }
      const el = $(canvasId); if (!el) return;
      cfg.options = Object.assign({ responsive:true, maintainAspectRatio:false, interaction:{ mode:'index', intersect:false } }, cfg.options||{});
      state.charts[key] = new Chart(el, cfg);
    }
    function areaDataset(label, data, color, fill){
      return { label, data, borderColor:color, backgroundColor: fill===false ? color : (color+'22'), fill: fill!==false, tension:.35, borderWidth:2, pointRadius:0, pointHoverRadius:4, pointBackgroundColor:color };
    }
    function legend(items){ return '<div class="legend">'+items.map(([l,c])=>'<span><i style="background:'+c+'"></i>'+safe(l)+'</span>').join('')+'</div>'; }

    function sparkline(values, color){
      const v = values && values.length ? values : [0,0];
      const max = Math.max(...v, 1), min = Math.min(...v, 0);
      const w = 120, h = 40, step = w/Math.max(v.length-1,1);
      const pts = v.map((y,i)=>[i*step, h-4-((y-min)/(max-min||1))*(h-10)]);
      const d = pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
      const id = 'g'+Math.random().toString(36).slice(2,8);
      return '<svg class="spark" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none"><defs><linearGradient id="'+id+'" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="'+color+'" stop-opacity=".28"/><stop offset="1" stop-color="'+color+'" stop-opacity="0"/></linearGradient></defs><path d="'+d+' L'+w+' '+h+' L0 '+h+' Z" fill="url(#'+id+')"/><path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
    }
    function delta(cur, prev){
      if (prev == null) return '';
      cur = Number(cur||0); prev = Number(prev||0);
      if (prev === 0 && cur === 0) return '<span class="delta flat">= stable</span>';
      if (prev === 0) return '<span class="delta up">▲ nouveau</span>';
      const p = ((cur-prev)/prev)*100;
      if (Math.abs(p) < 0.5) return '<span class="delta flat">= stable</span>';
      return '<span class="delta '+(p>0?'up':'down')+'">'+(p>0?'▲ +':'▼ ')+p.toLocaleString('fr-FR',{maximumFractionDigits:0})+' %</span>';
    }
    function kpi({label, value, ico, tone, meta, spark, sparkColor}){
      return '<div class="card kpi fade col-3"><div class="label"><span class="ico '+(tone||'')+'">'+icon(ico||'trend')+'</span>'+safe(label)+'</div>' +
        '<div class="value">'+safe(value)+'</div><div class="meta">'+(meta||'')+'</div>' + (spark ? sparkline(spark, sparkColor||'#7c8cff') : '') + '</div>';
    }
    const statRow = (k, v, sub) => '<div class="stat"><span class="k">'+safe(k)+'</span><span class="v">'+v+(sub?'<span class="sub">'+safe(sub)+'</span>':'')+'</span></div>';
    const sectionHead = (t, hint) => '<div class="section-head"><h2>'+safe(t)+'</h2><span class="line"></span>'+(hint?'<span class="hint">'+safe(hint)+'</span>':'')+'</div>';
    const emptyBox = (t, sub) => '<div class="empty"><b>'+safe(t)+'</b>'+safe(sub||'')+'</div>';
    const statusBadge = (s) => s==='ok'?badge('OK','ok'):s==='a_configurer'?badge('À configurer','warn'):s==='incomplet'?badge('Incomplet','warn'):s==='risque'?badge('Risque','warn'):badge('Erreur','bad');
    const priorityBadge = (p) => p==='critique'?badge('Critique','bad'):p==='important'?badge('Important','warn'):p==='moyen'?badge('Moyen','info'):badge('Faible','ok');
    const sevKind = (s) => s==='critique'?'bad':s==='warning'?'warn':'ok';

    function setNavActive(key){ ['overview','sites','domains','events','health'].forEach(k => { const el=$('nav-'+k); if (el) el.classList.toggle('active', k===key); }); }
    function setPage(title, subtitle){ $('pageTitle').textContent = title; $('pageSubtitle').textContent = subtitle || ''; document.title = title + ' · Cockpit'; }
    function show(view){ ['view-overview','view-sites','view-domains','view-events','view-health','view-site'].forEach(id => { const el=$(id); if(el) el.style.display = (id===view?'':'none'); }); }
    function skeleton(el, n){ el.innerHTML = '<div class="grid">'+Array.from({length:n||4}).map(()=>'<div class="col-3"><div class="skeleton"></div></div>').join('')+'</div>'; }

    const EV = {
      calculator_quote_success:{ i:'calc', k:'ok', t:'Calcul tarif réussi' },
      calculator_quote_failed:{ i:'calc', k:'warn', t:'Calcul tarif échoué' },
      payment_succeeded:{ i:'card', k:'ok', t:'Paiement confirmé' },
      payment_failed:{ i:'card', k:'bad', t:'Paiement échoué' },
      email_failed:{ i:'mail', k:'warn', t:'Email non envoyé' },
      email_sent:{ i:'mail', k:'ok', t:'Email envoyé' },
      api_error:{ i:'alert', k:'bad', t:'Erreur API' },
      admin_error:{ i:'alert', k:'bad', t:'Erreur admin' },
      stripe_webhook_received:{ i:'bolt', k:'ok', t:'Webhook Stripe reçu' },
      quote_request_created:{ i:'cart', k:'ok', t:'Demande reçue' },
      booking_created:{ i:'cart', k:'ok', t:'Réservation créée' },
      pro_login_failed:{ i:'key', k:'bad', t:'Connexion pro refusée' },
      pro_login_success:{ i:'key', k:'ok', t:'Connexion pro réussie' },
      api_usage_distance_matrix:{ i:'map', k:'ok', t:'Appel Distance Matrix' },
      api_usage_route_calculation:{ i:'calc', k:'ok', t:'Pipeline calcul tarif' },
    };
    function humanEvent(ev){
      const md = ev.metadata || {}; const get = (k) => (md && typeof md==='object') ? md[k] : undefined;
      const def = EV[ev.type] || { i:'pulse', k:'ok', t: ev.type || 'Événement' };
      let msg = '';
      switch (ev.type) {
        case 'calculator_quote_success': msg = (get('serviceType')||'calcul') + (get('estimatedPrice')!=null ? ' — '+get('estimatedPrice')+' €' : ''); break;
        case 'calculator_quote_failed': msg = get('reason') || 'Erreur de validation'; break;
        case 'payment_succeeded': msg = get('amountCents')!=null ? fmtCents(get('amountCents')) : ''; break;
        case 'payment_failed': msg = 'Vérifier Stripe / intent'; break;
        case 'email_failed': msg = get('error') || 'Erreur SMTP'; break;
        case 'email_sent': msg = 'Notification envoyée'; break;
        case 'api_error': case 'admin_error': msg = (get('message')||'500') + (ev.path?' — '+ev.path:''); break;
        case 'stripe_webhook_received': msg = get('stripeEventType') || ''; break;
        case 'quote_request_created': msg = get('kind') || ''; break;
        case 'pro_login_failed': msg = (get('failureReason')||get('reason')||'inconnu') + ((get('domainResolved')||ev.observedDomain)?' — '+(get('domainResolved')||ev.observedDomain):''); break;
        case 'pro_login_success': msg = get('role') || ''; break;
        case 'api_usage_distance_matrix': msg = get('skipped')===true ? 'Distance non appelée' : (get('billableUnit')!=null ? 'unités '+get('billableUnit') : (get('reason')||get('error')||'')); if (get('success')===false) def.k='warn'; break;
        default: msg = ev.path || '';
      }
      return { when: ev.createdAt, tenantId: ev.tenantId || '', kind:def.k, ico:def.i, title:def.t, message: msg };
    }
    function renderTimeline(container, events, opts){
      if (!events || events.length === 0) { container.innerHTML = emptyBox('Aucune activité', 'Rien à signaler sur la période sélectionnée.'); return; }
      container.innerHTML = '<div class="timeline">' + events.map(ev => {
        const h = humanEvent(ev);
        return '<div class="ev"><div class="ei '+h.kind+'">'+icon(h.ico)+'</div><div><div class="et">'+safe(h.title)+(h.tenantId && !(opts&&opts.hideSite) ? ' <a class="mono muted" href="#/site/'+safe(h.tenantId)+'">'+safe(h.tenantId)+'</a>':'')+'</div>' +
          (h.message?'<div class="em">'+safe(h.message)+'</div>':'') +
          '<details><summary>Détails techniques</summary><pre>'+safe(JSON.stringify({type:ev.type, tenantId:ev.tenantId, path:ev.path, category:ev.category, metadata:ev.metadata}, null, 2))+'</pre></details></div>' +
          '<div class="ew" title="'+safe(new Date(h.when).toLocaleString('fr-FR'))+'">'+safe(fmtAgo(h.when))+'</div></div>';
      }).join('') + '</div>';
    }

    async function loadMe(){
      const me = await api('/api/platform/me'); if (!me) return;
      $('meMail').textContent = me.email; $('meRole').textContent = me.role; $('meAv').textContent = (me.email||'?')[0].toUpperCase();
    }
    function bindOpen(root){ root.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { window.location.hash = '#/site/'+b.getAttribute('data-open'); })); }

    /* ───────────────────────── Vue globale ───────────────────────── */
    async function viewOverview(){
      setNavActive('overview');
      setPage('Vue globale', 'Business, activité clients, santé technique et coûts — sur '+RANGE_LABEL[state.range].toLowerCase()+'.');
      const root = $('view-overview'); skeleton(root, 8);
      const rq = encodeURIComponent(state.range);
      const [ov, charts, alerts, recent, health] = await Promise.all([
        api('/api/platform/overview?range='+rq), api('/api/platform/overview/charts?range='+rq),
        api('/api/platform/alerts?range='+rq), api('/api/platform/events?range='+rq+'&take=12'),
        api('/api/platform/health').catch(() => null),
      ]);
      if (!ov || !charts || !alerts) return;
      const prev = ov.previous || null;
      const s = charts.series || [];
      const usage = ov.usage || {};
      const pay = ov.payments;
      const paidCount = pay.paidInRange, failedCount = pay.failedInRange;
      const successRate = (paidCount+failedCount) ? paidCount/(paidCount+failedCount)*100 : null;
      const basket = paidCount ? pay.amountPaidInRangeCents/paidCount : 0;
      const prevBasket = prev && prev.paidInRange ? prev.amountPaidInRangeCents/prev.paidInRange : null;
      const calcs = usage.calculations || 0;
      const conv = calcs ? (ov.leads.inRange/calcs*100) : null;
      const costPerCalc = (usage.estimatedCostCents != null && calcs) ? usage.estimatedCostCents/calcs : null;
      const emailsTotal = (ov.leads.emailsSentInRange||0) + (ov.leads.emailsFailedInRange||0);
      const emailRate = emailsTotal ? ov.leads.emailsSentInRange/emailsTotal*100 : null;
      const crit = alerts.summary.critique || 0, warns = alerts.summary.warning || 0;
      const vs = prev ? ' <span>vs période préc.</span>' : '';

      const nb = $('navAlertCount'); if (crit > 0) { nb.textContent = crit; nb.style.display = ''; } else nb.style.display = 'none';

      const hero = [
        kpi({ label:'CA payé', value:fmtCents(pay.amountPaidInRangeCents), ico:'euro', tone:'ok', meta:delta(pay.amountPaidInRangeCents, prev&&prev.amountPaidInRangeCents)+vs, spark:s.map(x=>x.revenuePaidCents), sparkColor:'#34d399' }),
        kpi({ label:'Réservations & demandes', value:fmtInt(ov.leads.inRange), ico:'cart', meta:delta(ov.leads.inRange, prev&&prev.leadsInRange)+vs, spark:s.map(x=>x.reservations), sparkColor:'#7c8cff' }),
        kpi({ label:'Paiements réussis', value:fmtInt(paidCount), ico:'card', tone:'info', meta:(successRate!=null?badge(fmtPct(successRate)+' de succès', successRate>=90?'ok':successRate>=70?'warn':'bad'):'<span>Aucun paiement</span>'), spark:s.map(x=>x.payments), sparkColor:'#38bdf8' }),
        kpi({ label:'Sites actifs', value:fmtInt(ov.tenants.active)+' / '+fmtInt(ov.tenants.total), ico:'globe', tone:crit?'bad':warns?'warn':'ok', meta:(crit?badge(crit+' critique'+(crit>1?'s':''),'bad'):'')+(warns?badge(warns+' warning'+(warns>1?'s':''),'warn'):'')+(!crit&&!warns?badge('Tout est OK','ok'):'') }),
      ].join('');

      const sec = (cls, title, hint, body) => '<div class="card '+cls+' fade"><div class="card-title"><span class="grow">'+safe(title)+'</span>'+(hint||'')+'</div>'+body+'</div>';

      const finance = sec('col-4','Finances','', '<div class="stat-list">' +
        statRow('CA total (cumulé)', '<span>'+fmtCents(pay.amountPaidTotalCents)+'</span>', fmtInt(pay.paidTotal)+' paiements') +
        statRow('Frais plateforme', '<span>'+fmtCents(pay.platformFeesInRangeCents)+'</span> '+delta(pay.platformFeesInRangeCents, prev&&prev.platformFeesInRangeCents), 'cumulé : '+fmtCents(pay.platformFeesTotalCents)) +
        statRow('Panier moyen', '<span>'+fmtCents(basket)+'</span> '+delta(basket, prevBasket)) +
        statRow('Paiements échoués', '<span class="'+(failedCount?'':'muted')+'">'+fmtInt(failedCount)+'</span>', successRate!=null?'taux de succès '+fmtPct(successRate):'') +
      '</div>');
      const clients = sec('col-4','Activité clients','', '<div class="stat-list">' +
        statRow('Calculs de tarif', '<span>'+fmtInt(calcs)+'</span>', 'réussis '+fmtInt(usage.calculationSuccess)+' · échecs '+fmtInt(usage.calculationFailed)) +
        statRow('Conversion calcul → demande', conv!=null?'<span>'+fmtPct(conv)+'</span>':'<span class="muted">—</span>', fmtInt(ov.leads.inRange)+' demandes / '+fmtInt(calcs)+' calculs') +
        statRow('Emails envoyés', '<span>'+fmtInt(ov.leads.emailsSentInRange)+'</span>', emailRate!=null?'fiabilité '+fmtPct(emailRate):'') +
        statRow('Emails en échec', '<span class="'+(ov.leads.emailsFailedInRange?'':'muted')+'" style="'+(ov.leads.emailsFailedInRange?'color:var(--bad)':'')+'">'+fmtInt(ov.leads.emailsFailedInRange)+'</span>', 'à vérifier côté SMTP') +
      '</div>');
      const costBody = '<div class="stat-list">' +
        statRow('Coût estimé', '<span>'+safe(fmtUsageCost(usage))+'</span>', usage.costConfigured ? 'période '+RANGE_LABEL[state.range] : 'GOOGLE_*_COST_CENTS_PER_CALL à renseigner') +
        statRow('Appels Distance Matrix', '<span>'+fmtInt(usage.distanceCalls)+'</span>', costPerCalc!=null ? fmtCents(costPerCalc)+' / calcul' : '') +
        statRow('Autocomplete', '<span>'+fmtInt(usage.autocompleteCalls)+'</span>') +
        statRow('Appels API métier', '<span>'+fmtInt(usage.businessApiCalls)+'</span>', 'erreurs : '+fmtInt(usage.apiErrors)) +
      '</div>';
      const costs = sec('col-4','Coûts &amp; usage API','', costBody);

      const act = s;
      const trends = [
        '<div class="card col-8 fade"><div class="card-title"><span class="grow">Activité</span></div>'+legend([['Calculs','#7c8cff'],['Réservations','#34d399'],['Paiements','#fbbf24']])+'<div class="chart-box"><canvas id="chActivity"></canvas></div></div>',
        '<div class="card col-4 fade"><div class="card-title"><span class="grow">Types de service</span></div><div class="chart-box"><canvas id="chServiceTypes"></canvas></div></div>',
        '<div class="card col-7 fade"><div class="card-title"><span class="grow">Chiffre d’affaires &amp; frais</span></div>'+legend([['CA payé','#34d399'],['Frais plateforme','#f87171']])+'<div class="chart-box sm"><canvas id="chRevenue"></canvas></div></div>',
        '<div class="card col-5 fade"><div class="card-title"><span class="grow">Top sites par CA</span></div><div class="chart-box sm"><canvas id="chTopSites"></canvas></div></div>',
      ].join('');

      // santé technique (inline)
      let healthHtml = '<div class="card fade col-12">'+emptyBox('Santé indisponible')+'</div>';
      if (health) healthHtml = '<div class="card col-12 fade"><div class="card-title"><span class="grow">Santé technique</span><a class="btn sm" href="#/health">Détails</a></div>'+healthTiles(health)+'</div>';

      root.innerHTML =
        '<div class="grid">'+hero+'</div>' +
        sectionHead('Tendances') + '<div class="grid">'+trends+'</div>' +
        sectionHead('Business · Clients · Coûts') + '<div class="grid">'+finance+clients+costs+'</div>' +
        sectionHead('Santé technique') + '<div class="grid">'+healthHtml+'</div>' +
        sectionHead('À traiter en priorité', fmtInt((alerts.priorityActions||[]).length)+' action(s)') + '<div id="priorityActions"></div>' +
        '<div class="grid top" style="margin-top:14px"><div class="card col-7 fade"><div class="card-title"><span class="grow">Sites à surveiller</span></div><div id="watchTable"></div></div>' +
        '<div class="card col-5 fade"><div class="card-title"><span class="grow">Dernières activités</span><a class="btn sm" href="#/events">Tout voir</a></div><div id="recentEvents"></div></div></div>';
      hydrateIcons(root);
      await afterPaint();

      const labels = act.map(x => x.day.slice(5));
      mkChart('activity','chActivity',{ type:'line', data:{ labels, datasets:[ areaDataset('Calculs', act.map(x=>x.calculatorQuotes),'#7c8cff'), areaDataset('Réservations', act.map(x=>x.reservations),'#34d399'), areaDataset('Paiements', act.map(x=>x.payments),'#fbbf24') ] }, options:{ plugins:{ legend:{ display:false }, tooltip:tooltipOpts }, scales:chartScales(false) } });
      mkChart('revenue','chRevenue',{ type:'bar', data:{ labels, datasets:[ { label:'CA payé', data:act.map(x=>x.revenuePaidCents/100), backgroundColor:'#34d399', borderRadius:5, maxBarThickness:22 }, { label:'Frais plateforme', data:act.map(x=>x.platformFeesCents/100), backgroundColor:'#f87171', borderRadius:5, maxBarThickness:22 } ] }, options:{ plugins:{ legend:{ display:false }, tooltip:tooltipOpts }, scales:chartScales(true) } });
      const st = charts.serviceTypes || [];
      if (st.length) mkChart('service','chServiceTypes',{ type:'doughnut', data:{ labels:st.map(x=>x.key), datasets:[{ data:st.map(x=>x.cnt), backgroundColor:PALETTE, borderColor:'#11141c', borderWidth:3, hoverOffset:6 }] }, options:{ cutout:'66%', plugins:{ legend:{ position:'bottom', labels:{ usePointStyle:true, boxWidth:8, padding:14 } }, tooltip:tooltipOpts } } });
      else $('chServiceTypes').parentElement.innerHTML = emptyBox('Pas encore de données');
      const top = charts.topSites || [];
      if (top.length) mkChart('topSites','chTopSites',{ type:'bar', data:{ labels:top.map(x=>x.name), datasets:[{ label:'CA payé', data:top.map(x=>x.revenuePaidCents/100), backgroundColor:'#7c8cff', borderRadius:6, maxBarThickness:26 }] }, options:{ indexAxis:'y', plugins:{ legend:{ display:false }, tooltip:tooltipOpts }, scales:{ x:{ ...chartScales(true).y, grid:{ color:'rgba(255,255,255,.05)' } }, y:{ grid:{ display:false }, border:{ display:false } } } } });
      else $('chTopSites').parentElement.innerHTML = emptyBox('Aucun CA sur la période');

      const pa = alerts.priorityActions || [];
      $('priorityActions').innerHTML = pa.length === 0 ? '<div class="card">'+emptyBox('Aucune action prioritaire','Tout est en ordre sur la période.')+'</div>' :
        '<div class="grid">' + pa.slice(0,6).map(a => '<div class="col-4"><div class="alert '+(a.priority==='critique'?'bad':a.priority==='important'?'warn':'ok')+'"><span class="bar-l"></span><div style="flex:1;min-width:0"><div class="hrow">'+priorityBadge(a.priority)+'</div><div class="at" style="margin-top:8px">'+safe(a.action)+'</div><div class="ad">'+safe(a.siteName)+' · '+safe(a.problem||'')+'</div><div class="aa">'+safe(a.why||'')+'</div><button class="btn sm" style="margin-top:10px" data-open="'+safe(a.tenantId)+'">Ouvrir la fiche</button></div></div></div>').join('') + '</div>';
      bindOpen($('priorityActions'));

      const rows = alerts.sitesToWatch || [];
      $('watchTable').innerHTML = rows.length === 0 ? emptyBox('Aucun site à surveiller') :
        '<div class="table-wrap"><table class="table compact"><thead><tr><th>Site</th><th>Statut</th><th>Prêt</th><th></th></tr></thead><tbody>' +
        rows.slice(0,8).map(x => '<tr><td><div class="site-cell">'+siteAv(x.name)+'<div><div class="strong">'+safe(x.name)+'</div><div class="muted" style="font-size:12px">'+safe((x.problems||[]).slice(0,2).join(' · ')||x.tenantId)+'</div></div></div></td><td>'+statusBadge(x.status)+'</td><td><div class="strong">'+safe(String(x.readinessScore))+' %</div><div class="bar" style="width:64px"><i class="'+(x.readinessScore>=85?'ok':x.readinessScore>=70?'warn':'bad')+'" style="width:'+Number(x.readinessScore||0)+'%"></i></div></td><td class="right"><button class="btn sm" data-open="'+safe(x.tenantId)+'">Fiche</button></td></tr>').join('') + '</tbody></table></div>';
      bindOpen($('watchTable'));
      renderTimeline($('recentEvents'), (recent && recent.events) ? recent.events : []);
    }

    function healthTiles(h){
      const rt = h.runtime || {}, db = h.db || {}, it = h.integrations || {};
      const tile = (name, desc, kind) => '<div class="status-tile"><span class="dot '+kind+'"></span><div><div class="n">'+safe(name)+'</div><div class="d">'+safe(desc)+'</div></div></div>';
      return '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr))">' +
        tile('API', h.ok ? 'Opérationnelle · '+(rt.env||'') : 'Dégradée', h.ok?'ok':'bad') +
        tile('Base PostgreSQL', db.ok ? 'Répond en '+db.latencyMs+' ms' : 'Injoignable', db.ok ? (db.latencyMs>250?'warn':'ok') : 'bad') +
        tile('Stripe', it.stripe ? (it.stripeWebhook ? 'Clé + webhook configurés' : 'Webhook non configuré') : 'Clé absente', it.stripe ? (it.stripeWebhook?'ok':'warn') : 'bad') +
        tile('Emails SMTP', it.smtp ? 'Serveur configuré' : 'SMTP non configuré', it.smtp?'ok':'warn') +
        tile('Distance Matrix', it.distanceMatrix ? 'Clé API présente' : 'Clé absente (calcul tarif KO)', it.distanceMatrix?'ok':'bad') +
        tile('Secrets JWT', it.jwtSecrets ? 'Définis' : 'Valeurs par défaut (dev)', it.jwtSecrets?'ok':'warn') +
        tile('Télémétrie', h.features.telemetryEnabled ? 'Activée' : 'Désactivée', h.features.telemetryEnabled?'ok':'warn') +
        tile('Uptime', rt.uptimeSec!=null ? fmtUptime(rt.uptimeSec)+' · '+rt.rssMb+' Mo RAM' : '—', 'ok') +
      '</div>';
    }

    /* ───────────────────────── Sites ───────────────────────── */
    async function viewSites(){
      setNavActive('sites'); setPage('Sites', 'Statut, contenu, Stripe, performance et usage de chaque site client.');
      document.querySelectorAll('#siteFilters .pill-btn').forEach(b => b.classList.toggle('on', (b.getAttribute('data-status')||'')===state.sitesStatus));
      const qs = new URLSearchParams(); qs.set('range', state.range);
      if (state.q) qs.set('q', state.q); if (state.sitesStatus) qs.set('status', state.sitesStatus);
      const data = await api('/api/platform/sites?'+qs.toString()); if (!data) return;
      $('sitesCount').textContent = fmtInt(data.count)+' site(s)';
      const rows = data.sites || [];
      $('sitesTable').innerHTML = rows.length === 0 ? '<div class="card">'+emptyBox('Aucun site ne correspond aux filtres')+'</div>' :
        '<div class="table-wrap"><table class="table"><thead><tr><th>Site</th><th>Statut</th><th>Intégrations</th><th>Usage API · '+safe(RANGE_LABEL[state.range]||data.range)+'</th><th class="right">CA</th><th class="right">Paiements</th><th class="right">Actions</th></tr></thead><tbody>' +
        rows.map(s => {
          const sc = s.status.readinessScore;
          const pending = !!s.detectedDomain;
          const acts = pending
            ? '<button class="btn sm" data-domain-confirm="'+safe(s.detectedDomain.id)+'">Associer</button> <button class="btn sm" data-domain-create="'+safe(s.detectedDomain.id)+'">Créer tenant</button> <button class="btn sm danger" data-domain-reject="'+safe(s.detectedDomain.id)+'">Rejeter</button>'
            : (s.siteUrl?'<a class="btn sm" href="'+safe(s.siteUrl)+'" target="_blank" rel="noreferrer">Site</a> ':'')+'<button class="btn sm primary" data-open="'+safe(s.tenantId)+'">Fiche</button>'+(s.adminUrl?' <a class="btn sm" href="'+safe(s.adminUrl)+'" target="_blank" rel="noreferrer">Admin</a>':'');
          return '<tr><td><div class="site-cell">'+siteAv(s.name)+'<div><div class="strong">'+safe(s.name)+'</div><div class="muted mono">'+safe(s.siteUrl||s.tenantId)+'</div></div></div></td>' +
            '<td><div class="pill-row">'+statusBadge(s.status.globalFine)+priorityBadge(s.status.priority)+'</div><div class="bar" style="width:120px"><i class="'+(sc>=85?'ok':sc>=70?'warn':'bad')+'" style="width:'+Number(sc||0)+'%"></i></div><div class="muted" style="font-size:11.5px;margin-top:3px">Prêt à '+safe(String(sc))+' %</div></td>' +
            '<td><div class="pill-row">'+badge('Stripe', s.status.stripeConnected?'ok':'bad')+badge('Accents', s.status.accentsOk?'ok':'warn')+'</div></td>' +
            '<td><div>'+fmtInt(s.usage&&s.usage.calculations)+' calculs · '+fmtInt(s.usage&&s.usage.distanceCalls)+' distance</div><div class="muted" style="font-size:12px">'+fmtInt(s.usage&&s.usage.apiErrors)+' erreurs · '+safe(fmtUsageCost(s.usage))+'</div></td>' +
            '<td class="right strong">'+fmtCents(s.metrics.amountPaidInRangeCents)+'</td>' +
            '<td class="right">'+fmtInt(s.metrics.paymentsPaidInRange)+'<div class="muted" style="font-size:12px">'+fmtInt(s.metrics.paymentsFailedInRange)+' échec(s)</div></td>' +
            '<td class="right">'+acts+'</td></tr>';
        }).join('') + '</tbody></table></div>';
      bindOpen($('sitesTable')); bindDomainActions($('sitesTable'));
    }

    function bindDomainActions(root){
      root.querySelectorAll('[data-domain-confirm]').forEach(b => b.addEventListener('click', async () => {
        const id = b.getAttribute('data-domain-confirm'); const tenantId = prompt('Tenant existant à associer (ex: default)'); if (!tenantId) return;
        await api('/api/platform/domains/'+encodeURIComponent(id)+'/confirm', { method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'}, body: JSON.stringify({ tenantId, canonicalDomain:true }) });
        toast('Domaine associé'); await router();
      }));
      root.querySelectorAll('[data-domain-create]').forEach(b => b.addEventListener('click', async () => {
        const id = b.getAttribute('data-domain-create'); const name = prompt('Nom du nouveau site/tenant'); if (!name) return;
        await api('/api/platform/domains/'+encodeURIComponent(id)+'/create-tenant', { method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'}, body: JSON.stringify({ name }) });
        toast('Tenant créé'); await router();
      }));
      root.querySelectorAll('[data-domain-reject]').forEach(b => b.addEventListener('click', async () => {
        const id = b.getAttribute('data-domain-reject'); if (!confirm('Rejeter ce domaine détecté ?')) return;
        await api('/api/platform/domains/'+encodeURIComponent(id)+'/reject', { method:'POST' });
        toast('Domaine rejeté'); await router();
      }));
    }

    async function viewDomains(){
      setNavActive('domains'); setPage('Sites détectés', 'Domaines observés automatiquement et associations aux tenants.');
      const data = await api('/api/platform/domains'); if (!data) return;
      const rows = data.domains || [];
      $('domainsTable').innerHTML = rows.length === 0 ? '<div class="card">'+emptyBox('Aucun domaine détecté')+'</div>' :
        '<div class="table-wrap"><table class="table"><thead><tr><th>Domaine</th><th>Tenant</th><th>Statut</th><th>Source</th><th class="right">Événements</th><th>Dernière activité</th><th class="right">Actions</th></tr></thead><tbody>' +
        rows.map(d => {
          const st = d.status==='active' ? badge('Actif','ok') : d.status==='pending' ? badge('À confirmer','warn') : badge(d.status,'bad');
          const actions = d.status==='pending'
            ? '<button class="btn sm" data-domain-confirm="'+safe(d.id)+'">Associer</button> <button class="btn sm" data-domain-create="'+safe(d.id)+'">Créer tenant</button> <button class="btn sm danger" data-domain-reject="'+safe(d.id)+'">Rejeter</button>'
            : '<button class="btn sm" data-domain-confirm="'+safe(d.id)+'">Réassocier</button>';
          return '<tr><td><a class="strong" href="https://'+safe(d.domain)+'" target="_blank" rel="noreferrer">'+safe(d.domain)+'</a><div class="muted" style="font-size:12px">'+safe((d.eventTypes||[]).slice(0,4).join(', '))+'</div></td>' +
            '<td>'+(d.tenant?'<div class="strong">'+safe(d.tenant.name)+'</div><div class="muted mono">'+safe(d.tenant.id)+'</div>':'<span class="muted">—</span>')+'</td>' +
            '<td>'+st+'</td><td>'+safe(d.source)+(d.canonicalDomain?' '+badge('canonique','info'):'')+'</td><td class="right">'+fmtInt(d.eventsCount)+'</td>' +
            '<td class="muted">'+safe(fmtAgo(d.lastEventAt||d.lastSeenAt))+'</td><td class="right">'+actions+'</td></tr>';
        }).join('') + '</tbody></table></div>';
      bindDomainActions($('domainsTable'));
    }

    /* ───────────────────────── Fiche site ───────────────────────── */
    async function viewSite(tenantId){
      setNavActive('sites'); setPage('Fiche site', 'KPI, activité, usage API, plan d’action et audit du contenu.');
      const rq = encodeURIComponent(state.range), tid = encodeURIComponent(tenantId);
      const [site, metrics, charts, audit, planResp, events] = await Promise.all([
        api('/api/platform/sites/'+tid), api('/api/platform/sites/'+tid+'/metrics?range='+rq), api('/api/platform/sites/'+tid+'/charts?range='+rq),
        api('/api/platform/sites/'+tid+'/audit'), api('/api/platform/sites/'+tid+'/plan?range='+rq), api('/api/platform/sites/'+tid+'/events?range='+rq+'&take=40'),
      ]);
      if (!site || !metrics || !charts || !audit) return;
      const a = audit.audit, plan = planResp ? planResp.plan : null;
      const stripeOk = site.stripe.accountIdPresent && site.stripe.chargesEnabled;
      $('siteHeader').innerHTML = '<div class="site-hero">'+siteAv(site.name)+'<div style="flex:1;min-width:200px"><div style="font-size:20px;font-weight:700;letter-spacing:-.02em">'+safe(site.name)+'</div><div class="muted mono">'+safe(site.tenantId)+(site.siteUrl?' · <a href="'+safe(site.siteUrl)+'" target="_blank" rel="noreferrer" style="color:var(--accent)">'+safe(site.siteUrl)+'</a>':'')+'</div></div>' +
        '<div class="pill-row">'+(plan?statusBadge(plan.fineStatus)+priorityBadge(plan.priority):'')+badge('Stripe', stripeOk?'ok':'warn')+badge('Contenu '+a.readinessScore+' %', a.readinessScore>=85?'ok':a.readinessScore>=70?'warn':'bad')+'</div>' +
        '<div class="pill-row"><a class="btn" href="#/sites">← Sites</a>'+(site.siteUrl?'<a class="btn" href="'+safe(site.siteUrl)+'" target="_blank" rel="noreferrer">Ouvrir le site '+icon('external')+'</a>':'')+(site.adminUrl?'<a class="btn primary" href="'+safe(site.adminUrl)+'" target="_blank" rel="noreferrer">Ouvrir l’admin</a>':'')+'</div></div>';

      const u = metrics.usage || {};
      const sk = [
        kpi({ label:'CA payé', value:fmtCents(metrics.payments.amountPaidCents), ico:'euro', tone:'ok', meta:'<span>frais '+fmtCents(metrics.payments.platformFeesCents)+'</span>' }),
        kpi({ label:'Réservations', value:fmtInt(metrics.leads.count), ico:'cart', meta:'<span>'+RANGE_LABEL[state.range]+'</span>' }),
        kpi({ label:'Paiements OK', value:fmtInt(metrics.payments.paidCount), ico:'card', tone:'info', meta:'<span>'+fmtInt(metrics.payments.failedCount)+' échec(s)</span>' }),
        kpi({ label:'Calculs API', value:fmtInt(u.calculations), ico:'calc', tone:'warn', meta:'<span>'+fmtInt(u.calculationSuccess)+' ok · '+fmtInt(u.calculationFailed)+' échecs</span>' }),
      ].join('');
      $('siteKpis').innerHTML = sk;

      const up = site.usagePeriods || metrics.usagePeriods || {};
      $('siteUsage').innerHTML = '<div class="table-wrap"><table class="table" style="min-width:520px"><thead><tr><th>Période</th><th class="right">Calculs</th><th class="right">Distance</th><th class="right">Autocomplete</th><th class="right">API métier</th><th class="right">Erreurs</th><th class="right">Coût estimé</th></tr></thead><tbody>' +
        ['24h','7d','30d','90d','all'].filter(r => up[r]).map(r => { const x = up[r]; return '<tr><td class="strong">'+RANGE_LABEL[r]+'</td><td class="right">'+fmtInt(x.calculations)+'</td><td class="right">'+fmtInt(x.distanceCalls)+'</td><td class="right">'+fmtInt(x.autocompleteCalls)+'</td><td class="right">'+fmtInt(x.businessApiCalls)+'</td><td class="right">'+fmtInt(x.apiErrors)+'</td><td class="right">'+safe(fmtUsageCost(x))+'</td></tr>'; }).join('') +
        '</tbody></table></div><div class="muted" style="margin-top:8px;font-size:12px">Le coût reste « Non configuré » tant que les variables GOOGLE_*_COST_CENTS_PER_CALL ne sont pas renseignées.</div>';

      if (plan) {
        const items = (plan.actions||[]).slice(0,10).map(x => '<div class="check"><div><div class="strong">'+safe(x.action)+'</div><div class="muted" style="font-size:12.5px;margin-top:2px">'+safe(x.pourquoi)+'</div></div><div>'+(x.statut==='ok'?badge('OK','ok'):badge('À faire', sevKind(x.gravite)))+'</div></div>').join('');
        $('sitePlan').innerHTML = '<div class="card-title"><span class="grow">Plan d’action</span>'+(plan.nextAction?badge('Prochaine : '+plan.nextAction,'warn'):badge('Rien à faire','ok'))+'</div>'+(items||emptyBox('Aucune action recommandée'));
      } else $('sitePlan').innerHTML = emptyBox('Plan d’action indisponible');

      const checks = (a.checks||[]).map(c => '<div class="check"><div><div class="strong">'+safe(c.label)+'</div>'+(c.message?'<div class="muted" style="font-size:12px">'+safe(c.message)+'</div>':'')+'</div><div>'+badge(c.status==='ok'?'OK':c.status==='ko'?'KO':'Warning', c.status==='ok'?'ok':c.status==='ko'?'bad':'warn')+'</div></div>').join('');
      const issues = (a.issues||[]).slice(0,6).map(i => '<div class="alert '+sevKind(i.severity)+'" style="margin-top:10px"><span class="bar-l"></span><div><div class="at">'+safe(i.title)+'</div><div class="ad">'+safe(i.message)+'</div></div></div>').join('');
      $('siteAudit').innerHTML = '<div class="card-title"><span class="grow">Audit du contenu</span>'+badge('Score '+a.readinessScore+' %', a.readinessScore>=85?'ok':a.readinessScore>=70?'warn':'bad')+'</div>' +
        '<div class="bar" style="margin-bottom:10px"><i class="'+(a.readinessScore>=85?'ok':a.readinessScore>=70?'warn':'bad')+'" style="width:'+Number(a.readinessScore||0)+'%"></i></div>' + checks + issues +
        '<details style="margin-top:12px"><summary>Export technique (JSON)</summary><pre>'+safe(JSON.stringify(a,null,2))+'</pre></details>';

      const f = charts.funnel || {};
      const steps = [['Pages vues',f.pageViews],['Ouverture calculateur',f.calculatorOpened],['Début de saisie',f.calculatorStarted],['Prix affiché',f.quoteDisplayed],['Calculs API',f.quotesApi],['Demandes',f.demands],['Réservations',f.reservations],['Paiements',f.payments]];
      const top = Math.max(...steps.map(x=>Number(x[1]||0)), 1);
      $('siteFunnel').innerHTML = steps.map(([l,v],i) => '<div class="funnel-row"><div class="fr"><span>'+safe(l)+'</span><span>'+fmtInt(v)+'</span></div><div class="bar"><i style="width:'+Math.max(2,Number(v||0)/top*100)+'%;opacity:'+(1-i*.07)+'"></i></div></div>').join('');

      await afterPaint();
      const labels = charts.series.map(x=>x.day.slice(5));
      mkChart('siteActivity','chSiteActivity',{ type:'line', data:{ labels, datasets:[ areaDataset('Calculs', charts.series.map(x=>x.calculatorQuotes),'#7c8cff'), areaDataset('Demandes', charts.series.map(x=>x.demands),'#fbbf24'), areaDataset('Paiements', charts.series.map(x=>x.payments),'#34d399') ] }, options:{ plugins:{ legend:{ position:'bottom', labels:{ usePointStyle:true, boxWidth:8 } }, tooltip:tooltipOpts }, scales:chartScales(false) } });
      const sv = charts.serviceTypes || [];
      if (sv.length) mkChart('siteService','chSiteService',{ type:'doughnut', data:{ labels:sv.map(x=>x.key), datasets:[{ data:sv.map(x=>x.cnt), backgroundColor:PALETTE, borderColor:'#11141c', borderWidth:3 }] }, options:{ cutout:'64%', plugins:{ legend:{ position:'bottom', labels:{ usePointStyle:true, boxWidth:8 } }, tooltip:tooltipOpts } } });
      else $('chSiteService').parentElement.innerHTML = emptyBox('Pas de données');
      renderTimeline($('siteEvents'), events ? (events.events ?? events) : [], { hideSite:true });
      hydrateIcons($('view-site'));
    }

    /* ───────────────────────── Activité ───────────────────────── */
    async function viewEvents(){
      setNavActive('events'); setPage('Activité', 'Journal filtrable : calculateur, réservations, paiements, emails, erreurs.');
      const tenantId = ($('evTenant').value||'').trim(), type = ($('evType').value||'').trim();
      if (!tenantId && !type) {
        const g = await api('/api/platform/events/grouped?range='+encodeURIComponent(state.range)+'&by=day&take=120'); if (!g) return;
        const groups = g.groups || [];
        $('eventsTimeline').innerHTML = groups.length === 0 ? emptyBox('Aucune activité','Rien sur la période sélectionnée.') :
          '<div class="table-wrap"><table class="table"><thead><tr><th>Jour</th><th>Site</th><th>Type</th><th class="right">Occurrences</th><th>Dernier</th><th></th></tr></thead><tbody>' +
          groups.map(x => { const d = EV[x.type]; return '<tr><td class="mono">'+safe(x.bucket)+'</td><td class="mono">'+safe(x.tenantId||'—')+'</td><td>'+badge(d?d.t:x.type, d?d.k:'')+'</td><td class="right strong">'+fmtInt(x.count)+'</td><td class="muted">'+safe(fmtAgo(x.lastAt))+'</td><td class="right">'+(x.tenantId?'<button class="btn sm" data-open="'+safe(x.tenantId)+'">Fiche</button>':'')+'</td></tr>'; }).join('') + '</tbody></table></div>';
        bindOpen($('eventsTimeline')); return;
      }
      const qs = new URLSearchParams(); qs.set('range', state.range); qs.set('take','200'); if (tenantId) qs.set('tenantId', tenantId); if (type) qs.set('type', type);
      const data = await api('/api/platform/events?'+qs.toString()); if (!data) return;
      renderTimeline($('eventsTimeline'), data.events || []);
    }

    /* ───────────────────────── Santé & alertes ───────────────────────── */
    async function viewHealth(){
      setNavActive('health'); setPage('Santé & alertes', 'Supervision de la plateforme : services, intégrations, priorités et risques.');
      const root = $('view-health'); skeleton(root, 4);
      const [health, alerts] = await Promise.all([ api('/api/platform/health'), api('/api/platform/alerts?range='+encodeURIComponent(state.range)) ]);
      if (!health || !alerts) return;
      const crit = alerts.summary.critique||0, warn = alerts.summary.warning||0;
      const nb = $('navAlertCount'); if (crit>0) { nb.textContent = crit; nb.style.display=''; } else nb.style.display='none';
      const rt = health.runtime || {};
      const list = alerts.alerts || [];
      root.innerHTML =
        '<div class="grid">' +
          kpi({ label:'Alertes critiques', value:fmtInt(crit), ico:'alert', tone:crit?'bad':'ok', meta:'<span>à traiter en priorité</span>' }) +
          kpi({ label:'Warnings', value:fmtInt(warn), ico:'alert', tone:warn?'warn':'ok', meta:'<span>à surveiller</span>' }) +
          kpi({ label:'Uptime API', value:rt.uptimeSec!=null?fmtUptime(rt.uptimeSec):'—', ico:'clock', tone:'info', meta:'<span>Node '+safe(rt.nodeVersion||'')+'</span>' }) +
          kpi({ label:'Latence base', value:health.db&&health.db.ok?health.db.latencyMs+' ms':'KO', ico:'db', tone:health.db&&health.db.ok?'ok':'bad', meta:'<span>'+safe(rt.rssMb!=null?rt.rssMb+' Mo RAM':'')+'</span>' }) +
        '</div>' +
        sectionHead('Services & intégrations') + '<div class="card">'+healthTiles(health)+'</div>' +
        sectionHead('Alertes', fmtInt(list.length)+' au total') +
        (list.length === 0 ? '<div class="card">'+emptyBox('Aucune alerte','Tous les sites sont en ordre sur la période.')+'</div>' :
          '<div class="table-wrap"><table class="table"><thead><tr><th>Sévérité</th><th>Site</th><th>Raison</th><th>Action suggérée</th><th>Activité</th><th></th></tr></thead><tbody>' +
          list.slice(0,60).map(a => '<tr><td>'+badge(a.severity, sevKind(a.severity))+'</td><td><div class="site-cell">'+siteAv(a.siteName)+'<div><div class="strong">'+safe(a.siteName)+'</div><div class="muted mono">'+safe(a.tenantId)+'</div></div></div></td><td><div class="strong">'+safe(a.reason)+'</div><div class="muted" style="font-size:12.5px">'+safe(a.detail||'')+'</div></td><td class="muted">'+safe(a.actionSuggested||'')+'</td><td class="muted">'+safe(fmtAgo(a.lastActivityAt))+'</td><td class="right"><button class="btn sm" data-open="'+safe(a.tenantId)+'">Fiche</button></td></tr>').join('') + '</tbody></table></div>');
      hydrateIcons(root); bindOpen(root);
    }

    async function router(){
      const parts = (window.location.hash || '#/overview').replace('#/','').split('/');
      const page = parts[0] || 'overview';
      document.querySelectorAll('#rangeSeg button').forEach(b => b.classList.toggle('on', b.getAttribute('data-r')===state.range));
      try {
        if (page === 'overview'){ show('view-overview'); await viewOverview(); }
        else if (page === 'sites'){ show('view-sites'); await viewSites(); }
        else if (page === 'domains'){ show('view-domains'); await viewDomains(); }
        else if (page === 'site'){ show('view-site'); await viewSite(parts[1]||''); }
        else if (page === 'events'){ show('view-events'); await viewEvents(); }
        else if (page === 'health'){ show('view-health'); await viewHealth(); }
        else window.location.hash = '#/overview';
        window.scrollTo({ top:0 });
      } catch (e) { toast(e && e.message ? e.message : 'Erreur de chargement'); }
    }

    document.querySelectorAll('#siteFilters .pill-btn').forEach(btn => btn.addEventListener('click', () => { state.sitesStatus = btn.getAttribute('data-status')||''; router(); }));
    document.querySelectorAll('#rangeSeg button').forEach(b => b.addEventListener('click', () => { state.range = b.getAttribute('data-r'); router(); }));
    let qT; $('q').addEventListener('input', () => { state.q = $('q').value; clearTimeout(qT); qT = setTimeout(() => { if (!(window.location.hash||'').startsWith('#/sites')) window.location.hash = '#/sites'; else router(); }, 250); });
    $('reload').addEventListener('click', () => router());
    $('logout').addEventListener('click', async () => { try { await fetch('/api/platform/auth/logout', { method:'POST', credentials:'include' }); } catch {} window.location.href='/admin/login'; });
    $('evReload').addEventListener('click', () => viewEvents().catch(()=>{}));
    window.addEventListener('hashchange', () => router());

    (async function init(){ hydrateIcons(); await loadMe(); await router(); })();
  </script>
</body>
</html>
`;
}
