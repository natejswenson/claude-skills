import React from 'react';
import { ArrowUpRight } from 'lucide-react';

type SearchSkill = { id: string; name: string; description: string };
type Props<T extends SearchSkill> = { skills: T[]; query: string; onChoose: (skill: T) => void; onClear: () => void };
export function SkillSearchResults<T extends SearchSkill>({ skills, query, onChoose, onClear }: Props<T>) {
    const matches = skills.filter(skill => `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase()));
    return <>
        <p className="palette-count mono" role="status">{matches.length} {matches.length === 1 ? 'skill' : 'skills'}</p>
        <div className="palette-results">
            {matches.map(skill => <button key={skill.id} onClick={() => onChoose(skill)}><div><strong>{skill.name}</strong><span>{skill.description}</span></div><ArrowUpRight size={17}/></button>)}
            {!matches.length && <div className="palette-empty"><h2>No skills found</h2><p>Try another name or describe what you want to make.</p><button className="text-button" onClick={onClear}>Clear search</button></div>}
        </div>
    </>;
}
