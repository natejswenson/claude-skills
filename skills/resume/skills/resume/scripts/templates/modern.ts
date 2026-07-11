import type { TemplateConfig } from './types';

export const modern: TemplateConfig = {
  name: 'modern',
  label: 'Modern',
  description: 'Clean and contemporary with a purple accent',
  layout: 'single-column',
  header: 'centered',
  contactSeparator: '\u00B7',
  pdf: {
    fontFamily: 'Helvetica',
    fontFamilyBold: 'Helvetica-Bold',
    fontSize: 10,
    nameFontSize: 20,
    sectionFontSize: 11,
    pageMargin: { top: 36, bottom: 36, horizontal: 48 },
  },
  html: { fontFamily: "system-ui, -apple-system, sans-serif" },
  colors: {
    foreground: '#111',
    muted: '#444',
    accent: '#8b5cf6',
    border: '#111',
  },
  sectionHeading: {
    uppercase: true,
    letterSpacing: 0.15,
    borderBottom: true,
    accentColored: true,
  },
  bullet: { character: '\u2013', indent: 8 },
  sectionGap: 14,
  jobGap: 10,
  lineHeight: 1.0,
  bulletGap: 2,
  allowJobWrap: false,
};
