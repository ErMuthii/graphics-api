/*
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           COSMIC DEFENDER — HTML5 Canvas Game               ║
 * ║  Demonstrates the Graphics Pipeline:                        ║
 * ║   • GEOMETRY STAGE   → defining vertices, transforms        ║
 * ║   • RASTERIZATION    → ctx.fill/stroke converting to pixels ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

// ── Canvas Setup ─────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ── Web Audio API (Audio Requirement) ────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let   audioCtx = null;
let   muted    = false;

function initAudio() {
  if (!audioCtx) audioCtx = new AudioCtx();
}

/**
 * Synthesises a short sound using oscillators — no external files needed.
 * @param {string} type  - 'shoot' | 'explode' | 'hit' | 'levelup'
 */
function playSound(type) {
  if (muted || !audioCtx) return;
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  const t = audioCtx.currentTime;
  if (type === 'shoot') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.08);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.start(t); osc.stop(t + 0.1);
  } else if (type === 'explode') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.35);
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.start(t); osc.stop(t + 0.35);
  } else if (type === 'hit') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.2);
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.start(t); osc.stop(t + 0.2);
  } else if (type === 'levelup') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.setValueAtTime(660, t + 0.1);
    osc.frequency.setValueAtTime(880, t + 0.2);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.start(t); osc.stop(t + 0.4);
  }
}

// ── Game State ───────────────────────────────────────────────
let score      = 0;
let lives      = 3;
let level      = 1;
let speedMult  = 1.0;
let gameActive = false;
let frameId    = null;
let shootCooldown = 0;

// ── Input ────────────────────────────────────────────────────
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup',  e => { keys[e.code] = false; });

// ── Stars (Background Parallax) ──────────────────────────────
// GEOMETRY STAGE: Star positions are defined as 2D points (x,y)
// with a size scalar — this is the vertex/geometry definition step.
const stars = Array.from({ length: 180 }, () => ({
  x:    Math.random() * window.innerWidth,
  y:    Math.random() * window.innerHeight,
  r:    Math.random() * 1.6 + 0.3,
  spd:  Math.random() * 0.4 + 0.1,
  alpha: Math.random() * 0.6 + 0.3,
}));

// ── OBJECT 1: Player Ship ────────────────────────────────────
/*
 * GEOMETRY STAGE:
 * The spaceship is defined as a polygon with 7 vertices
 * in local (model) space. ctx.save/restore + translate/rotate
 * apply the MODEL→WORLD transformation before rasterization.
 */
const ship = {
  x: 0, y: 0,
  vx: 0, vy: 0,
  angle: 0,           // rotation angle in radians
  radius: 18,
  thrusting: false,
  invincible: false,
  invTimer: 0,

  // GEOMETRY: local-space vertices of the ship polygon
  // These points define the ship's shape before any transformation
  getVertices() {
    const r = this.radius;
    return [
      { x:  r * 1.6,  y: 0      },   // nose
      { x: -r,        y: -r      },  // left wing tip
      { x: -r * 0.5,  y: -r*0.4 },  // left inner
      { x: -r * 0.5,  y:  r*0.4 },  // right inner
      { x: -r,        y:  r      },  // right wing tip
    ];
  },

  reset() {
    this.x = canvas.width / 2;
    this.y = canvas.height / 2;
    this.vx = 0; this.vy = 0;
    this.angle = -Math.PI / 2;
    this.invincible = true;
    this.invTimer = 180;
  },

  update() {
    // GEOMETRY (TRANSFORMATION): Rotate ship based on input
    if (keys['ArrowLeft'])  this.angle -= 0.05;
    if (keys['ArrowRight']) this.angle += 0.05;

    // GEOMETRY (TRANSFORMATION): Thrust vector in direction of angle
    this.thrusting = keys['ArrowUp'] || keys['KeyW'];
    if (this.thrusting) {
      this.vx += Math.cos(this.angle) * 0.25;
      this.vy += Math.sin(this.angle) * 0.25;
    }

    // Friction / drag
    this.vx *= 0.985;
    this.vy *= 0.985;

    // Clamp speed
    const spd = Math.hypot(this.vx, this.vy);
    if (spd > 7) { this.vx = (this.vx/spd)*7; this.vy = (this.vy/spd)*7; }

    // Move (translation transformation)
    this.x += this.vx;
    this.y += this.vy;

    // Screen wrap — object reappears on opposite edge
    if (this.x < -30) this.x = canvas.width  + 30;
    if (this.x > canvas.width  + 30) this.x = -30;
    if (this.y < -30) this.y = canvas.height + 30;
    if (this.y > canvas.height + 30) this.y = -30;

    // Invincibility countdown
    if (this.invincible) {
      this.invTimer--;
      if (this.invTimer <= 0) this.invincible = false;
    }

    // Shooting
    if (shootCooldown > 0) shootCooldown--;
    if (keys['Space'] && shootCooldown === 0) {
      bullets.push(new Bullet(this.x, this.y, this.angle));
      playSound('shoot');
      shootCooldown = 14;
    }
  },

  draw() {
    if (this.invincible && Math.floor(this.invTimer / 6) % 2 === 0) return;

    /*
     * GEOMETRY STAGE (MODEL → WORLD TRANSFORM):
     * ctx.save/translate/rotate applies a 2D affine transformation
     * matrix to move from model space → world space.
     * This is equivalent to multiplying by a model matrix.
     */
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // Draw engine glow when thrusting (size change / animation)
    if (this.thrusting) {
      // GEOMETRY: flame cone vertices
      ctx.beginPath();
      ctx.moveTo(-this.radius * 0.5, -this.radius * 0.25);
      ctx.lineTo(-this.radius * (1.2 + Math.random() * 0.6), 0);
      ctx.lineTo(-this.radius * 0.5,  this.radius * 0.25);
      ctx.closePath();

      /*
       * RASTERIZATION STAGE:
       * ctx.fill() triggers the rasterizer — it converts the path's
       * geometric description into coloured pixels on the canvas bitmap.
       */
      const flameGrad = ctx.createLinearGradient(-this.radius * 1.8, 0, -this.radius * 0.5, 0);
      flameGrad.addColorStop(0, 'hsla(30,100%,60%,0)');
      flameGrad.addColorStop(1, 'hsla(45,100%,70%,0.9)');
      ctx.fillStyle = flameGrad;
      ctx.fill(); // ← RASTERIZATION

      ctx.shadowBlur  = 18;
      ctx.shadowColor = 'hsl(40,100%,60%)';
      ctx.fill(); // ← RASTERIZATION (glow pass)
      ctx.shadowBlur = 0;
    }

    // GEOMETRY: define ship polygon path in local space
    const verts = this.getVertices();
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
    ctx.closePath();

    // RASTERIZATION: fill ship body → converts path to pixels
    const shipGrad = ctx.createLinearGradient(-this.radius, 0, this.radius, 0);
    shipGrad.addColorStop(0, 'hsl(220,70%,30%)');
    shipGrad.addColorStop(1, 'hsl(185,100%,55%)');
    ctx.fillStyle   = shipGrad;
    ctx.shadowBlur  = 20;
    ctx.shadowColor = 'hsl(185,100%,55%)';
    ctx.fill();   // ← RASTERIZATION

    // RASTERIZATION: stroke outline → rasterizes edges to pixels
    ctx.strokeStyle = 'hsl(185,100%,75%)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();  // ← RASTERIZATION
    ctx.shadowBlur = 0;

    ctx.restore(); // undo transformation matrix
  }
};

// ── OBJECT 2: Bullets ────────────────────────────────────────
/*
 * GEOMETRY STAGE:
 * Each bullet is a line segment (2 points) + small circle (radius scalar).
 * Position updates are translations in world space each frame.
 */
class Bullet {
  constructor(x, y, angle) {
    const spd = 11 * speedMult;
    this.x    = x;
    this.y    = y;
    this.vx   = Math.cos(angle) * spd;
    this.vy   = Math.sin(angle) * spd;
    this.life = 60;
    this.radius = 4;
  }

  update() {
    // GEOMETRY (TRANSLATION): move bullet each frame
    this.x += this.vx;
    this.y += this.vy;
    this.life--;
    // Wrap
    if (this.x < 0) this.x = canvas.width;
    if (this.x > canvas.width) this.x = 0;
    if (this.y < 0) this.y = canvas.height;
    if (this.y > canvas.height) this.y = 0;
  }

  draw() {
    // GEOMETRY: define bullet as a circle path
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);

    // RASTERIZATION: convert circle geometry → pixels
    ctx.fillStyle   = 'hsl(60,100%,80%)';
    ctx.shadowBlur  = 12;
    ctx.shadowColor = 'hsl(45,100%,65%)';
    ctx.fill();  // ← RASTERIZATION
    ctx.shadowBlur = 0;
  }
}

// ── OBJECT 3: Asteroids ──────────────────────────────────────
/*
 * GEOMETRY STAGE:
 * Each asteroid is an irregular polygon defined by N vertices
 * at randomised radii, equally spaced in angle (polar coordinates
 * converted to Cartesian). This is geometry/vertex generation.
 * Asteroids rotate (angle += spin each frame) — rotation transform.
 * Size changes as they break into smaller pieces — scaling transform.
 */
class Asteroid {
  constructor(x, y, radius) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    const spd = (Math.random() * 1.2 + 0.5) * speedMult;
    const ang  = Math.random() * Math.PI * 2;
    this.vx   = Math.cos(ang) * spd;
    this.vy   = Math.sin(ang) * spd;
    this.spin = (Math.random() - 0.5) * 0.04; // rotation speed
    this.angle = 0;
    this.numVerts = Math.floor(Math.random() * 5) + 7;

    // GEOMETRY: generate irregular polygon vertices in local space
    // Using polar→Cartesian conversion: each vertex at angle i*(2π/n)
    // with a random jitter on the radius (jagged rock look)
    this.offsets = Array.from({ length: this.numVerts }, () =>
      0.75 + Math.random() * 0.5   // radial jitter factor
    );
  }

  update() {
    // GEOMETRY (TRANSLATION + ROTATION): update position and angle each frame
    this.x     += this.vx;
    this.y     += this.vy;
    this.angle += this.spin; // rotation transform applied each frame

    if (this.x < -this.radius) this.x = canvas.width  + this.radius;
    if (this.x > canvas.width  + this.radius) this.x = -this.radius;
    if (this.y < -this.radius) this.y = canvas.height + this.radius;
    if (this.y > canvas.height + this.radius) this.y = -this.radius;
  }

  draw() {
    /*
     * GEOMETRY STAGE (MODEL → WORLD TRANSFORM):
     * ctx.translate + ctx.rotate applies a 2D rotation matrix,
     * equivalent to multiplying vertex positions by a rotation matrix:
     *   [cos θ  -sin θ]
     *   [sin θ   cos θ]
     * The vertices in local space are rotated into world space.
     */
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // GEOMETRY: build irregular polygon path from polar vertices
    ctx.beginPath();
    for (let i = 0; i < this.numVerts; i++) {
      const theta = (i / this.numVerts) * Math.PI * 2;
      const r     = this.radius * this.offsets[i];
      // Convert polar (r, θ) → Cartesian (x, y) — geometry computation
      const px    = Math.cos(theta) * r;
      const py    = Math.sin(theta) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();

    /*
     * RASTERIZATION STAGE:
     * ctx.fill() sends the path through the rasterizer.
     * The GPU/browser fills every pixel inside the polygon boundary.
     * This converts our geometric description into a raster image.
     */
    const shade = Math.floor(this.radius * 2.5);
    ctx.fillStyle   = `hsl(25, ${shade}%, 28%)`;
    ctx.shadowBlur  = 10;
    ctx.shadowColor = 'hsl(25,60%,45%)';
    ctx.fill();   // ← RASTERIZATION

    ctx.strokeStyle = 'hsl(30,70%,60%)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();  // ← RASTERIZATION
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}

// ── OBJECT 4: Particles (Explosion) ──────────────────────────
/*
 * GEOMETRY STAGE:
 * Each particle is a point with velocity (vx,vy) and a radius
 * that SHRINKS over lifetime — demonstrating SIZE CHANGE transform.
 */
class Particle {
  constructor(x, y, color) {
    this.x    = x;
    this.y    = y;
    const spd = Math.random() * 4 + 1;
    const ang = Math.random() * Math.PI * 2;
    this.vx   = Math.cos(ang) * spd;
    this.vy   = Math.sin(ang) * spd;
    this.life = Math.random() * 40 + 20;
    this.maxLife = this.life;
    this.color = color || 'hsl(45,100%,65%)';
    this.radius = Math.random() * 3 + 1;
  }

  update() {
    // GEOMETRY (TRANSLATION + SIZE CHANGE): shrink radius over time
    this.x  += this.vx;
    this.y  += this.vy;
    this.vx *= 0.97;
    this.vy *= 0.97;
    this.life--;
    // SIZE CHANGE: radius scales down proportionally to remaining life
    this.currentRadius = this.radius * (this.life / this.maxLife);
  }

  draw() {
    const alpha = this.life / this.maxLife;
    // GEOMETRY: circular path
    ctx.beginPath();
    ctx.arc(this.x, this.y, Math.max(0.5, this.currentRadius), 0, Math.PI * 2);
    // RASTERIZATION: fill pixel circle
    ctx.fillStyle   = this.color.replace(')', `,${alpha})`).replace('hsl', 'hsla');
    ctx.fill(); // ← RASTERIZATION
  }
}

// ── Collections ──────────────────────────────────────────────
let bullets   = [];
let asteroids = [];
let particles = [];

// ── Helper: spawn asteroids ───────────────────────────────────
function spawnAsteroid(x, y, radius) {
  // Keep asteroids away from ship at spawn
  if (!x) {
    let ex, ey;
    do {
      ex = Math.random() * canvas.width;
      ey = Math.random() * canvas.height;
    } while (Math.hypot(ex - ship.x, ey - ship.y) < 180);
    x = ex; y = ey;
  }
  asteroids.push(new Asteroid(x, y, radius || 48 + Math.random() * 20));
}

function spawnWave() {
  const count = 3 + level;
  for (let i = 0; i < count; i++) spawnAsteroid();
}

// ── Collision Detection ───────────────────────────────────────
function circleCollide(ax, ay, ar, bx, by, br) {
  return Math.hypot(ax - bx, ay - by) < ar + br;
}

function explode(x, y, count, color) {
  for (let i = 0; i < count; i++) particles.push(new Particle(x, y, color));
}

// ── HUD Update ────────────────────────────────────────────────
function updateHUD() {
  document.getElementById('score-display').textContent = score;
  document.getElementById('level-display').textContent = `LEVEL ${level}`;
  document.getElementById('speed-display').textContent = `SPEED ×${speedMult.toFixed(1)}`;
  const heartsArr = ['', '❤️', '❤️ ❤️', '❤️ ❤️ ❤️'];
  document.getElementById('lives-display').textContent = heartsArr[Math.max(0, lives)] || '';
}

// ── Game Initialization ───────────────────────────────────────
function initGame() {
  score     = 0;
  lives     = 3;
  level     = 1;
  speedMult = 1.0;
  bullets   = [];
  asteroids = [];
  particles = [];
  ship.reset();
  spawnWave();
  updateHUD();
}

// ── Main Game Loop ────────────────────────────────────────────
function gameLoop() {
  if (!gameActive) return;
  frameId = requestAnimationFrame(gameLoop);

  const W = canvas.width, H = canvas.height;

  // ── RASTERIZATION: Clear canvas each frame (background fill) ──
  // This is a full-screen raster clear — sets all pixels to bg colour
  ctx.fillStyle = 'hsl(220, 30%, 5%)';
  ctx.fillRect(0, 0, W, H); // ← RASTERIZATION (clear/background)

  // ── Draw Starfield ────────────────────────────────────────────
  // GEOMETRY: each star is a tiny circle (arc with radius r)
  // RASTERIZATION: ctx.fill() converts circle to pixels
  stars.forEach(s => {
    s.y += s.spd * speedMult * 0.3;
    if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); // GEOMETRY: circle path
    ctx.fillStyle = `hsla(220,60%,90%,${s.alpha})`;
    ctx.fill(); // ← RASTERIZATION
  });

  // ── Update & Draw all objects ─────────────────────────────────
  ship.update();
  ship.draw();

  // Update bullets
  bullets.forEach(b => { b.update(); b.draw(); });
  bullets = bullets.filter(b => b.life > 0);

  // Update asteroids
  asteroids.forEach(a => { a.update(); a.draw(); });

  // Update particles
  particles.forEach(p => { p.update(); p.draw(); });
  particles = particles.filter(p => p.life > 0);

  // ── Collision: Bullets vs Asteroids ───────────────────────────
  const remainingBullets    = [];
  const remainingAsteroids  = [];
  let   hitAny = false;

  bullets.forEach(b => {
    let hit = false;
    asteroids.forEach(a => {
      if (!hit && circleCollide(b.x, b.y, b.radius, a.x, a.y, a.radius)) {
        hit = true; hitAny = true;
        explode(a.x, a.y, 18, 'hsl(30,100%,60%)');
        playSound('explode');

        // GEOMETRY + SIZE CHANGE: large asteroids break into 2 smaller ones
        // This demonstrates changing object size dynamically
        if (a.radius > 22) {
          const newR = a.radius * 0.52; // size reduction transform
          for (let i = 0; i < 2; i++) {
            const child = new Asteroid(
              a.x + (Math.random() - 0.5) * 20,
              a.y + (Math.random() - 0.5) * 20,
              newR
            );
            // Inherit parent velocity + randomisation (direction change)
            child.vx = a.vx * 0.8 + (Math.random() - 0.5) * 1.5;
            child.vy = a.vy * 0.8 + (Math.random() - 0.5) * 1.5;
            remainingAsteroids.push(child);
          }
          score += 50;
        } else {
          score += 100;
        }
        updateHUD();
      }
    });
    if (!hit) remainingBullets.push(b);
  });

  // Keep asteroids that weren't directly destroyed (only child replacements added)
  asteroids.forEach(a => {
    if (!bullets.some(b => circleCollide(b.x, b.y, b.radius, a.x, a.y, a.radius))) {
      remainingAsteroids.push(a);
    }
  });

  bullets   = remainingBullets;
  asteroids = remainingAsteroids.filter((a, i, arr) =>
    arr.indexOf(a) === i // deduplicate
  );

  // ── Collision: Ship vs Asteroids ──────────────────────────────
  if (!ship.invincible) {
    asteroids.forEach(a => {
      if (circleCollide(ship.x, ship.y, ship.radius * 0.7, a.x, a.y, a.radius * 0.85)) {
        explode(ship.x, ship.y, 30, 'hsl(185,100%,60%)');
        playSound('hit');
        lives--;
        updateHUD();
        if (lives <= 0) {
          endGame();
        } else {
          ship.reset();
        }
      }
    });
  }

  // ── Level Progression (Speed Change) ─────────────────────────
  // When all asteroids cleared, advance level — SPEED INCREASES
  if (asteroids.length === 0) {
    level++;
    // SPEED CHANGE: multiply speed factor each level
    speedMult = Math.min(1.0 + (level - 1) * 0.25, 3.5);
    playSound('levelup');
    explode(W / 2, H / 2, 60, 'hsl(270,90%,70%)');
    spawnWave();
    updateHUD();
  }

  // ── Draw grid overlay (subtle — simulates pixel grid awareness) ─
  if (level >= 3) {
    // RASTERIZATION: thin grid lines drawn as raster strokes
    ctx.strokeStyle = 'hsla(185,100%,55%,0.03)';
    ctx.lineWidth   = 1;
    for (let gx = 0; gx < W; gx += 80) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H);
      ctx.stroke(); // ← RASTERIZATION
    }
    for (let gy = 0; gy < H; gy += 80) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy);
      ctx.stroke(); // ← RASTERIZATION
    }
  }
}

// ── End Game ─────────────────────────────────────────────────
function endGame() {
  gameActive = false;
  cancelAnimationFrame(frameId);
  document.getElementById('final-score-text').textContent = `FINAL SCORE: ${score}`;
  document.getElementById('final-level-text').textContent = `LEVEL REACHED: ${level}`;
  document.getElementById('gameover-overlay').classList.remove('hidden');
  document.getElementById('gameover-overlay').classList.add('active');
}

// ── Toggle Mute ───────────────────────────────────────────────
function toggleMute() {
  muted = !muted;
  let badge = document.getElementById('mute-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'mute-badge';
    document.body.appendChild(badge);
  }
  badge.textContent = muted ? '🔇 MUTED' : '🔊 SOUND ON';
}

// ── Button Wiring ─────────────────────────────────────────────
document.getElementById('start-btn').addEventListener('click', () => {
  initAudio();
  document.getElementById('overlay').classList.remove('active');
  document.getElementById('overlay').classList.add('hidden');
  initGame();
  gameActive = true;
  gameLoop();
});

document.getElementById('restart-btn').addEventListener('click', () => {
  initAudio();
  document.getElementById('gameover-overlay').classList.remove('active');
  document.getElementById('gameover-overlay').classList.add('hidden');
  initGame();
  gameActive = true;
  gameLoop();
});

// ── Mobile/Touch Support ─────────────────────────────────────
// Left half of screen = move left; right half = move right; tap = shoot
canvas.addEventListener('touchstart', e => {
  initAudio();
  e.preventDefault();
  Array.from(e.touches).forEach(t => {
    if (t.clientX < canvas.width / 2) keys['ArrowLeft'] = true;
    else keys['ArrowRight'] = true;
    keys['Space'] = true;
  });
}, { passive: false });

canvas.addEventListener('touchend', e => {
  e.preventDefault();
  keys['ArrowLeft'] = false;
  keys['ArrowRight'] = false;
  keys['Space'] = false;
}, { passive: false });
