import type { TemplateConfig } from './types';

export const polished: TemplateConfig = {
  name: 'polished',
  label: 'Polished',
  description: 'Elegant two-column with colored sidebar',
  layout: 'sidebar',
  header: 'centered',
  contactSeparator: '·',
  sidebar: {
    width: 170,
    backgroundColor: '#1a365d',
    textColor: '#ffffff',
    mutedColor: 'rgba(255,255,255,0.7)',
    position: 'left',
  },
  pdf: {
    fontFamily: 'Helvetica',
    fontFamilyBold: 'Helvetica-Bold',
    fontSize: 9.5,
    nameFontSize: 20,
    sectionFontSize: 10,
    pageMargin: { top: 0, bottom: 0, horizontal: 0 },
  },
  html: { fontFamily: "system-ui, -apple-system, sans-serif" },
  colors: {
    foreground: '#111',
    muted: '#444',
    accent: '#1a365d',
    border: '#e2e8f0',
  },
  sectionHeading: {
    uppercase: true,
    letterSpacing: 0.12,
    borderBottom: false,
    accentColored: true,
  },
  bullet: { character: '–', indent: 6 },
  sectionGap: 12,
  jobGap: 8,
  lineHeight: 1.0,
  bulletGap: 2,
  allowJobWrap: false,
};
