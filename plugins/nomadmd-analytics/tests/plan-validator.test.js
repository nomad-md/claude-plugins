import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  findTrackRule,
  validateCall,
  validateValue,
} from '../scripts/lib/plan-validator.js';

test('type checks: integer vs number vs string', () => {
  assert.deepEqual(validateValue({ type: 'integer' }, 42), []);
  assert.match(validateValue({ type: 'integer' }, 4.2)[0], /expected integer/);
  assert.match(validateValue({ type: 'integer' }, '42')[0], /expected integer/);
  assert.deepEqual(validateValue({ type: 'number' }, 4.2), []);
  assert.match(validateValue({ type: 'string' }, 42)[0], /expected string/);
  assert.deepEqual(validateValue({ type: 'boolean' }, false), []);
});

test('nullable union types accept null', () => {
  const schema = { type: ['string', 'null'] };
  assert.deepEqual(validateValue(schema, null), []);
  assert.deepEqual(validateValue(schema, 'x'), []);
  assert.match(validateValue(schema, 3)[0], /expected string or null/);
});

test('enum membership', () => {
  const schema = { type: 'string', enum: ['a', 'b'] };
  assert.deepEqual(validateValue(schema, 'a'), []);
  assert.match(validateValue(schema, 'c')[0], /not in enum/);
});

test('required and additionalProperties', () => {
  const schema = {
    type: 'object',
    properties: { a: { type: 'integer' } },
    required: ['a'],
    additionalProperties: false,
  };
  assert.deepEqual(validateValue(schema, { a: 1 }), []);
  assert.match(validateValue(schema, {})[0], /missing required property "a"/);
  assert.match(
    validateValue(schema, { a: 1, b: 2 })[0],
    /unexpected property "b"/,
  );
});

test('array items validate individually with index paths', () => {
  const schema = {
    type: 'array',
    items: { type: 'object', properties: { x: { type: 'integer' } } },
  };
  const errors = validateValue(schema, [{ x: 1 }, { x: 'nope' }]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^\$\[1\]\.x:/);
});

test('wrong type short-circuits nested checks', () => {
  const schema = {
    type: 'object',
    properties: { a: { type: 'integer' } },
    required: ['a'],
  };
  const errors = validateValue(schema, 'not-an-object');
  assert.equal(errors.length, 1);
});

const MINI_PLAN = {
  rules: [
    {
      type: 'TRACK',
      key: 'Signed In',
      jsonSchema: {
        type: 'object',
        properties: {
          context: {
            type: 'object',
            properties: { schema_version: { type: 'string', enum: ['2.0'] } },
            required: ['schema_version'],
          },
          traits: {},
          properties: {
            type: 'object',
            properties: { method: { type: 'string', enum: ['password'] } },
            required: ['method'],
            additionalProperties: false,
          },
        },
      },
    },
    {
      type: 'IDENTIFY',
      key: '',
      jsonSchema: {
        type: 'object',
        properties: {
          context: {},
          properties: {},
          traits: {
            type: 'object',
            properties: { email: { type: 'string' } },
            additionalProperties: false,
          },
        },
      },
    },
  ],
};

test('validateCall: valid track passes, unknown track returns null', () => {
  const ok = validateCall(MINI_PLAN, {
    type: 'track',
    event: 'Signed In',
    context: { schema_version: '2.0' },
    properties: { method: 'password' },
  });
  assert.deepEqual(ok.errors, []);
  assert.equal(validateCall(MINI_PLAN, { type: 'track', event: 'Nope' }), null);
});

test('validateCall: missing required property and context enum surface', () => {
  const bad = validateCall(MINI_PLAN, {
    type: 'track',
    event: 'Signed In',
    context: { schema_version: '1.0' },
    properties: {},
  });
  assert.equal(bad.errors.length, 2);
  assert.match(bad.errors[0], /\$\.context\.schema_version/);
  assert.match(bad.errors[1], /missing required property "method"/);
});

test('validateCall: identify validates traits', () => {
  const bad = validateCall(MINI_PLAN, {
    type: 'identify',
    traits: { email: 'a@b.c', bogus: true },
  });
  assert.match(bad.errors[0], /unexpected property "bogus"/);
});

test('findTrackRule finds by key only among TRACK rules', () => {
  assert.ok(findTrackRule(MINI_PLAN, 'Signed In'));
  assert.equal(findTrackRule(MINI_PLAN, ''), null);
});
