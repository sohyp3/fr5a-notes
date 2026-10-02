/**
 * ask_user: one call may carry several questions (shown as steps of a single
 * card, like a short form). Models send loosely-shaped arguments, so this
 * normalises both the multi-question form and the older single
 * `{ question, options: string[] }` form.
 */

export interface QuestionOption {
	label: string;
	description?: string;
}

export interface QuestionItem {
	question: string;
	/** Short tab label (a few words). */
	header?: string;
	options: QuestionOption[];
	/** Several options may be picked together. */
	multiSelect: boolean;
}

export const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 6;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

function option(v: unknown): QuestionOption | null {
	if (typeof v === 'string' || typeof v === 'number') {
		const label = str(v);
		return label ? { label } : null;
	}
	if (v && typeof v === 'object') {
		const o = v as Record<string, unknown>;
		const label = str(o.label ?? o.title ?? o.value ?? o.text);
		if (!label) return null;
		const description = str(o.description ?? o.hint);
		return description ? { label, description } : { label };
	}
	return null;
}

function item(v: unknown): QuestionItem | null {
	if (typeof v === 'string')
		return v.trim() ? { question: v.trim(), options: [], multiSelect: false } : null;
	if (!v || typeof v !== 'object') return null;
	const o = v as Record<string, unknown>;
	const question = str(o.question ?? o.text ?? o.prompt);
	if (!question) return null;
	const options = (Array.isArray(o.options) ? o.options : [])
		.map(option)
		.filter((x): x is QuestionOption => x !== null)
		.slice(0, MAX_OPTIONS);
	const header = str(o.header).slice(0, 24);
	return {
		question,
		...(header ? { header } : {}),
		options,
		multiSelect: o.multiSelect === true || o.multi_select === true || o.multiple === true
	};
}

/** Tool arguments → 1..MAX_QUESTIONS questions (empty when nothing usable was sent). */
export function normalizeQuestions(args: Record<string, unknown>): QuestionItem[] {
	const list = Array.isArray(args.questions) ? args.questions : [args];
	return list
		.map(item)
		.filter((x): x is QuestionItem => x !== null)
		.slice(0, MAX_QUESTIONS);
}

/** The tool result the model reads back. */
export function formatAnswers(items: QuestionItem[], answers: string[]): string {
	if (items.length === 1) return `User answered: ${answers[0] ?? ''}`;
	return `User answered:\n${items
		.map((q, i) => `${i + 1}. ${q.question} → ${answers[i] || '(skipped)'}`)
		.join('\n')}`;
}

/** JSON schema for the tool definition. */
export const ASK_USER_PARAMETERS = {
	type: 'object',
	properties: {
		questions: {
			type: 'array',
			description: `1-${MAX_QUESTIONS} related questions, shown together.`,
			items: {
				type: 'object',
				properties: {
					question: { type: 'string', description: 'The full question.' },
					header: { type: 'string', description: 'Very short label, e.g. "Audience".' },
					options: {
						type: 'array',
						description: '2-4 distinct choices.',
						items: {
							type: 'object',
							properties: {
								label: { type: 'string', description: '1-5 words.' },
								description: { type: 'string', description: 'What picking it means.' }
							},
							required: ['label']
						}
					},
					multiSelect: { type: 'boolean', description: 'Allow picking several options.' }
				},
				required: ['question', 'options']
			}
		}
	},
	required: ['questions']
} as const;
