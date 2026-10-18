import { describe, it, expect } from 'vitest';
import { calculateSignedThermalRise } from '@/lib/utils/temperature';

describe('calculateSignedThermalRise', () => {
  it('handles positive temperature difference (motor warmer than ambient)', () => {
    const result = calculateSignedThermalRise(42.0, 30.0);
    expect(result.value).toBe(12.0);
    expect(result.formatted).toBe('+12.0 °C');
    expect(result.formattedValueOnly).toBe('+12.0');
    expect(result.explanation).toBe('Motor surface is 12.0 °C above ambient');
    expect(result.isCoolerThanAmbient).toBe(false);
  });

  it('handles negative temperature difference (motor cooler than ambient)', () => {
    const result = calculateSignedThermalRise(27.0, 31.0);
    expect(result.value).toBe(-4.0);
    expect(result.formatted).toBe('-4.0 °C');
    expect(result.formattedValueOnly).toBe('-4.0');
    expect(result.explanation).toBe('Motor surface is 4.0 °C cooler than ambient');
    expect(result.isCoolerThanAmbient).toBe(true);
  });

  it('handles zero difference (motor equals ambient)', () => {
    const result = calculateSignedThermalRise(25.5, 25.5);
    expect(result.value).toBe(0);
    expect(result.formatted).toBe('0.0 °C');
    expect(result.formattedValueOnly).toBe('0.0');
    expect(result.explanation).toBe('Motor surface matches ambient temperature (0.0 °C rise)');
    expect(result.isCoolerThanAmbient).toBe(false);
  });

  it('handles missing motor temperature as Unavailable', () => {
    const result = calculateSignedThermalRise(null, 25.0);
    expect(result.value).toBeNull();
    expect(result.formatted).toBe('Unavailable');
    expect(result.formattedValueOnly).toBeNull();
    expect(result.explanation).toBe('Requires motor probe (not detected)');
  });

  it('handles missing ambient temperature as Unavailable', () => {
    const result = calculateSignedThermalRise(45.0, null);
    expect(result.value).toBeNull();
    expect(result.formatted).toBe('Unavailable');
    expect(result.formattedValueOnly).toBeNull();
    expect(result.explanation).toBe('Requires ambient probe (not detected)');
  });

  it('handles both temperatures missing as Unavailable', () => {
    const result = calculateSignedThermalRise(null, null);
    expect(result.value).toBeNull();
    expect(result.formatted).toBe('Unavailable');
    expect(result.formattedValueOnly).toBeNull();
    expect(result.explanation).toBe('Both temperature probes unavailable');
  });

  it('handles NaN or non-finite values as Unavailable', () => {
    const result = calculateSignedThermalRise(NaN, 25.0);
    expect(result.value).toBeNull();
    expect(result.formatted).toBe('Unavailable');
  });
});
