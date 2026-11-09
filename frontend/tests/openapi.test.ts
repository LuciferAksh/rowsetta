import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BackendError, createBackend } from '../src/backend/http';
import {
  EXPORT_FORMATS,
  LABEL_MODES,
  SQL_DIALECTS,
  type DistillInput,
  type ExclusionInput,
  type LabelInput,
  type TargetInput,
  type ThresholdInput,
} from '../src/backend/types';

// Regenerate with: uv run python scripts/export_openapi.py > frontend/tests/openapi.json
const openapi: unknown = JSON.parse(
  readFileSync(new URL('openapi.json', import.meta.url), 'utf8'),
);

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function at(value: unknown, ...keys: string[]): Json {
  let current = value;
  for (const key of keys) {
    if (!isJson(current)) {
      throw new Error(`openapi.json: no object at ${keys.join('.')}`);
    }
    current = current[key];
  }
  if (!isJson(current)) {
    throw new Error(`openapi.json: no object at ${keys.join('.')}`);
  }
  return current;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

// The wire type a TypeScript field must have. TypeScript cannot tell integers
// from floats, so the test pins which one each number field is.
type WireType<V> = [V] extends [string]
  ? 'string'
  : [V] extends [number]
    ? 'number' | 'integer'
    : [V] extends [boolean]
      ? 'boolean'
      : [V] extends [readonly (infer Item)[]]
        ? `array<${WireType<Item>}>`
        : never;

type FieldShapes<T> = {
  [K in keyof T]-?: {
    type: WireType<NonNullable<T[K]>>;
    nullable: null extends T[K] ? true : false;
    required: Pick<T, K> extends Required<Pick<T, K>> ? true : false;
  };
};

const requestBodies = {
  DistillInput: {
    max_depth: { type: 'integer', nullable: false, required: false },
  } satisfies FieldShapes<DistillInput>,
  ExclusionInput: {
    excluded: { type: 'boolean', nullable: false, required: true },
  } satisfies FieldShapes<ExclusionInput>,
  LabelInput: {
    label: { type: 'string', nullable: true, required: true },
    mode: { type: 'string', nullable: false, required: false },
  } satisfies FieldShapes<LabelInput>,
  TargetInput: {
    target: { type: 'string', nullable: false, required: true },
    classes: { type: 'array<string>', nullable: false, required: true },
  } satisfies FieldShapes<TargetInput>,
  ThresholdInput: {
    threshold: { type: 'number', nullable: false, required: true },
  } satisfies FieldShapes<ThresholdInput>,
};

function wireType(property: Json): string {
  const type = property['type'];
  if (type === 'array') {
    return `array<${wireType(at(property, 'items'))}>`;
  }
  if (typeof type !== 'string') {
    throw new Error(
      `openapi.json: untyped property ${JSON.stringify(property)}`,
    );
  }
  return type;
}

function fieldShape(property: Json, required: boolean) {
  const variants = Array.isArray(property['anyOf'])
    ? property['anyOf'].filter(isJson)
    : [property];
  const present = variants.filter((variant) => variant['type'] !== 'null');
  const [only] = present;
  if (only === undefined || present.length !== 1) {
    throw new Error(
      `openapi.json: ambiguous property ${JSON.stringify(property)}`,
    );
  }
  return {
    type: wireType(only),
    nullable: present.length !== variants.length,
    required,
  };
}

function servedFields(schemaName: string) {
  const schema = at(openapi, 'components', 'schemas', schemaName);
  const required = strings(schema['required']);
  return Object.fromEntries(
    Object.entries(at(schema, 'properties')).map(([name, property]) => {
      if (!isJson(property)) {
        throw new Error(`openapi.json: ${schemaName}.${name} is not a schema`);
      }
      return [name, fieldShape(property, required.includes(name))];
    }),
  );
}

describe('request bodies match the served OpenAPI schema', () => {
  it.each(Object.entries(requestBodies))(
    '%s has the same field names, types, nullability and optionality',
    (schemaName, fields) => {
      expect(servedFields(schemaName)).toEqual(fields);
    },
  );

  it('declares a type for every input model the backend validates', () => {
    const served = Object.keys(at(openapi, 'components', 'schemas')).filter(
      (name) => name.endsWith('Input'),
    );

    expect(served.sort()).toEqual(Object.keys(requestBodies).sort());
  });

  it('uses the served label modes, export formats and SQL dialects', () => {
    const exportParameters = at(openapi, 'paths', '/export', 'get')[
      'parameters'
    ];
    const dialect = Array.isArray(exportParameters)
      ? exportParameters.filter(isJson).find((p) => p['name'] === 'dialect')
      : undefined;

    expect(
      strings(
        at(
          openapi,
          'components',
          'schemas',
          'LabelInput',
          'properties',
          'mode',
        )['enum'],
      ),
    ).toEqual(LABEL_MODES);
    expect(
      strings(at(openapi, 'components', 'schemas', 'ExportFormat')['enum']),
    ).toEqual(EXPORT_FORMATS);
    expect(strings(at(dialect, 'schema')['enum'])).toEqual(SQL_DIALECTS);
  });
});

interface RecordedRequest {
  method: string;
  url: URL;
  body: BodyInit | null | undefined;
}

// Routes the browser reaches without this client: the page itself, a file
// download link, the event stream, and the command-line health probe.
const OUTSIDE_CLIENT = ['GET /', 'GET /events', 'GET /health', 'GET /session'];

function operationKey(request: RecordedRequest): string {
  const templates = Object.keys(at(openapi, 'paths'));
  const template = templates.find((path) =>
    new RegExp(`^${path.replace(/\{[^/]+\}/g, '[^/]+')}$`).test(
      request.url.pathname,
    ),
  );
  if (template === undefined) {
    throw new Error(`no served path matches ${request.url.pathname}`);
  }
  return `${request.method} ${template}`;
}

async function recordEveryRequest(): Promise<RecordedRequest[]> {
  const requests: RecordedRequest[] = [];
  const backend = createBackend((input, init) => {
    requests.push({
      method: init.method ?? 'GET',
      url: new URL(input, 'http://127.0.0.1'),
      body: init.body,
    });
    return Promise.resolve(
      Response.json({ error: 'stub', next_step: 'stub' }, { status: 409 }),
    );
  });
  const calls = [
    () => backend.state(),
    () => backend.loadDemo(),
    () => backend.uploadCsv(new File(['a,b\n1,2\n'], 'rows.csv')),
    () => backend.tablePage({ page: 2, size: 100 }),
    () =>
      backend.setTarget({ target: 'species', classes: ['Adelie', 'Gentoo'] }),
    () => backend.setLabel(7, { label: 'Adelie', mode: 'eval' }),
    () => backend.undo(),
    () => backend.nextEvalRow(),
    () => backend.setExcluded('bill length', { excluded: true }),
    () => backend.setThreshold({ threshold: 0.8 }),
    () => backend.distill({ max_depth: 3 }),
    () => backend.audit(),
    () => backend.exportRule({ format: 'sql', dialect: 'postgres' }),
  ];
  for (const call of calls) {
    await expect(call()).rejects.toBeInstanceOf(BackendError);
  }
  return requests;
}

describe('client requests match served operations', () => {
  it('covers every served operation outside the documented exceptions', async () => {
    const used = new Set((await recordEveryRequest()).map(operationKey));
    const served = Object.entries(at(openapi, 'paths')).flatMap(
      ([path, operations]) =>
        Object.keys(at(operations)).map(
          (method) => `${method.toUpperCase()} ${path}`,
        ),
    );

    expect(served.filter((key) => !used.has(key)).sort()).toEqual(
      OUTSIDE_CLIENT,
    );
  });

  it('sends only declared query parameters and well-typed path parameters', async () => {
    for (const request of await recordEveryRequest()) {
      const [method = '', path = ''] = operationKey(request).split(' ');
      const declared = at(openapi, 'paths', path, method.toLowerCase())[
        'parameters'
      ];
      const parameters = Array.isArray(declared) ? declared.filter(isJson) : [];
      const queryNames = parameters
        .filter((p) => p['in'] === 'query')
        .map((p) => p['name']);

      expect(queryNames).toEqual(
        expect.arrayContaining([...request.url.searchParams.keys()]),
      );
      for (const parameter of parameters.filter((p) => p['in'] === 'path')) {
        const name = parameter['name'];
        if (
          typeof name === 'string' &&
          at(parameter, 'schema')['type'] === 'integer'
        ) {
          const index = path.split('/').indexOf(`{${name}}`);
          expect(request.url.pathname.split('/')[index]).toMatch(/^\d+$/);
        }
      }
    }
  });

  it('sends JSON bodies with exactly the fields their input model accepts', async () => {
    for (const request of await recordEveryRequest()) {
      if (typeof request.body !== 'string') {
        continue;
      }
      const key = operationKey(request);
      const [method = '', path = ''] = key.split(' ');
      const operation = at(openapi, 'paths', path, method.toLowerCase());
      if (!('requestBody' in operation)) {
        // The upload route reads its raw body to bound its size, then validates DemoInput itself.
        expect(key).toBe('POST /table');
        expect(JSON.parse(request.body)).toEqual({ demo: 'penguins' });
        continue;
      }
      const reference = at(
        operation,
        'requestBody',
        'content',
        'application/json',
        'schema',
      )['$ref'];
      const schemaName =
        typeof reference === 'string' ? reference.split('/').at(-1) : undefined;
      const schema = at(openapi, 'components', 'schemas', schemaName ?? '');
      const sent = Object.keys(at(JSON.parse(request.body)));

      expect(Object.keys(at(schema, 'properties'))).toEqual(
        expect.arrayContaining(sent),
      );
      expect(sent).toEqual(expect.arrayContaining(strings(schema['required'])));
    }
  });
});
