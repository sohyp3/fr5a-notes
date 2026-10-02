import { describe, expect, it } from 'vitest';
import { blockedReason, isLocalOnly } from './privacy';
import { estimateTokens, fitHistory, truncateToTokens } from './context';
import { allowedTools, BUILTIN_SKILLS, loadSkillTree, parseSkill, serializeSkill } from './skills';
import { DEFAULT_AI_CONFIG, type ChatMessage, type ProviderProfile } from './types';

const remote: ProviderProfile = {
	id: 'r',
	name: 'Remote',
	baseUrl: 'https://x',
	model: 'm',
	local: false,
	tools: true,
	contextTokens: 1000
};
const config = { ...DEFAULT_AI_CONFIG, localOnlyFolders: ['private'] };

describe('privacy', () => {
	it('blocks local-only notes for remote providers only', () => {
		expect(isLocalOnly('private/a.md', '', config)).toBe(true);
		expect(isLocalOnly('private/deep/a.md', '', config)).toBe(true);
		expect(isLocalOnly('privateer/a.md', '', config)).toBe(false);
		expect(isLocalOnly('a.md', '# x\n<!-- ai: local -->', config)).toBe(true);
		expect(blockedReason('private/a.md', '', remote, config)).toMatch(/local-only/);
		expect(blockedReason('private/a.md', '', { ...remote, local: true }, config)).toBeNull();
		expect(blockedReason('a.md', 'hi', remote, config)).toBeNull();
	});
});

describe('context', () => {
	it('estimates and truncates', () => {
		expect(estimateTokens('abcd'.repeat(10))).toBe(10);
		const cut = truncateToTokens('word '.repeat(1000), 50);
		expect(estimateTokens(cut)).toBeLessThan(70);
		expect(cut).toContain('truncated');
	});

	it('keeps system + newest messages and drops orphaned tool results', () => {
		const big = 'x'.repeat(400); // ~100 tokens
		const msgs: ChatMessage[] = [
			{ role: 'system', content: 'sys' },
			{ role: 'user', content: big },
			{ role: 'assistant', content: null, tool_calls: [{ id: 'c', name: 't', arguments: '{}' }] },
			{ role: 'tool', tool_call_id: 'c', content: big },
			{ role: 'assistant', content: big },
			{ role: 'user', content: 'last' }
		];
		const kept = fitHistory(msgs, 230);
		expect(kept[0].role).toBe('system');
		expect(kept[1].role).not.toBe('tool');
		expect(kept.at(-1)).toEqual({ role: 'user', content: 'last' });
		expect(fitHistory(msgs, 100000)).toEqual(msgs);
	});
});

describe('skills', () => {
	it('round-trips built-ins and filters tools', () => {
		for (const s of BUILTIN_SKILLS)
			expect(parseSkill(`${s.name}.md`, serializeSkill(s))).toEqual(s);
		const all = [{ name: 'read_note' }, { name: 'web_search' }];
		const summarize = BUILTIN_SKILLS.find((s) => s.name === 'summarize')!;
		expect(allowedTools(summarize, all, (t) => t.name)).toEqual([{ name: 'read_note' }]);
		expect(allowedTools(null, all, (t) => t.name)).toEqual(all);
	});

	it('defaults name and output from the file', () => {
		const s = parseSkill('mine.md', 'Just a prompt');
		expect(s).toMatchObject({ name: 'mine', output: 'chat', tools: null, prompt: 'Just a prompt' });
	});
});

describe('loadSkillTree', () => {
	it('loads loose skills and git packs (SKILL.md folders), first name wins', async () => {
		const files: Record<string, string> = {
			'skills/mine.md': '---\nname: outline\ndescription: mine\n---\nmy prompt',
			'skills/pack/README.md': '# readme',
			'skills/pack/outline.md': '---\nname: outline\n---\nshadowed',
			'skills/pack/skills/pdf/SKILL.md': '---\nname: pdf\ndescription: PDFs\n---\nUse pdf tools',
			'skills/pack/skills/pdf/reference.md': 'not a skill',
			'skills/pack/.git/HEAD.md': 'ignored'
		};
		const fs = {
			async list(dir: string) {
				const kids = new Set<string>();
				for (const k of Object.keys(files)) {
					if (!k.startsWith(`${dir}/`)) continue;
					const rest = k.slice(dir.length + 1);
					kids.add(rest.includes('/') ? `${rest.split('/')[0]}/` : rest);
				}
				return [...kids];
			},
			read: async (p: string) => files[p] ?? null
		};
		const skills = await loadSkillTree(fs);
		expect(skills.map((s) => [s.name, s.prompt, s.source])).toEqual([
			['outline', 'my prompt', 'skills/mine.md'],
			['pdf', 'Use pdf tools', 'skills/pack/skills/pdf/SKILL.md']
		]);
	});
});
