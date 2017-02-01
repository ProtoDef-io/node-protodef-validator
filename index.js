const Ajv = require('ajv');
const assert=require("assert");

class Validator {
  constructor() {
    this.ajv = new Ajv({verbose:true});
    this.ajv.addSchema(require("./ProtoDef/schemas/definitions.json"),"definitions");
    this.ajv.addSchema(require("./ProtoDef/schemas/protocol_schema.json"),"protocol");
    this.subSchemas = [];
    this.addDefaultTypes();
  }

  addDefaultTypes() {
    this.addType("array",require("./ProtoDef/schemas/array.json"));
    this.addType("bitfield",require("./ProtoDef/schemas/bitfield.json"));
    this.addType("buffer",require("./ProtoDef/schemas/buffer.json"));
    this.addType("container",require("./ProtoDef/schemas/container.json"));
    this.addType("count",require("./ProtoDef/schemas/count.json"));
    this.addType("mapper",require("./ProtoDef/schemas/mapper.json"));
    this.addType("option",require("./ProtoDef/schemas/option.json"));
    this.addType("pstring",require("./ProtoDef/schemas/pstring.json"));
    this.addType("switch",require("./ProtoDef/schemas/switch.json"));
  }

  addTypes(schemas) {
    Object.keys(schemas).forEach((name) => this.addType(name, schemas[name]));
  }

  addType(name,schema) {
    this.subSchemas.push(name);
    this.ajv.addSchema(schema, name);

    this.ajv.removeSchema("dataType");
    this.ajv.addSchema({
      "$schema": "http://json-schema.org/draft-04/schema#",
      "title": "dataType",
      "oneOf": [{"$ref": "definitions#/definitions/simpleFieldType"}]
        .concat(this.subSchemas.map(name => ({"$ref": name})))
    },"dataType");
  }

  validateType(type) {
    let valid = this.ajv.validate("dataType",type);
    assert.ok(valid, JSON.stringify(this.ajv.errors,null,2));
  }

  validateProtocol(protocol) {
    let valid = this.ajv.validate("protocol",protocol);
    assert.ok(valid, JSON.stringify(this.ajv.errors,null,2));
  }
}

module.exports=Validator;
