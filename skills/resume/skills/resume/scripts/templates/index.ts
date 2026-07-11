export type { TemplateName, TemplateConfig, ResumeJSON } from './types';

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
