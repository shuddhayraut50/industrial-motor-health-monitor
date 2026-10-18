/**
 * Single source of truth for signed thermal rise calculation and formatting.
 *
 * Definition:
 *   thermal_rise_c = motor_temp_c - ambient_temp_c
 *
 * Negative results are mathematically valid and physically meaningful:
 * the measured motor surface is cooler than ambient room air (e.g. idle motor in warm facility,
 * air draft, refrigeration, or during initial startup).
 */

export interface SignedThermalRise {
  value: number | null;
  /** Formatted string with unit, e.g. "+12.0 °C", "-4.0 °C", "0.0 °C", or "Unavailable" */
  formatted: string;
  /** Formatted numeric string with sign for card value, e.g. "+12.0", "-4.0", "0.0", or null */
  formattedValueOnly: string | null;
  /** Plain explanation of thermal state */
  explanation: string;
  /** Whether the motor is cooler than ambient */
  isCoolerThanAmbient: boolean;
}

export function calculateSignedThermalRise(
  motorTempC: number | null | undefined,
  ambientTempC: number | null | undefined
): SignedThermalRise {
  const isMotorValid =
    motorTempC !== null &&
    motorTempC !== undefined &&
    Number.isFinite(Number(motorTempC));

  const isAmbientValid =
    ambientTempC !== null &&
    ambientTempC !== undefined &&
    Number.isFinite(Number(ambientTempC));

  if (!isMotorValid || !isAmbientValid) {
    let explanation = 'Requires both motor and ambient probes';
    if (!isMotorValid && !isAmbientValid) {
      explanation = 'Both temperature probes unavailable';
    } else if (!isMotorValid) {
      explanation = 'Requires motor probe (not detected)';
    } else {
      explanation = 'Requires ambient probe (not detected)';
    }

    return {
      value: null,
      formatted: 'Unavailable',
      formattedValueOnly: null,
      explanation,
      isCoolerThanAmbient: false,
    };
  }

  const motor = Number(motorTempC);
  const ambient = Number(ambientTempC);
  const diff = Number((motor - ambient).toFixed(2));
  const absDiff = Math.abs(diff).toFixed(1);

  if (diff > 0.05) {
    const valStr = `+${diff.toFixed(1)}`;
    return {
      value: diff,
      formatted: `${valStr} °C`,
      formattedValueOnly: valStr,
      explanation: `Motor surface is ${absDiff} °C above ambient`,
      isCoolerThanAmbient: false,
    };
  } else if (diff < -0.05) {
    const valStr = `-${absDiff}`;
    return {
      value: diff,
      formatted: `${valStr} °C`,
      formattedValueOnly: valStr,
      explanation: `Motor surface is ${absDiff} °C cooler than ambient`,
      isCoolerThanAmbient: true,
    };
  } else {
    return {
      value: 0,
      formatted: '0.0 °C',
      formattedValueOnly: '0.0',
      explanation: 'Motor surface matches ambient temperature (0.0 °C rise)',
      isCoolerThanAmbient: false,
    };
  }
}
