# ProtoDef-validator
[![NPM version](https://img.shields.io/npm/v/protodef-validator.svg)](http://npmjs.com/package/protodef-validator)

Validate [ProtoDef](https://github.com/ProtoDef-io/ProtoDef) protocol definition in node

## Installing

```
npm install protodef-validator
```

## Usage

See [example](example.js)

## Command Line Interface

You can install this package globally with `npm install -g protodef-validator` and then run `protodef-validator someProtocol.json` to validate it.

## API

### Validator

Class to make validator instances

#### Validator.addType(name,schema)

add the type `name` with schema `schema`

#### Validator.addTypes(schemas)

Add `schemas` which is an object with keys the name of the schemas and values the schema definitions.

#### Validator.validateType(type)

validates a type definition `type`

throws an exception if the type isn't correct

#### Validator.validateProtocol(protocol)

validates a protocol definition `protocol`

throws an exception if the protocol isn't correct

## History

### 1.0.0 (unreleased)

* can validate types and protocols
