const assert = require('assert');
const Validator = require('./');

let tests = 0;
function test(name, run) {
  try {
    run();
    tests++;
  } catch (error) {
    error.message = name + ': ' + error.message;
    throw error;
  }
}

function mapper(mappings = { 0: 'alpha', 1: 'beta' }) {
  return ['mapper', { type: 'u8', mappings }];
}

function field(name, type) {
  return { name, type };
}

function container(...fields) {
  return ['container', fields];
}

function choice(fields, compareTo = 'kind', defaultType) {
  const options = { compareTo, fields };
  if (defaultType !== undefined) options.default = defaultType;
  return ['switch', options];
}

function packet(payload, kind = mapper()) {
  return container(field('kind', kind), field('payload', payload));
}

function rejects(run, location, comparator, invalidCase) {
  assert.throws(run, error => {
    assert.ok(error.message.includes(location), error.message);
    assert.ok(error.message.includes(JSON.stringify(comparator)), error.message);
    assert.ok(error.message.includes(JSON.stringify(invalidCase)), error.message);
    assert.match(error.message, /mapper/i);
    return true;
  });
}

test('valid cases preserve the success return value', () => {
  assert.strictEqual(new Validator().validateType(packet(choice({ alpha: 'u8', beta: 'void' }))), undefined);
});

test('impossible literal case includes its field location', () => {
  rejects(() => new Validator().validateType(packet(choice({ gamma: 'void' }))), 'payload', 'kind', 'gamma');
});

test('wire keys are not mapper outputs', () => {
  rejects(() => new Validator().validateType(packet(choice({ 0: 'void' }))), 'payload', 'kind', '0');
});

test('a default does not permit an impossible explicit case', () => {
  rejects(() => new Validator().validateType(packet(choice({ gamma: 'void' }, 'kind', 'void'))), 'payload', 'kind', 'gamma');
});

test('partial and empty case coverage are allowed', () => {
  const validator = new Validator();
  validator.validateType(packet(choice({ alpha: 'void' })));
  validator.validateType(packet(choice({ alpha: 'void' }, 'kind', 'u8')));
  validator.validateType(packet(choice({}, 'kind', 'void')));
});

test('numeric-looking output strings remain valid cases', () => {
  new Validator().validateType(packet(choice({ 7: 'void' }), mapper({ 0: '7' })));
});

test('named mapper aliases and chains are resolved', () => {
  rejects(() => new Validator().validateProtocol({ types: {
    Kind: mapper(), Alias: 'Kind', Packet: packet(choice({ gamma: 'void' }), 'Alias')
  } }), 'root.types.Packet', 'kind', 'gamma');
});

test('named container aliases preserve parent references at their use site', () => {
  rejects(() => new Validator().validateProtocol({ types: {
    Body: container(field('payload', choice({ gamma: 'void' }, '../kind'))),
    Packet: packet('Body')
  } }), 'Packet', '../kind', 'gamma');
});

test('preceding named-container paths resolve their child fields', () => {
  rejects(() => new Validator().validateType(container(
    field('header', container(field('kind', mapper()))),
    field('payload', choice({ gamma: 'void' }, 'header/kind'))
  )), 'payload', 'header/kind', 'gamma');
});

test('parent references cross ordinary containers', () => {
  rejects(() => new Validator().validateType(packet(container(
    field('payload', choice({ gamma: 'void' }, '../kind')))
  )), 'payload', '../kind', 'gamma');
});

test('multiple parent references retain the correct frame', () => {
  rejects(() => new Validator().validateType(packet(container(
    field('inner', container(field('payload', choice({ gamma: 'void' }, '../../kind')))))
  )), 'payload', '../../kind', 'gamma');
});

test('bare names do not implicitly search parent containers', () => {
  new Validator().validateType(packet(container(field('payload', choice({ gamma: 'void' })))));
});

test('a local mapper shadows the parent field', () => {
  new Validator().validateType(packet(packet(choice({ gamma: 'void' }), mapper({ 0: 'gamma' }))));
});

test('a local scalar shadows the parent mapper', () => {
  new Validator().validateType(packet(packet(choice({ gamma: 'void' }), 'u8')));
});

test('a later non-mapper field invalidates an earlier same-name mapper', () => {
  new Validator().validateType(container(field('kind', mapper()), field('kind', 'u8'), field('payload', choice({ gamma: 'void' }))));
});

test('future fields and sibling fields are not visible', () => {
  new Validator().validateType(container(field('payload', choice({ gamma: 'void' })), field('kind', mapper())));
  new Validator().validateType(container(
    field('left', container(field('kind', mapper()))),
    field('right', container(field('payload', choice({ gamma: 'void' }))))
  ));
});

test('array and option wrappers do not add container scope', () => {
  for (const wrap of [type => ['array', { count: 1, type }], type => ['option', type]]) {
    rejects(() => new Validator().validateType(packet(wrap(choice({ gamma: 'void' })))), 'payload', 'kind', 'gamma');
    rejects(() => new Validator().validateType(packet(wrap(container(field('payload', choice({ gamma: 'void' }, '../kind')))))), 'payload', '../kind', 'gamma');
  }
});

test('switch branches and defaults retain their container scope', () => {
  rejects(() => new Validator().validateType(packet(choice({ alpha: choice({ gamma: 'void' }) }))), 'payload', 'kind', 'gamma');
  rejects(() => new Validator().validateType(packet(choice({}, 'kind', choice({ gamma: 'void' })))), 'payload', 'kind', 'gamma');
});

test('containers inside switch branches create only their own scope', () => {
  rejects(() => new Validator().validateType(packet(choice({ alpha:
    container(field('payload', choice({ gamma: 'void' }, '../kind')))
  }))), 'payload', '../kind', 'gamma');
});

test('native declarations of standard built-ins retain their meaning', () => {
  rejects(() => new Validator().validateProtocol({ types: {
    mapper: 'native', switch: 'native', container: 'native', u8: 'native', void: 'native',
    Packet: packet(choice({ gamma: 'void' }))
  } }), 'root.types.Packet', 'kind', 'gamma');
});

test('repeated standard native declarations are not ambiguous', () => {
  rejects(() => new Validator().validateProtocol({ types: { mapper: 'native' }, play: { types: {
    mapper: 'native', Packet: packet(choice({ gamma: 'void' }))
  } } }), 'play.types.Packet', 'kind', 'gamma');
});

test('protocol overrides of a built-in remain opaque', () => {
  new Validator().validateProtocol({ types: {
    mapper: container(field('value', 'u8')), Packet: packet(choice({ gamma: 'void' }))
  } });
});

test('custom schemas overriding built-ins remain opaque', () => {
  const validator = new Validator({ mapper: {
    type: 'array', items: [{ enum: ['mapper'] }, { type: 'object' }], additionalItems: false
  } });
  validator.validateType(packet(choice({ gamma: 'void' })));
});

test('custom native fields have unknown output domains', () => {
  new Validator().validateProtocol({ types: { Kind: 'native', Packet: packet(choice({ gamma: 'void' }), 'Kind') } });
});

test('addType schemas do not supply alias definitions or output domains', () => {
  const validator = new Validator();
  validator.addType('Kind', { enum: ['Kind'] });
  validator.validateType(packet(choice({ gamma: 'void' }), 'Kind'));
});

test('parameterized aliases are not expanded as fixed definitions', () => {
  new Validator().validateProtocol({ types: {
    Kind: mapper(), Packet: packet(choice({ gamma: 'void' }), ['Kind', { ignored: true }])
  } });
});

test('unresolved mapper parameters do not imply literal output values', () => {
  new Validator().validateProtocol({ types: {
    Kind: mapper({ 0: '$label' }), Packet: packet(choice({ gamma: 'void' }), 'Kind')
  } });
});

test('conflicting aliases across namespaces are ambiguous', () => {
  new Validator().validateProtocol({ types: { Kind: mapper() }, play: { types: {
    Kind: mapper({ 0: 'gamma' }), Packet: packet(choice({ delta: 'void' }), 'Kind')
  } } });
});

test('independent namespaces do not share alias definitions', () => {
  new Validator().validateProtocol({
    first: { types: { Kind: mapper(), Packet: packet(choice({ alpha: 'void' }), 'Kind') } },
    second: { types: { Kind: mapper({ 0: 'gamma' }), Packet: packet(choice({ gamma: 'void' }), 'Kind') } }
  });
  rejects(() => new Validator().validateProtocol({
    first: { types: { Kind: mapper() } },
    second: { types: { Kind: mapper({ 0: 'gamma' }), Packet: packet(choice({ alpha: 'void' }), 'Kind') } }
  }), 'second.types.Packet', 'kind', 'alpha');
});

test('recursive aliases terminate without inventing a domain', () => {
  new Validator().validateProtocol({ types: {
    First: 'Second', Second: 'First', Packet: packet(choice({ gamma: 'void' }), 'First')
  } });
});

test('recursive container aliases still check non-recursive local relationships', () => {
  rejects(() => new Validator().validateProtocol({ types: {
    Node: container(field('next', ['option', 'Node']), field('kind', mapper()), field('payload', choice({ gamma: 'void' })))
  } }), 'root.types.Node', 'kind', 'gamma');
});

test('dynamic switch keys are skipped without hiding invalid literals', () => {
  new Validator().validateType(packet(choice({ '/selected': 'void', alpha: 'void' })));
  rejects(() => new Validator().validateType(packet(choice({ '/selected': 'void', gamma: 'void' }))), 'payload', 'kind', 'gamma');
});

test('compareToValue and absolute-root comparisons are not inferred', () => {
  new Validator().validateType(packet(['switch', { compareToValue: 'kind', fields: { gamma: 'void' } }]));
  new Validator().validateType(packet(choice({ gamma: 'void' }, '/kind')));
});

test('array-index projections are not treated as container paths', () => {
  new Validator().validateType(container(
    field('entries', ['array', { count: 1, type: container(field('kind', mapper())) }]),
    field('payload', choice({ gamma: 'void' }, 'entries/0/kind'))
  ));
});

test('opaque custom payloads are not recursively interpreted', () => {
  const validator = new Validator();
  validator.addType('wrapper');
  validator.validateType(['wrapper', { type: packet(choice({ gamma: 'void' })) }]);
});

test('unrelated named custom fields do not erase known mapper fields', () => {
  const validator = new Validator();
  validator.addType('custom');
  rejects(() => validator.validateType(container(
    field('kind', mapper()), field('other', 'custom'), field('payload', choice({ gamma: 'void' }))
  )), 'payload', 'kind', 'gamma');
});

test('named custom fields replace same-name assumptions', () => {
  const validator = new Validator();
  validator.addType('custom');
  validator.validateType(container(field('kind', mapper()), field('kind', 'custom'), field('payload', choice({ gamma: 'void' }))));
});

test('anonymous custom output invalidates surrounding field assumptions', () => {
  const validator = new Validator();
  validator.addType('custom');
  validator.validateType(container(field('kind', mapper()), { anon: true, type: 'custom' }, field('payload', choice({ gamma: 'void' }))));
  validator.validateType(packet(container({ anon: true, type: 'custom' }, field('payload', choice({ gamma: 'void' }, '../kind')))));
});

test('self-contained relationships inside anonymous containers are checked', () => {
  rejects(() => new Validator().validateType(container({ anon: true, type: packet(choice({ gamma: 'void' })) })), 'payload', 'kind', 'gamma');
});

test('validation does not mutate input or retain domains between calls', () => {
  const validator = new Validator();
  const protocol = { types: { Kind: mapper(), Packet: packet(choice({ alpha: 'void' }), 'Kind') } };
  const before = JSON.stringify(protocol);
  validator.validateProtocol(protocol);
  validator.validateProtocol(protocol);
  assert.strictEqual(JSON.stringify(protocol), before);
  rejects(() => validator.validateType(packet(choice({ gamma: 'void' }))), 'payload', 'kind', 'gamma');
  validator.validateType(packet(choice({ gamma: 'void' }), 'u8'));
  validator.validateProtocol({ types: { Kind: mapper({ 0: 'gamma' }), Packet: packet(choice({ gamma: 'void' }), 'Kind') } });
});

test('malformed schemas are still rejected', () => {
  assert.throws(() => new Validator().validateType(['switch', { compareTo: 'kind' }]));
  assert.throws(() => new Validator().validateProtocol({ types: { Broken: ['mapper', { type: 'u8' }] } }));
});

console.log(tests + ' validation tests passed');
