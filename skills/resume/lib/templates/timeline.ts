import type { TemplateConfig } from './types';

export const timeline: TemplateConfig = {
  name: 'timeline',
  label: 'Timeline',
  description: 'Dates in a left gutter along an accent rail — enhancv-style chronology',
  layout: 'timeline',
  header: 'centered',
  contactSeparator: '·',
  timeline: {
    gutterWidth: 70,
    ruleColor: '#0e7c66',
    ruleWidth: 1,
  },
  pdf: {
    fontFamily: 'Helvetica',
    fontFamilyBold: 'Helvetica-Bold',
    fontSize: 10,
    nameFontSize: 22,
    sectionFontSize: 10.5,
    pageMargin: { top: 40, bottom: 36, horizontal: 48 },
  },
  html: { fontFamily: "system-ui, -apple-system, sans-serif" },
  colors: {
    foreground: '#111',
    muted: '#555',
    accent: '#0e7c66',
    border: '#d4d4d8',
  },
  sectionHeading: {
    uppercase: true,
    letterSpacing: 0.14,
    borderBottom: false,
    accentColored: true,
  },
  bullet: { character: '\u2013', indent: 8 },
  sectionGap: 14,
  jobGap: 12,
  lineHeight: 1.0,
  bulletGap: 2,
  allowJobWrap: true,
};
