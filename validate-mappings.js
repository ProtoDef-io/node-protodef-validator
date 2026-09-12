const { isDeepStrictEqual } = require('util');

const builtinSchemas = Object.assign({},
  require('./ProtoDef/schemas/numeric.json'),
  require('./ProtoDef/schemas/utils.json'),
  require('./ProtoDef/schemas/structures.json'),
  require('./ProtoDef/schemas/conditional.json'),
  require('./ProtoDef/schemas/primitives.json'));
const unknown = { kind: 'unknown' };

function hasParameters(value) {
  if(typeof value === 'string') return value.startsWith('$');
  if(value && typeof value === 'object')
    return Object.keys(value).some(key => hasParameters(value[key]));
  return false;
}

function createChecker(schemas) {
  const builtins = new Set(Object.keys(builtinSchemas).filter(name =>
    isDeepStrictEqual(schemas[name], builtinSchemas[name])));

  function resolve(type, definitions, active) {
    const name = Array.isArray(type) ? type[0] : type;
    const args = Array.isArray(type) ? type[1] : undefined;
    if(typeof name !== 'string' || name.startsWith('$')) return null;
    const definition = definitions.get(name);
    if(Object.prototype.hasOwnProperty.call(builtinSchemas, name)) {
      if(!builtins.has(name) || (definitions.has(name) && definition !== 'native'))
        return null;
      return { name, args, active };
    }
    // A schema describes the shape of a type declaration, not its decoded values.
    if(!definition || definition === 'native' || args !== undefined || active.has(name))
      return null;
    if(hasParameters(definition)) return null;
    const next = new Set(active);
    next.add(name);
    return resolve(definition, definitions, next);
  }

  function fieldAt(compareTo, scope) {
    if(typeof compareTo !== 'string' || compareTo.startsWith('/') || compareTo.startsWith('$'))
      return unknown;
    const parts = compareTo.split('/');
    let current = scope;
    while(parts[0] === '..') {
      if(!current) return unknown;
      current = current.parent;
      parts.shift();
    }
    if(!current || !parts.length || parts.some(part => !part || part === '..' || /^\d+$/.test(part)))
      return unknown;
    let value = current.fields.get(parts.shift()) || unknown;
    for(const part of parts) {
      if(value.kind !== 'container') return unknown;
      value = value.fields.get(part) || unknown;
    }
    return value;
  }

  function checkSwitch(args, scope, path) {
    if(args.compareToValue !== undefined) return;
    const producer = fieldAt(args.compareTo, scope);
    if(producer.kind !== 'mapper') return;
    for(const value of Object.keys(args.fields)) {
      // These keys are runtime references, rather than literal case values.
      if(value.startsWith('/')) continue;
      if(!producer.values.has(value)) {
        throw new Error('Error at ' + path + ': switch compareTo ' +
          JSON.stringify(args.compareTo) + ' has impossible case ' + JSON.stringify(value) +
          ' (not a mapper output)');
      }
    }
  }

  function walk(type, scope, definitions, path, active) {
    const resolved = resolve(type, definitions, active);
    if(!resolved) return unknown;
    const { name, args } = resolved;
    active = resolved.active;
    if(name === 'mapper') {
      if(!args || hasParameters(args)) return unknown;
      return { kind: 'mapper', values: new Set(Object.values(args.mappings)) };
    }
    if(name === 'container') {
      if(!Array.isArray(args)) return unknown;
      const inner = { parent: scope, fields: new Map() };
      args.forEach((field, index) => {
        const fieldPath = path + '[' + index + ']' + (field.name ? '.' + field.name : '');
        // Anonymous values can merge arbitrary names into this container. Their
        // read/write parent contexts need not agree, so do not propagate either.
        if(field.anon) {
          walk(field.type, null, definitions, fieldPath, active);
          inner.fields.clear();
          inner.parent = null;
        } else {
          const value = walk(field.type, inner, definitions, fieldPath, active);
          inner.fields.set(field.name, value);
        }
      });
      return { kind: 'container', fields: inner.fields };
    }
    if(name === 'switch') {
      if(!args || hasParameters(args.compareTo)) return unknown;
      checkSwitch(args, scope, path);
      Object.keys(args.fields).forEach(value =>
        walk(args.fields[value], scope, definitions, path + '.fields[' + JSON.stringify(value) + ']', active));
      if(args.default !== undefined)
        walk(args.default, scope, definitions, path + '.default', active);
      return unknown;
    }
    if(name === 'array') {
      if(args) walk(args.type, scope, definitions, path + '.type', active);
      return unknown;
    }
    if(name === 'option') {
      walk(args, scope, definitions, path + '.type', active);
      return unknown;
    }
    // The remaining intrinsic types do not introduce container fields. Custom
    // types are opaque: their arguments do not establish traversal or scope rules.
    return unknown;
  }

  return walk;
}

function validateType(type, schemas) {
  createChecker(schemas)(type, null, new Map(), 'type', new Set());
}

function validateProtocol(protocol, schemas) {
  const walk = createChecker(schemas);
  function visit(node, inherited, path) {
    const definitions = new Map(inherited);
    const types = node.types || {};
    Object.keys(types).forEach(name => {
      const type = types[name];
      // Type override precedence differs between consumers. Repeated native
      // declarations are harmless; other collisions cannot establish a domain.
      definitions.set(name, inherited.has(name) &&
        !(type === 'native' && inherited.get(name) === 'native') ? null : type);
    });
    Object.keys(types).forEach(name => {
      if(definitions.get(name) === null ||
        (Object.prototype.hasOwnProperty.call(builtinSchemas, name) && types[name] !== 'native') ||
        hasParameters(types[name])) return;
      walk(types[name], null, definitions, path + '.types.' + name, new Set([name]));
    });
    Object.keys(node).forEach(name => {
      if(name !== 'types') visit(node[name], definitions, path + '.' + name);
    });
  }
  visit(protocol, new Map(), 'root');
}

module.exports = { validateType, validateProtocol };
