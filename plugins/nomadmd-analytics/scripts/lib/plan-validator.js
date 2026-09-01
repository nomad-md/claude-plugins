// Offline validator for the subset of JSON Schema the NomadMD Protocols plans
// actually use: type (incl. ["T","null"]), enum, properties, required,
// additionalProperties: false, and items. Deliberately not a general JSON
// Schema implementation — the plans are generated, so the subset is closed.

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value; // 'string' | 'number' | 'boolean' | 'object' | ...
}

function matchesType(expected, value) {
  switch (expected) {
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    default:
      return typeOf(value) === expected;
  }
}

/**
 * Validates `value` against `schema`, appending human-readable errors.
 * @returns {string[]} error messages, empty when valid
 */
export function validateValue(schema, value, path = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(t, value))) {
      errors.push(
        `${path}: expected ${types.join(' or ')}, got ${typeOf(value)}` +
          (typeOf(value) === 'string' || typeOf(value) === 'number'
            ? ` (${JSON.stringify(value)})`
            : ''),
      );
      return errors; // wrong type — nested checks would only add noise
    }
  }

  if (schema.enum !== undefined) {
    const allowed = schema.enum;
    if (!allowed.some((v) => v === value)) {
      errors.push(
        `${path}: ${JSON.stringify(value)} not in enum ` +
          JSON.stringify(allowed),
      );
    }
  }

  if (typeOf(value) === 'object' && schema.properties) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) {
        errors.push(`${path}: missing required property "${key}"`);
      }
    }
    for (const [key, sub] of Object.entries(value)) {
      const subSchema = schema.properties[key];
      if (subSchema) {
        errors.push(...validateValue(subSchema, sub, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: unexpected property "${key}"`);
      }
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => {
      errors.push(...validateValue(schema.items, item, `${path}[${i}]`));
    });
  }

  return errors;
}

/** Finds a plan's TRACK rule by event name; null when the plan lacks it. */
export function findTrackRule(plan, eventName) {
  return (
    plan.rules.find((r) => r.type === 'TRACK' && r.key === eventName) ?? null
  );
}

function findRuleByType(plan, type) {
  return plan.rules.find((r) => r.type === type) ?? null;
}

/**
 * Validates one captured Segment call (track/identify/page/group) against a
 * plan rule's jsonSchema. The plan schema describes {context, properties,
 * traits}; the captured call carries them as top-level fields.
 * @returns {string[]} errors
 */
export function validateCallAgainstRule(rule, call) {
  const errors = [];
  const schema = rule.jsonSchema?.properties ?? {};
  if (call.context !== undefined && schema.context) {
    errors.push(...validateValue(schema.context, call.context, '$.context'));
  }
  if (schema.properties && Object.keys(schema.properties).length > 0) {
    errors.push(
      ...validateValue(schema.properties, call.properties ?? {}, '$.properties'),
    );
  }
  if (
    call.traits !== undefined &&
    schema.traits &&
    Object.keys(schema.traits).length > 0
  ) {
    errors.push(...validateValue(schema.traits, call.traits, '$.traits'));
  }
  return errors;
}

/**
 * Infers a captured call's type: explicit `type` field, else 'track' when an
 * `event` name is present. Single owner of this heuristic.
 */
export function callType(call) {
  return call.type ?? (call.event !== undefined ? 'track' : undefined);
}

/**
 * Validates one captured call against a plan, dispatching on call type.
 * @returns {{rule: string, errors: string[]}|null} null when the plan has no
 * rule for this call (caller decides how to report unknowns)
 */
export function validateCall(plan, call) {
  const type = callType(call);
  if (type === 'track') {
    const rule = findTrackRule(plan, call.event);
    if (!rule) return null;
    return { rule: `TRACK ${call.event}`, errors: validateCallAgainstRule(rule, call) };
  }
  if (type === 'identify' || type === 'group' || type === 'page') {
    const rule = findRuleByType(plan, type.toUpperCase());
    if (!rule) return null;
    return { rule: type.toUpperCase(), errors: validateCallAgainstRule(rule, call) };
  }
  return { rule: '(unrecognized)', errors: [`unrecognized call type ${JSON.stringify(type)}`] };
}
