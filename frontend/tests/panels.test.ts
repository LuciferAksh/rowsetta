import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type {
  Evaluation,
  LeafLine,
  TablePage,
  WorkspaceState,
} from '../src/backend/types';
import EvalPanel from '../src/EvalPanel.svelte';
import { evaluationText, recallText } from '../src/evaluation';
import { NO_PROPOSALS } from '../src/labelling';
import LeakList from '../src/LeakList.svelte';
import { disagreements, lineFilter, ruleLineText } from '../src/rule';
import RuleView from '../src/RuleView.svelte';
import { Studio } from '../src/state.svelte';
import TableView from '../src/TableView.svelte';
import TargetPicker from '../src/TargetPicker.svelte';
import { fakeBackend } from './fake-backend';

const STATE: WorkspaceState = {
  loaded: true,
  notice: null,
  target: 'y',
  classes: ['no', 'yes'],
  human: { '0': 'no', '1': 'yes' },
  eval_count: 3,
  threshold: 0.6,
  excluded_columns: [],
  generation: 4,
  refit_generation: 4,
  proposals: { '2': 'yes', '3': 'no' },
  confidence: { '2': 0.9, '3': 0.4 },
  abstained: [3],
  missing: {},
  next_row: 2,
  evaluation: null,
  failure: null,
  dev_states: false,
};

const PAGE: TablePage = {
  rows: [{ age: 30 }, { age: 41 }, { age: 52 }, { age: 63 }],
  row_ids: [0, 1, 2, 3],
  columns: [
    { name: 'age', kind: 'numeric', distinct_ratio: 0.2, missing_ratio: 0 },
  ],
  total: 4,
  source_rows: 4,
  page: 0,
  size: 100,
};

const EVALUATION: Evaluation = {
  n: 24,
  accuracy: { kind: 'measured', value: 0.875, lo: 0.69, hi: 0.957 },
  balanced_accuracy: { kind: 'needs_rows', counts: { no: 22, yes: 2 } },
  per_class_recall: { no: 0.909, yes: null },
  majority_class: 'no',
  majority_baseline: 0.917,
};

const ANSWERING: LeafLine = {
  line_no: 1,
  conditions: [
    ['duration', 'IS NULL OR <=', '524.5'],
    ['poutcome', '=', "'success'"],
  ],
  label: 'yes',
  row_ids: [0, 2],
  agree: { k: 1, n: 2, coverage: { answered: 2, total: 2 } },
};

const ABSTAINING: LeafLine = {
  line_no: 2,
  conditions: [],
  label: null,
  row_ids: [1, 3],
  agree: { k: 0, n: 0, coverage: { answered: 0, total: 2 } },
};

const LINES = [ANSWERING, ABSTAINING];

async function studioWith(state: WorkspaceState = STATE): Promise<Studio> {
  const studio = new Studio(
    fakeBackend([], {
      tablePage: () => Promise.resolve(PAGE),
      distill: () => Promise.resolve({ leaf_summary: LINES, generation: 4 }),
      audit: () =>
        Promise.resolve([
          {
            column: 'y_after',
            kind: 'single-column',
            reason: '`y_after` alone predicts the label 100% of the time.',
            score: 1,
          },
          {
            column: 'y_after',
            kind: 'name',
            reason:
              'The name of `y_after` suggests an identifier or an outcome.',
            score: null,
          },
        ]),
    }).backend,
  );
  await studio.apply(Promise.resolve(state));
  await studio.showPage(0);
  return studio;
}

describe('evaluation text', () => {
  it('asks for twenty evaluation rows before any figure', () => {
    expect(evaluationText(null, 3)).toEqual([
      'Label 20 evaluation rows to see accuracy (3 so far).',
    ]);
  });

  it('gives accuracy with its interval, the baseline, and what balanced accuracy still needs', () => {
    expect(evaluationText(EVALUATION, 24)).toEqual([
      '24 evaluation rows. Accuracy 88% (95% CI 69% to 96%).',
      'Balanced accuracy needs 5 evaluation rows of each class (yes: 2 so far).',
      'Always guessing no would score 92%.',
    ]);
  });

  it('gives balanced accuracy once every class has five rows', () => {
    const measured: Evaluation = {
      ...EVALUATION,
      balanced_accuracy: { kind: 'measured', value: 0.8, lo: 0.7, hi: 0.9 },
    };
    expect(evaluationText(measured, 24)[1]).toBe(
      'Balanced accuracy 80% (70% to 90%).',
    );
  });

  it('withholds a class recall below five rows', () => {
    expect(recallText('no', 0.909)).toBe('no: recall 91%');
    expect(recallText('yes', null)).toBe('yes: recall needs 5 evaluation rows');
  });
});

describe('rule lines', () => {
  it('reads as conditions, answer, rows and agreement', () => {
    expect(ruleLineText(ANSWERING)).toBe(
      "duration IS NULL OR <= 524.5 and poutcome = 'success' → yes: 2 rows, 1 agree with the model",
    );
  });

  it('says when a line abstains or covers every row', () => {
    expect(ruleLineText(ABSTAINING)).toBe(
      'every row → no answer (rule unsure): 2 rows',
    );
  });

  it('filters to the line rows and says so', () => {
    expect(lineFilter(ANSWERING)).toEqual({
      rowIds: [0, 2],
      description: 'Showing 2 rows for rule line 1',
    });
  });

  it('marks rows whose shown answer differs from their line, skipping unsure and abstaining', () => {
    const proposals = {
      ...NO_PROPOSALS,
      labels: { '2': 'yes', '3': 'yes' },
      unsure: new Set([3]),
    };
    const found = disagreements(LINES, { '0': 'no', '1': 'no' }, proposals);
    expect([...found]).toEqual([[0, 1]]);
  });
});

describe('panels', () => {
  it('shows the drop zone hint before any file is chosen', async () => {
    const { body } = render(TargetPicker, {
      props: { studio: await studioWith({ ...STATE, loaded: false }) },
    });
    expect(body).toContain(
      'Numbers and categories are used; free-text columns are skipped.',
    );
    expect(body).toContain('type="file"');
    expect(body).not.toContain('Create target');
  });

  it('offers both kinds of target and clearing human labels', async () => {
    const { body } = render(TargetPicker, {
      props: { studio: await studioWith() },
    });
    expect(body).toContain('Target: y (no, yes). 2 human labels.');
    expect(body).toContain('Use its values as labels');
    expect(body).toContain('Create target');
    expect(body).toContain('Clear all and teach from scratch');
  });

  it('shows evaluation figures, recall per class and the unsure count', async () => {
    const studio = await studioWith({
      ...STATE,
      evaluation: EVALUATION,
      eval_count: 24,
    });
    const { body } = render(EvalPanel, { props: { studio } });
    expect(body).toContain('Accuracy 88% (95% CI 69% to 96%)');
    expect(body).toContain('Always guessing no would score 92%.');
    expect(body).toContain('yes: recall needs 5 evaluation rows');
    expect(body).toMatch(
      /Threshold 0\.60: 1 rows below\s+it\s+are marked unsure\./,
    );
    expect(body).toContain('Evaluate (e)');
  });

  it('lists a flagged column once with each reason, struck once excluded', async () => {
    const studio = await studioWith({
      ...STATE,
      excluded_columns: ['y_after'],
    });
    await studio.checkLeaks();
    const { body } = render(LeakList, { props: { studio } });
    expect(body.match(/<s>y_after<\/s>/g)).toHaveLength(1);
    expect(body).toContain('alone predicts the label');
    expect(body).toContain('suggests an identifier or an outcome');
    expect(body).toContain('Include column y_after');
  });

  it('lists the rule as numbered buttons', async () => {
    const studio = await studioWith();
    await studio.showRule();
    const { body } = render(RuleView, { props: { studio } });
    expect(body.match(/<li><button type="button"/g)).toHaveLength(2);
    expect(body).toContain('Line 2: every row → no answer (rule unsure)');
    expect(body).not.toContain('Labels changed since this rule was fitted.');
  });
});

describe('table during evaluation and with a rule', () => {
  it('leaves rows other than the served one inert', async () => {
    const studio = await studioWith();
    studio.mode = { kind: 'evaluate', row: 2 };
    const { body } = render(TableView, { props: { studio } });
    expect(body.match(/aria-disabled="true"/g)).toHaveLength(3);
    expect(body).toContain('Evaluation row: label it blind');
  });

  it('carries the rule line number on rows that disagree with it', async () => {
    const studio = await studioWith();
    await studio.showRule();
    const { body } = render(TableView, { props: { studio } });
    expect(body).toContain('Rule line 1 disagrees');
    expect(body.match(/disagrees/g)).toHaveLength(1);
  });

  it('says which rows a filter shows and offers every row back', async () => {
    const studio = await studioWith();
    await studio.filterRows(lineFilter(ANSWERING));
    const { body } = render(TableView, { props: { studio } });
    expect(body).toContain('Showing 2 rows for rule line 1.');
    expect(body).toContain('Show all rows');
  });
});
