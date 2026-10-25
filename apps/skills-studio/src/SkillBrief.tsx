import React from 'react';
import { ArrowUpRight, X } from 'lucide-react';

type Skill = { name: string; category: string; description: string; example?: string; available: boolean };

export function SkillBrief({ skill, onRemove, onExample, busy = false }: { skill: Skill; onRemove: () => void; onExample: () => void; busy?: boolean }) {
    return <div className="skill-brief">
        <div className="skill-brief-heading"><span className="mono">{skill.category} / Selected skill</span><button onClick={onRemove} disabled={busy} aria-label="Remove selected skill"><X size={16}/></button></div>
        <h2>{skill.name}</h2><p>{skill.description}</p>
        {skill.example && skill.available && <button className="skill-example" onClick={onExample} disabled={busy}><span><span className="mono">Try a starting point</span>{skill.example}</span><ArrowUpRight size={17}/></button>}
        {!skill.available && <p role="status">This skill needs setup before you can start.</p>}
    </div>;
}
