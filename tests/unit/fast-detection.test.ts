import { describe, it, expect } from 'vitest';

/**
 * Fast ESP32-Level Rolling RMS & Local Condition Classifier Simulator
 * Mirrors the C++ RollingWindowAccumulator & fastEvaluateCondition logic.
 */
class FastRollingEvaluator {
  private windowSize = 50; // 50 samples @ 200 Hz = 250 ms
  private bufX: number[] = new Array(50).fill(0);
  private head = 0;
  private count = 0;
  private sumX = 0;
  private sumSqX = 0;

  public currentCondition = 'UNKNOWN';
  public pendingCondition = 'UNKNOWN';
  public conditionPersistenceCount = 0;
  public activeLedTest: 'IDLE' | 'TEST_ALL' | 'TEST_SINGLE' = 'IDLE';
  public ledOutputState: 'NORMAL' | 'CAUTION' | 'WARNING' | 'CRITICAL_FLASH' | 'TEST_PATTERN' = 'NORMAL';

  // Configurable thresholds
  public rmsCautionG = 0.12;
  public rmsWarningG = 0.25;
  public rmsCriticalG = 0.45;

  public addSample(x: number) {
    if (this.count === this.windowSize) {
      const oldX = this.bufX[this.head];
      this.sumX -= oldX;
      this.sumSqX -= oldX * oldX;
    } else {
      this.count++;
    }

    this.bufX[this.head] = x;
    this.sumX += x;
    this.sumSqX += x * x;
    this.head = (this.head + 1) % this.windowSize;
  }

  public calculateRms(): number {
    if (this.count === 0) return 0;
    const n = this.count;
    const mean = this.sumX / n;
    const variance = (this.sumSqX / n) - (mean * mean);
    return Math.sqrt(Math.max(0, variance));
  }

  public evaluateCondition(motorTempC = 45): string {
    const rms = this.calculateRms();
    let evaluated = 'GOOD';

    if (rms >= this.rmsCriticalG || motorTempC >= 85) {
      evaluated = 'CRITICAL';
    } else if (rms >= this.rmsWarningG || motorTempC >= 70) {
      evaluated = 'WARNING';
    } else if (rms >= this.rmsCautionG || motorTempC >= 55) {
      evaluated = 'CHECK';
    }

    // Immediate escalation on safety hazard (0 delay)
    if (evaluated === 'CRITICAL') {
      this.currentCondition = evaluated;
      this.pendingCondition = evaluated;
      this.conditionPersistenceCount = 0;
    } else if (evaluated === this.pendingCondition) {
      this.conditionPersistenceCount++;
      if (this.conditionPersistenceCount >= 2) {
        this.currentCondition = evaluated;
      }
    } else {
      this.pendingCondition = evaluated;
      this.conditionPersistenceCount = 1;
    }

    this.updateLeds();
    return this.currentCondition;
  }

  public updateLeds() {
    // Safety override: CRITICAL overrides active LED test immediately
    if (this.currentCondition === 'CRITICAL') {
      this.activeLedTest = 'IDLE';
      this.ledOutputState = 'CRITICAL_FLASH';
      return;
    }

    if (this.activeLedTest !== 'IDLE') {
      this.ledOutputState = 'TEST_PATTERN';
      return;
    }

    if (this.currentCondition === 'GOOD') this.ledOutputState = 'NORMAL';
    else if (this.currentCondition === 'CHECK') this.ledOutputState = 'CAUTION';
    else if (this.currentCondition === 'WARNING') this.ledOutputState = 'WARNING';
  }
}

describe('Fast ESP32-Level Vibration Detection & Immediate LED Driver', () => {
  it('correctly calculates AC RMS across a 50-sample (250 ms) rolling window', () => {
    const evaluator = new FastRollingEvaluator();
    // Feed sinusoidal acceleration amplitude A = 0.5g -> theoretical RMS = A / sqrt(2) ~= 0.3535g
    for (let i = 0; i < 50; i++) {
      const sample = 0.5 * Math.sin((2 * Math.PI * i) / 25);
      evaluator.addSample(sample);
    }
    const rms = evaluator.calculateRms();
    expect(rms).toBeGreaterThan(0.34);
    expect(rms).toBeLessThan(0.36);
  });

  it('triggers immediate CRITICAL condition within 1 evaluation window (<250 ms)', () => {
    const evaluator = new FastRollingEvaluator();
    // Inject severe vibration (RMS > 0.45g)
    for (let i = 0; i < 50; i++) {
      const sample = (i % 2 === 0 ? 0.7 : -0.7);
      evaluator.addSample(sample);
    }
    const cond = evaluator.evaluateCondition();
    expect(cond).toBe('CRITICAL');
    expect(evaluator.ledOutputState).toBe('CRITICAL_FLASH');
  });

  it('requires 2 consecutive 250 ms cycles (500 ms) to confirm WARNING to prevent noise chatter', () => {
    const evaluator = new FastRollingEvaluator();
    // 1st cycle: inject warning vibration (0.30g)
    for (let i = 0; i < 50; i++) {
      const sample = (i % 2 === 0 ? 0.3 : -0.3);
      evaluator.addSample(sample);
    }
    // After 1 cycle (250 ms), pending is WARNING but current remains initial/GOOD
    evaluator.evaluateCondition();
    expect(evaluator.pendingCondition).toBe('WARNING');
    expect(evaluator.currentCondition).toBe('UNKNOWN');

    // 2nd cycle (500 ms): sustained warning vibration confirms WARNING
    evaluator.evaluateCondition();
    expect(evaluator.currentCondition).toBe('WARNING');
    expect(evaluator.ledOutputState).toBe('WARNING');
  });

  it('CRITICAL condition immediately overrides active website diagnostic test', () => {
    const evaluator = new FastRollingEvaluator();
    evaluator.activeLedTest = 'TEST_ALL';
    evaluator.ledOutputState = 'TEST_PATTERN';

    // Normal evaluation does not abort test
    evaluator.evaluateCondition(40);
    expect(evaluator.activeLedTest).toBe('TEST_ALL');
    expect(evaluator.ledOutputState).toBe('TEST_PATTERN');

    // Severe vibration spike occurs while user is running test
    for (let i = 0; i < 50; i++) {
      evaluator.addSample(i % 2 === 0 ? 0.8 : -0.8);
    }
    evaluator.evaluateCondition();

    // Must immediately abort test and flash critical alarm!
    expect(evaluator.currentCondition).toBe('CRITICAL');
    expect(evaluator.activeLedTest).toBe('IDLE');
    expect(evaluator.ledOutputState).toBe('CRITICAL_FLASH');
  });
});
