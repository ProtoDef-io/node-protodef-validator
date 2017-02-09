const Ajv = require('ajv');
const assert=require("assert");

class Validator {
  constructor(v) {
    this.ajv = new Ajv({verbose:true});
    this.ajv.addSchema(require("./ProtoDef/schemas/definitions.json"),"definitions");
    this.ajv.addSchema(require("./ProtoDef/schemas/protocol_schema.json"),"protocol");
    this.typesSchemas = {};
    this.addDefaultTypes();

    if(v)
      Object.keys(v.typesSchemas).forEach(s => this.addType(s,v.typesSchemas[s]));
  }

  addDefaultTypes() {
    this.addTypes(require("./ProtoDef/schemas/numeric"));
    this.addTypes(require("./ProtoDef/schemas/utils"));
    this.addTypes(require("./ProtoDef/schemas/structures"));
    this.addTypes(require("./ProtoDef/schemas/conditional"));
  }

  addTypes(schemas) {
    Object.keys(schemas).forEach((name) => this.addType(name, schemas[name]));
  }

  addType(name,schema) {
    if(this.typesSchemas[name] != undefined)
      return;

    if(!schema) { // default schema
      schema={
        "oneOf":[
          {"enum":[name]},
          {
            "type": "array",
              "items": [
                {"enum":[name]},
                {"oneOf":[{"type": "object"},{"type": "array"}]}
            ]
          }
        ]};
    }

    this.typesSchemas[name]=schema;
    this.ajv.addSchema(schema, name);

    this.ajv.removeSchema("dataType");
    this.ajv.addSchema({
      "$schema": "http://json-schema.org/draft-04/schema#",
      "title": "dataType",
      "oneOf": [{"enum":["native"]}].concat(Object.keys(this.typesSchemas).map(name => ({"$ref": name})))
    },"dataType");
  }

  validateType(type) {
    let valid = this.ajv.validate("dataType",type);
    if(!valid) {
      console.log(JSON.stringify(this.ajv.errors[0],null,2));
      if(this.ajv.errors[0]['parentSchema']['title']=="dataType") {
        this.validateTypeGoingInside(this.ajv.errors[0]['data']);
      }
      throw new Error("validation error");
    }
  }

  validateTypeGoingInside(type) {
    if(Array.isArray(type)) {
      assert.ok(this.typesSchemas[type[0]]!=undefined,type+" is an undefined type");

      let valid = this.ajv.validate(type[0],type);
      if(!valid) {
        console.log(JSON.stringify(this.ajv.errors[0],null,2));
        if(this.ajv.errors[0]['parentSchema']['title']=="dataType") {
          this.validateTypeGoingInside(this.ajv.errors[0]['data']);
        }
        throw new Error("validation error");
      }
    }
    else {
      if(type=="native")
        return;
      assert.ok(this.typesSchemas[type]!=undefined,type+" is an undefined type");
    }
  }

  validateProtocol(protocol) {
    // 1. validate with protocol schema with basic datatype def
    let valid = this.ajv.validate("protocol",protocol);
    assert.ok(valid, JSON.stringify(this.ajv.errors,null,2));


    // 2. recursively create several validator from current one and validate that
    function validateTypes(p,originalValidator,path) {
      const v=new Validator(originalValidator);
      Object.keys(p).forEach(k => {
        if(k=="types") {
          // 2 steps for recursive types
          Object.keys(p[k]).forEach(typeName => v.addType(typeName));
          Object.keys(p[k]).forEach(typeName => {
            try {
              v.validateType(p[k][typeName], path + "." + k + "." + typeName);
            }
            catch(e) {
              throw new Error("Error at "+path + "." + k + "." + typeName);
            }
          });
        }
        else {
          validateTypes(p[k],v,path+"."+k);
        }
      })
    }
    validateTypes(protocol,this,"root");
  }
}

module.exports=Validator;
