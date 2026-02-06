/* =============================================
   LÔ TÔ - CONFETTI EFFECTS
   Canvas-based particle system
   ============================================= */

const Confetti = {
    canvas: null,
    ctx: null,
    particles: [],
    animationId: null,

    init() {
        // Create canvas if not exists
        if (!document.getElementById('confetti-canvas')) {
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'confetti-canvas';
            this.canvas.style.position = 'fixed';
            this.canvas.style.top = '0';
            this.canvas.style.left = '0';
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.pointerEvents = 'none';
            this.canvas.style.zIndex = '9999';
            document.body.appendChild(this.canvas);

            this.ctx = this.canvas.getContext('2d');
            this.resize();

            window.addEventListener('resize', () => this.resize());
        }
    },

    resize() {
        if (this.canvas) {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        }
    },

    // Burst confetti from specific coordinates or center
    burst(x = 0.5, y = 0.5) {
        this.init();

        const colors = ['#FF6B6B', '#FFB347', '#4ECDC4', '#A78BFA', '#FFD93D'];

        // Create 100 particles
        for (let i = 0; i < 100; i++) {
            this.particles.push({
                x: x * this.canvas.width,
                y: y * this.canvas.height,
                w: Math.random() * 10 + 5,
                h: Math.random() * 10 + 5,
                color: colors[Math.floor(Math.random() * colors.length)],
                vx: (Math.random() - 0.5) * 20, // Random velocity X
                vy: (Math.random() - 0.5) * 20 - 10, // Random velocity Y (mostly up)
                rotation: Math.random() * 360,
                rotationSpeed: (Math.random() - 0.5) * 10,
                gravity: 0.2
            });
        }

        if (!this.animationId) {
            this.animate();
        }
    },

    animate() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Update and draw particles
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];

            p.vy += p.gravity;
            p.x += p.vx;
            p.y += p.vy;
            p.rotation += p.rotationSpeed;

            this.ctx.save();
            this.ctx.translate(p.x, p.y);
            this.ctx.rotate((p.rotation * Math.PI) / 180);
            this.ctx.fillStyle = p.color;
            this.ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            this.ctx.restore();

            // Friction
            p.vx *= 0.95;
            p.vy *= 0.95;
        }

        // Remove off-screen particles
        this.particles = this.particles.filter(p => p.y < this.canvas.height + 50);

        if (this.particles.length > 0) {
            this.animationId = requestAnimationFrame(() => this.animate());
        } else {
            this.animationId = null;
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }
};

window.Confetti = Confetti;
