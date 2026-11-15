/**
 * main.js
 * Controls language switching, manual vital inputs, health evaluation,
 * Helmet Screen report generation, and navigation.
 */

import { TEXT } from './data.js';
import { playClickSound, playCalmSound, playAlarmSound } from './audio.js';
import { startStarfield, startEcgChart } from './canvas.js';

const appState = {
  lang: 'ar',
  status: 'normal', // normal | stress (yellow) | emergency (red)
  heartRate: 78,
  hasReport: false,
};

const el = (id) => document.getElementById(id);

// 2. Read all user inputs and make sure every field has a number
function readInputs() {
  const ids = [
    'input-bpm',
    'input-spo2',
    'input-resp',
    'input-temp',
    'input-bp-sys',
    'input-bp-dia',
    'input-accel',
    'input-caffeine',
    'input-cortisol',
    'input-hydration',
    'input-elec',
    'input-co2',
  ];

  for (const id of ids) {
    const raw = el(id).value.trim();
    if (raw === '' || Number.isNaN(Number(raw))) {
      return null;
    }
  }

  return {
    bpm: Number(el('input-bpm').value),
    spo2: Number(el('input-spo2').value),
    resp: Number(el('input-resp').value),
    temp: Number(el('input-temp').value),
    bpSys: Number(el('input-bp-sys').value),
    bpDia: Number(el('input-bp-dia').value),
    accel: Number(el('input-accel').value),
    caffeine: Number(el('input-caffeine').value),
    cortisol: Number(el('input-cortisol').value),
    hydration: Number(el('input-hydration').value),
    elec: Number(el('input-elec').value),
    co2: Number(el('input-co2').value),
  };
}

const INPUT_IDS = [
  'input-bpm',
  'input-spo2',
  'input-resp',
  'input-temp',
  'input-bp-sys',
  'input-bp-dia',
  'input-accel',
  'input-caffeine',
  'input-cortisol',
  'input-hydration',
  'input-elec',
  'input-co2',
];

function saveVitalsSnapshot(items = null) {
  const values = {};
  INPUT_IDS.forEach((id) => {
    const raw = el(id).value.trim();
    if (raw !== '' && !Number.isNaN(Number(raw))) {
      values[id] = Number(raw);
    }
  });

  const fullValues = readInputs();
  const computedItems = items || (fullValues ? evaluateVitals(fullValues, appState.lang) : null);

  try {
    localStorage.setItem(
      'wanas_vitals',
      JSON.stringify({
        values,
        fullValues,
        items: computedItems,
        updatedAt: Date.now(),
      })
    );
  } catch {
    // Ignore storage quota errors
  }
}

function restoreSavedInputs() {
  try {
    const saved = JSON.parse(localStorage.getItem('wanas_vitals') || 'null');
    if (!saved || !saved.values) return;
    INPUT_IDS.forEach((id) => {
      if (saved.values[id] !== undefined) {
        el(id).value = saved.values[id];
      }
    });
    if (saved.values['input-bpm']) {
      appState.heartRate = Number(saved.values['input-bpm']);
    }
  } catch {
    // Ignore invalid JSON
  }
}

// 3. Evaluate all 10 metrics into Green (normal), Yellow (warning), or Red (emergency)
function evaluateVitals(v, lang) {
  const ar = lang === 'ar';
  const items = [];

  // 1. Heart Rate (Normal: 60 - 100 BPM)
  if (v.bpm < 50) {
    items.push({ level: 'red', name: ar ? 'نبضات القلب' : 'Heart Rate', msg: ar ? `نبضات القلب منخفضة جداً (${v.bpm} BPM — أقل من 50)` : `Heart rate critically low (${v.bpm} BPM)` });
  } else if (v.bpm > 120) {
    items.push({ level: 'red', name: ar ? 'نبضات القلب' : 'Heart Rate', msg: ar ? `نبضات القلب مرتفعة جداً (${v.bpm} BPM — أعلى من 120)` : `Heart rate critically high (${v.bpm} BPM)` });
  } else if (v.bpm < 60 || v.bpm > 100) {
    items.push({ level: 'yellow', name: ar ? 'نبضات القلب' : 'Heart Rate', msg: ar ? `تحذير: نبضات القلب بدأت تتجاوز الطبيعي (${v.bpm} BPM)` : `Warning: Heart rate outside 60–100 (${v.bpm} BPM)` });
  } else {
    items.push({ level: 'green', name: ar ? 'نبضات القلب' : 'Heart Rate', msg: `${v.bpm} BPM` });
  }

  // 2. SpO2 (Normal: 95% - 100%)
  if (v.spo2 < 90) {
    items.push({ level: 'red', name: ar ? 'تشبع الأكسجين' : 'SpO2', msg: ar ? `طوارئ: نقص حاد في الأكسجين (${v.spo2}% — أقل من 90%)` : `Emergency: Critically low oxygen (${v.spo2}%)` });
  } else if (v.spo2 < 95 || v.spo2 > 100) {
    items.push({ level: 'yellow', name: ar ? 'تشبع الأكسجين' : 'SpO2', msg: ar ? `تحذير: تشبع الأكسجين خارج الطبيعي (${v.spo2}%)` : `Warning: SpO2 outside 95–100% (${v.spo2}%)` });
  } else {
    items.push({ level: 'green', name: ar ? 'تشبع الأكسجين' : 'SpO2', msg: `${v.spo2}%` });
  }

  // 3. Respiration Rate (Normal: 12 - 20 RPM)
  if (v.resp < 8) {
    items.push({ level: 'red', name: ar ? 'معدل التنفس' : 'Respiration', msg: ar ? `طوارئ: بطء حاد في معدل التنفس (${v.resp} — أقل من 8)` : `Emergency: Critically low respiration (${v.resp} RPM)` });
  } else if (v.resp > 28) {
    items.push({ level: 'red', name: ar ? 'معدل التنفس' : 'Respiration', msg: ar ? `طوارئ: تسارع حاد في معدل التنفس (${v.resp} — أعلى من 28)` : `Emergency: Critically high respiration (${v.resp} RPM)` });
  } else if (v.resp < 12 || v.resp > 20) {
    items.push({ level: 'yellow', name: ar ? 'معدل التنفس' : 'Respiration', msg: ar ? `تحذير: معدل التنفس خارج المعدل 12-20 (${v.resp})` : `Warning: Respiration outside 12–20 (${v.resp} RPM)` });
  } else {
    items.push({ level: 'green', name: ar ? 'معدل التنفس' : 'Respiration', msg: `${v.resp} RPM` });
  }

  // 4. Temperature (Normal: 36.5 - 37.5 °C)
  if (v.temp < 35.5) {
    items.push({ level: 'red', name: ar ? 'درجة الحرارة' : 'Temperature', msg: ar ? `طوارئ: درجة حرارتك منخفضة جداً (${v.temp}°C)` : `Emergency: Hypothermia risk (${v.temp}°C)` });
  } else if (v.temp > 38.5) {
    items.push({ level: 'red', name: ar ? 'درجة الحرارة' : 'Temperature', msg: ar ? `طوارئ: درجة حرارتك عالية جداً (${v.temp}°C)` : `Emergency: High fever (${v.temp}°C)` });
  } else if (v.temp < 36.5) {
    items.push({ level: 'yellow', name: ar ? 'درجة الحرارة' : 'Temperature', msg: ar ? `تحذير: درجة حرارتك قليلة (${v.temp}°C)` : `Warning: Slightly low temperature (${v.temp}°C)` });
  } else if (v.temp > 37.5) {
    items.push({ level: 'yellow', name: ar ? 'درجة الحرارة' : 'Temperature', msg: ar ? `تحذير: درجة حرارتك مرتفعة قليلاً (${v.temp}°C)` : `Warning: Slightly high temperature (${v.temp}°C)` });
  } else {
    items.push({ level: 'green', name: ar ? 'درجة الحرارة' : 'Temperature', msg: `${v.temp}°C` });
  }

  // 5. Blood Pressure (Normal around 120/80, Low Red < 90/60, High Red >= 160/100)
  const bpText = `${v.bpSys}/${v.bpDia}`;
  if (v.bpSys < 90 || v.bpDia < 60) {
    items.push({ level: 'red', name: ar ? 'ضغط الدم' : 'Blood Pressure', msg: ar ? `طوارئ: ضغط الدم منخفض (${bpText})` : `Emergency: Blood pressure too low (${bpText})` });
  } else if (v.bpSys >= 160 || v.bpDia >= 100) {
    items.push({ level: 'red', name: ar ? 'ضغط الدم' : 'Blood Pressure', msg: ar ? `طوارئ: ضغط الدم مرتفع جداً (${bpText})` : `Emergency: Blood pressure critically high (${bpText})` });
  } else if (v.bpSys < 100 || v.bpSys > 125 || v.bpDia < 65 || v.bpDia > 85) {
    items.push({ level: 'yellow', name: ar ? 'ضغط الدم' : 'Blood Pressure', msg: ar ? `تحذير: ضغط الدم بدأ يتجاوز الطبيعي (${bpText})` : `Warning: Blood pressure outside normal (${bpText})` });
  } else {
    items.push({ level: 'green', name: ar ? 'ضغط الدم' : 'Blood Pressure', msg: bpText });
  }

  // 6. Body Acceleration (Normal: 0 - 1 g, > 2 = Fall / Impact)
  if (v.accel > 2) {
    items.push({ level: 'red', name: ar ? 'التسارع' : 'Acceleration', msg: ar ? `طوارئ: تسارع مفاجئ (${v.accel} g) — احتمال سقوط أو اصطدام رائد الفضاء!` : `Emergency: Sudden acceleration (${v.accel} g) — possible astronaut fall!` });
  } else if (v.accel > 1 || v.accel < 0) {
    items.push({ level: 'yellow', name: ar ? 'التسارع' : 'Acceleration', msg: ar ? `تحذير: تسارع أعلى من المعدل الطبيعي (${v.accel} g)` : `Warning: Elevated acceleration (${v.accel} g)` });
  } else {
    items.push({ level: 'green', name: ar ? 'التسارع' : 'Acceleration', msg: `${v.accel} g` });
  }

  // 7. Cortisol (Normal: 10 - 20 μg/dL)
  if (v.cortisol < 7) {
    items.push({ level: 'red', name: ar ? 'الكورتيزول' : 'Cortisol', msg: ar ? `طوارئ: الكورتيزول منخفض جداً (${v.cortisol})` : `Emergency: Cortisol critically low (${v.cortisol})` });
  } else if (v.cortisol > 26) {
    items.push({ level: 'red', name: ar ? 'الكورتيزول' : 'Cortisol', msg: ar ? `طوارئ: الكورتيزول عالي جداً (${v.cortisol})` : `Emergency: Cortisol critically high (${v.cortisol})` });
  } else if (v.cortisol < 10) {
    items.push({ level: 'yellow', name: ar ? 'الكورتيزول' : 'Cortisol', msg: ar ? `تحذير: الكورتيزول منخفض عن الطبيعي (${v.cortisol})` : `Warning: Low cortisol (${v.cortisol})` });
  } else if (v.cortisol > 20) {
    items.push({ level: 'yellow', name: ar ? 'الكورتيزول' : 'Cortisol', msg: ar ? `تحذير: الكورتيزول مرتفع عن الطبيعي (${v.cortisol})` : `Warning: High cortisol (${v.cortisol})` });
  } else {
    items.push({ level: 'green', name: ar ? 'الكورتيزول' : 'Cortisol', msg: `${v.cortisol} μg/dL` });
  }

  // 8. Caffeine (Normal: 100 - 200 mg, > 200 warning, >= 400 emergency, < 100 low)
  if (v.caffeine >= 400) {
    items.push({ level: 'red', name: ar ? 'الكافيين' : 'Caffeine', msg: ar ? `طوارئ: كافيين زائد قوي (${v.caffeine} مجم)` : `Emergency: Excessive caffeine (${v.caffeine} mg)` });
  } else if (v.caffeine > 200) {
    items.push({ level: 'yellow', name: ar ? 'الكافيين' : 'Caffeine', msg: ar ? `تحذير: الكافيين بدأ يرتفع عن الطبيعي (${v.caffeine} مجم)` : `Warning: Caffeine rising above 200 mg (${v.caffeine} mg)` });
  } else if (v.caffeine < 100) {
    items.push({ level: 'yellow', name: ar ? 'الكافيين' : 'Caffeine', msg: ar ? `تحذير: نسبة الكافيين قليلة جداً (${v.caffeine} مجم)` : `Warning: Caffeine too low (${v.caffeine} mg)` });
  } else {
    items.push({ level: 'green', name: ar ? 'الكافيين' : 'Caffeine', msg: `${v.caffeine} mg` });
  }

  // 9. Water / Hydration (Normal: 2 - 2.5 L, < 1 L dehydration, > 5 L too much)
  if (v.hydration < 1) {
    items.push({ level: 'red', name: ar ? 'المياه' : 'Hydration', msg: ar ? `طوارئ: أنت عندك جفاف (${v.hydration} لتر — أقل من 1 لتر)` : `Emergency: Dehydration (${v.hydration} L — below 1 L)` });
  } else if (v.hydration > 5) {
    items.push({ level: 'red', name: ar ? 'المياه' : 'Hydration', msg: ar ? `طوارئ: شربت مياه كثير جداً (${v.hydration} لتر — أكثر من 5 لتر)` : `Emergency: Overhydration (${v.hydration} L — above 5 L)` });
  } else if (v.hydration < 2) {
    items.push({ level: 'yellow', name: ar ? 'المياه' : 'Hydration', msg: ar ? `تحذير: شرب المياه أقل من الطبيعي (${v.hydration} لتر)` : `Warning: Low water intake (${v.hydration} L)` });
  } else if (v.hydration > 2.5) {
    items.push({ level: 'yellow', name: ar ? 'المياه' : 'Hydration', msg: ar ? `تحذير: شرب المياه أعلى من الطبيعي (${v.hydration} لتر)` : `Warning: High water intake (${v.hydration} L)` });
  } else {
    items.push({ level: 'green', name: ar ? 'المياه' : 'Hydration', msg: `${v.hydration} ${ar ? 'لتر' : 'L'}` });
  }

  // 10. Electrolytes (Normal: 135 - 145 mmol/L)
  if (v.elec < 130) {
    items.push({ level: 'red', name: ar ? 'الأملاح' : 'Electrolytes', msg: ar ? `طوارئ: نقص حاد في الأملاح (${v.elec} mmol/L)` : `Emergency: Critically low electrolytes (${v.elec})` });
  } else if (v.elec > 150) {
    items.push({ level: 'red', name: ar ? 'الأملاح' : 'Electrolytes', msg: ar ? `طوارئ: زيادة حادة في الأملاح (${v.elec} mmol/L)` : `Emergency: Critically high electrolytes (${v.elec})` });
  } else if (v.elec < 135) {
    items.push({ level: 'yellow', name: ar ? 'الأملاح' : 'Electrolytes', msg: ar ? `تحذير: أملاح قليلة عن الطبيعي (${v.elec})` : `Warning: Low electrolytes (${v.elec})` });
  } else if (v.elec > 145) {
    items.push({ level: 'yellow', name: ar ? 'الأملاح' : 'Electrolytes', msg: ar ? `تحذير: أملاح زيادة عن الطبيعي (${v.elec})` : `Warning: High electrolytes (${v.elec})` });
  } else {
    items.push({ level: 'green', name: ar ? 'الأملاح' : 'Electrolytes', msg: `${v.elec} mmol/L` });
  }

  // 11. CO2 Level (Normal: < 0.5%, Warning: 0.5 - 0.6%, Emergency: > 0.6%)
  if (v.co2 > 0.6) {
    items.push({ level: 'red', name: ar ? 'ثاني أكسيد الكربون' : 'CO2 Level', msg: ar ? `طوارئ: ارتفاع خطر في ثاني أكسيد الكربون (${v.co2}% — أعلى من 0.6%)` : `Emergency: Critically high CO2 (${v.co2}% — above 0.6%)` });
  } else if (v.co2 >= 0.5) {
    items.push({ level: 'yellow', name: ar ? 'ثاني أكسيد الكربون' : 'CO2 Level', msg: ar ? `تحذير: نسبة ثاني أكسيد الكربون مرتفعة (${v.co2}%)` : `Warning: CO2 level elevated (${v.co2}%)` });
  } else {
    items.push({ level: 'green', name: ar ? 'ثاني أكسيد الكربون' : 'CO2 Level', msg: `${v.co2}%` });
  }

  return items;
}

// 4. Render the generated report inside the rectangular Helmet Screen
function renderHelmetScreen(items) {
  const dict = TEXT[appState.lang].helmet;
  const issues = items.filter((item) => item.level !== 'green');
  const normals = items.filter((item) => item.level === 'green');

  let overall = 'green';
  if (issues.some((i) => i.level === 'red')) overall = 'red';
  else if (issues.length > 0) overall = 'yellow';

  // Sync ECG line color with overall health level
  appState.status = overall === 'red' ? 'emergency' : overall === 'yellow' ? 'stress' : 'normal';

  const screen = el('helmet-screen');
  screen.className = `helmet-screen screen-${overall}`;

  const pill = el('helmet-overall-pill');
  pill.className = `screen-pill ${overall}`;
  const statusMap = {
    green: dict.statusGreen,
    yellow: dict.statusYellow,
    red: dict.statusRed,
  };
  pill.textContent = statusMap[overall];

  const body = el('helmet-screen-body');
  body.innerHTML = '';

  // Top summary banner
  const summary = document.createElement('div');
  summary.className = `report-item ${overall}`;
  summary.innerHTML = `
    <span class="dot ${overall}"></span>
    <div>
      <strong>${overall === 'green' ? dict.allGoodTitle : dict.issuesTitle}</strong>
      ${overall === 'green' ? `<p class="report-text">${dict.allGoodDesc}</p>` : ''}
    </div>
  `;
  body.appendChild(summary);

  // List any yellow/red issues
  if (issues.length > 0) {
    const list = document.createElement('div');
    list.className = 'report-list';
    issues.forEach((issue) => {
      const row = document.createElement('div');
      row.className = `report-item ${issue.level}`;
      row.innerHTML = `<span class="dot ${issue.level}"></span><span><strong>${issue.name}:</strong> ${issue.msg}</span>`;
      list.appendChild(row);
    });
    body.appendChild(list);
  }

  // Show remaining healthy (green) metrics clearly
  if (normals.length > 0) {
    const okHeading = document.createElement('div');
    okHeading.className = 'metric-label';
    okHeading.textContent = dict.restOkLabel;
    body.appendChild(okHeading);

    const chips = document.createElement('div');
    chips.className = 'ok-chips';
    normals.forEach((ok) => {
      const chip = document.createElement('span');
      chip.className = 'ok-chip';
      chip.innerHTML = `<span class="dot green"></span>${ok.name} (${ok.msg})`;
      chips.appendChild(chip);
    });
    body.appendChild(chips);
  }

  return overall;
}

// 5. Validate inputs, evaluate, render on Helmet Screen, and scroll down
function generateReport(shouldScroll = true) {
  const values = readInputs();
  const errBox = el('belt-form-error');

  if (!values) {
    errBox.classList.remove('hidden');
    playClickSound();
    return;
  }

  errBox.classList.add('hidden');
  appState.heartRate = values.bpm;
  appState.hasReport = true;

  const items = evaluateVitals(values, appState.lang);
  const overall = renderHelmetScreen(items);
  saveVitalsSnapshot(items);

  if (shouldScroll) {
    if (overall === 'red') playAlarmSound();
    else if (overall === 'green') playCalmSound();
    else playClickSound();

    el('helmet').scrollIntoView({ behavior: 'smooth' });
  }
}

// 6. Navbar blur on scroll, mobile menu, and scroll reveal animations
function initNavigation() {
  const navbar = el('navbar');
  const mobileMenu = el('mobile-menu');

  el('menu-toggle').addEventListener('click', () => {
    mobileMenu.classList.toggle('hidden');
  });

  document.querySelectorAll('[data-scroll]').forEach((btn) => {
    btn.addEventListener('click', () => {
      playClickSound();
      mobileMenu.classList.add('hidden');
      const target = el(btn.getAttribute('data-scroll'));
      if (target) target.scrollIntoView({ behavior: 'smooth' });
    });
  });

  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 25);
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add('visible');
      });
    },
    { threshold: 0.15 }
  );

  document.querySelectorAll('.reveal').forEach((item) => observer.observe(item));
}

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  startStarfield(el('space-canvas'));
  startEcgChart(el('ecg-canvas'), () => ({
    status: appState.status,
    heartRate: appState.heartRate,
  }));

  // Restore previously entered inputs and sync live edits to localStorage for Wanas AI
  restoreSavedInputs();
  INPUT_IDS.forEach((id) => {
    el(id).addEventListener('input', () => saveVitalsSnapshot());
  });

  // Update ECG speed live as the user types heart rate
  el('input-bpm').addEventListener('input', (e) => {
    const val = Number(e.target.value);
    if (val >= 20 && val <= 240) appState.heartRate = val;
  });

  el('btn-generate-report').addEventListener('click', () => generateReport(true));

  initNavigation();
});
