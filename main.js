// ─── NARROW — main.js ───────────────────────
// Supabase client exposed globally so dashboard.html can use it
window.narrowSupabase = null;

document.addEventListener('DOMContentLoaded', () => {
  window.narrowSupabase = window.supabase.createClient(
    'https://okalotfqhmwiyckhvcmk.supabase.co',
    'sb_publishable_YrgPXrGiPlCY1Mdhw_NYpw_jO36M2iZ'
  );

  // ── Auth state → nav ────────────────────────
  async function updateNavAuth() {
    const navAuth    = document.getElementById('nav-auth');
    const navLinks   = document.querySelector('.nav__links');
    const journeyBtn = document.querySelector('.nav__journey-btn');
    if (!navAuth) return;

    const { data: { session } } = await window.narrowSupabase.auth.getSession();

    if (session && session.user) {
      // Logged in: hide full nav, show dashboard pill + sign out
      if (navLinks)   navLinks.style.display  = 'none';
      if (journeyBtn) journeyBtn.style.display = 'none';

      const name      = session.user.user_metadata?.full_name || session.user.email.split('@')[0];
      const firstName = name.split(' ')[0];

      const { data: journey } = await window.narrowSupabase
        .from('user_journeys').select('*')
        .eq('user_id', session.user.id).single();

      const done        = journey?.steps_done   || [];
      const currentStep = journey?.current_step || 1;

      const STEP_NAMES = [
        'Start Your Journey','Financing','Find Land',
        'Architect Plans','Customize','Contractor Bids','Move In'
      ];

      navAuth.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;position:relative">

          <button onclick="toggleNavJourney(event)" style="
            background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);
            color:white;border-radius:8px;padding:7px 16px;cursor:pointer;
            font-family:var(--font-body);font-size:0.85rem;font-weight:600;
            display:flex;align-items:center;gap:8px;white-space:nowrap;transition:background 0.2s"
            onmouseover="this.style.background='rgba(255,255,255,0.18)'"
            onmouseout="this.style.background='rgba(255,255,255,0.1)'">
            🏠 ${firstName}'s Dashboard
            <span style="font-size:0.7rem;background:var(--amber);color:var(--navy-dark);
              border-radius:10px;padding:2px 8px;font-weight:700">${done.length}/7</span>
            <span style="opacity:0.5;font-size:0.65rem">▾</span>
          </button>

          <button onclick="window.narrowSignOut()" style="
            background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);
            color:rgba(255,255,255,0.7);border-radius:6px;padding:6px 12px;cursor:pointer;
            font-family:var(--font-body);font-size:0.8rem;font-weight:500;
            transition:all 0.2s;white-space:nowrap"
            onmouseover="this.style.background='rgba(255,255,255,0.15)';this.style.color='white'"
            onmouseout="this.style.background='rgba(255,255,255,0.08)';this.style.color='rgba(255,255,255,0.7)'">
            Sign Out
          </button>

          <div id="navJourneyPanel" style="display:none;position:absolute;top:calc(100% + 12px);
            right:0;background:white;border-radius:14px;width:300px;
            box-shadow:0 12px 40px rgba(0,0,0,0.2);z-index:500;overflow:hidden;
            border:1px solid rgba(27,58,107,0.1)">

            <div style="background:var(--navy);padding:16px 20px">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="color:white;font-weight:700;font-size:0.9rem">Your Journey</span>
                <a href="dashboard.html" style="color:var(--amber);font-size:0.75rem;font-weight:600">Open Dashboard →</a>
              </div>
              <div style="color:rgba(255,255,255,0.5);font-size:0.72rem;margin-top:4px">${done.length} of 7 steps complete</div>
            </div>

            <div style="padding:10px 8px;max-height:300px;overflow-y:auto">
              ${STEP_NAMES.map((s, i) => {
                const n = i + 1;
                const isDone    = done.includes(n);
                const isCurrent = n === currentStep && !isDone;
                return `
                  <div onclick="navToggleStep(${n})" style="display:flex;align-items:center;gap:10px;
                    padding:9px 12px;border-radius:8px;margin-bottom:2px;cursor:pointer;
                    background:${isCurrent ? '#EEF2FF' : 'transparent'}"
                    onmouseover="this.style.background='${isDone ? '#f0fbf4' : '#f5f5f5'}'"
                    onmouseout="this.style.background='${isCurrent ? '#EEF2FF' : 'transparent'}'">
                    <div style="width:24px;height:24px;border-radius:50%;flex-shrink:0;
                      background:${isDone ? '#2D6A4F' : isCurrent ? '#E8A838' : '#E5E7EB'};
                      display:flex;align-items:center;justify-content:center;
                      font-size:0.7rem;font-weight:700;color:${isDone || isCurrent ? 'white' : '#9CA3AF'}">
                      ${isDone ? '✓' : n}
                    </div>
                    <span style="font-size:0.82rem;flex:1;font-weight:${isCurrent ? 700 : 500};
                      color:${isDone ? '#9CA3AF' : '#111'};
                      text-decoration:${isDone ? 'line-through' : 'none'}">${s}</span>
                    ${isCurrent ? '<span style="font-size:0.62rem;background:#FEF3C7;color:#92400E;padding:2px 6px;border-radius:8px;font-weight:700">NOW</span>' : ''}
                  </div>`;
              }).join('')}
            </div>

            <div style="border-top:1px solid #E5E7EB;padding:12px 16px">
              <a href="dashboard.html" class="btn btn-primary"
                style="width:100%;justify-content:center;font-size:0.82rem;padding:10px;display:flex">
                Go to My Dashboard →
              </a>
            </div>
          </div>
        </div>
      `;

    } else {
      // Not logged in: restore full nav
      if (navLinks)   navLinks.style.display  = '';
      if (journeyBtn) journeyBtn.style.display = '';
      navAuth.innerHTML = `<a href="login.html" class="nav__signin">Sign In</a>`;
    }
  }

  window.toggleNavJourney = function(e) {
    e.stopPropagation();
    const panel = document.getElementById('navJourneyPanel');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  };

  document.addEventListener('click', () => {
    const panel = document.getElementById('navJourneyPanel');
    if (panel) panel.style.display = 'none';
  });

  window.navToggleStep = async function(n) {
    const { data: { session } } = await window.narrowSupabase.auth.getSession();
    if (!session) return;
    const { data: j } = await window.narrowSupabase
      .from('user_journeys').select('*').eq('user_id', session.user.id).single();
    const done = [...(j?.steps_done || [])];
    const pos  = done.indexOf(n);
    if (pos === -1) done.push(n); else done.splice(pos, 1);
    let next = 7;
    for (let i = 1; i <= 7; i++) { if (!done.includes(i)) { next = i; break; } }
    await window.narrowSupabase.from('user_journeys').upsert({
      user_id: session.user.id, current_step: next,
      steps_done: done, updated_at: new Date().toISOString()
    });
    updateNavAuth();
  };

  window.narrowSignOut = async function() {
    await window.narrowSupabase.auth.signOut();
    window.location.href = 'index.html';
  };

  updateNavAuth();
  setTimeout(updateNavAuth, 600);
  setTimeout(updateNavAuth, 1800);
  window.narrowSupabase.auth.onAuthStateChange(() => updateNavAuth());

  // ── Nav auth styles ──────────────────────────
  if (!document.getElementById('nav-auth-styles')) {
    const s = document.createElement('style');
    s.id = 'nav-auth-styles';
    s.textContent = `
      .nav__auth { display:flex; align-items:center; }
      .nav__signin { color:rgba(255,255,255,0.8);font-size:0.9rem;font-weight:500;
        font-family:var(--font-body);text-decoration:none;padding:6px 4px;
        transition:color 0.2s;white-space:nowrap; }
      .nav__signin:hover { color:#fff; }
    `;
    document.head.appendChild(s);
  }

  // ── Active nav link ──────────────────────────
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav__link').forEach(link => {
    if (link.getAttribute('href') === currentPage) link.classList.add('active');
  });

  // ── Mobile nav toggle ────────────────────────
  const hamburger  = document.querySelector('.nav__hamburger');
  const navLinksEl = document.querySelector('.nav__links');
  if (hamburger) {
    hamburger.addEventListener('click', () => {
      const isOpen = hamburger.classList.toggle('open');
      if (!navLinksEl) return;
      if (isOpen) {
        navLinksEl.style.cssText = `
          display:flex;flex-direction:column;position:fixed;
          top:72px;left:0;right:0;background:var(--navy-dark,#122850);
          padding:24px;gap:20px;border-bottom:1px solid rgba(255,255,255,0.1);z-index:99;`;
      } else {
        navLinksEl.style.cssText = '';
        navLinksEl.style.display = '';
      }
    });
  }

  // ── Scroll reveal ────────────────────────────
  const revealObs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'none';
        revealObs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.reveal').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(28px)';
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    revealObs.observe(el);
  });

  // ── Nav shadow on scroll ─────────────────────
  window.addEventListener('scroll', () => {
    const nav = document.querySelector('.nav');
    if (nav) nav.style.boxShadow = window.scrollY > 20 ? '0 4px 24px rgba(0,0,0,0.3)' : 'none';
  });

  // ── Journey button: require sign-in first ────
  const journeyBtnEl = document.getElementById('startJourney');
  if (journeyBtnEl) {
    journeyBtnEl.addEventListener('click', async () => {
      const { data: { session } } = await window.narrowSupabase.auth.getSession();
      if (!session) {
        sessionStorage.setItem('narrow_q_intent', Date.now().toString());
        window.location.href = 'login.html';
      } else {
        openQuestionnaire();
      }
    });
  }

  // If returning from login with questionnaire intent, open it automatically
  const qIntent = sessionStorage.getItem('narrow_q_intent');
  if (qIntent) {
    const age = Date.now() - parseInt(qIntent);
    if (age < 600000) { // Valid for 10 minutes
      sessionStorage.removeItem('narrow_q_intent');
      setTimeout(async () => {
        const { data: { session } } = await window.narrowSupabase.auth.getSession();
        if (session) openQuestionnaire();
      }, 1000);
    } else {
      sessionStorage.removeItem('narrow_q_intent');
    }
  }

  // ── Filter system ────────────────────────────
  initFilters();

  // ── Contact form ─────────────────────────────
  const contactForm = document.getElementById('contactForm');
  if (contactForm) contactForm.addEventListener('submit', handleContact);
});

// ── QUESTIONNAIRE ─────────────────────────────
const questionnaireAnswers = {};

function openQuestionnaire() {
  if (document.getElementById('journeyModal')) return; // prevent double open

  const modal = document.createElement('div');
  modal.id = 'journeyModal';
  modal.innerHTML = `
    <div class="modal-overlay" onclick="closeQuestionnaire()"></div>
    <div class="modal-box">
      <button class="modal-close" onclick="closeQuestionnaire()">✕</button>

      <div class="modal-step active" id="q-step-1">
        <p class="modal-label">Step 1 of 3</p>
        <h2>What's your building experience?</h2>
        <div class="q-options">
          <div class="q-option" onclick="selectOption(this,'experience','first')">🏠 First-time homebuilder</div>
          <div class="q-option" onclick="selectOption(this,'experience','renovated')">🔨 I've built or renovated before</div>
          <div class="q-option" onclick="selectOption(this,'experience','pro')">🏗️ I build regularly / professionally</div>
        </div>
        <button class="btn btn-primary" onclick="qNextStep(1)" style="margin-top:24px">Continue →</button>
      </div>

      <div class="modal-step" id="q-step-2">
        <p class="modal-label">Step 2 of 3</p>
        <h2>What do you already have in place?</h2>
        <p style="color:#6B7280;font-size:0.85rem;margin:6px 0 0">Tap all that apply — we'll pre-fill your journey.</p>
        <div class="q-options" style="margin-top:14px">
          <div class="q-option q-multi" data-value="zero" onclick="toggleMulti(this)">💡 Nothing yet — starting from zero</div>
          <div class="q-option q-multi" data-value="financing" onclick="toggleMulti(this)">💰 Financing / pre-approval</div>
          <div class="q-option q-multi" data-value="land" onclick="toggleMulti(this)">🗺️ Land or a lot</div>
          <div class="q-option q-multi" data-value="plans" onclick="toggleMulti(this)">📐 Architect plans</div>
          <div class="q-option q-multi" data-value="contractor" onclick="toggleMulti(this)">🔨 A contractor</div>
        </div>
        <button class="btn btn-primary" onclick="qNextStep(2)" style="margin-top:20px">Continue →</button>
      </div>

      <div class="modal-step" id="q-step-3">
        <p class="modal-label">Step 3 of 3</p>
        <h2>Your personalized path is ready.</h2>
        <p style="color:#6B7280;margin:10px 0 20px;font-size:0.9rem">We'll pre-fill your dashboard based on where you are now.</p>
        <div class="form-group"><label>Full Name</label><input type="text" id="q-name" placeholder="Jane Smith"></div>
        <div class="form-group"><label>Email Address</label><input type="email" id="q-email" placeholder="jane@email.com"></div>
        <div class="form-group"><label>ZIP Code</label><input type="text" id="q-zip" placeholder="90210" maxlength="5"></div>
        <button class="btn btn-primary btn-lg" onclick="submitJourney()" style="width:100%;margin-top:8px">Build My Path →</button>
      </div>

      <div class="modal-step" id="q-success">
        <div style="text-align:center;padding:32px 0">
          <div style="font-size:3rem;margin-bottom:16px">✅</div>
          <h2>Your journey is personalized!</h2>
          <div id="q-success-msg" style="background:#F0FBF4;border:1px solid #6EE7B7;
            border-radius:10px;padding:16px 20px;margin:16px 0 20px;text-align:left">
            <p style="color:#065F46;font-weight:600;font-size:0.88rem;margin:0 0 10px">
              ✓ We've updated your journey based on your answers
            </p>
            <div id="q-steps-checked" style="color:#065F46;font-size:0.82rem;line-height:2"></div>
          </div>
          <p style="color:#9CA3AF;font-size:0.82rem">Taking you to your dashboard in a moment...</p>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';

  if (!document.getElementById('modal-styles')) {
    const s = document.createElement('style');
    s.id = 'modal-styles';
    s.textContent = `
      #journeyModal{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px}
      .modal-overlay{position:absolute;inset:0;background:rgba(18,40,80,0.75);backdrop-filter:blur(4px)}
      .modal-box{position:relative;background:#fff;border-radius:16px;padding:44px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,0.3)}
      .modal-close{position:absolute;top:16px;right:20px;background:none;border:none;font-size:1.2rem;cursor:pointer;color:#6B7280;z-index:10}
      .modal-label{font-size:0.72rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#2D6A4F;margin-bottom:8px;display:block}
      .modal-step{display:none}.modal-step.active{display:block}
      .q-options{display:grid;gap:10px;margin-top:12px}
      .q-option{padding:14px 18px;border:2px solid #E5E7EB;border-radius:10px;cursor:pointer;font-weight:500;transition:all 0.2s;font-family:'DM Sans',sans-serif;user-select:none}
      .q-option:hover{border-color:#1B3A6B;background:#F0F4FF}
      .q-option.selected{border-color:#1B3A6B;background:#EEF2FF;color:#1B3A6B}
    `;
    document.head.appendChild(s);
  }
}

function qNextStep(from) {
  document.getElementById(`q-step-${from}`).classList.remove('active');
  const next = document.getElementById(`q-step-${from + 1}`);
  if (next) next.classList.add('active');
}

function selectOption(el, key, value) {
  el.closest('.q-options').querySelectorAll('.q-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  questionnaireAnswers[key] = value;
}

function toggleMulti(el) {
  const val = el.dataset.value;
  if (val === 'zero') {
    document.querySelectorAll('.q-multi').forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
    questionnaireAnswers.stage = ['zero'];
    return;
  }
  const zeroEl = document.querySelector('.q-multi[data-value="zero"]');
  if (zeroEl) zeroEl.classList.remove('selected');
  el.classList.toggle('selected');
  questionnaireAnswers.stage = [...document.querySelectorAll('.q-multi.selected')].map(o => o.dataset.value);
}

async function submitJourney() {
  const STEP_NAMES = ['Start Your Journey','Financing','Find Land','Architect Plans','Customize','Contractor Bids','Move In'];
  const stages = questionnaireAnswers.stage || [];
  const completedSteps = [1];

  if (stages.includes('financing') || stages.includes('land') || stages.includes('plans') || stages.includes('contractor')) completedSteps.push(2);
  if (stages.includes('land') || stages.includes('plans') || stages.includes('contractor')) completedSteps.push(3);
  if (stages.includes('plans') || stages.includes('contractor')) completedSteps.push(4);
  if (stages.includes('contractor')) completedSteps.push(6);

  let currentStep = 7;
  for (let i = 1; i <= 7; i++) { if (!completedSteps.includes(i)) { currentStep = i; break; } }

  document.getElementById('q-step-3').classList.remove('active');
  document.getElementById('q-success').classList.add('active');
  document.getElementById('q-steps-checked').innerHTML =
    completedSteps.map(n => `<div>✓ ${STEP_NAMES[n-1]}</div>`).join('') +
    `<div style="margin-top:10px;padding-top:10px;border-top:1px solid #A7F3D0;color:#047857;font-weight:700">
      → Your next step: ${STEP_NAMES[currentStep-1]}
    </div>`;

  const { data: { session } } = await window.narrowSupabase.auth.getSession();
  if (session) {
    await window.narrowSupabase.from('user_journeys').upsert({
      user_id: session.user.id, current_step: currentStep,
      steps_done: completedSteps, updated_at: new Date().toISOString()
    });
  }

  setTimeout(() => { closeQuestionnaire(); window.location.href = 'dashboard.html'; }, 3000);
}

function closeQuestionnaire() {
  const modal = document.getElementById('journeyModal');
  if (modal) modal.remove();
  document.body.style.overflow = '';
}

// ── FILTER SYSTEM ─────────────────────────────
function initFilters() {
  const filterBtns = document.querySelectorAll('.filter-btn');
  const cards      = document.querySelectorAll('.filterable');
  if (!filterBtns.length) return;
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.dataset.filter;
      cards.forEach(card => {
        card.style.display = (filter === 'all' || card.dataset.category === filter) ? '' : 'none';
      });
    });
  });
}

// ── CONTACT FORM ──────────────────────────────
async function handleContact(e) {
  e.preventDefault();
  const btn  = e.target.querySelector('button[type="submit"]');
  const orig = btn.textContent;
  btn.textContent = 'Sending…';
  btn.disabled    = true;
  const data = new FormData(e.target);
  try {
    const res = await fetch(
      'https://okalotfqhmwiyckhvcmk.supabase.co/functions/v1/send-contact',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey':        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rYWxvdGZxaG13aXlja2h2Y21rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2NzAxMTUsImV4cCI6MjA4NzI0NjExNX0.xTtqUl4k8VmvupmPblkLyPvtyp7JoyM2e4N88VI6tbM',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rYWxvdGZxaG13aXlja2h2Y21rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2NzAxMTUsImV4cCI6MjA4NzI0NjExNX0.xTtqUl4k8VmvupmPblkLyPvtyp7JoyM2e4N88VI6tbM'
        },
        body: JSON.stringify({
          name:    data.get('name'),
          email:   data.get('email'),
          role:    data.get('role') || 'Not specified',
          message: data.get('message')
        })
      }
    );
    if (res.ok) {
      btn.textContent = '✓ Message Sent!';
      btn.style.background = '#2D6A4F';
      e.target.reset();
      setTimeout(() => { btn.textContent = orig; btn.style.background = ''; btn.disabled = false; }, 4000);
    } else { throw new Error('Server error'); }
  } catch (err) {
    btn.textContent = '✗ Failed — try again';
    btn.style.background = '#DC2626';
    btn.disabled = false;
    setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 3000);
  }
}
