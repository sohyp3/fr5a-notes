import { describe, expect, it } from 'vitest';
import { formatAnswers, normalizeQuestions } from './questions';

describe('normalizeQuestions', () => {
	it('accepts the single legacy form', () => {
		expect(normalizeQuestions({ question: 'Which?', options: ['A', 'B'] })).toEqual([
			{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }
		]);
	});

	it('accepts several questions with described options', () => {
		const items = normalizeQuestions({
			questions: [
				{
					question: 'Who reads it?',
					header: 'Audience',
					options: [{ label: 'Team', description: 'internal' }, 'Public']
				},
				{ question: 'Sections?', options: ['Intro', 'Body'], multiSelect: true },
				{ nothing: true }
			]
		});
		expect(items).toEqual([
			{
				question: 'Who reads it?',
				header: 'Audience',
				options: [{ label: 'Team', description: 'internal' }, { label: 'Public' }],
				multiSelect: false
			},
			{
				question: 'Sections?',
				options: [{ label: 'Intro' }, { label: 'Body' }],
				multiSelect: true
			}
		]);
	});

	it('caps the number of questions and drops empty ones', () => {
		const many = Array.from({ length: 6 }, (_, i) => ({ question: `q${i}`, options: [] }));
		expect(normalizeQuestions({ questions: many })).toHaveLength(4);
		expect(normalizeQuestions({})).toEqual([]);
	});
});

describe('formatAnswers', () => {
	it('keeps the single-answer shape and numbers several', () => {
		const one = normalizeQuestions({ question: 'Q', options: [] });
		expect(formatAnswers(one, ['A'])).toBe('User answered: A');
		const two = normalizeQuestions({
			questions: [
				{ question: 'Q1', options: [] },
				{ question: 'Q2', options: [] }
			]
		});
		expect(formatAnswers(two, ['A', ''])).toBe('User answered:\n1. Q1 → A\n2. Q2 → (skipped)');
	});
});
