import type { TemplateConfig } from './types';

export const technical: TemplateConfig = {
  name: 'technical',
  label: 'Technical',
  description: 'Ultra-compact for maximum content density',
  layout: 'single-column',
  header: 'centered',
  contactSeparator: '|',
  pdf: {
    fontFamily: 'Helvetica',
    fontFamilyBold: 'Helvetica-Bold',
    fontSize: 9,
    nameFontSize: 18,
    sectionFontSize: 10,
    pageMargin: { top: 28, bottom: 28, horizontal: 36 },
  },
  html: { fontFamily: "system-ui, -apple-system, sans-serif" },
  colors: {
    foreground: '#111',
    muted: '#555',
    accent: '#111',
    border: '#111',
  },
  sectionHeading: {
    uppercase: true,
    letterSpacing: 0.08,
    borderBottom: true,
    accentColored: false,
  },
  bullet: { character: '\u2022', indent: 6 },
  sectionGap: 8,
  jobGap: 6,
  lineHeight: 1.0,
  bulletGap: 1,
  allowJobWrap: true,
};
