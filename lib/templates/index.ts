export type { TemplateName, TemplateConfig } from './types';

import { modern } from './modern';
import { classic } from './classic';
import { technical } from './technical';
import { polished } from './polished';
import { timeline } from './timeline';
import { editorial } from './editorial';
import { spotlight } from './spotlight';
import type { TemplateName, TemplateConfig } from './types';

export const templates: Record<TemplateName, TemplateConfig> = {
  modern,
  classic,
  technical,
  polished,
  timeline,
  editorial,
  spotlight,
};

export const templateNames: TemplateName[] = [
  'modern',
  'classic',
  'technical',
  'polished',
  'timeline',
  'editorial',
  'spotlight',
];

/**
 * Accent color presets for the polished template.
 * Users can pick a color that matches their industry/personal brand.
 */
export const polishedAccents = [
  { name: 'Navy',      sidebar: '#1a365d', accent: '#1a365d' },
  { name: 'Charcoal',  sidebar: '#1f2937', accent: '#374151' },
  { name: 'Burgundy',  sidebar: '#7f1d1d', accent: '#991b1b' },
  { name: 'Forest',    sidebar: '#14532d', accent: '#166534' },
  { name: 'Slate',     sidebar: '#334155', accent: '#475569' },
  { name: 'Plum',      sidebar: '#581c87', accent: '#6b21a8' },
] as const;

export type PolishedAccentName = typeof polishedAccents[number]['name'];

/**
 * Accent color presets for the spotlight template's colored header band.
 */
export const spotlightAccents = [
  { name: 'Burgundy', band: '#8C0027', accent: '#8C0027' },
  { name: 'Navy',     band: '#1a365d', accent: '#1a365d' },
  { name: 'Forest',   band: '#14532d', accent: '#14532d' },
] as const;

export type SpotlightAccentName = typeof spotlightAccents[number]['name'];
