// ─── NARROW — main.js ───────────────────────
// Supabase client
let narrowSupabase;
document.addEventListener('DOMContentLoaded', () => {
  narrowSupabase = window.supabase.createClient(
    'https://okalotfqhmwiyckhvcmk.supabase.co',
    'sb_publishable_YrgPXrGiPlCY1Mdhw_NYpw_jO36M2iZ'
  );

  // ── Auth state → nav ────────────────────
  async function updateNavAuth() {
    const navAuth = document.getElementById('nav-auth');
    const journeyBtn = document.querySelector('.nav__journey-btn');
    if (!navAuth) return;

    const { data: { session } } = await narrowSupabase.auth.getSession();

    if (session && session.user) {
      const name = session.user.user_metadata?.full_name || session.user.email.split('@')[0];
      const firstName = name.split(' ')[0];

      // Fetch journey progress
      const { data: journey } = await narrowSupabase
        .from('user_journeys')
        .select('*')
        .eq('user_id', session.user.id)
        .single();

      const done = journey?.steps_done || [];
      const currentStep = journey?.current_step || 1;
      const pct = Math.round((done.length / 7) * 100);

      const STEP_NAMES = [
        'Start Your Journey', 'Financing', 'Find Land',
        'Architect Plans', 'Customize', 'Contractor Bids', 'Move In'
      ];

      navAuth.innerHTML = `
        <div class="nav__user" style="position:relative">
          <button class="nav__welcome-btn" onclick="toggleNavJourney(event)" style="
            background:rgba(255,255,255,0.1);
            border:1px solid rgba(255,255,255,0.2);
            color:white;border-radius:8px;padding:7px 14px;cursor:pointer;
            font-family:var(--font-body);font-size:0.85rem;font-weight:600;
            display:flex;align-items:center;gap:8px;white-space:nowrap;
            transition:background 0.2s"
            onmouseover="this.style.background='rgba(255,255,255,0.18)'"
            onmouseout="this.style.background='rgba(255,255,255,0.1)'">
            👋 ${firstName}
            <span style="font-size:0.7rem;background:var(--amber);color:var(--navy-dark);
              border-radius:10px;padding:2px 8px;font-weight:700">${done.length}/7</span>
            <span style="font-size:0.65rem;opacity:0.6">▾</span>
          </button>

          <div id="navJourneyPanel" style="display:none;position:absolute;top:calc(100% + 12px);
            right:0;background:white;border-radius:14px;padding:0;width:300px;
            box-shadow:0 12px 40px rgba(0,0,0,0.2);z-index:500;overflow:hidden;
            border:1px solid rgba(27,58,107,0.1)">

            <!-- Header -->
            <div style="background:var(--navy);padding:16px 20px">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="color:white;font-weight:700;font-size:0.9rem">Your Journey</span>
                <a href="dashboard.html" style="color:var(--amber);font-size:0.75rem;font-weight:600">View Full Dashboard →</a>
              </div>
              <div style="color:rgba(255,255,255,0.5);font-size:0.72rem;margin-top:6px">${done.length} of 7 steps complete</div>
            </div>

            <!-- Steps list -->
            <div style="padding:12px 8px;max-height:320px;overflow-y:auto">
              ${STEP_NAMES.map((s, i) => {
                const n = i + 1;
                const isDone = done.includes(n);
                const isCurrent = n === currentStep && !isDone;
                return `
                  <div onclick="navToggleStep(${n})" style="display:flex;align-items:center;gap:12px;
                    padding:10px 12px;border-radius:8px;margin-bottom:2px;cursor:pointer;
                    background:${isCurrent ? '#EEF2FF' : 'transparent'};
                    transition:background 0.15s"
                    onmouseover="this.style.background='${isDone ? '#f0fbf4' : '#f5f5f5'}'"
                    onmouseout="this.style.background='${isCurrent ? '#EEF2FF' : 'transparent'}'">
                    <div style="width:26px;height:26px;border-radius:50%;flex-shrink:0;
                      background:${isDone ? '#2D6A4F' : isCurrent ? '#E8A838' : '#E5E7EB'};
                      display:flex;align-items:center;justify-content:center;
                      font-size:0.72rem;font-weight:700;
                      color:${isDone || isCurrent ? 'white' : '#9CA3AF'}">
                      ${isDone ? '✓' : n}
                    </div>
                    <span style="font-size:0.83rem;font-weight:${isCurrent ? 700 : 500};
                      color:${isDone ? '#9CA3AF' : '#111'};
                      text-decoration:${isDone ? 'line-through' : 'none'};flex:1">${s}</span>
                    ${isCurrent ? '<span style="font-size:0.65rem;background:#FEF3C7;color:#92400E;padding:2px 7px;border-radius:10px;font-weight:700">NOW</span>' : ''}
                  </div>
                `;
              }).join('')}
            </div>

            <!-- Footer -->
            <div style="border-top:1px solid #E5E7EB;padding:12px 20px;display:flex;justify-content:space-between;align-items:center">
              <a href="dashboard.html" class="btn btn-primary" style="font-size:0.78rem;padding:7px 16px">Open Dashboard</a>
              <button onclick="window.narrowSignOut()" style="font-size:0.78rem;color:#6B7280;
                background:none;border:none;cursor:pointer;font-family:var(--font-body)">Sign Out</button>
            </div>
          </div>
        </div>
      `;

      if (journeyBtn) journeyBtn.style.display = 'none';
    } else {
      navAuth.innerHTML = `<a href="login.html" class="nav__signin">Sign In</a>`;
      if (journeyBtn) journeyBtn.style.display = '';
    }
  }

  window.toggleNavJourney = function(e) {
    e.stopPropagation();
    const panel = document.getElementById('navJourneyPanel');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  };

  // Close panel when clicking outside
  document.addEventListener('click', () => {
    const panel = document.getElementById('navJourneyPanel');
    if (panel) panel.style.display = 'none';
  });

  window.navToggleStep = async function(n) {
    const { data: { session } } = await narrowSupabase.auth.getSession();
    if (!session) return;

    const { data: j } = await narrowSupabase
      .from('user_journeys').select('*')
      .eq('user_id', session.user.id).single();

    const done = [...(j?.steps_done || [])];
    const pos = done.indexOf(n);
    if (pos === -1) done.push(n); else done.splice(pos, 1);

    let next = 1;
    for (let i = 1; i <= 7; i++) {
      if (!done.includes(i)) { next = i; break; }
      if (i === 7) next = 7;
    }

    await narrowSupabase.from('user_journeys').upsert({
      user_id: session.user.id,
      current_step: next,
      steps_done: done,
      updated_at: new Date().toISOString()
    });

    updateNavAuth();
  };

  window.narrowSignOut = async function() {
    await narrowSupabase.auth.signOut();
    window.location.href = 'index.html';
  };

  updateNavAuth();
  // Retry after short delay in case session cookie isn't ready yet
  setTimeout(updateNavAuth, 500);
  setTimeout(updateNavAuth, 1500);

  // Re-run nav update if auth state changes (e.g. after email confirm)
  narrowSupabase.auth.onAuthStateChange((_event, session) => {
    updateNavAuth();
  });

  // Inject nav auth styles once
  if (!document.getElementById('nav-auth-styles')) {
    const s = document.createElement('style');
    s.id = 'nav-auth-styles';
    s.textContent = `
      .nav__auth { display:flex; align-items:center; }
      .nav__user { display:flex; align-items:center; gap:12px; }
      .nav__welcome {
        color: rgba(255,255,255,0.9);
        font-size: 0.9rem;
        font-weight: 600;
        font-family: var(--font-body);
        white-space: nowrap;
      }
      .nav__signout {
        background: rgba(255,255,255,0.12);
        color: rgba(255,255,255,0.85);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 6px;
        padding: 6px 14px;
        font-size: 0.82rem;
        font-weight: 600;
        font-family: var(--font-body);
        cursor: pointer;
        transition: background 0.2s, color 0.2s;
        white-space: nowrap;
      }
      .nav__signout:hover { background: rgba(255,255,255,0.22); color: #fff; }
      .nav__signin {
        color: rgba(255,255,255,0.8);
        font-size: 0.9rem;
        font-weight: 500;
        font-family: var(--font-body);
        text-decoration: none;
        padding: 6px 4px;
        transition: color 0.2s;
        white-space: nowrap;
      }
      .nav__signin:hover { color: #fff; }
    `;
    document.head.appendChild(s);
  }

  // ── Active nav link ──────────────────────
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav__link').forEach(link => {
    if (link.getAttribute('href') === currentPage) {
      link.classList.add('active');
    }
  });

  // ── Mobile nav toggle ────────────────────
  const hamburger = document.querySelector('.nav__hamburger');
  const navLinks  = document.querySelector('.nav__links');
  const navCta    = document.querySelector('.nav__cta');

  if (hamburger) {
    hamburger.addEventListener('click', () => {
      const isOpen = hamburger.classList.toggle('open');

      if (!navLinks) return;

      if (isOpen) {
        navLinks.style.cssText = `
          display: flex;
          flex-direction: column;
          position: fixed;
          top: 72px; left: 0; right: 0;
          background: var(--navy-dark, #122850);
          padding: 24px;
          gap: 20px;
          border-bottom: 1px solid rgba(255,255,255,0.1);
          z-index: 99;
        `;
      } else {
        navLinks.style.cssText = '';
        navLinks.style.display = '';
      }
    });
  }

  // ── Scroll reveal ────────────────────────
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.reveal').forEach(el => {
    el.style.cssText = 'opacity:0; transform:translateY(28px); transition: opacity 0.6s ease, transform 0.6s ease;';
    observer.observe(el);
  });

  document.querySelectorAll('.reveal.visible').forEach(el => {
    el.style.opacity = '1';
    el.style.transform = 'none';
  });

  // Observe new elements
  const mutObs = new MutationObserver(() => {
    document.querySelectorAll('.reveal:not([data-observed])').forEach(el => {
      el.dataset.observed = true;
      observer.observe(el);
    });
  });
  mutObs.observe(document.body, { childList: true, subtree: true });

  // Mark existing
  document.querySelectorAll('.reveal').forEach(el => {
    if (!el.dataset.observed) {
      el.dataset.observed = true;
      observer.observe(el);
    }
  });

  // Override to make visible
  document.querySelectorAll('.reveal').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(28px)';
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
  });

  const revealObs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'none';
        revealObs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));

  // ── Nav shadow on scroll ─────────────────
  window.addEventListener('scroll', () => {
    const nav = document.querySelector('.nav');
    if (nav) {
      nav.style.boxShadow = window.scrollY > 20
        ? '0 4px 24px rgba(0,0,0,0.3)'
        : 'none';
    }
  });

  // ── Journey modal / questionnaire ────────
  const journeyBtn = document.getElementById('startJourney');
  if (journeyBtn) {
    journeyBtn.addEventListener('click', openQuestionnaire);
  }

  // ── Filter system (marketplace pages) ────
  initFilters();

  // ── Contact form ─────────────────────────
  const contactForm = document.getElementById('contactForm');
  if (contactForm) {
    contactForm.addEventListener('submit', handleContact);
  }

});

// ── START JOURNEY QUESTIONNAIRE ──────────────
function openQuestionnaire() {
  const modal = document.createElement('div');
  modal.id = 'journeyModal';
  modal.innerHTML = `
    <div class="modal-overlay" onclick="closeQuestionnaire()"></div>
    <div class="modal-box">
      <button class="modal-close" onclick="closeQuestionnaire()">✕</button>
      <div class="modal-step active" id="q-step-1">
        <p class="modal-label">Step 1 of 4</p>
        <h2>What's your building experience?</h2>
        <div class="q-options">
          <div class="q-option" onclick="selectOption(this, 1)">🏠 First-time homebuilder</div>
          <div class="q-option" onclick="selectOption(this, 1)">🔨 I've built or renovated before</div>
          <div class="q-option" onclick="selectOption(this, 1)">🏗️ I build regularly / professionally</div>
        </div>
        <button class="btn btn-primary" onclick="nextStep(1)" style="margin-top:24px">Continue →</button>
      </div>
      <div class="modal-step" id="q-step-2">
        <p class="modal-label">Step 2 of 4</p>
        <h2>What's your budget range?</h2>
        <div class="q-options">
          <div class="q-option" onclick="selectOption(this, 2)">Under $300K</div>
          <div class="q-option" onclick="selectOption(this, 2)">$300K – $600K</div>
          <div class="q-option" onclick="selectOption(this, 2)">$600K – $1M</div>
          <div class="q-option" onclick="selectOption(this, 2)">$1M+</div>
        </div>
        <button class="btn btn-primary" onclick="nextStep(2)" style="margin-top:24px">Continue →</button>
      </div>
      <div class="modal-step" id="q-step-3">
        <p class="modal-label">Step 3 of 4</p>
        <h2>Where are you in the process?</h2>
        <div class="q-options">
          <div class="q-option" onclick="selectOption(this, 3)">💡 Just an idea — I'm starting from zero</div>
          <div class="q-option" onclick="selectOption(this, 3)">💰 I have financing & need land</div>
          <div class="q-option" onclick="selectOption(this, 3)">🗺️ I have land & need plans</div>
          <div class="q-option" onclick="selectOption(this, 3)">📋 I have plans & need a contractor</div>
        </div>
        <button class="btn btn-primary" onclick="nextStep(3)" style="margin-top:24px">Continue →</button>
      </div>
      <div class="modal-step" id="q-step-4">
        <p class="modal-label">Step 4 of 4</p>
        <h2>Your personalized path is ready.</h2>
        <p style="color:#6B7280;margin:12px 0 24px">Enter your info and we'll guide you from concept to move-in day.</p>
        <div class="form-group"><label>Full Name</label><input type="text" placeholder="Jane Smith"></div>
        <div class="form-group"><label>Email Address</label><input type="email" placeholder="jane@email.com"></div>
        <div class="form-group"><label>ZIP Code</label><input type="text" placeholder="90210" maxlength="5"></div>
        <button class="btn btn-primary btn-lg" onclick="submitJourney()" style="width:100%">Build My Path →</button>
      </div>
      <div class="modal-step" id="q-success">
        <div style="text-align:center;padding:40px 0">
          <div style="font-size:3rem;margin-bottom:16px">🏠</div>
          <h2>Your journey starts now!</h2>
          <p style="color:#6B7280;margin:12px 0 24px">Check your email for your personalized A to Z roadmap. A Narrow specialist will be in touch shortly.</p>
          <button class="btn btn-primary" onclick="closeQuestionnaire()">Got It!</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';

  // Inject modal styles if not present
  if (!document.getElementById('modal-styles')) {
    const s = document.createElement('style');
    s.id = 'modal-styles';
    s.textContent = `
      #journeyModal { position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px; }
      .modal-overlay { position:absolute;inset:0;background:rgba(18,40,80,0.75);backdrop-filter:blur(4px); }
      .modal-box { position:relative;background:#fff;border-radius:16px;padding:48px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,0.3); }
      .modal-close { position:absolute;top:16px;right:20px;background:none;border:none;font-size:1.2rem;cursor:pointer;color:#6B7280; }
      .modal-label { font-size:0.75rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#2D6A4F;margin-bottom:8px; }
      .modal-step { display:none; } .modal-step.active { display:block; }
      .q-options { display:grid;gap:12px;margin-top:20px; }
      .q-option { padding:16px 20px;border:2px solid #E5E7EB;border-radius:10px;cursor:pointer;font-weight:500;transition:all 0.2s;font-family:'DM Sans',sans-serif; }
      .q-option:hover { border-color:#1B3A6B;background:#F0F4FF; }
      .q-option.selected { border-color:#1B3A6B;background:#EEF2FF;color:#1B3A6B; }
    `;
    document.head.appendChild(s);
  }
}

let currentStep = 1;

function nextStep(from) {
  const step = document.getElementById(`q-step-${from}`);
  const next = document.getElementById(`q-step-${from + 1}`);
  if (!next) return;
  step.classList.remove('active');
  next.classList.add('active');
  currentStep = from + 1;
}

function selectOption(el, step) {
  el.closest('.q-options').querySelectorAll('.q-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
}

function submitJourney() {
  document.getElementById(`q-step-4`).classList.remove('active');
  document.getElementById('q-success').classList.add('active');
}

function closeQuestionnaire() {
  const modal = document.getElementById('journeyModal');
  if (modal) modal.remove();
  document.body.style.overflow = '';
  currentStep = 1;
}

// ── FILTER SYSTEM ─────────────────────────────
function initFilters() {
  const filterBtns = document.querySelectorAll('.filter-btn');
  const cards = document.querySelectorAll('.filterable');

  if (!filterBtns.length) return;

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.dataset.filter;
      cards.forEach(card => {
        const show = filter === 'all' || card.dataset.category === filter;
        card.style.display = show ? '' : 'none';
      });
    });
  });
}

// ── CONTACT FORM ──────────────────────────────
async function handleContact(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const orig = btn.textContent;
  btn.textContent = 'Sending…';
  btn.disabled = true;

  const data = new FormData(e.target);

  try {
    const res = await fetch(
      'https://okalotfqhmwiyckhvcmk.supabase.co/functions/v1/send-contact',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      setTimeout(() => {
        btn.textContent = orig;
        btn.style.background = '';
        btn.disabled = false;
      }, 4000);
    } else {
      throw new Error('Server error');
    }
  } catch (err) {
    btn.textContent = '✗ Failed — try again';
    btn.style.background = '#DC2626';
    btn.disabled = false;
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.background = '';
    }, 3000);
  }
}
