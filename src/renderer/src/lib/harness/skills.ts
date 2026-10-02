import { list, parseFrontmatter, str, stringifyFrontmatter } from './frontmatter';

/**
 * Skills are Markdown files in `.fr5a/skills/`: frontmatter (name,
 * description, allowed tools, output mode, optional provider) plus a body that
 * becomes the system prompt. Built-ins are seeded once into an empty folder and
 * are then ordinary, editable, synced files.
 */

export const SKILLS_DIR = 'skills';

export type SkillOutput = 'chat' | 'insert' | 'new-note';

export interface Skill {
	/** Invocation name: `/name`. */
	name: string;
	description: string;
	/** Allowed tool names; `null` = every tool. */
	tools: string[] | null;
	output: SkillOutput;
	/** Provider profile id to prefer, if set. */
	provider: string;
	prompt: string;
	/** Where it was loaded from, relative to `.fr5a/` (set by the loader). */
	source?: string;
}

const OUTPUTS: SkillOutput[] = ['chat', 'insert', 'new-note'];

export function parseSkill(file: string, text: string): Skill {
	const { data, body } = parseFrontmatter(text);
	const tools = data.tools === undefined ? null : list(data.tools);
	const output = str(data.output) as SkillOutput;
	return {
		name: (str(data.name) || file.replace(/\.md$/, '')).replace(/^\//, ''),
		description: str(data.description),
		tools: tools && tools.includes('*') ? null : tools,
		output: OUTPUTS.includes(output) ? output : 'chat',
		provider: str(data.provider),
		prompt: body.trim()
	};
}

export function serializeSkill(s: Skill): string {
	return (
		stringifyFrontmatter({
			name: s.name,
			description: s.description,
			tools: s.tools ?? ['*'],
			output: s.output,
			provider: s.provider || undefined
		}) +
		'\n' +
		s.prompt +
		'\n'
	);
}

/** Not skills, even though they're Markdown (repo boilerplate in skill packs). */
const NOT_SKILLS =
	/^(readme|license|licence|changelog|contributing|code_of_conduct|security|agents|claude)\.md$/i;
const MAX_DEPTH = 3;

export interface SkillFiles {
	/** Entries of a `.fr5a/` folder: files, then folders as `name/`. */
	list(rel: string): Promise<string[]>;
	read(rel: string): Promise<string | null>;
}

/**
 * Every skill under `.fr5a/skills/`: loose `*.md` files, plus packs cloned
 * from git (any depth up to 3). A folder holding `SKILL.md` is ONE skill named
 * after the folder (the Claude-style layout; its other files are references,
 * not skills). First name wins, so your own top-level files shadow packs.
 */
export async function loadSkillTree(fs: SkillFiles, dir = SKILLS_DIR, depth = 0): Promise<Skill[]> {
	const entries = await fs.list(dir).catch(() => [] as string[]);
	if (depth > 0 && entries.includes('SKILL.md')) {
		const text = await fs.read(`${dir}/SKILL.md`);
		const folder = dir.slice(dir.lastIndexOf('/') + 1);
		return text === null
			? []
			: [{ ...parseSkill(`${folder}.md`, text), source: `${dir}/SKILL.md` }];
	}
	const files = entries.filter((e) => e.toLowerCase().endsWith('.md') && !NOT_SKILLS.test(e));
	const out = (
		await Promise.all(
			files.map(async (f): Promise<Skill | null> => {
				const text = await fs.read(`${dir}/${f}`);
				return text === null ? null : { ...parseSkill(f, text), source: `${dir}/${f}` };
			})
		)
	).filter((s): s is Skill => !!s);
	if (depth < MAX_DEPTH) {
		const dirs = entries.filter((e) => e.endsWith('/') && !e.startsWith('.'));
		for (const d of dirs)
			out.push(...(await loadSkillTree(fs, `${dir}/${d.slice(0, -1)}`, depth + 1)));
	}
	if (depth > 0) return out;
	const seen = new Set<string>();
	return out
		.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** Marker so built-ins are seeded once; deleted built-ins stay deleted. */
export const SEEDED_MARKER = `${SKILLS_DIR}/.seeded`;

/** Tools a skill may use, from the full set. */
export function allowedTools<T>(skill: Skill | null, all: T[], nameOf: (t: T) => string): T[] {
	if (!skill || skill.tools === null) return all;
	const set = new Set(skill.tools);
	return all.filter((t) => set.has(nameOf(t)));
}

const NOTE_TOOLS = ['read_note', 'list_notes', 'search_notes', 'ask_user'];
const WEB_TOOLS = ['web_search', 'fetch_url'];

export const BUILTIN_SKILLS: Skill[] = [
	{
		name: 'clarify',
		description: 'Interview me and turn rough notes into a clear spec',
		tools: [...NOTE_TOOLS, 'write_note'],
		output: 'chat',
		provider: '',
		prompt: `Help the user turn rough ideas in the attached note into a clear plan or spec.

1. Read the note. Summarise in 2-3 lines what you think they want.
2. Ask the most important open questions ONE AT A TIME with ask_user, offering 2-4 concrete options each (the user can always type their own). Prefer questions whose answer changes the result.
3. After at most ~5 questions, propose a structured spec: goal, features (must / later), open risks, next steps.
4. Offer to write it with write_note (new note, or appended under a heading). Never write without being asked.`
	},
	{
		name: 'outline',
		description: 'Propose an article outline from the note',
		tools: NOTE_TOOLS,
		output: 'chat',
		provider: '',
		prompt: `Draft an outline for an article based on the attached note.
Ask with ask_user who the audience is and what the single main point should be, unless the note already makes it clear.
Return a Markdown outline: working title, one-sentence thesis, H2 sections with 2-4 bullet points each, and a list of claims that will need sources.`
	},
	{
		name: 'draft',
		description: 'Write or expand a section in my voice',
		tools: [...NOTE_TOOLS, 'write_note'],
		output: 'insert',
		provider: '',
		prompt: `Write prose for the user's article. Match the tone, language and formatting of the attached note (if the note is Arabic, write Arabic).
If it's unclear which section to write, ask with ask_user listing the candidate sections.
Output only the Markdown text to insert — no preamble, no closing remarks.`
	},
	{
		name: 'critique',
		description: 'Honest editorial feedback',
		tools: NOTE_TOOLS,
		output: 'chat',
		provider: '',
		prompt: `Act as a sharp, kind editor. Review the attached note for: unclear argument, weak structure, unsupported claims, repetition, and wordiness.
Give the 3-7 most valuable points, most important first, each with a quote of the passage and a concrete rewrite suggestion. Don't rewrite the whole piece.`
	},
	{
		name: 'sources',
		description: 'Find sources for the claims in the note',
		tools: [...NOTE_TOOLS, ...WEB_TOOLS],
		output: 'chat',
		provider: '',
		prompt: `Find good sources for the attached note.
List the key factual claims, search the web for each (web_search; fetch_url to read the most promising pages), and prefer primary sources, papers, official data and reputable outlets.
Return a Markdown list per claim: the claim, then 1-3 sources as [title](url) with one line on what each supports. Say clearly when you found nothing solid.`
	},
	{
		name: 'fact-check',
		description: 'Check each claim against the web',
		tools: [...NOTE_TOOLS, ...WEB_TOOLS],
		output: 'chat',
		provider: '',
		prompt: `Fact-check the attached note.
1. Extract every checkable factual claim (numbers, dates, names, causal claims). Skip opinions.
2. For each, web_search and read at least one source with fetch_url when the snippet isn't conclusive.
3. Return a Markdown table: | Claim | Verdict | Evidence | Source |, where Verdict is one of ✅ supported, ⚠️ partly / needs nuance, ❌ contradicted, ❓ unverified. Keep Evidence to one sentence; Source is a [title](url) link.
4. End with suggested corrections for anything ⚠️ or ❌. Never invent sources — if you couldn't verify, say ❓.`
	},
	{
		name: 'summarize',
		description: 'Summarise the note',
		tools: ['read_note'],
		output: 'chat',
		provider: '',
		prompt: `Summarise the attached note in the same language it is written in: a one-line TL;DR, then 3-6 bullet points of the key ideas, then any open questions or TODOs found in it.`
	}
];
