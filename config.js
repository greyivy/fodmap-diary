// Central configuration for tracked dietary factors

export const FACTORS = [
  { id: 'fructans', name: 'Fructans', category: 'fodmap' },
  { id: 'gos', name: 'GOS', category: 'fodmap' },
  { id: 'lactose', name: 'Lactose', category: 'fodmap' },
  { id: 'fructose', name: 'Fructose', category: 'fodmap' },
  { id: 'polyols', name: 'Polyols', category: 'fodmap' },
  { id: 'gluten', name: 'Gluten', category: 'other' },
  { id: 'soy', name: 'Soy', category: 'other' },
  { id: 'nightshades', name: 'Nightshades', category: 'other' },
  { id: 'fibre', name: 'Fibre', category: 'other' },
];

export const FACTOR_IDS = FACTORS.map(f => f.id);

export const LEVELS = ['none', 'low', 'medium', 'high', 'unknown'];

