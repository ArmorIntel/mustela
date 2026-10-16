const TLP_LEVELS = ['clear', 'green', 'amber', 'amber+strict', 'red'];

export function normalizeTlp(value) {
  return TLP_LEVELS.includes(value) ? value : null;
}

export function validateTlp(value) {
  if (value !== null && !TLP_LEVELS.includes(value)) throw new Error('Invalid TLP marking');
  return value;
}
