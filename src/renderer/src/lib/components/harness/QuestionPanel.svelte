<script lang="ts">
	import { fly } from 'svelte/transition';
	import type { Question } from '../../harness/harness.svelte';
	import Icon from '../Icon.svelte';
	import { reducedMotion } from '../../portal';

	interface Props {
		question: Question;
		onanswer(answers: string[]): void;
		onstop(): void;
	}

	let { question, onanswer, onstop }: Props = $props();

	const items = $derived(question.items);
	const dur = reducedMotion() ? 0 : 1;

	/** The answers so far: a new ask_user call starts the form over. */
	const form = $derived.by(() => {
		const fresh = $state({
			step: 0,
			/** Picked option labels, per question. */
			picked: items.map((): string[] => []),
			/** Typed "other" answers, per question. */
			other: items.map(() => '')
		});
		return fresh;
	});
	let otherEl = $state<HTMLInputElement | null>(null);

	/** Attachment: focus the panel for each new question, so its keys work at once. */
	function focusPanel(node: HTMLElement): void {
		void items;
		node.focus({ preventScroll: true });
	}

	const item = $derived(items[form.step]);
	const last = $derived(form.step === items.length - 1);

	function answerOf(i: number): string {
		const typed = (form.other[i] ?? '').trim();
		return [...(form.picked[i] ?? []), ...(typed ? [typed] : [])].join(', ');
	}
	const answered = (i: number) => answerOf(i).length > 0;

	function submit(): void {
		onanswer(items.map((_, i) => answerOf(i)));
	}

	function next(): void {
		if (last) submit();
		else form.step++;
	}

	function choose(label: string): void {
		const i = form.step;
		if (item.multiSelect) {
			const cur = form.picked[i];
			form.picked[i] = cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label];
			return;
		}
		form.picked[i] = [label];
		form.other[i] = '';
		// A single pick moves straight on (and a lone question is answered).
		setTimeout(next, items.length === 1 ? 0 : 140 * dur);
	}

	function typed(e: Event): void {
		const v = (e.currentTarget as HTMLInputElement).value;
		form.other[form.step] = v;
		if (!item.multiSelect && v.trim()) form.picked[form.step] = [];
	}

	function onKey(e: KeyboardEvent): void {
		if (e.target instanceof HTMLInputElement) {
			if (e.key === 'Enter' && answered(form.step)) {
				e.preventDefault();
				next();
			}
			return;
		}
		const n = Number(e.key);
		if (n >= 1 && n <= item.options.length) {
			e.preventDefault();
			choose(item.options[n - 1].label);
		} else if (n === item.options.length + 1) {
			e.preventDefault();
			otherEl?.focus();
		} else if (e.key === 'Enter' && answered(form.step)) {
			e.preventDefault();
			next();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onstop();
		}
	}
</script>

<!-- Number keys pick options, Enter goes on, Esc stops: shortcuts over real buttons. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	{@attach focusPanel}
	class="qpanel"
	role="group"
	aria-label="Question from the AI"
	tabindex="-1"
	onkeydown={onKey}
	in:fly={{ y: 16, duration: 200 * dur }}
>
	{#if items.length > 1}
		<div class="steps" role="tablist" aria-label="Questions">
			{#each items as q, i (q)}
				<button
					class={['stepper', { on: i === form.step, done: answered(i) }]}
					role="tab"
					aria-selected={i === form.step}
					onclick={() => (form.step = i)}
				>
					<span class="dot"
						>{#if answered(i) && i !== form.step}<Icon
								name="check"
								size={11}
								stroke={2.6}
							/>{:else}{i + 1}{/if}</span
					>
					<span class="slabel">{q.header || `Question ${i + 1}`}</span>
				</button>
			{/each}
		</div>
	{/if}

	{#key form.step}
		<div class="qbody" in:fly={{ x: 12, duration: 160 * dur }}>
			<h3 class="q" dir="auto">{item.question}</h3>
			{#if item.multiSelect}<p class="hint">Pick all that apply</p>{/if}

			<div class="opts">
				{#each item.options as o, k (o.label)}
					{@const on = form.picked[form.step]?.includes(o.label)}
					<button
						class={['opt', { on }]}
						aria-pressed={on}
						dir="auto"
						onclick={() => choose(o.label)}
					>
						<span class="key" aria-hidden="true">{k + 1}</span>
						<span class="otext">
							<span class="olabel">{o.label}</span>
							{#if o.description}<span class="odesc">{o.description}</span>{/if}
						</span>
						<span class={['mark', { multi: item.multiSelect }]} aria-hidden="true">
							{#if on}<Icon name="check" size={13} stroke={2.6} />{/if}
						</span>
					</button>
				{/each}
				<label class={['opt other', { on: !!form.other[form.step]?.trim() }]}>
					<span class="key" aria-hidden="true">{item.options.length + 1}</span>
					<input
						bind:this={otherEl}
						value={form.other[form.step] ?? ''}
						oninput={typed}
						dir="auto"
						placeholder={item.options.length ? 'Something else… (type it)' : 'Type your answer…'}
						aria-label="Your own answer"
					/>
				</label>
			</div>
		</div>
	{/key}

	<div class="qfoot">
		<button class="ghost" onclick={onstop} title="Stop the run (Esc)">Stop</button>
		<span class="spacer"></span>
		{#if form.step > 0}
			<button class="ghost" onclick={() => form.step--}>Back</button>
		{/if}
		{#if items.length > 1 || item.multiSelect || !item.options.length || form.other[form.step]?.trim()}
			<button class="primary" disabled={!answered(form.step)} onclick={next}>
				{last ? (items.length > 1 ? 'Submit answers' : 'Send') : 'Next'}
			</button>
		{/if}
	</div>
</div>

<style>
	/* Gives way when the pane is short (keyboard up, context open, small sheet):
	   the question scrolls, the steps and buttons stay. */
	.qpanel {
		flex: 0 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		max-height: min(70%, 560px);
		padding: 12px 14px calc(12px + env(safe-area-inset-bottom, 0px));
		background: var(--bg-editor);
		box-shadow:
			0 -1px 0 var(--bg-active),
			0 -10px 28px rgba(0, 0, 0, 0.08);
		outline: none;
	}
	.steps {
		flex: 0 0 auto;
		display: flex;
		gap: 4px;
		margin: 0 -4px 10px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.stepper {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 30px;
		padding: 0 10px 0 6px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-muted);
		white-space: nowrap;
		transition: background var(--dur-fast) ease;
	}
	:global(html[data-touch]) .stepper {
		min-height: 40px;
	}
	.stepper.on {
		background: var(--accent-soft);
		color: var(--text-strong);
	}
	.dot {
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--bg-active);
		font-size: 10.5px;
	}
	.stepper.on .dot,
	.stepper.done .dot {
		background: var(--accent);
		color: #fff;
	}
	.qbody {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
	}
	.q {
		margin: 0 0 4px;
		font-size: 15px;
		font-weight: 650;
		line-height: 1.4;
		color: var(--text-strong);
	}
	:global(html[data-touch]) .q {
		font-size: 16.5px;
	}
	.hint {
		margin: 0 0 6px;
		font-size: 12px;
		color: var(--text-muted);
	}
	.opts {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 10px;
	}
	.opt {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 44px;
		padding: 8px 12px;
		border-radius: 10px;
		background: var(--bg-list);
		box-shadow: inset 0 0 0 1px var(--bg-active);
		text-align: start;
		transition:
			background var(--dur-fast) ease,
			box-shadow var(--dur-fast) ease,
			transform var(--dur-fast) ease;
	}
	:global(html[data-touch]) .opt {
		min-height: 54px;
	}
	.opt:hover {
		background: var(--bg-hover);
	}
	button.opt:active {
		transform: scale(0.99);
	}
	.opt.on {
		background: var(--accent-soft);
		box-shadow: inset 0 0 0 1.5px var(--accent);
	}
	.key {
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 6px;
		background: var(--bg-active);
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-muted);
	}
	.opt.on .key {
		background: var(--accent);
		color: #fff;
	}
	.otext {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.olabel {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-strong);
	}
	:global(html[data-touch]) .olabel {
		font-size: 15.5px;
	}
	.odesc {
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--text-muted);
	}
	.mark {
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1.5px var(--text-faint);
		color: #fff;
	}
	.mark.multi {
		border-radius: 5px;
	}
	.opt.on .mark {
		background: var(--accent);
		box-shadow: none;
	}
	.other {
		cursor: text;
	}
	.other input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: none;
		font: inherit;
		font-size: 14px;
		color: var(--text-strong);
	}
	:global(html[data-touch]) .other input {
		font-size: 16px;
	}
	.other input::placeholder {
		color: var(--text-faint);
	}
	.qfoot {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 12px;
	}
	.spacer {
		flex: 1;
	}
	.qfoot button {
		min-height: 34px;
		padding: 0 16px;
		border-radius: 9px;
		font-size: 13px;
		font-weight: 600;
		transition:
			background var(--dur-fast) ease,
			transform var(--dur-fast) ease;
	}
	:global(html[data-touch]) .qfoot button {
		min-height: 44px;
		font-size: 15px;
	}
	.qfoot button:active:not(:disabled) {
		transform: scale(0.97);
	}
	.ghost {
		color: var(--text-muted);
	}
	.ghost:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.primary {
		background: var(--accent);
		color: #fff;
	}
	.primary:disabled {
		opacity: 0.4;
	}
</style>
