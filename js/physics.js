/**
 * Double pendulum simulation using RK4 integration.
 * Pivot can move each frame (attached to letter outline).
 */

export class DoublePendulum {
  constructor(options = {}) {
    this.L1 = options.L1 ?? 55;
    this.L2 = options.L2 ?? 70;
    this.m1 = options.m1 ?? 1;
    this.m2 = options.m2 ?? 1;
    this.g = options.g ?? 12;
    this.damping = options.damping ?? 0.008;

    this.theta1 = options.theta1 ?? Math.PI * 0.5;
    this.theta2 = options.theta2 ?? Math.PI * 0.75;
    this.omega1 = options.omega1 ?? 0;
    this.omega2 = options.omega2 ?? 0;

    this.pivotX = 0;
    this.pivotY = 0;
    this.prevPivotX = 0;
    this.prevPivotY = 0;
  }

  setPivot(x, y) {
    this.prevPivotX = this.pivotX;
    this.prevPivotY = this.pivotY;
    this.pivotX = x;
    this.pivotY = y;
  }

  /** World positions of pivot, bob1, bob2 */
  getPositions() {
    const x1 = this.pivotX + this.L1 * Math.sin(this.theta1);
    const y1 = this.pivotY + this.L1 * Math.cos(this.theta1);
    const x2 = x1 + this.L2 * Math.sin(this.theta2);
    const y2 = y1 + this.L2 * Math.cos(this.theta2);

    return {
      pivot: { x: this.pivotX, y: this.pivotY },
      bob1: { x: x1, y: y1 },
      bob2: { x: x2, y: y2 },
    };
  }

  derivatives(state) {
    const [theta1, theta2, omega1, omega2] = state;
    const { L1: l1, L2: l2, m1, m2, g } = this;
    const delta = theta2 - theta1;
    const sinDelta = Math.sin(delta);
    const cosDelta = Math.cos(delta);
    const sin1 = Math.sin(theta1);
    const sin2 = Math.sin(theta2);

    const denom1 = l1 * (2 * m1 + m2 - m2 * Math.cos(2 * delta));
    const denom2 = l2 * (2 * m1 + m2 - m2 * Math.cos(2 * delta));

    const alpha1 =
      (-g * (2 * m1 + m2) * sin1 -
        m2 * g * Math.sin(theta1 - 2 * theta2) -
        2 * sinDelta * m2 * (omega2 * omega2 * l2 + omega1 * omega1 * l1 * cosDelta)) /
      denom1;

    const alpha2 =
      (2 *
        sinDelta *
        (omega1 * omega1 * l1 * (m1 + m2) + g * (m1 + m2) * Math.cos(theta1) + omega2 * omega2 * l2 * m2 * cosDelta)) /
      denom2;

    const dOmega1 = alpha1 - this.damping * omega1;
    const dOmega2 = alpha2 - this.damping * omega2;

    return [omega1, omega2, dOmega1, dOmega2];
  }

  step(dt) {
    const state = [this.theta1, this.theta2, this.omega1, this.omega2];
    const k1 = this.derivatives(state);

    const s2 = state.map((v, i) => v + k1[i] * dt * 0.5);
    const k2 = this.derivatives(s2);

    const s3 = state.map((v, i) => v + k2[i] * dt * 0.5);
    const k3 = this.derivatives(s3);

    const s4 = state.map((v, i) => v + k3[i] * dt);
    const k4 = this.derivatives(s4);

    this.theta1 += (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    this.theta2 += (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    this.omega1 += (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    this.omega2 += (dt / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]);

    // Moving pivot imparts momentum — coupling outline motion into the system
    const pvx = (this.pivotX - this.prevPivotX) / dt;
    const pvy = (this.pivotY - this.prevPivotY) / dt;
    const pivotSpeed = Math.hypot(pvx, pvy);
    if (pivotSpeed > 0.01) {
      const impulse = Math.min(pivotSpeed * 0.002, 0.15);
      this.omega1 += impulse * Math.sign(pvx + pvy * 0.3) * (0.5 + Math.random() * 0.5);
      this.omega2 += impulse * Math.sign(pvx - pvy * 0.3) * (0.5 + Math.random() * 0.5);
    }
  }

  randomize(seed) {
    const rng = mulberry32(seed);
    this.theta1 = Math.PI * (0.3 + rng() * 0.4);
    this.theta2 = Math.PI * (0.5 + rng() * 0.5);
    this.omega1 = (rng() - 0.5) * 2;
    this.omega2 = (rng() - 0.5) * 3;
  }
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { mulberry32 };
