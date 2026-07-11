export type TemplateName =
  | 'modern'
  | 'classic'
  | 'technical'
  | 'polished'
  | 'timeline'
  | 'editorial'
  | 'spotlight';

/**
 * Type-only mirror of the runtime zod contract in scripts/validate.mjs's
 * `ResumeJSON`. This is dev-time/editor support only — the TSX loader
 * transpiles without type-checking, so this type is never enforced at
 * runtime. The single source of truth for the actual runtime shape is
 * scripts/validate.mjs; keep this in sync if that schema changes.
 */
export interface ResumeJSON {
  name: string;
  contact: {
    email?: string;
    phone?: string;
    location?: string;
    links: string[];
  };
  summary: string;
  experience: Array<{
    title: string;
    company: string;
    location?: string;
    startDate: string;
    endDate: string;
    bullets: string[];
  }>;
  skills: string[];
  education: Array<{
    degree: string;
    school: string;
    year?: string;
    details?: string;
  }>;
  droppedBullets: string[];
  optimizedBullets: Array<{ original: string; rewritten: string; role: string }>;
}

export interface TemplateConfig {
  name: TemplateName;
  label: string;
  description: string;

  layout: 'single-column' | 'sidebar' | 'timeline';
  header: 'centered' | 'split' | 'band';
  contactSeparator: string;

  sidebar?: {
    width: number;          // PDF points
    backgroundColor: string;
    textColor: string;
    mutedColor: string;
    position: 'left';
  };

  /** Spotlight-style full-width colored header band. */
  band?: {
    backgroundColor: string;
    textColor: string;
    mutedColor: string;
    height: number;
  };

  /** Timeline-style left-gutter chronology rail. */
  timeline?: {
    gutterWidth: number;
    ruleColor: string;
    ruleWidth: number;
  };

  pdf: {
    fontFamily: string;
    fontFamilyBold: string;
    fontFamilyItalic?: string;
    fontSize: number;
    nameFontSize: number;
    sectionFontSize: number;
    pageMargin: { top: number; bottom: number; horizontal: number };
  };
  html: {
    fontFamily: string;
  };

  colors: {
    foreground: string;
    muted: string;
    accent: string;
    border: string;
  };

  sectionHeading: {
    uppercase: boolean;
    letterSpacing: number;
    borderBottom: boolean;
    accentColored: boolean;
  };

  bullet: {
    character: string;
    indent: number;
  };

  sectionGap: number;
  jobGap: number;
  lineHeight: number;
  bulletGap: number;
  allowJobWrap: boolean;
}
