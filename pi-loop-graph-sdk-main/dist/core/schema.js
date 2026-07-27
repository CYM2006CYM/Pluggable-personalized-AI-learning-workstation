import { Compile } from "typebox/compile";
import { isJsonValue } from "./json.js";
const validators = new WeakMap();
export function checkJsonSchemaValue(schema, value) {
    if (!isJsonValue(value)) {
        return Object.freeze({ valid: false, message: "Value is not JSON-compatible" });
    }
    const validator = getValidator(schema);
    if (validator.Check(value))
        return Object.freeze({ valid: true, value });
    const first = validator.Errors(value)[0];
    const location = first?.instancePath ? ` at ${first.instancePath}` : "";
    const detail = first?.message ? `: ${first.message}` : "";
    return Object.freeze({ valid: false, message: `Schema validation failed${location}${detail}` });
}
function getValidator(schema) {
    const cached = validators.get(schema);
    if (cached)
        return cached;
    const validator = Compile(schema);
    validators.set(schema, validator);
    return validator;
}
