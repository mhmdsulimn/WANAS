/**
 * canvas.js
 * Two simple Canvas animations:
 * 1. Space starfield background
 * 2. Live ECG heartbeat graph
 */

export function startStarfield(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  // Create 160 random stars
  const stars = Array.from({ length: 160 }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    size: Math.random() * 1.6 + 0.4,
    alpha: Math.random() * 0.7 + 0.3,
    speed: Math.random() * 0.02 + 0.008,
  }));

  let angle = 0;

  function draw() {
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, width, height);

    angle += 0.03;
    stars.forEach((s, i) => {
      const twinkle = 0.5 + 0.5 * Math.sin(angle + i);
      ctx.fillStyle = `rgba(226, 232, 240, ${s.alpha * twinkle})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    });

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });

  draw();
}

export function startEcgChart(canvas, getState) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let x = 0;
  let phase = 0;
  let lastY = canvas.height / 2;

  function getWaveY(p, height) {
    const mid = height / 2;
    if (p > 0.15 && p < 0.22) return mid - 8;  // P wave
    if (p >= 0.30 && p < 0.33) return mid + 8; // Q dip
    if (p >= 0.33 && p < 0.38) return mid - 38; // R spike
    if (p >= 0.38 && p < 0.42) return mid + 14; // S dip
    if (p > 0.55 && p < 0.68) return mid - 12; // T wave
    return mid;
  }

  function draw() {
    const { status, heartRate } = getState();
    const w = canvas.width;
    const h = canvas.height;

    // Pick line color based on health status
    let color = '#10b981';
    if (status === 'emergency') color = '#ef4444';
    else if (status === 'stress') color = '#f59e0b';
    else if (status === 'caffeine') color = '#0ea5e9';

    // Clear a narrow vertical strip ahead of the line
    ctx.fillStyle = '#060b16';
    ctx.fillRect(x, 0, 14, h);

    // Advance beat phase according to current heart rate (BPM)
    phase = (phase + heartRate / 60 / 60) % 1;
    const nextX = x + 2;
    const nextY = getWaveY(phase, h);

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, lastY);
    ctx.lineTo(nextX, nextY);
    ctx.stroke();

    x = nextX >= w ? 0 : nextX;
    lastY = x === 0 ? h / 2 : nextY;

    requestAnimationFrame(draw);
  }

  draw();
}
