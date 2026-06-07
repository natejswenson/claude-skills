import { z } from "zod";

export const OptimizedBullet = z.object({
  original: z.string(),
  rewritten: z.string(),
  role: z.string(),
});

export type OptimizedBullet = z.infer<typeof OptimizedBullet>;

export const ResumeJSON = z.object({
  name: z.string().min(1),
  contact: z.object({
    email: z.string().optional(),
    phone: z.string().optional(),
    location: z.string().optional(),
    links: z.array(z.string()).default([]),
  }),
  summary: z.string(),
  experience: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      location: z.string().optional(),
      startDate: z.string(),
      endDate: z.string(),
      bullets: z.array(z.string()),
    }),
  ),
  skills: z.array(z.string()),
  education: z.array(
    z.object({
      degree: z.string(),
      school: z.string(),
      year: z.string().optional(),
      details: z.string().optional(),
    }),
  ),
  droppedBullets: z.array(z.string()).default([]),
  optimizedBullets: z.array(OptimizedBullet).default([]),
});

export type ResumeJSON = z.infer<typeof ResumeJSON>;
